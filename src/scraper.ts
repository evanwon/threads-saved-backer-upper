import type { BrowserContext } from "playwright";

export interface RawPostData {
  scriptJson: unknown;
  postId?: string;
}

/**
 * Recursively search a JSON object for arrays that look like thread items.
 * Threads embeds post data in <script type="application/json" data-sjs> tags
 * inside deeply nested `require` call structures.
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

export async function scrapeSavedPosts(
  context: BrowserContext,
  knownPostIds: Set<string>
): Promise<unknown[]> {
  const page = await context.newPage();
  const collectedItems: unknown[] = [];
  const seenIds = new Set<string>();
  let noNewContentCount = 0;
  const MAX_EMPTY_SCROLLS = 5;

  try {
    console.log("Navigating to saved posts...");
    await page.goto("https://www.threads.net/saved", {
      waitUntil: "networkidle",
    });

    // Wait for initial content
    await page.waitForTimeout(3000);

    let scrollCount = 0;
    let hitKnownPost = false;

    while (!hitKnownPost && noNewContentCount < MAX_EMPTY_SCROLLS) {
      scrollCount++;

      // Extract JSON data from all script tags
      const scriptData = await page.evaluate(() => {
        const scripts = document.querySelectorAll(
          'script[type="application/json"][data-sjs]'
        );
        return Array.from(scripts).map((s) => s.textContent);
      });

      let newItemsThisScroll = 0;

      for (const text of scriptData) {
        if (!text) continue;
        try {
          const json = JSON.parse(text);
          const items = findThreadItems(json);

          for (const item of items) {
            const postId = extractPostId(item);
            if (!postId) continue;
            if (seenIds.has(postId)) continue;

            seenIds.add(postId);

            if (knownPostIds.has(postId)) {
              console.log(
                `Found already backed-up post ${postId}, stopping scroll.`
              );
              hitKnownPost = true;
              break;
            }

            collectedItems.push(item);
            newItemsThisScroll++;
          }

          if (hitKnownPost) break;
        } catch {
          // Invalid JSON, skip
        }
      }

      if (newItemsThisScroll === 0) {
        noNewContentCount++;
      } else {
        noNewContentCount = 0;
      }

      console.log(
        `Scroll #${scrollCount}: ${newItemsThisScroll} new items (${collectedItems.length} total)`
      );

      if (hitKnownPost) break;

      // Scroll down
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));

      // Random delay between 1-3 seconds
      const delay = 1000 + Math.random() * 2000;
      await page.waitForTimeout(delay);
    }

    console.log(
      `Scraping complete. Collected ${collectedItems.length} posts.`
    );
    return collectedItems;
  } finally {
    await page.close();
  }
}
