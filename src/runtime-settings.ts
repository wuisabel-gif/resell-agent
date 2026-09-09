/**
 * Runtime-only settings accepted by the local GUI.
 *
 * These values intentionally live in process.env for the lifetime of the
 * process, but are never part of a DraftRecord or an API response. Empty
 * fields are treated as omitted so a GUI opened against an existing .env file
 * continues to use the process-start configuration. The explicit reset API
 * restores those process-start values.
 */

export const RUNTIME_SETTING_KEYS = [
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_API_KEY",
  "EBAY_CLIENT_ID",
  "EBAY_CLIENT_SECRET",
  "EBAY_ENV",
  "EBAY_REDIRECT_URI",
  "EBAY_USER_REFRESH_TOKEN",
] as const;

export const RUNTIME_SECRET_KEYS = [
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "EBAY_CLIENT_SECRET",
  "EBAY_USER_REFRESH_TOKEN",
] as const;

export type RuntimeSettingKey = (typeof RUNTIME_SETTING_KEYS)[number];
export type RuntimeSettings = Partial<Record<RuntimeSettingKey, string>>;

const MAX_VALUE_LENGTH: Record<RuntimeSettingKey, number> = {
  ANTHROPIC_AUTH_TOKEN: 8_192,
  ANTHROPIC_BASE_URL: 2_048,
  ANTHROPIC_MODEL: 256,
  ANTHROPIC_API_KEY: 8_192,
  EBAY_CLIENT_ID: 256,
  EBAY_CLIENT_SECRET: 8_192,
  EBAY_ENV: 32,
  EBAY_REDIRECT_URI: 2_048,
  EBAY_USER_REFRESH_TOKEN: 8_192,
};

const startupEnvironment = new Map<RuntimeSettingKey, string | undefined>(
  RUNTIME_SETTING_KEYS.map((key) => [key, process.env[key]])
);

function isRuntimeSettingKey(value: string): value is RuntimeSettingKey {
  return (RUNTIME_SETTING_KEYS as readonly string[]).includes(value);
}

function settingError(key: string, message: string): Error {
  return new Error(`${key} ${message}.`);
}

function validateUrl(value: string, key: RuntimeSettingKey): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw settingError(key, "must be a valid URL");
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || !parsed.hostname) {
    throw settingError(key, "must use http or https");
  }
  if (parsed.username || parsed.password) throw settingError(key, "may not contain embedded credentials");
  if (parsed.search || parsed.hash) throw settingError(key, "may not contain a query or fragment");
  return parsed.toString().replace(/\/$/, "");
}

/**
 * Validate and normalize untrusted GUI input without touching process.env.
 * Unknown keys fail closed so a browser cannot use this endpoint as a general
 * process environment setter. Blank strings are omitted from the patch.
 */
export function validateRuntimeSettings(value: unknown): RuntimeSettings {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("settings must be an object.");
  }

  const input = value as Record<string, unknown>;
  const result: RuntimeSettings = {};
  for (const key of Object.keys(input)) {
    if (!isRuntimeSettingKey(key)) throw new Error(`Unsupported runtime setting: ${key}.`);
    const candidate = input[key];
    if (candidate === undefined || candidate === null) continue;
    if (typeof candidate !== "string") throw settingError(key, "must be text");
    if (candidate.length > MAX_VALUE_LENGTH[key]) throw settingError(key, "is too long");
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) throw settingError(key, "contains unsupported control characters");

    if (key === "EBAY_ENV") {
      const env = trimmed.toLowerCase();
      if (env !== "sandbox" && env !== "production") throw new Error("EBAY_ENV must be sandbox or production.");
      result[key] = env;
    } else if (key === "ANTHROPIC_BASE_URL") {
      result[key] = validateUrl(trimmed, key);
    } else {
      result[key] = trimmed;
    }
  }
  return result;
}

/** Pure merge used by the request boundary and tests. */
export function mergeRuntimeSettings(base: RuntimeSettings, patch: RuntimeSettings): RuntimeSettings {
  return { ...base, ...patch };
}

/** Apply validated settings to process.env for this process only. */
export function applyRuntimeSettings(value: unknown): RuntimeSettings {
  const patch = validateRuntimeSettings(value);
  for (const [key, candidate] of Object.entries(patch) as [RuntimeSettingKey, string][]) {
    process.env[key] = candidate;
  }
  return patch;
}

/**
 * Restore only the environment keys this feature is allowed to touch. This
 * does not write a file and is safe to call even when no GUI settings arrived.
 */
export function resetRuntimeSettings(): void {
  for (const key of RUNTIME_SETTING_KEYS) {
    const original = startupEnvironment.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
}

/** Return the keys accepted by the GUI without returning their values. */
export function runtimeSettingKeys(): readonly RuntimeSettingKey[] {
  return RUNTIME_SETTING_KEYS;
}
