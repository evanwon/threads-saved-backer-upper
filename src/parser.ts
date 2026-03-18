import type { PostData, MediaItem } from "./types.js";

/**
 * Safely extract a string from a nested path.
 */
function getString(obj: unknown, ...keys: string[]): string {
  let current: unknown = obj;
  for (const key of keys) {
    if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[key];
    } else {
      return "";
    }
  }
  return typeof current === "string" ? current : "";
}

/**
 * Safely extract a number from a nested path.
 */
function getNumber(obj: unknown, ...keys: string[]): number {
  let current: unknown = obj;
  for (const key of keys) {
    if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[key];
    } else {
      return 0;
    }
  }
  return typeof current === "number" ? current : 0;
}

/**
 * Extract media items from various Threads post structures.
 */
function extractMedia(post: Record<string, unknown>): MediaItem[] {
  const media: MediaItem[] = [];

  // Carousel media
  const carouselMedia = post.carousel_media as unknown[] | undefined;
  if (Array.isArray(carouselMedia)) {
    for (const item of carouselMedia) {
      if (!item || typeof item !== "object") continue;
      const m = item as Record<string, unknown>;
      const imageVersions = m.image_versions2 as Record<string, unknown>;
      if (imageVersions?.candidates && Array.isArray(imageVersions.candidates)) {
        const best = imageVersions.candidates[0] as Record<string, unknown>;
        if (best?.url) {
          media.push({ type: "image", url: String(best.url) });
        }
      }
      if (m.video_versions && Array.isArray(m.video_versions)) {
        const best = (m.video_versions as Record<string, unknown>[])[0];
        if (best?.url) {
          media.push({ type: "video", url: String(best.url) });
        }
      }
    }
    return media;
  }

  // Single image
  const imageVersions = post.image_versions2 as Record<string, unknown>;
  if (imageVersions?.candidates && Array.isArray(imageVersions.candidates)) {
    const best = imageVersions.candidates[0] as Record<string, unknown>;
    if (best?.url) {
      media.push({ type: "image", url: String(best.url) });
    }
  }

  // Single video
  if (post.video_versions && Array.isArray(post.video_versions)) {
    const best = (post.video_versions as Record<string, unknown>[])[0];
    if (best?.url) {
      media.push({ type: "video", url: String(best.url) });
    }
  }

  return media;
}

/**
 * Parse a raw thread item (from the scraper) into a PostData object.
 */
function parseItem(raw: unknown): PostData | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  // The post data might be at the top level or nested under "post"
  const post = (
    record.post && typeof record.post === "object" ? record.post : record
  ) as Record<string, unknown>;

  const id = String(post.pk ?? post.id ?? post.code ?? "");
  if (!id) return null;

  // Author info
  const user = post.user as Record<string, unknown> | undefined;
  const author = user
    ? getString(user, "username")
    : getString(post, "user", "username");
  const authorVerified = user
    ? Boolean(user.is_verified)
    : false;

  // Text content
  const caption = post.caption as Record<string, unknown> | undefined;
  const text = caption
    ? getString(caption, "text")
    : getString(post, "text") || getString(post, "caption", "text");

  // Timestamp
  const takenAt = post.taken_at as number | undefined;
  const timestamp = takenAt
    ? new Date(takenAt * 1000).toISOString()
    : new Date().toISOString();

  // Post URL
  const code = getString(post, "code");
  const url = code
    ? `https://www.threads.net/post/${code}`
    : `https://www.threads.net/post/${id}`;

  // Engagement metrics
  const likes = getNumber(post, "like_count");
  const replies = getNumber(post, "text_post_app_reply_count") ||
    getNumber(post, "reply_count");
  const reposts = getNumber(post, "repost_count") ||
    getNumber(post, "text_post_app_share_count");

  // Media
  const media = extractMedia(post);

  return {
    id,
    author: author ? `@${author}` : "@unknown",
    authorVerified,
    text,
    timestamp,
    url,
    likes,
    replies,
    reposts,
    media,
  };
}

/**
 * Parse an array of raw scraped items into PostData objects.
 */
export function parseThreadsData(rawItems: unknown[]): PostData[] {
  const posts: PostData[] = [];
  const seenIds = new Set<string>();

  for (const item of rawItems) {
    const post = parseItem(item);
    if (post && !seenIds.has(post.id)) {
      seenIds.add(post.id);
      posts.push(post);
    }
  }

  return posts;
}
