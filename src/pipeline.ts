import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { authenticate } from "./auth.js";
import { scrapeSavedPosts } from "./scraper.js";
import { parseThreadsData } from "./parser.js";
import { downloadImages, downloadProfilePics } from "./downloader.js";
import { generateMarkdownFiles } from "./markdown.js";
import { loadState, saveState, addBackedUpPosts } from "./state.js";
import { generateGallery } from "./gallery.js";

export type ProgressCallback = (step: string, detail: string) => void;

export interface PipelineResult {
  newPosts: number;
  totalPosts: number;
  error?: string;
}

/**
 * Run the full scrape pipeline: auth -> scrape -> parse -> download -> markdown -> state -> gallery.
 * Reports progress via onProgress callback at each phase.
 */
export async function runPipeline(
  outputDir: string,
  onProgress: ProgressCallback
): Promise<PipelineResult> {
  // Ensure output directories exist
  await mkdir(resolve(outputDir, "posts"), { recursive: true });
  await mkdir(resolve(outputDir, "assets"), { recursive: true });

  // Authenticate
  onProgress("auth", "Validating session...");
  const { context, closeBrowser } = await authenticate();
  onProgress("auth", "Session valid");

  // Load backup state
  const state = await loadState();
  const knownIds = new Set(state.backedUpPostIds);
  onProgress("scrape", `Loaded state: ${knownIds.size} previously backed-up posts`);

  let newPostCount = 0;
  let totalPostCount = state.backedUpPostIds.length;
  let errorMessage: string | undefined;

  try {
    // Scrape saved posts
    onProgress("scrape", "Navigating to saved posts...");
    const rawItems = await scrapeSavedPosts(context, knownIds);

    if (rawItems.length === 0) {
      onProgress("scrape", "No new posts found");
    } else {
      // Parse into structured data
      const posts = parseThreadsData(rawItems);
      onProgress("parse", `Parsed ${posts.length} posts`);

      if (posts.length === 0) {
        onProgress("parse", "No posts could be parsed from scraped data");
      } else {
        // Download images and profile pictures
        onProgress("download", "Downloading images...");
        const postsWithImages = await downloadImages(posts, outputDir);
        onProgress("download", "Downloading profile pictures...");
        await downloadProfilePics(posts, outputDir);

        // Generate markdown files
        onProgress("markdown", "Writing markdown files...");
        const written = await generateMarkdownFiles(postsWithImages, outputDir);
        onProgress("markdown", `Wrote ${written} markdown files`);

        // Update state. newPostCount is the delta against state, not posts.length —
        // a post can be re-parsed on a retry but already exist in state.
        onProgress("state", "Updating backup state...");
        const newPostIds = posts.map((p) => p.id);
        const updatedState = addBackedUpPosts(state, newPostIds);
        await saveState(updatedState);
        newPostCount = updatedState.backedUpPostIds.length - state.backedUpPostIds.length;
        totalPostCount = updatedState.backedUpPostIds.length;
        onProgress(
          "state",
          `State updated: ${totalPostCount} total backed-up posts`
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onProgress("error", `Error during backup: ${message}`);
    errorMessage = message;

    // Try to save partial state even on error
    try {
      await saveState(state);
    } catch {
      // Ignore save errors during crash
    }
  } finally {
    await closeBrowser();
  }

  // Generate gallery (always runs, even if no new posts or on error)
  onProgress("gallery", "Regenerating gallery...");
  await generateGallery(outputDir);

  if (errorMessage) {
    return { newPosts: newPostCount, totalPosts: totalPostCount, error: errorMessage };
  }

  onProgress("done", `Complete — ${newPostCount} new posts backed up`);
  return { newPosts: newPostCount, totalPosts: totalPostCount };
}
