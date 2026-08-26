import type { ListingDraft, Platform } from "./types.js";

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
}

function truthy(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
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

function requiredString(flow: Record<string, unknown>, key: string, platform: string): string {
  const value = flow[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${platform} browser flow is missing required field ${key}`);
  }
  return value.trim();
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

  const successSelector = flow.successSelector;
  if (typeof successSelector === "string" && successSelector.trim()) {
    config.successSelector = successSelector.trim();
  }
  const successUrlIncludes = flow.successUrlIncludes;
  if (typeof successUrlIncludes === "string" && successUrlIncludes.trim()) {
    config.successUrlIncludes = successUrlIncludes.trim();
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
    await page.locator(flow.publishSelector).click();

    if (flow.successSelector) {
      await page.locator(flow.successSelector).first().waitFor({ state: "visible", timeout: 60_000 });
    } else if (flow.successUrlIncludes) {
      await page.waitForURL((url: URL) => url.toString().includes(flow.successUrlIncludes!), { timeout: 60_000 });
    }

    return {
      message: `${platform} browser flow completed`,
      url: page.url(),
    };
  } catch (error) {
    throw new Error(`${platform} browser publish failed: ${String(error instanceof Error ? error.message : error)}`);
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
