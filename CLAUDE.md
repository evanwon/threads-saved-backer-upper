# CLAUDE.md

## Project Overview

Threadsafe is a TypeScript CLI tool that backs up saved Threads posts as Obsidian-compatible markdown. Uses Playwright to automate a Chromium browser, scrolling through `threads.com/saved` and intercepting GraphQL API responses to extract post data.

## Tech Stack

- TypeScript with ESNext/NodeNext module resolution
- Playwright (Chromium only) for browser automation
- tsx for direct TS execution (no build step needed)
- node:test + node:assert for unit tests
- Playwright for render validation (headless gallery checking)

## Key Commands

- `npm start` — Run the backup tool (`tsx src/index.ts`)
- `npm start -- --output /path/to/dir` — Override output directory
- `npm start -- --output /path/to/dir --save-config` — Save output dir to `config.json`
- `npm start -- --gallery-only` — Regenerate gallery HTML without scraping
- `npx tsc --noEmit` — Type check without emitting
- `npm test` — Run unit tests (`tests/gallery.test.ts`)
- `npm run validate` — Run Playwright render validation (generates gallery from fixtures, opens in headless Chromium, checks for JS errors)
- `npm run validate -- path/to/index.html` — Validate an existing gallery file

## Architecture

The pipeline flows: **config -> auth -> scrape -> parse -> download -> markdown -> state -> gallery**

- `config.ts` — Loads persistent settings from `config.json`, merges with CLI args (`--output`, `--save-config`). Priority: CLI flag > config.json > default `./output`.
- `auth.ts` — Manages Playwright session persistence via `session.json`. First run opens headed browser for manual login; subsequent runs reuse saved cookies.
- `scraper.ts` — Navigates to `/saved`, listens for `response` events on `/graphql/query` endpoints, and scrolls to `document.body.scrollHeight` in a loop. Initial posts come from `<script data-sjs>` tags; subsequent pages come from intercepted network responses. Stops after 8 consecutive empty scrolls or when a known post ID is encountered.
- `parser.ts` — Recursively searches nested JSON for objects with `post.pk` or `thread_items` keys. Extracts post ID, author, text, timestamp, media URLs, profile picture URL, and engagement metrics.
- `downloader.ts` — Downloads images with concurrency limit of 3. Skips videos (preserves URL for linking). Skips already-downloaded files. Also downloads author profile pictures (one per author, always overwritten to stay current).
- `markdown.ts` — Generates `.md` files with YAML frontmatter. Filenames: `@author-slug-YYYY-MM-DD.md`. Handles collisions with counter suffix.
- `state.ts` — Tracks backed-up post IDs in `state.json` for incremental backups.
- `gallery.ts` — Reads all markdown files, parses frontmatter, scans assets directory for images and profile pictures, and generates a self-contained `index.html` gallery. Runs after every backup (even when no new posts). Uses incremental rendering (50-post batches via IntersectionObserver) for performance with 1000+ posts. Profile pictures render as circular avatars with fallback to colored initials.

## Validation (required after changes)

After any change to gallery.ts or types.ts, run all three:

1. `npx tsc --noEmit` — Type check
2. `npm test` — Unit tests for parsing logic
3. `npm run validate` — Playwright render check (catches JS runtime errors in generated HTML)

The gallery embeds JavaScript inside a TypeScript template literal — this means JS syntax errors won't be caught by tsc. The render validation is the only way to catch those.

## Important Patterns

- The Threads JSON structure is undocumented and deeply nested. The parser uses recursive key searching rather than fixed paths, which makes it resilient to minor structural changes.
- The domain is `threads.com` (not `threads.net`) — the site redirects.
- GraphQL responses during scroll are small (one post per response), not batched.
- Scrolling must go to `document.body.scrollHeight` (not just one viewport) to trigger new content loads.

## Documentation

When making user-facing changes (new flags, changed behavior, new commands), check if README.md and this file need updating. CLI flags should be documented in both the Key Commands section here and the Usage section of README.md.

## Sensitive Files (gitignored)

- `config.json` — Persistent settings (output directory)
- `session.json` — Browser cookies, never commit
- `state.json` — Backup state
- `output/` — Default output (user's backed-up content)
