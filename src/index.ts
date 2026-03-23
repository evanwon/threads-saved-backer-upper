import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { authenticate } from "./auth.js";
import { scrapeSavedPosts } from "./scraper.js";
import { parseThreadsData } from "./parser.js";
import { downloadImages } from "./downloader.js";
import { generateMarkdownFiles } from "./markdown.js";
import { loadState, saveState, addBackedUpPosts } from "./state.js";
import { resolveConfig } from "./config.js";
import { generateGallery } from "./gallery.js";

async function main() {
  console.log("Threadsafe\n");

  const config = await resolveConfig();
  const OUTPUT_DIR = config.outputDir;
  console.log(`Output directory: ${OUTPUT_DIR}`);

  // Ensure output directories exist
  await mkdir(resolve(OUTPUT_DIR, "posts"), { recursive: true });
  await mkdir(resolve(OUTPUT_DIR, "assets"), { recursive: true });

  if (config.galleryOnly) {
    console.log("Gallery-only mode: regenerating HTML from existing posts...");
    await generateGallery(OUTPUT_DIR);
    console.log("\nDone!");
    return;
  }

  // Load backup state
  const state = await loadState();
  const knownIds = new Set(state.backedUpPostIds);
  console.log(
    `Loaded state: ${knownIds.size} previously backed-up posts.`
  );

  // Authenticate
  const { context, closeBrowser } = await authenticate();

  try {
    // Scrape saved posts
    const rawItems = await scrapeSavedPosts(context, knownIds);

    if (rawItems.length === 0) {
      console.log("No new posts found.");
    } else {
      // Parse into structured data
      const posts = parseThreadsData(rawItems);
      console.log(`Parsed ${posts.length} posts.`);

      if (posts.length === 0) {
        console.log("No posts could be parsed from scraped data.");
      } else {
        // Download images
        const postsWithImages = await downloadImages(posts, OUTPUT_DIR);

        // Generate markdown files
        const written = await generateMarkdownFiles(
          postsWithImages,
          OUTPUT_DIR
        );
        console.log(`Wrote ${written} markdown files to ${OUTPUT_DIR}/posts/`);

        // Update state
        const newPostIds = posts.map((p) => p.id);
        const updatedState = addBackedUpPosts(state, newPostIds);
        await saveState(updatedState);
        console.log(
          `State updated: ${updatedState.backedUpPostIds.length} total backed-up posts.`
        );
      }
    }
  } catch (err) {
    console.error("Error during backup:", err);

    // Try to save partial state even on error
    try {
      await saveState(state);
    } catch {
      // Ignore save errors during crash
    }

    process.exitCode = 1;
  } finally {
    await closeBrowser();
  }

  // Generate gallery (always runs, even if no new posts or on error)
  await generateGallery(OUTPUT_DIR);

  console.log("\nDone!");
}

main();
