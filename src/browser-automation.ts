import type { ListingDraft, Platform } from "./types.js";
import { truthy } from "./env.js";

export interface BrowserFlowConfig {
  url: string;
  titleSelector: string;
  descriptionSelector: string;
  priceSelector: string;
  imageInputSelector: string;
  publishSelector: string;
  successSelector?: string;
  successUrlIncludes?: string;
}

export interface BrowserAutomationOptions {
  headless?: boolean;
}

export interface BrowserPublishResult {
  message: string;
  url?: string;
  status?: "published" | "unknown";
}

function browserEnabled(): boolean {
  return truthy(process.env.ENABLE_BROWSER_AUTOMATION);
}

function platformEnvName(platform: Exclude<Platform, "ebay">): string {
  return `${platform.toUpperCase()}_BROWSER_FLOW`;
}

function readFlowRaw(platform: Exclude<Platform, "ebay">): string | undefined {
  return process.env[platformEnvName(platform)] ?? process.env[`BROWSER_FLOW_${platform.toUpperCase()}`];
}

function expectedHost(platform: Exclude<Platform, "ebay">): string {
  return platform === "poshmark" ? "poshmark.com" : "depop.com";
}

function isExpectedPlatformUrl(platform: Exclude<Platform, "ebay">, value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const expected = expectedHost(platform);
  return parsed.protocol === "https:" && !parsed.username && !parsed.password && (host === expected || host.endsWith(`.${expected}`));
}

function requiredString(flow: Record<string, unknown>, key: string, platform: string): string {
  const value = flow[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${platform} browser flow is missing required field ${key}`);
  }
  const trimmed = value.trim();
  if (trimmed.length > 2_048) throw new Error(`${platform} browser flow field ${key} is too long`);
  return trimmed;
}

function validateSuccessUrl(platform: Exclude<Platform, "ebay">, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > 2_048) throw new Error(`${platform} browser flow field successUrlIncludes is too long`);
  if (/^https?:\/\//i.test(trimmed) && !isExpectedPlatformUrl(platform, trimmed)) {
    throw new Error(`${platform} successUrlIncludes must point at the expected ${expectedHost(platform)} domain`);
  }
  return trimmed;
}

function parseFlow(platform: Exclude<Platform, "ebay">): BrowserFlowConfig {
  const raw = readFlowRaw(platform);
  if (!raw) {
    throw new Error(
      `${platform} browser publishing is not configured. Set ENABLE_BROWSER_AUTOMATION=1 and ${platformEnvName(platform)} to a JSON flow definition.`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${platform} browser flow JSON is invalid: ${String(error instanceof Error ? error.message : error)}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${platform} browser flow must be a JSON object`);
  }

  const flow = parsed as Record<string, unknown>;
  const config: BrowserFlowConfig = {
    url: requiredString(flow, "url", platform),
    titleSelector: requiredString(flow, "titleSelector", platform),
    descriptionSelector: requiredString(flow, "descriptionSelector", platform),
    priceSelector: requiredString(flow, "priceSelector", platform),
    imageInputSelector: requiredString(flow, "imageInputSelector", platform),
    publishSelector: requiredString(flow, "publishSelector", platform),
  };

  if (!isExpectedPlatformUrl(platform, config.url)) {
    throw new Error(`${platform} browser flow URL must be an HTTPS ${expectedHost(platform)} URL`);
  }

  const successSelector = flow.successSelector;
  if (typeof successSelector === "string" && successSelector.trim()) {
    const trimmed = successSelector.trim();
    if (trimmed.length > 2_048) throw new Error(`${platform} browser flow field successSelector is too long`);
    config.successSelector = trimmed;
  }
  const successUrlIncludes = flow.successUrlIncludes;
  if (typeof successUrlIncludes === "string" && successUrlIncludes.trim()) {
    config.successUrlIncludes = validateSuccessUrl(platform, successUrlIncludes);
  }

  if (!config.successSelector && !config.successUrlIncludes) {
    throw new Error(
      `${platform} browser flow needs either successSelector or successUrlIncludes so the publish result can be verified`
    );
  }

  return config;
}

async function loadPlaywright(): Promise<any> {
  try {
    const specifier = "playwright" as string;
    return await import(specifier);
  } catch (error) {
    throw new Error(
      `Playwright is not installed. Install it locally (npm install -D playwright) to enable browser automation. ${String(
        error instanceof Error ? error.message : error
      )}`
    );
  }
}

export async function publishViaBrowser(
  platform: Exclude<Platform, "ebay">,
  listing: ListingDraft,
  photoPaths: string[],
  options: BrowserAutomationOptions = {}
): Promise<BrowserPublishResult> {
  if (!browserEnabled()) {
    throw new Error(
      `Browser automation is disabled. Set ENABLE_BROWSER_AUTOMATION=1 and configure ${platform.toUpperCase()}_BROWSER_FLOW.`
    );
  }

  const flow = parseFlow(platform);
  const { chromium } = await loadPlaywright();
  const headless = options.headless ?? !truthy(process.env.BROWSER_AUTOMATION_HEADFUL);
  const profileDir = process.env.BROWSER_AUTOMATION_PROFILE_DIR?.trim() || "";

  let browser: any = null;
  let context: any = null;
  let publishClicked = false;

  try {
    if (profileDir) {
      context = await chromium.launchPersistentContext(profileDir, { headless });
    } else {
      browser = await chromium.launch({ headless });
      context = await browser.newContext();
    }

    const page = await context.newPage();
    await page.goto(flow.url, { waitUntil: "domcontentloaded" });

    if (!photoPaths.length) {
      throw new Error(`${platform} browser publish needs local photo paths`);
    }

    await page.locator(flow.imageInputSelector).setInputFiles(photoPaths);
    await page.locator(flow.titleSelector).fill(listing.title);
    await page.locator(flow.descriptionSelector).fill(listing.description);
    await page.locator(flow.priceSelector).fill(listing.price.toFixed(2));
    publishClicked = true;
    const beforePublishUrl = page.url();
    await page.locator(flow.publishSelector).click();

    if (flow.successSelector) {
      await page.locator(flow.successSelector).first().waitFor({ state: "visible", timeout: 60_000 });
    } else if (flow.successUrlIncludes) {
      await page.waitForURL(
        (url: URL) => url.toString() !== beforePublishUrl && url.toString().includes(flow.successUrlIncludes!),
        { timeout: 60_000 }
      );
    }

    if (!isExpectedPlatformUrl(platform, page.url())) {
      throw new Error(`success verification ended on an unexpected URL (${page.url()})`);
    }

    return {
      message: `${platform} browser flow completed and success was verified at ${page.url()}`,
      url: page.url(),
      status: "published",
    };
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    if (publishClicked) {
      throw new Error(`${platform} browser publish status is unknown; the submit may have succeeded. Verify before retrying. ${message}`);
    }
    throw new Error(`${platform} browser publish failed before submit: ${message}`);
  } finally {
    try {
      if (context) {
        await context.close();
      }
    } catch {
      // Close best-effort.
    }
    try {
      if (browser) {
        await browser.close();
      }
    } catch {
      // Close best-effort.
    }
  }
}
