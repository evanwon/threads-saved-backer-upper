import { writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { PostData } from "./types.js";

const CONCURRENCY_LIMIT = 3;

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(dest, buffer);
}

/**
 * Download images for all posts with a concurrency limit.
 * Videos are skipped (URL is preserved in PostData for linking).
 * Returns the updated posts with localPath set on downloaded images.
 */
export async function downloadImages(
  posts: PostData[],
  outputDir: string
): Promise<PostData[]> {
  const assetsDir = resolve(outputDir, "assets");

  // Build download queue
  const queue: { post: PostData; mediaIndex: number; dest: string }[] = [];

  for (const post of posts) {
    for (let i = 0; i < post.media.length; i++) {
      const item = post.media[i];
      if (item.type !== "image") continue;

      const ext = item.url.match(/\.(jpe?g|png|webp|gif)/i)?.[1] ?? "jpg";
      const filename = `${post.id}-${i}.${ext}`;
      const dest = join(assetsDir, filename);

      item.localPath = join("assets", filename);
      queue.push({ post, mediaIndex: i, dest });
    }
  }

  if (queue.length === 0) {
    console.log("No images to download.");
    return posts;
  }

  console.log(`Downloading ${queue.length} images...`);
  let completed = 0;
  let skipped = 0;

  // Process queue with concurrency limit
  const pending = new Set<Promise<void>>();

  for (const job of queue) {
    const task = (async () => {
      if (await fileExists(job.dest)) {
        skipped++;
        return;
      }
      try {
        await downloadFile(job.post.media[job.mediaIndex].url, job.dest);
        completed++;
      } catch (err) {
        console.error(
          `Failed to download image for post ${job.post.id}: ${err}`
        );
        // Clear localPath on failure so markdown won't reference missing file
        job.post.media[job.mediaIndex].localPath = undefined;
      }
    })();

    pending.add(task);
    task.finally(() => pending.delete(task));

    if (pending.size >= CONCURRENCY_LIMIT) {
      await Promise.race(pending);
    }
  }

  await Promise.all(pending);
  console.log(
    `Downloaded ${completed} images (${skipped} already existed).`
  );

  return posts;
}
