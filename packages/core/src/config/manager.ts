import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { configSchema, createDefaultConfig, type AbfConfig } from "./schema.js";

const ABF_HOME = join(homedir(), ".abf");
const CONFIG_FILE = join(ABF_HOME, "config.json");

/**
 * Load the global ABF configuration from ~/.abf/config.json.
 * Creates the file with defaults if it doesn't exist.
 * Merges stored config with defaults so new fields are always present.
 */
export function loadConfig(): AbfConfig {
  ensureConfigDir();

  if (!existsSync(CONFIG_FILE)) {
    const defaults = createDefaultConfig();
    saveConfig(defaults);
    return defaults;
  }

  const raw = readFileSync(CONFIG_FILE, "utf-8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupted config file — reset to defaults
    const defaults = createDefaultConfig();
    saveConfig(defaults);
    return defaults;
  }

  // Validate and apply defaults for any missing fields
  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    // Invalid config — merge what we can with defaults
    const defaults = createDefaultConfig();
    saveConfig(defaults);
    return defaults;
  }

  return result.data;
}

/**
 * Save the config to ~/.abf/config.json.
 */
export function saveConfig(config: AbfConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Update specific fields of the config (deep merge).
 */
export function updateConfig(partial: Partial<AbfConfig>): AbfConfig {
  const current = loadConfig();
  const merged = deepMerge(current, partial) as AbfConfig;
  const validated = configSchema.parse(merged);
  saveConfig(validated);
  return validated;
}

/**
 * Get the path to the ABF home directory (~/.abf).
 */
export function getAbfHome(): string {
  return ABF_HOME;
}

/**
 * Get the path to the config file.
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
}

function ensureConfigDir(): void {
  if (!existsSync(ABF_HOME)) {
    mkdirSync(ABF_HOME, { recursive: true });
  }
}

function deepMerge(
  target: Record<string, any>,
  source: Record<string, any>,
): Record<string, any> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (
      sourceVal &&
      typeof sourceVal === "object" &&
      !Array.isArray(sourceVal) &&
      targetVal &&
      typeof targetVal === "object" &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(targetVal, sourceVal);
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
}
