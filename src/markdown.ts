import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { PostData } from "./types.js";

/**
 * Sanitize a string for use as a filename.
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/**
 * Generate a slug from the post text (first few words).
 */
function textSlug(text: string): string {
  const words = text
    .replace(/\n/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join("-");
  return sanitizeFilename(words) || "no-text";
}

/**
 * Build the markdown filename for a post.
 */
function buildFilename(post: PostData): string {
  const author = post.author.replace("@", "");
  const date = post.timestamp.slice(0, 10); // YYYY-MM-DD
  const slug = textSlug(post.text);
  return `${date}-${sanitizeFilename(author)}-${slug}.md`;
}

/**
 * Escape YAML string values.
 */
function yamlString(value: string): string {
  if (
    value.includes(":") ||
    value.includes("#") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.startsWith("@")
  ) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return value;
}

/**
 * Generate the markdown content for a single post.
 */
function generateMarkdownContent(post: PostData): string {
  const lines: string[] = [];

  // YAML frontmatter
  lines.push("---");
  lines.push(`id: ${yamlString(post.id)}`);
  lines.push(`author: ${yamlString(post.author)}`);
  lines.push(`verified: ${post.authorVerified}`);
  lines.push(`date: ${post.timestamp}`);
  lines.push(`url: ${yamlString(post.url)}`);
  lines.push(`likes: ${post.likes}`);
  lines.push(`replies: ${post.replies}`);
  lines.push(`reposts: ${post.reposts}`);
  lines.push(`source: threads`);
  if (post.quotedPost) {
    lines.push(`quoted_author: ${yamlString(post.quotedPost.author)}`);
    lines.push(`quoted_verified: ${post.quotedPost.authorVerified}`);
    if (post.quotedPost.url) {
      lines.push(`quoted_url: ${yamlString(post.quotedPost.url)}`);
    }
  }
  if (post.isReply) {
    lines.push(`isReply: true`);
    if (post.replyToAuthor) {
      lines.push(`replyToAuthor: ${yamlString(post.replyToAuthor)}`);
    }
  }
  lines.push("---");
  lines.push("");

  // Post text
  if (post.text) {
    lines.push(post.text);
    lines.push("");
  }

  // Note (embedded long-form text)
  if (post.note) {
    lines.push("> [!note]");
    for (const noteLine of post.note.split("\n")) {
      lines.push(`> ${noteLine}`);
    }
    lines.push("");
  }

  // Quoted post (quote repost)
  if (post.quotedPost) {
    const qp = post.quotedPost;
    const verifiedMark = qp.authorVerified ? " \u2713" : "";
    lines.push(`> [!quote] ${qp.author}${verifiedMark}`);
    if (qp.text) {
      for (const qLine of qp.text.split("\n")) {
        lines.push(`> ${qLine}`);
      }
    }
    for (const item of qp.media) {
      lines.push(">");
      if (item.type === "image" && item.localPath) {
        lines.push(`> ![](${item.localPath.replace(/\\/g, "/")})`);
      } else if (item.type === "video") {
        lines.push(`> [Video](${item.url})`);
      } else if (item.type === "image") {
        lines.push(`> ![](${item.url})`);
      }
    }
    if (qp.url) {
      lines.push(">");
      lines.push(`> [View quoted post](${qp.url})`);
    }
    lines.push("");
  }

  // Media
  for (const item of post.media) {
    if (item.type === "image" && item.localPath) {
      lines.push(`![](${item.localPath.replace(/\\/g, "/")})`);
    } else if (item.type === "video") {
      lines.push(`[Video](${item.url})`);
    } else if (item.type === "image") {
      // Image failed to download, link to original
      lines.push(`![](${item.url})`);
    }
    lines.push("");
  }

  // Source link
  lines.push("---");
  lines.push(`[View on Threads](${post.url})`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Write a markdown file for each post.
 * Returns the number of files written.
 */
export async function generateMarkdownFiles(
  posts: PostData[],
  outputDir: string
): Promise<number> {
  const postsDir = join(outputDir, "posts");
  const usedFilenames = new Set<string>();
  let written = 0;

  for (const post of posts) {
    let filename = buildFilename(post);

    // Handle collisions
    if (usedFilenames.has(filename) || existsSync(join(postsDir, filename))) {
      let counter = 2;
      while (true) {
        const candidate = filename.replace(/\.md$/, `-${counter}.md`);
        if (
          !usedFilenames.has(candidate) &&
          !existsSync(join(postsDir, candidate))
        ) {
          filename = candidate;
          break;
        }
        counter++;
      }
    }

    usedFilenames.add(filename);

    const content = generateMarkdownContent(post);
    await writeFile(join(postsDir, filename), content, "utf-8");
    written++;
  }

  return written;
}
