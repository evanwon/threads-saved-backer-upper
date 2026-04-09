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
  const queue: { post: PostData; mediaIndex: number; dest: string; quoted?: boolean }[] = [];

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

    // Quoted post images (use "q" prefix to distinguish from outer media)
    if (post.quotedPost) {
      for (let i = 0; i < post.quotedPost.media.length; i++) {
        const item = post.quotedPost.media[i];
        if (item.type !== "image") continue;

        const ext = item.url.match(/\.(jpe?g|png|webp|gif)/i)?.[1] ?? "jpg";
        const filename = `${post.id}-q${i}.${ext}`;
        const dest = join(assetsDir, filename);

        item.localPath = join("assets", filename);
        queue.push({ post, mediaIndex: i, dest, quoted: true });
      }
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
      const mediaArr = job.quoted ? job.post.quotedPost!.media : job.post.media;
      try {
        await downloadFile(mediaArr[job.mediaIndex].url, job.dest);
        completed++;
      } catch (err) {
        console.error(
          `Failed to download image for post ${job.post.id}: ${err}`
        );
        // Clear localPath on failure so markdown won't reference missing file
        mediaArr[job.mediaIndex].localPath = undefined;
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

/**
 * Download profile pictures for all unique authors.
 * Always overwrites to keep avatars current across runs.
 */
export async function downloadProfilePics(
  posts: PostData[],
  outputDir: string
): Promise<void> {
  const assetsDir = resolve(outputDir, "assets");

  // Deduplicate by author — keep first non-empty profilePicUrl per author
  const authorPics = new Map<string, string>();
  for (const post of posts) {
    if (post.profilePicUrl && !authorPics.has(post.author)) {
      authorPics.set(post.author, post.profilePicUrl);
    }
    if (post.quotedPost?.profilePicUrl && !authorPics.has(post.quotedPost.author)) {
      authorPics.set(post.quotedPost.author, post.quotedPost.profilePicUrl);
    }
  }

  if (authorPics.size === 0) {
    return;
  }

  console.log(`Downloading ${authorPics.size} profile pictures...`);
  let completed = 0;

  const pending = new Set<Promise<void>>();

  for (const [author, url] of authorPics) {
    const task = (async () => {
      const username = author.replace(/^@/, "");
      const ext = url.match(/\.(jpe?g|png|webp|gif)/i)?.[1] ?? "jpg";
      const dest = join(assetsDir, `${username}-profile.${ext}`);
      try {
        await downloadFile(url, dest);
        completed++;
      } catch (err) {
        console.error(`Failed to download profile pic for ${author}: ${err}`);
      }
    })();

    pending.add(task);
    task.finally(() => pending.delete(task));

    if (pending.size >= CONCURRENCY_LIMIT) {
      await Promise.race(pending);
    }
  }

  await Promise.all(pending);
  console.log(`Downloaded ${completed} profile pictures.`);
}
