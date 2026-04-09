import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseThreadsData } from "../src/parser.js";

/** Helper to build a minimal thread item wrapper around a post object. */
function threadItem(post: Record<string, unknown>) {
  return { post: { pk: "test-id", code: "ABC", user: { username: "tester", is_verified: false, profile_pic_url: "https://example.com/pic.jpg" }, caption: { text: "test" }, taken_at: 1700000000, ...post } };
}

describe("parseThreadsData — text extraction from text_fragments", () => {
  it("prefers text_fragments over caption.text", () => {
    const items = [threadItem({
      // caption.text is the lossy version
      caption: { text: "Check out AGENTS.md" },
      text_post_app_info: {
        text_fragments: {
          fragments: [
            { fragment_type: "plaintext", plaintext: "Check out " },
            { fragment_type: "link", plaintext: "AGENTS.md" },
          ],
        },
      },
    })];
    const posts = parseThreadsData(items);
    assert.equal(posts[0].text, "Check out AGENTS.md");
  });

  it("preserves @ in text_fragments that caption.text strips", () => {
    const items = [threadItem({
      caption: { text: "Link with:\n\n`AGENTS.md`" },
      text_post_app_info: {
        text_fragments: {
          fragments: [
            { fragment_type: "plaintext", plaintext: "Link with:\n\n`@AGENTS.md`" },
          ],
        },
      },
    })];
    const posts = parseThreadsData(items);
    assert.equal(posts[0].text, "Link with:\n\n`@AGENTS.md`");
  });

  it("reconstructs text with mention fragments", () => {
    const items = [threadItem({
      caption: { text: "@boris_cherny is great" },
      text_post_app_info: {
        text_fragments: {
          fragments: [
            { fragment_type: "mention", plaintext: "@boris_cherny", mention_fragment: { mentioned_user: { username: "boris_cherny" } } },
            { fragment_type: "plaintext", plaintext: " is great" },
          ],
        },
      },
    })];
    const posts = parseThreadsData(items);
    assert.equal(posts[0].text, "@boris_cherny is great");
  });

  it("falls back to caption.text when no text_fragments", () => {
    const items = [threadItem({
      caption: { text: "Simple post" },
    })];
    const posts = parseThreadsData(items);
    assert.equal(posts[0].text, "Simple post");
  });

  it("falls back to caption.text when text_fragments is empty", () => {
    const items = [threadItem({
      caption: { text: "Fallback text" },
      text_post_app_info: {
        text_fragments: { fragments: [] },
      },
    })];
    const posts = parseThreadsData(items);
    assert.equal(posts[0].text, "Fallback text");
  });
});

describe("parseThreadsData — media extraction", () => {
  it("extracts a direct video", () => {
    const items = [threadItem({
      video_versions: [{ url: "https://cdn.threads.net/video.mp4", width: 720 }],
    })];
    const posts = parseThreadsData(items);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].media.length, 1);
    assert.equal(posts[0].media[0].type, "video");
    assert.equal(posts[0].media[0].url, "https://cdn.threads.net/video.mp4");
  });

  it("extracts a direct image", () => {
    const items = [threadItem({
      image_versions2: { candidates: [{ url: "https://cdn.threads.net/img.jpg", width: 1080 }] },
    })];
    const posts = parseThreadsData(items);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].media.length, 1);
    assert.equal(posts[0].media[0].type, "image");
    assert.equal(posts[0].media[0].url, "https://cdn.threads.net/img.jpg");
  });

  it("extracts carousel media", () => {
    const items = [threadItem({
      carousel_media: [
        { image_versions2: { candidates: [{ url: "https://cdn.threads.net/img1.jpg" }] } },
        { video_versions: [{ url: "https://cdn.threads.net/vid1.mp4" }] },
      ],
    })];
    const posts = parseThreadsData(items);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].media.length, 2);
    assert.equal(posts[0].media[0].type, "image");
    assert.equal(posts[0].media[1].type, "video");
  });

  it("extracts embedded reel via text_post_app_info.share_info.reposted_post", () => {
    const items = [threadItem({
      text_post_app_info: {
        share_info: {
          reposted_post: {
            video_versions: [{ url: "https://cdn.threads.net/reel.mp4", width: 720 }],
            image_versions2: { candidates: [{ url: "https://cdn.threads.net/reel_thumb.jpg" }] },
          },
        },
      },
    })];
    const posts = parseThreadsData(items);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].media.length, 2);
    const types = posts[0].media.map((m) => m.type).sort();
    assert.deepEqual(types, ["image", "video"]);
  });

  it("extracts media nested under clips_metadata", () => {
    const items = [threadItem({
      clips_metadata: {
        original_media: {
          video_versions: [{ url: "https://cdn.threads.net/clip.mp4" }],
        },
      },
    })];
    const posts = parseThreadsData(items);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].media.length, 1);
    assert.equal(posts[0].media[0].type, "video");
    assert.equal(posts[0].media[0].url, "https://cdn.threads.net/clip.mp4");
  });

  it("does not extract user profile pic as post media", () => {
    // The user object has image_versions2 for the profile pic — it must be skipped
    const items = [{
      post: {
        pk: "user-skip-test",
        code: "XYZ",
        user: {
          username: "someone",
          is_verified: false,
          profile_pic_url: "https://example.com/profile.jpg",
          image_versions2: { candidates: [{ url: "https://cdn.threads.net/profile_hd.jpg" }] },
        },
        caption: { text: "text only post" },
        taken_at: 1700000000,
      },
    }];
    const posts = parseThreadsData(items);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].media.length, 0);
  });

  it("returns empty media for text-only post", () => {
    const items = [threadItem({})];
    const posts = parseThreadsData(items);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].media.length, 0);
  });

  it("deduplicates media found at multiple nesting levels", () => {
    const items = [threadItem({
      some_wrapper: {
        nested: {
          video_versions: [{ url: "https://cdn.threads.net/dup.mp4" }],
        },
        another: {
          video_versions: [{ url: "https://cdn.threads.net/dup.mp4" }],
        },
      },
    })];
    const posts = parseThreadsData(items);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].media.length, 1);
    assert.equal(posts[0].media[0].url, "https://cdn.threads.net/dup.mp4");
  });

  it("extracts note from snippet_attachment_info", () => {
    const items = [threadItem({
      text_post_app_info: {
        snippet_attachment_info: {
          text_fragments: {
            fragments: [
              { plaintext: "First paragraph of the note." },
              { plaintext: "Second paragraph." },
            ],
          },
        },
      },
    })];
    const posts = parseThreadsData(items);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].note, "First paragraph of the note.\nSecond paragraph.");
  });

  it("returns undefined note when snippet_attachment_info is null", () => {
    const items = [threadItem({
      text_post_app_info: {
        snippet_attachment_info: null,
      },
    })];
    const posts = parseThreadsData(items);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].note, undefined);
  });

  it("returns undefined note when no text_post_app_info", () => {
    const items = [threadItem({})];
    const posts = parseThreadsData(items);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].note, undefined);
  });
});

describe("parseThreadsData — quoted post extraction", () => {
  it("extracts quoted post from share_info.quoted_post", () => {
    const items = [threadItem({
      text_post_app_info: {
        share_info: {
          quoted_post: {
            user: { username: "origauthor", is_verified: true, profile_pic_url: "https://example.com/orig.jpg" },
            caption: { text: "Original post text" },
            code: "ABC123",
            carousel_media: [
              { image_versions2: { candidates: [{ url: "https://cdn.threads.net/quoted-img.jpg" }] } },
            ],
          },
        },
      },
    })];
    const posts = parseThreadsData(items);
    assert.equal(posts.length, 1);
    assert.ok(posts[0].quotedPost);
    assert.equal(posts[0].quotedPost!.author, "@origauthor");
    assert.equal(posts[0].quotedPost!.authorVerified, true);
    assert.equal(posts[0].quotedPost!.text, "Original post text");
    assert.equal(posts[0].quotedPost!.url, "https://www.threads.net/post/ABC123");
    assert.equal(posts[0].quotedPost!.media.length, 1);
    assert.equal(posts[0].quotedPost!.media[0].type, "image");
    // Outer post should have no media (quoted post media is separate)
    assert.equal(posts[0].media.length, 0);
  });

  it("does not put quoted_post media on the outer post", () => {
    const items = [threadItem({
      text_post_app_info: {
        share_info: {
          quoted_post: {
            user: { username: "someone", is_verified: false, profile_pic_url: "" },
            caption: { text: "Quoted" },
            code: "XYZ",
            image_versions2: { candidates: [{ url: "https://cdn.threads.net/q.jpg" }] },
          },
        },
      },
    })];
    const posts = parseThreadsData(items);
    assert.equal(posts[0].media.length, 0);
    assert.equal(posts[0].quotedPost!.media.length, 1);
  });

  it("uses text_fragments for quoted post text when available", () => {
    const items = [threadItem({
      text_post_app_info: {
        share_info: {
          quoted_post: {
            user: { username: "fraguser", is_verified: false, profile_pic_url: "" },
            caption: { text: "lossy text" },
            code: "FRAG",
            text_post_app_info: {
              text_fragments: {
                fragments: [
                  { plaintext: "faithful @mention text" },
                ],
              },
            },
          },
        },
      },
    })];
    const posts = parseThreadsData(items);
    assert.equal(posts[0].quotedPost!.text, "faithful @mention text");
  });

  it("returns undefined quotedPost for embedded reel without user", () => {
    const items = [threadItem({
      text_post_app_info: {
        share_info: {
          reposted_post: {
            video_versions: [{ url: "https://cdn.threads.net/reel.mp4", width: 720 }],
            image_versions2: { candidates: [{ url: "https://cdn.threads.net/reel_thumb.jpg" }] },
          },
        },
      },
    })];
    const posts = parseThreadsData(items);
    assert.equal(posts[0].quotedPost, undefined);
    // Media should still be attributed to outer post via recursive fallback
    assert.equal(posts[0].media.length, 2);
  });

  it("returns undefined quotedPost when no share_info", () => {
    const items = [threadItem({})];
    const posts = parseThreadsData(items);
    assert.equal(posts[0].quotedPost, undefined);
  });
});

describe("parseThreadsData — reply detection", () => {
  it("detects reply via text_post_app_info.is_reply", () => {
    const items = [threadItem({
      text_post_app_info: {
        is_reply: true,
        reply_to_author: { username: "parentuser", id: "123" },
      },
    })];
    const posts = parseThreadsData(items);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].isReply, true);
    assert.equal(posts[0].replyToAuthor, "@parentuser");
  });

  it("detects reply with is_reply true but null reply_to_author", () => {
    const items = [threadItem({
      text_post_app_info: {
        is_reply: true,
        reply_to_author: null,
      },
    })];
    const posts = parseThreadsData(items);
    assert.equal(posts[0].isReply, true);
    assert.equal(posts[0].replyToAuthor, undefined);
  });

  it("non-reply post has isReply false", () => {
    const items = [threadItem({
      text_post_app_info: {
        is_reply: false,
        reply_to_author: null,
      },
    })];
    const posts = parseThreadsData(items);
    assert.equal(posts[0].isReply, false);
    assert.equal(posts[0].replyToAuthor, undefined);
  });

  it("post without text_post_app_info defaults to non-reply", () => {
    const items = [threadItem({})];
    const posts = parseThreadsData(items);
    assert.equal(posts[0].isReply, false);
    assert.equal(posts[0].replyToAuthor, undefined);
  });
});
