/**
 * Playwright-based gallery render validation.
 *
 * Generates a gallery from test fixture data, opens it in headless Chromium,
 * and checks for JavaScript errors / missing elements.
 *
 * Usage:
 *   npx tsx tests/validate-render.ts [path/to/index.html]
 *
 * If no path is given, generates a temporary gallery from fixture data.
 */

import { chromium } from "playwright";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { generateHtml } from "../src/gallery.js";
import type { GalleryPost } from "../src/types.js";

const FIXTURES: GalleryPost[] = [
  {
    id: "1",
    author: "@alice",
    verified: true,
    avatar: "assets/alice-profile.jpg",
    date: "2024-03-01T12:00:00.000Z",
    url: "https://www.threads.net/post/1",
    likes: 100,
    replies: 5,
    reposts: 2,
    text: "A text-only post",
    media: [],
  },
  {
    id: "2",
    author: "@bob",
    verified: false,
    date: "2024-03-02T12:00:00.000Z",
    url: "https://www.threads.net/post/2",
    likes: 50,
    replies: 1,
    reposts: 0,
    text: "Post with an image",
    media: [{ type: "image", src: "assets/2-0.jpg" }],
  },
  {
    id: "3",
    author: "@carol",
    verified: false,
    date: "2024-03-03T12:00:00.000Z",
    url: "https://www.threads.net/post/3",
    likes: 200,
    replies: 10,
    reposts: 5,
    text: "Post with video",
    media: [
      {
        type: "video",
        src: "https://example.com/video.mp4",
        poster: "assets/3-0.jpg",
      },
    ],
  },
  {
    id: "4",
    author: "@dave",
    verified: false,
    date: "2024-03-04T12:00:00.000Z",
    url: "https://www.threads.net/post/4",
    likes: 10,
    replies: 0,
    reposts: 0,
    text: "Video without poster",
    media: [{ type: "video", src: "https://example.com/video2.mp4" }],
  },
  {
    id: "5",
    author: "@eve",
    verified: false,
    date: "2024-03-05T12:00:00.000Z",
    url: "https://www.threads.net/post/5",
    likes: 30,
    replies: 2,
    reposts: 1,
    text: "Check out my note",
    note: "This is a long note with detailed content.\n\nIt spans multiple paragraphs and contains useful information.",
    media: [],
  },
  {
    id: "6",
    author: "@frank",
    verified: false,
    date: "2024-03-06T12:00:00.000Z",
    url: "https://www.threads.net/post/6",
    likes: 15,
    replies: 1,
    reposts: 3,
    text: "This is such a great point",
    media: [],
    quotedPost: {
      author: "@grace",
      verified: true,
      text: "Original thought here with some detail",
      url: "https://www.threads.net/post/99",
      media: [{ type: "image", src: "assets/6-q0.jpg" }],
    },
  },
  {
    id: "7",
    author: "@eve",
    verified: false,
    date: "2024-03-07T12:00:00.000Z",
    url: "https://www.threads.net/post/7",
    likes: 8,
    replies: 0,
    reposts: 0,
    text: "You should add this to your agents.md",
    isReply: true,
    replyToAuthor: "@frank",
    media: [],
  },
];

async function validate(htmlPath?: string): Promise<void> {
  let tempDir: string | null = null;
  let filePath: string;

  if (htmlPath) {
    filePath = htmlPath;
  } else {
    tempDir = await mkdtemp(join(tmpdir(), "threadsafe-validate-"));
    const html = generateHtml(FIXTURES);
    filePath = join(tempDir, "index.html");
    await writeFile(filePath, html, "utf-8");
    console.log(`Generated test gallery: ${filePath}`);
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Capture console errors (ignore resource loading failures for missing fixture assets)
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" && !text.includes("ERR_FILE_NOT_FOUND") && !text.includes("ERR_CERT_AUTHORITY_INVALID")) {
      errors.push(`Console error: ${text}`);
    } else if (msg.type() === "warning") {
      warnings.push(`Console warning: ${text}`);
    }
  });

  // Capture page errors (uncaught exceptions)
  page.on("pageerror", (err) => {
    errors.push(`Page error: ${err.message}`);
  });

  const url = pathToFileURL(filePath).href;
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Wait for gallery to initialize
  await page.waitForSelector(".post", { timeout: 5000 });

  // Check: posts rendered
  const postCount = await page.locator(".post").count();
  console.log(`Posts rendered: ${postCount}`);
  if (postCount === 0) {
    errors.push("No posts rendered");
  }

  // Check: header elements exist
  const headerChecks = ["#search", "#authorFilter", "#sortMode", ".logo"];
  for (const sel of headerChecks) {
    const count = await page.locator(sel).count();
    if (count === 0) errors.push(`Missing element: ${sel}`);
  }

  // Check: video containers rendered for video posts
  const videoContainers = await page.locator(".video-container").count();
  const videoElements = await page.locator(".post-video").count();
  console.log(
    `Video containers (click-to-play): ${videoContainers}, Direct video elements: ${videoElements}`
  );

  // Check: no old-style video placeholders
  const oldPlaceholders = await page.locator(".video-placeholder").count();
  if (oldPlaceholders > 0) {
    errors.push(
      `Found ${oldPlaceholders} old-style .video-placeholder elements`
    );
  }

  // Check: reply banner renders for reply posts
  const replyBanners = await page.locator(".reply-banner").count();
  console.log(`Reply banners: ${replyBanners}`);
  if (replyBanners === 0) errors.push("Reply banner not rendered for reply post");

  // Check: grid view works
  await page.click("#gridBtn");
  await page.waitForTimeout(200);
  const gridMode = await page.locator("#feed.grid-mode").count();
  if (gridMode === 0) errors.push("Grid mode did not activate");

  // Check: clicking grid post opens modal
  const gridPost = page.locator("#feed.grid-mode .post").first();
  if ((await gridPost.count()) > 0) {
    await gridPost.click();
    await page.waitForTimeout(200);
    const modal = await page.locator(".modal-backdrop").count();
    if (modal === 0) errors.push("Modal did not open on grid click");
    // Close modal
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }

  // Check: feed view works
  await page.click("#feedBtn");
  await page.waitForTimeout(200);
  const feedMode = await page.locator("#feed:not(.grid-mode)").count();
  if (feedMode === 0) errors.push("Feed mode did not activate");

  // Check: note embed renders (fixture data only — real data may not have notes)
  const noteEmbeds = await page.locator(".note-embed").count();
  if (!htmlPath) {
    if (noteEmbeds === 0) errors.push("No .note-embed elements rendered");
    const noteLabels = await page.locator(".note-label").count();
    if (noteLabels === 0) errors.push("No .note-label elements rendered");
  }
  console.log(`Note embeds: ${noteEmbeds}`);

  // Check: quote embed renders (fixture data only)
  const quoteEmbeds = await page.locator(".quote-embed").count();
  if (!htmlPath) {
    if (quoteEmbeds === 0) errors.push("No .quote-embed elements rendered");
    const quoteAuthors = await page.locator(".quote-author-name").count();
    if (quoteAuthors === 0) errors.push("No .quote-author-name elements rendered");
  }
  console.log(`Quote embeds: ${quoteEmbeds}`);

  // Check: search works (fixture data only — real data may not contain "alice")
  if (!htmlPath) {
    await page.fill("#search", "alice");
    await page.waitForTimeout(300);
    const filteredCount = await page.locator(".post").count();
    console.log(`Posts after search "alice": ${filteredCount}`);
    if (filteredCount === 0) errors.push("Search returned no results for 'alice'");
    if (filteredCount >= postCount)
      errors.push("Search did not filter results");
  }

  await browser.close();

  // Cleanup temp dir
  if (tempDir) {
    await rm(tempDir, { recursive: true });
  }

  // Report
  console.log("");
  if (warnings.length > 0) {
    console.log(`Warnings (${warnings.length}):`);
    for (const w of warnings) console.log(`  ${w}`);
  }
  if (errors.length > 0) {
    console.log(`ERRORS (${errors.length}):`);
    for (const e of errors) console.log(`  ${e}`);
    process.exit(1);
  } else {
    console.log("All render checks passed.");
  }
}

const customPath = process.argv[2];
validate(customPath).catch((err) => {
  console.error("Validation failed:", err);
  process.exit(1);
});
