# CLAUDE.md

## Project Overview

TypeScript CLI tool that backs up saved Threads posts as Obsidian-compatible markdown. Uses Playwright to automate a Chromium browser, scrolling through `threads.com/saved` and intercepting GraphQL API responses to extract post data.

## Tech Stack

- TypeScript with ESNext/NodeNext module resolution
- Playwright (Chromium only) for browser automation
- tsx for direct TS execution (no build step needed)
- No test framework (manual testing against live site)

## Key Commands

- `npm start` — Run the backup tool (`tsx src/index.ts`)
- `npx tsc --noEmit` — Type check without emitting

## Architecture

The pipeline flows: **auth -> scrape -> parse -> download -> markdown -> state**

- `auth.ts` — Manages Playwright session persistence via `session.json`. First run opens headed browser for manual login; subsequent runs reuse saved cookies.
- `scraper.ts` — Navigates to `/saved`, listens for `response` events on `/graphql/query` endpoints, and scrolls to `document.body.scrollHeight` in a loop. Initial posts come from `<script data-sjs>` tags; subsequent pages come from intercepted network responses. Stops after 8 consecutive empty scrolls or when a known post ID is encountered.
- `parser.ts` — Recursively searches nested JSON for objects with `post.pk` or `thread_items` keys. Extracts post ID, author, text, timestamp, media URLs, and engagement metrics.
- `downloader.ts` — Downloads images with concurrency limit of 3. Skips videos (preserves URL for linking). Skips already-downloaded files.
- `markdown.ts` — Generates `.md` files with YAML frontmatter. Filenames: `@author-slug-YYYY-MM-DD.md`. Handles collisions with counter suffix.
- `state.ts` — Tracks backed-up post IDs in `state.json` for incremental backups.

## Important Patterns

- The Threads JSON structure is undocumented and deeply nested. The parser uses recursive key searching rather than fixed paths, which makes it resilient to minor structural changes.
- The domain is `threads.com` (not `threads.net`) — the site redirects.
- GraphQL responses during scroll are small (one post per response), not batched.
- Scrolling must go to `document.body.scrollHeight` (not just one viewport) to trigger new content loads.

## Sensitive Files (gitignored)

- `session.json` — Browser cookies, never commit
- `state.json` — Backup state
- `output/` — User's backed-up content
