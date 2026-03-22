# Static HTML Gallery Viewer

## Problem

With 1,000+ backed-up Threads posts stored as individual markdown files, browsing is painful. The Obsidian sidebar shows a massive list of filenames that's hard to skim. Finding a post you vaguely remember (usually by author) requires clicking through files one at a time. There's no way to visually scan posts or see image thumbnails without opening each file.

## Solution

Generate a self-contained `index.html` file alongside the backed-up posts. This static gallery renders all posts as a browsable feed with search, author filtering, sort options, and image thumbnails. No server required — just open the file in a browser.

## Design Decisions

- **Feed view is the default** — vertical timeline, one post per row, full text visible. Matches how users read social content.
- **Grid view available via toggle** — 3-column card layout for visual scanning. Useful for image-heavy browsing.
- **Threads-inspired dark color scheme** — pure black (#000) background, dark card surfaces (#181818), subtle borders (#2d2d2d), white text, blue accents (#0095f6) for links and verified badges.
- **Auto-generated every backup run** — the gallery is rebuilt after each `npm start`, so it's always current. No separate command needed.
- **Also runs when no new posts found** — the gallery generation step runs regardless of whether new posts were scraped, since the user may want an updated gallery after manual edits. Place the `generateGallery()` call outside the early-return gates in `index.ts`.
- **View preference persisted to localStorage** — toggle between feed/grid sticks across sessions.
- **No new dependencies** — frontmatter parsing uses a simple custom parser (the format is controlled by `markdown.ts` and contains only simple key-value pairs, no nested objects or arrays).

## Features

### Search + Filter
- Text search box: filters posts by text content as you type (debounced at ~150ms to avoid DOM thrashing)
- Author dropdown with autocomplete: lists all authors with post counts (e.g., "carnage4life (23)"). Author names displayed without the `@` prefix.
- Sort: newest first (default), most liked, oldest

### Feed View (Default)
- Single column, max-width ~600px centered
- Per post: avatar with author initial, author name, verified badge, date, full post text, image thumbnail(s), engagement metrics (likes, replies, reposts)
- Action links: "View on Threads" (original URL), "Copy link" (uses Clipboard API; may not work on all browsers from `file://` — degrade gracefully)

### Grid View
- 3-column card grid, 1px gap borders (Threads-style)
- Per card: thumbnail image, author + verified badge, text preview (2 lines truncated), like count
- Carousel posts show "1/N" badge; videos show play icon badge
- Text-only posts display the text as the card visual

### Post Detail (click to expand)
- Clicking a post card in grid view expands it to show full text, all images, and action links
- In feed view, posts are already fully expanded

### Video Handling
- Videos are not downloaded (only URLs stored). Video URLs are extracted from the markdown body by matching the `[Video](url)` pattern (a simple regex). This is the one case where we parse the markdown body for media, since videos have no local asset files.
- In both views, show a placeholder with a play icon overlay.
- Clicking the video placeholder opens the original video URL in a new tab.

### Performance
- All post data embedded as a JSON array in the HTML file (estimated 1-5 MB for 1000+ posts — images are NOT embedded, only referenced by path)
- Client-side rendering with lazy image loading (`loading="lazy"`)
- **Incremental rendering**: render the first ~50 posts, then append more batches as the user scrolls near the bottom (IntersectionObserver). This is simpler than virtual scrolling and adequate for 1000-2000 posts.
- Search and filter operate on the in-memory JSON — instant, no server round-trips. Re-render is debounced.

## Data Flow

1. Backup tool runs: scrape → parse → download → markdown (existing pipeline)
2. New step: `generateGallery()` reads all `.md` files from the posts directory
3. Parses YAML frontmatter using a simple custom parser (split on `---` delimiters, parse key-value pairs). Malformed files are skipped with a console warning.
4. Extracts post text from the markdown body (content between frontmatter and the `---\n[View on Threads]` footer)
5. **Reconstructs image paths from the post ID** — scans the `assets/` directory for files matching the pattern `{id}-\d+\.(jpe?g|png|webp|gif)` (anchored on the `-` after the ID to avoid prefix collisions). This avoids fragility around the relative path mismatch between markdown files (in `posts/`) and `index.html` (in output root).
6. **Extracts video URLs** from the markdown body by matching `[Video](url)` links.
7. Embeds all post data as JSON into an HTML template
8. Writes `index.html` to the output directory (sibling to `posts/` and `assets/`)

## Output Structure

```
output/
├── index.html          ← NEW: the gallery viewer
├── posts/              (existing markdown files)
│   ├── 2026-03-21-carnage4life-Steve-is-an-engineering-VP-at.md
│   └── ...
└── assets/             (existing downloaded images)
    ├── 3857867403062185065-0.jpg
    └── ...
```

## Files to Create/Modify

- **New: `src/gallery.ts`** — reads markdown files, parses frontmatter, scans assets directory for images, generates the self-contained HTML
- **Modify: `src/index.ts`** — call `generateGallery()` after the main pipeline, outside the early-return gates so it runs even when no new posts are found
- **Modify: `src/types.ts`** — add `GalleryPost` type if the gallery needs a different shape than `PostData` (e.g., resolved image paths as string array instead of `MediaItem[]`)

## Image Handling

- Gallery reconstructs image paths by scanning `assets/` for files matching the post ID pattern: `{id}-{index}.{ext}`
- Since `index.html` is at the output root alongside `assets/`, paths like `assets/12345-0.jpg` resolve correctly
- Lazy loading via `loading="lazy"` on `<img>` tags
- Fallback for posts with no images: show post text as the visual (in grid view) or just the text (in feed view)

## Technical Notes

- The HTML file is fully self-contained: CSS and JS are inlined, no external dependencies
- Post data is embedded as `<script>const POSTS = [...];</script>`
- Search uses simple case-insensitive string matching on author + text fields
- Author dropdown is populated dynamically from the post data, sorted by post count descending
- localStorage key for view preference: `threads-gallery-view`
- Author names stored with `@` prefix in frontmatter; gallery strips the `@` for display
- The frontmatter parser must treat all values as strings — never attempt numeric coercion, since post IDs are large numbers that exceed JavaScript's safe integer range
- `generateGallery()` signature: `generateGallery(outputDir: string): Promise<void>`
- Place the `generateGallery()` call after the try/catch/finally block in `index.ts` (after `closeBrowser()`), so it runs even if the scrape errors out — it only needs the existing `.md` files on disk

## Verification

1. Run `npm start` to back up posts
2. Open `output/index.html` in a browser
3. Verify: feed view shows posts in reverse chronological order
4. Verify: grid view shows cards with thumbnails
5. Verify: search filters posts by text
6. Verify: author dropdown filters by author
7. Verify: sort options work (newest, most liked, oldest)
8. Verify: images load from local assets
9. Verify: "View on Threads" links open correct URLs
10. Verify: performance is acceptable with 1000+ posts (no jank on scroll)
11. Verify: gallery regenerates even when no new posts are found
12. Verify: malformed markdown files are skipped with a warning
