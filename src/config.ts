import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Config } from "./types.js";

const CONFIG_PATH = resolve("config.json");
const DEFAULT_OUTPUT_DIR = resolve("output");

export async function loadConfig(): Promise<Config> {
  if (!existsSync(CONFIG_PATH)) {
    return { outputDir: DEFAULT_OUTPUT_DIR };
  }
  try {
    const data = JSON.parse(await readFile(CONFIG_PATH, "utf-8"));
    return {
      outputDir: data.outputDir
        ? resolve(data.outputDir)
        : DEFAULT_OUTPUT_DIR,
    };
  } catch {
    return { outputDir: DEFAULT_OUTPUT_DIR };
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Parse CLI args and merge with saved config.
 * Priority: --output flag > config.json > default ./output
 */
export async function resolveConfig(): Promise<Config & { galleryOnly: boolean }> {
  const config = await loadConfig();
  const args = process.argv.slice(2);
  let galleryOnly = false;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--output" || args[i] === "-o") && args[i + 1]) {
      config.outputDir = resolve(args[i + 1]);
      i++;
    }
    if (args[i] === "--save-config") {
      await saveConfig(config);
      console.log(`Config saved to ${CONFIG_PATH}`);
    }
    if (args[i] === "--gallery-only") {
      galleryOnly = true;
    }
  }

  return { ...config, galleryOnly };
}
