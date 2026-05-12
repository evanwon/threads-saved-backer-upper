import type { PostData, MediaItem, QuotedPost } from "./types.js";

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
 * Keys whose subtrees must NOT be walked when scanning for post media.
 * These commonly contain unrelated image/video fields that would otherwise
 * get attributed to the outer post:
 *  - user, reply_to_author: profile pics
 *  - quoted_post: belongs to the embedded quoted post, handled separately
 *  - preview_comments, comments, reply_facepile_users: other users' avatars
 *  - music_metadata, music_info, original_sound_info: audio artwork
 *  - sharing_friction_info, friction_info, disclaimer_info: policy banners
 *  - link_preview_attachment, attached_story: external media previews
 */
const MEDIA_RECURSION_DENYLIST = new Set([
  "user",
  "reply_to_author",
  "quoted_post",
  "preview_comments",
  "comments",
  "reply_facepile_users",
  "music_metadata",
  "music_info",
  "original_sound_info",
  "sharing_friction_info",
  "friction_info",
  "disclaimer_info",
  "link_preview_attachment",
  "attached_story",
]);

/**
 * Recursively search a post object for video_versions and image_versions2 keys.
 * Used as a fallback when fixed-path extraction finds no media — handles embedded
 * Instagram content (reels, reposts, quoted posts) where media is nested deeper.
 */
function findMediaRecursive(
  obj: unknown,
  results: MediaItem[],
  depth = 0,
): MediaItem[] {
  if (obj === null || obj === undefined || depth > 10) return results;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      findMediaRecursive(item, results, depth + 1);
    }
    return results;
  }

  if (typeof obj === "object") {
    const record = obj as Record<string, unknown>;

    // Check for video_versions array
    if (record.video_versions && Array.isArray(record.video_versions)) {
      const best = (record.video_versions as Record<string, unknown>[])[0];
      if (best?.url) {
        results.push({ type: "video", url: String(best.url) });
      }
    }

    // Check for image_versions2.candidates array
    const iv2 = record.image_versions2 as Record<string, unknown> | undefined;
    if (iv2?.candidates && Array.isArray(iv2.candidates)) {
      const best = (iv2.candidates as Record<string, unknown>[])[0];
      if (best?.url) {
        results.push({ type: "image", url: String(best.url) });
      }
    }

    // Recurse into remaining values, skipping known-unrelated subtrees
    for (const [key, value] of Object.entries(record)) {
      if (MEDIA_RECURSION_DENYLIST.has(key)) continue;
      findMediaRecursive(value, results, depth + 1);
    }
  }

  return results;
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

  // Fallback: if no media found via fixed paths, search recursively
  // (handles embedded Instagram content nested in reposted_post, clips_metadata, etc.)
  if (media.length === 0) {
    const found = findMediaRecursive(post, []);
    const seenUrls = new Set<string>();
    for (const item of found) {
      if (!seenUrls.has(item.url)) {
        seenUrls.add(item.url);
        media.push(item);
      }
    }
  }

  return media;
}

/**
 * Join a text_fragments.fragments array by concatenating the plaintext field
 * of each fragment. Threads embeds newlines and spacing *inside* the plaintext
 * of each fragment, so fragments are always joined with no separator.
 */
function joinFragments(fragments: unknown[]): string {
  const parts: string[] = [];
  for (const frag of fragments) {
    if (frag && typeof frag === "object") {
      const plaintext = (frag as Record<string, unknown>).plaintext;
      if (typeof plaintext === "string") {
        parts.push(plaintext);
      }
    }
  }
  return parts.join("");
}

/**
 * Reconstruct post text from text_fragments when available.
 * The Threads API's caption.text field can lose characters (e.g. stripping
 * '@' from '@AGENTS.md'). The text_fragments array in text_post_app_info
 * preserves the original text faithfully by splitting it into typed fragments
 * (plaintext, mention, link) each with a plaintext field.
 */
function getTextFromFragments(post: Record<string, unknown>): string | null {
  const tpai = post.text_post_app_info as Record<string, unknown> | undefined;
  if (!tpai) return null;
  const tf = tpai.text_fragments as Record<string, unknown> | undefined;
  if (!tf) return null;
  const fragments = tf.fragments;
  if (!Array.isArray(fragments) || fragments.length === 0) return null;
  const result = joinFragments(fragments);
  return result || null;
}

/**
 * Extract the "note" / long-form snippet text attached to a post, if any.
 * Threads stores this under text_post_app_info.snippet_attachment_info as a
 * parallel text_fragments structure.
 */
function getNoteFromSnippet(post: Record<string, unknown>): string | undefined {
  const tpai = post.text_post_app_info as Record<string, unknown> | undefined;
  const snippet = tpai?.snippet_attachment_info as Record<string, unknown> | undefined;
  const tf = snippet?.text_fragments as Record<string, unknown> | undefined;
  const fragments = tf?.fragments;
  if (!Array.isArray(fragments) || fragments.length === 0) return undefined;
  const result = joinFragments(fragments);
  return result || undefined;
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
  const profilePicUrl = user
    ? getString(user, "profile_pic_url")
    : "";

  // Text content — prefer text_fragments (preserves @mentions and special chars)
  // over caption.text (which can strip characters like '@')
  const caption = post.caption as Record<string, unknown> | undefined;
  const text = getTextFromFragments(post)
    ?? (caption
      ? getString(caption, "text")
      : getString(post, "text") || getString(post, "caption", "text"));

  const textPostAppInfo = post.text_post_app_info as Record<string, unknown> | undefined;

  // Note content (Threads "snippet" / long-form note attachment)
  const note = getNoteFromSnippet(post);

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

  // Quoted post (quote repost — user quotes another user's post with added text)
  let quotedPost: QuotedPost | undefined;
  const shareInfo = textPostAppInfo?.share_info as Record<string, unknown> | undefined;
  const quotedRaw = (shareInfo?.quoted_post ?? shareInfo?.reposted_post) as Record<string, unknown> | undefined;
  if (quotedRaw) {
    const qUser = quotedRaw.user as Record<string, unknown> | undefined;
    const qUsername = qUser ? getString(qUser, "username") : "";
    if (qUsername) {
      const qVerified = Boolean(qUser?.is_verified);
      const qProfilePic = qUser ? getString(qUser, "profile_pic_url") : "";
      const qText = getTextFromFragments(quotedRaw)
        ?? getString(quotedRaw, "caption", "text");
      const qCode = getString(quotedRaw, "code");
      const qUrl = qCode ? `https://www.threads.net/post/${qCode}` : "";
      const qMedia = extractMedia(quotedRaw);

      quotedPost = {
        author: `@${qUsername}`,
        authorVerified: qVerified,
        profilePicUrl: qProfilePic,
        text: qText,
        url: qUrl,
        media: qMedia,
      };
    }
  }

  // Reply detection via text_post_app_info
  const isReply = textPostAppInfo ? Boolean(textPostAppInfo.is_reply) : false;
  const replyToAuthorRaw = textPostAppInfo
    ? getString(textPostAppInfo, "reply_to_author", "username")
    : "";

  return {
    id,
    author: author ? `@${author}` : "@unknown",
    authorVerified,
    profilePicUrl,
    text,
    note,
    timestamp,
    url,
    likes,
    replies,
    reposts,
    media,
    quotedPost,
    isReply,
    replyToAuthor: replyToAuthorRaw ? `@${replyToAuthorRaw}` : undefined,
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
