import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { BackupState } from "./types.js";

const STATE_PATH = resolve("state.json");

export async function loadState(): Promise<BackupState> {
  if (!existsSync(STATE_PATH)) {
    return { lastRunAt: "", backedUpPostIds: [] };
  }
  try {
    const data = JSON.parse(await readFile(STATE_PATH, "utf-8"));
    return {
      lastRunAt: data.lastRunAt ?? "",
      backedUpPostIds: data.backedUpPostIds ?? [],
    };
  } catch {
    return { lastRunAt: "", backedUpPostIds: [] };
  }
}

export async function saveState(state: BackupState): Promise<void> {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

export function addBackedUpPosts(
  state: BackupState,
  postIds: string[]
): BackupState {
  const idSet = new Set(state.backedUpPostIds);
  for (const id of postIds) {
    idSet.add(id);
  }
  return {
    lastRunAt: new Date().toISOString(),
    backedUpPostIds: [...idSet],
  };
}
