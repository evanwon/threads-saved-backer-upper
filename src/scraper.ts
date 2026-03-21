import type { BrowserContext } from "playwright";

/**
 * Recursively search a JSON object for arrays that look like thread items.
 * Threads embeds post data in deeply nested structures — both in initial
 * <script data-sjs> tags and in GraphQL API responses during scroll.
 */
function findThreadItems(obj: unknown, results: unknown[] = []): unknown[] {
  if (obj === null || obj === undefined) return results;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      findThreadItems(item, results);
    }
    return results;
  }

  if (typeof obj === "object") {
    const record = obj as Record<string, unknown>;

    // Look for objects that have post-like properties
    if (
      record.post &&
      typeof record.post === "object" &&
      (record.post as Record<string, unknown>).pk
    ) {
      results.push(record);
    }

    // Look for thread_items arrays
    if (record.thread_items && Array.isArray(record.thread_items)) {
      for (const item of record.thread_items) {
        results.push(item);
      }
    }

    // Look for items inside edges (GraphQL-style)
    if (record.edges && Array.isArray(record.edges)) {
      for (const edge of record.edges) {
        if (
          edge &&
          typeof edge === "object" &&
          (edge as Record<string, unknown>).node
        ) {
          findThreadItems((edge as Record<string, unknown>).node, results);
        }
      }
    }

    // Recurse into all values
    for (const value of Object.values(record)) {
      findThreadItems(value, results);
    }
  }

  return results;
}

/**
 * Extract a post ID from a thread item object by searching common key patterns.
 */
function extractPostId(item: unknown): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const record = item as Record<string, unknown>;

  // Direct ID fields
  if (record.id && typeof record.id === "string") return record.id;
  if (record.pk && typeof record.pk === "string") return record.pk;

  // Nested in post object
  if (record.post && typeof record.post === "object") {
    const post = record.post as Record<string, unknown>;
    if (post.pk) return String(post.pk);
    if (post.id) return String(post.id);
    if (post.code) return String(post.code);
  }

  return undefined;
}

/**
 * Process a JSON blob (from script tags or network responses) and extract new posts.
 */
function processJson(
  json: unknown,
  seenIds: Set<string>,
  knownPostIds: Set<string>,
  collectedItems: unknown[]
): { newCount: number; hitKnown: boolean } {
  const items = findThreadItems(json);
  let newCount = 0;
  let hitKnown = false;

  for (const item of items) {
    const postId = extractPostId(item);
    if (!postId) continue;
    if (seenIds.has(postId)) continue;

    seenIds.add(postId);

    if (knownPostIds.has(postId)) {
      console.log(
        `Found already backed-up post ${postId}, stopping.`
      );
      hitKnown = true;
      break;
    }

    collectedItems.push(item);
    newCount++;
  }

  return { newCount, hitKnown };
}

export async function scrapeSavedPosts(
  context: BrowserContext,
  knownPostIds: Set<string>
): Promise<unknown[]> {
  const page = await context.newPage();
  const collectedItems: unknown[] = [];
  const seenIds = new Set<string>();
  let hitKnownPost = false;
  let noNewContentCount = 0;
  const MAX_EMPTY_SCROLLS = 8;

  // Listen for network responses that contain post data (API calls)
  let pendingNewItems = 0;
  page.on("response", async (response) => {
    const url = response.url();

    // Match Threads API endpoints
    if (
      !url.includes("/api/graphql") &&
      !url.includes("/graphql") &&
      !url.includes("/api/v1/")
    ) return;

    try {
      const body = await response.text();
      // Responses may be multipart or JSON
      const jsonTexts: string[] = [];

      // Handle "for (;;);" prefix that Meta APIs sometimes use
      const cleaned = body.replace(/^for\s*\(;;\)\s*;\s*/, "");

      // Try parsing as single JSON
      try {
        JSON.parse(cleaned);
        jsonTexts.push(cleaned);
      } catch {
        // Try splitting on newlines (streaming JSON responses)
        for (const line of cleaned.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            try {
              JSON.parse(trimmed);
              jsonTexts.push(trimmed);
            } catch {
              // skip
            }
          }
        }
      }

      for (const text of jsonTexts) {
        const json = JSON.parse(text);
        const { newCount, hitKnown } = processJson(
          json,
          seenIds,
          knownPostIds,
          collectedItems
        );
        if (newCount > 0) {
          pendingNewItems += newCount;
        }
        if (hitKnown) {
          hitKnownPost = true;
        }
      }
    } catch {
      // Response not JSON or unreadable, skip
    }
  });

  try {
    console.log("Navigating to saved posts...");
    await page.goto("https://www.threads.net/saved", {
      waitUntil: "networkidle",
    });

    // Wait for initial content
    await page.waitForTimeout(3000);

    // Extract from initial script tags
    const scriptData = await page.evaluate(() => {
      const scripts = document.querySelectorAll(
        'script[type="application/json"][data-sjs]'
      );
      return Array.from(scripts).map((s) => s.textContent);
    });

    for (const text of scriptData) {
      if (!text) continue;
      try {
        const json = JSON.parse(text);
        const { hitKnown } = processJson(
          json,
          seenIds,
          knownPostIds,
          collectedItems
        );
        if (hitKnown) hitKnownPost = true;
      } catch {
        // skip
      }
    }

    console.log(
      `Initial load: ${collectedItems.length} posts from script tags.`
    );

    // Scroll loop to load more content via API
    let scrollCount = 0;

    while (!hitKnownPost && noNewContentCount < MAX_EMPTY_SCROLLS) {
      scrollCount++;
      pendingNewItems = 0;

      // Scroll to the very bottom of current content
      await page.evaluate(() =>
        window.scrollTo(0, document.body.scrollHeight)
      );

      // Wait for network responses (random delay 2-4s to be safe)
      const delay = 2000 + Math.random() * 2000;
      await page.waitForTimeout(delay);

      if (pendingNewItems > 0) {
        noNewContentCount = 0;
        console.log(
          `Scroll #${scrollCount}: ${pendingNewItems} new items (${collectedItems.length} total)`
        );
      } else {
        noNewContentCount++;
        console.log(
          `Scroll #${scrollCount}: no new items (${noNewContentCount}/${MAX_EMPTY_SCROLLS} empty)`
        );
      }
    }

    console.log(
      `Scraping complete. Collected ${collectedItems.length} posts.`
    );
    return collectedItems;
  } finally {
    await page.close();
  }
}
