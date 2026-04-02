import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, parseBody, generateHtml } from "../src/gallery.js";
import type { GalleryPost } from "../src/types.js";

describe("parseFrontmatter", () => {
  it("parses basic frontmatter", () => {
    const content = `---
id: 123
author: "@alice"
date: 2024-01-15
---

Hello world`;
    const result = parseFrontmatter(content);
    assert.ok(result);
    assert.equal(result.meta.id, "123");
    assert.equal(result.meta.author, "@alice");
    assert.equal(result.meta.date, "2024-01-15");
    assert.equal(result.body, "Hello world");
  });

  it("handles quoted YAML values", () => {
    const content = `---
author: "@bob"
url: "https://threads.net/post/123"
---

text`;
    const result = parseFrontmatter(content);
    assert.ok(result);
    assert.equal(result.meta.author, "@bob");
    assert.equal(result.meta.url, "https://threads.net/post/123");
  });

  it("returns null for malformed content", () => {
    assert.equal(parseFrontmatter("no frontmatter here"), null);
    assert.equal(parseFrontmatter("---\nno closing delimiter"), null);
  });
});

describe("parseBody", () => {
  it("extracts text before media", () => {
    const body = `Some post text here

![](assets/123-0.jpg)`;
    const result = parseBody(body);
    assert.equal(result.text, "Some post text here");
  });

  it("parses standalone images", () => {
    const body = `Text

![](assets/123-0.jpg)

![](assets/123-1.jpg)

---
[View on Threads](https://threads.net)`;
    const result = parseBody(body);
    assert.equal(result.media.length, 2);
    assert.equal(result.media[0].type, "image");
    assert.equal(result.media[0].src, "assets/123-0.jpg");
    assert.equal(result.media[1].type, "image");
    assert.equal(result.media[1].src, "assets/123-1.jpg");
  });

  it("pairs adjacent image + video as video with poster", () => {
    const body = `Post text

![](assets/123-0.jpg)

[Video](https://cdn.threads.net/video.mp4)

---
[View on Threads](https://threads.net)`;
    const result = parseBody(body);
    assert.equal(result.media.length, 1);
    assert.equal(result.media[0].type, "video");
    assert.equal(result.media[0].src, "https://cdn.threads.net/video.mp4");
    assert.equal(result.media[0].poster, "assets/123-0.jpg");
  });

  it("handles video without preceding image", () => {
    const body = `Text

[Video](https://cdn.threads.net/video.mp4)

---
[View on Threads](https://threads.net)`;
    const result = parseBody(body);
    assert.equal(result.media.length, 1);
    assert.equal(result.media[0].type, "video");
    assert.equal(result.media[0].src, "https://cdn.threads.net/video.mp4");
    assert.equal(result.media[0].poster, undefined);
  });

  it("handles carousel with mixed images and videos", () => {
    const body = `Carousel post

![](assets/123-0.jpg)

![](assets/123-1.jpg)

[Video](https://cdn.threads.net/video.mp4)

![](assets/123-3.jpg)

---
[View on Threads](https://threads.net)`;
    const result = parseBody(body);
    assert.equal(result.media.length, 3);
    // First image is standalone (next non-blank is another image, not a video)
    assert.equal(result.media[0].type, "image");
    assert.equal(result.media[0].src, "assets/123-0.jpg");
    // Second image is paired with video
    assert.equal(result.media[1].type, "video");
    assert.equal(result.media[1].poster, "assets/123-1.jpg");
    assert.equal(result.media[1].src, "https://cdn.threads.net/video.mp4");
    // Third image is standalone
    assert.equal(result.media[2].type, "image");
    assert.equal(result.media[2].src, "assets/123-3.jpg");
  });

  it("handles text-only posts", () => {
    const body = `Just some text

---
[View on Threads](https://threads.net)`;
    const result = parseBody(body);
    assert.equal(result.text, "Just some text");
    assert.equal(result.media.length, 0);
  });
});

describe("generateHtml", () => {
  const samplePost: GalleryPost = {
    id: "123",
    author: "@testuser",
    verified: false,
    date: "2024-01-15T00:00:00.000Z",
    url: "https://www.threads.net/post/123",
    likes: 42,
    replies: 3,
    reposts: 1,
    text: "Hello world",
    media: [{ type: "image", src: "assets/123-0.jpg" }],
  };

  const videoPost: GalleryPost = {
    id: "456",
    author: "@viduser",
    verified: false,
    date: "2024-02-01T00:00:00.000Z",
    url: "https://www.threads.net/post/456",
    likes: 10,
    replies: 0,
    reposts: 0,
    text: "Video post",
    media: [
      {
        type: "video",
        src: "https://cdn.threads.net/video.mp4",
        poster: "assets/456-0.jpg",
      },
    ],
  };

  it("produces valid HTML structure", () => {
    const html = generateHtml([samplePost]);
    assert.ok(html.startsWith("<!DOCTYPE html>"));
    assert.ok(html.includes("<title>Threadsafe</title>"));
    assert.ok(html.includes("</html>"));
  });

  it("embeds posts as JSON", () => {
    const html = generateHtml([samplePost]);
    assert.ok(html.includes('"id":"123"'));
    assert.ok(html.includes('"author":"@testuser"'));
  });

  it("includes video rendering functions", () => {
    const html = generateHtml([videoPost]);
    assert.ok(html.includes("function playVideo("));
    assert.ok(html.includes("function renderMediaHtml("));
    assert.ok(html.includes("video-container"));
  });

  it("includes CSS for video elements", () => {
    const html = generateHtml([videoPost]);
    assert.ok(html.includes(".video-container"));
    assert.ok(html.includes(".play-overlay"));
    assert.ok(html.includes(".post-video"));
  });

  it("does not contain old video-placeholder references", () => {
    const html = generateHtml([videoPost]);
    assert.ok(!html.includes("video-placeholder"));
    assert.ok(!html.includes("Open video"));
  });

  it("renders img avatar when avatar path is provided", () => {
    const postWithAvatar: GalleryPost = {
      ...samplePost,
      avatar: "assets/testuser-profile.jpg",
    };
    const html = generateHtml([postWithAvatar]);
    assert.ok(html.includes('"avatar":"assets/testuser-profile.jpg"'));
    assert.ok(html.includes("function renderAvatarHtml("));
    assert.ok(html.includes("function avatarFallbackHtml("));
  });

  it("falls back to initial avatar when no avatar path", () => {
    const html = generateHtml([samplePost]);
    assert.ok(html.includes("function avatarFallbackHtml("));
    // samplePost has no avatar field, so JSON should not contain avatar key
    assert.ok(!html.includes('"avatar":"assets/'));
  });

  it("linkify: includes linkify function in output", () => {
    const html = generateHtml([samplePost]);
    assert.ok(html.includes("function linkify("));
  });

  it("linkify: embeds correct regex with proper escaping", () => {
    const html = generateHtml([samplePost]);
    // Backslashes must survive the template literal: \s and \/ in the output
    assert.ok(html.includes("https?:\\/\\/[^\\s)&]+"));
  });

  it("linkify: uses linkify for post text in feed and modal views", () => {
    const html = generateHtml([samplePost]);
    // Feed and modal views should use linkify(), not esc(), for post text
    const linkifyCalls = html.match(/linkify\(p\.text\)/g) || [];
    assert.ok(linkifyCalls.length >= 2, "expected linkify(p.text) in feed and modal views");
  });

  it("linkify: post data with URL includes href-friendly characters", () => {
    const postWithUrl: GalleryPost = {
      ...samplePost,
      text: "Visit https://example.com/path?q=1&r=2 for info",
    };
    const html = generateHtml([postWithUrl]);
    // The post text in JSON should preserve the URL with & escaped for JSON
    assert.ok(html.includes("https://example.com/path?q=1\\u0026r=2") ||
              html.includes("https://example.com/path?q=1&r=2"));
  });

  it("linkify: strips trailing punctuation in regex", () => {
    const html = generateHtml([samplePost]);
    // The linkify function should include the trailing punctuation strip
    assert.ok(html.includes('.replace(/[.,;:!]+$/,"")'));
  });
});
