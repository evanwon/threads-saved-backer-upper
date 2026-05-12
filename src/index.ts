import { mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { authenticate } from "./auth.js";
import { scrapeSavedPosts, scrapeSinglePost } from "./scraper.js";
import { parseThreadsData } from "./parser.js";
import { downloadImages, downloadProfilePics } from "./downloader.js";
import { generateMarkdownFiles } from "./markdown.js";
import { resolveConfig } from "./config.js";
import { generateGallery } from "./gallery.js";
import { runPipeline } from "./pipeline.js";
import { STATE_PATH } from "./state.js";

async function main() {
  console.log("Threadsafe\n");

  const config = await resolveConfig();
  const OUTPUT_DIR = config.outputDir;
  console.log(`Output directory: ${OUTPUT_DIR}`);

  // Handle --reset / --reset-all
  if (config.reset) {
    if (config.galleryOnly || config.url || config.dumpRaw) {
      console.error("Error: --reset cannot be combined with --gallery-only, --url, or --dump-raw.");
      process.exitCode = 1;
      return;
    }

    const postsDir = resolve(OUTPUT_DIR, "posts");
    const assetsDir = resolve(OUTPUT_DIR, "assets");
    const galleryPath = resolve(OUTPUT_DIR, "index.html");

    let postsDeleted = 0;
    if (existsSync(postsDir)) {
      const files = await readdir(postsDir);
      postsDeleted = files.filter((f) => f.endsWith(".md")).length;
      await rm(postsDir, { recursive: true });
    }
    if (existsSync(STATE_PATH)) await rm(STATE_PATH);
    if (existsSync(galleryPath)) await rm(galleryPath);

    if (config.resetAll && existsSync(assetsDir)) {
      await rm(assetsDir, { recursive: true });
      console.log(`Reset: deleted ${postsDeleted} posts, state, gallery, and assets.`);
    } else {
      console.log(`Reset: deleted ${postsDeleted} posts, state, and gallery. Assets preserved.`);
    }
  }

  // Ensure output directories exist
  await mkdir(resolve(OUTPUT_DIR, "posts"), { recursive: true });
  await mkdir(resolve(OUTPUT_DIR, "assets"), { recursive: true });

  if (config.galleryOnly) {
    console.log("Gallery-only mode: regenerating HTML from existing posts...");
    await generateGallery(OUTPUT_DIR);
    console.log("\nDone!");
    return;
  }

  // Dump-raw and single-post modes need their own auth
  if (config.dumpRaw) {
    const { context, closeBrowser } = await authenticate();
    try {
      const rawItems = config.url
        ? await scrapeSinglePost(context, config.url)
        : await scrapeSavedPosts(context, new Set());
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const dumpPath = resolve(OUTPUT_DIR, `raw-dump-${timestamp}.json`);
      await writeFile(dumpPath, JSON.stringify(rawItems, null, 2), "utf-8");
      console.log(`Dumped ${rawItems.length} raw items to ${dumpPath}`);
    } finally {
      await closeBrowser();
    }
    console.log("\nDone!");
    return;
  }

  if (config.url) {
    // Single-post scrape: parse + download + markdown + gallery regen.
    // Does NOT update state.json — this mode is for ad-hoc fetches.
    const { context, closeBrowser } = await authenticate();
    try {
      const rawItems = await scrapeSinglePost(context, config.url);
      const posts = parseThreadsData(rawItems);
      console.log(`Parsed ${posts.length} post(s).`);
      if (posts.length > 0) {
        const postsWithImages = await downloadImages(posts, OUTPUT_DIR);
        await downloadProfilePics(posts, OUTPUT_DIR);
        const written = await generateMarkdownFiles(postsWithImages, OUTPUT_DIR);
        console.log(`Wrote ${written} markdown file(s) to ${OUTPUT_DIR}/posts/`);
      }
    } finally {
      await closeBrowser();
    }
    await generateGallery(OUTPUT_DIR);
    console.log("\nDone!");
    return;
  }

  const result = await runPipeline(OUTPUT_DIR, (step, detail) =>
    console.log(`[${step}] ${detail}`)
  );

  if (result.error) {
    process.exitCode = 1;
  }

  console.log("\nDone!");
}

main();
