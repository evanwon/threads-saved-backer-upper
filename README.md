# Threadsafe

Back up your saved posts from [Threads](https://threads.com) as Obsidian-compatible markdown files with downloaded images.

The official Threads API does not expose saved/bookmarked posts. This tool uses Playwright browser automation to scroll through your saved posts page, intercept the GraphQL responses, and generate local markdown files.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)

## Setup

```bash
npm install
npx playwright install chromium
```

## Usage

```bash
npm run serve
```

This starts a local server at `localhost:3000` and opens your browser to a gallery of your saved posts. Click the **refresh button** in the bottom-right corner to scrape — progress is streamed to the page in real time via Server-Sent Events, and the gallery auto-reloads when new posts are fetched.

Set the server port with the `PORT` environment variable.

### Login

**First refresh**: A Chromium browser opens to `threads.com/login`. Log in manually. Once logged in, the session is saved to `session.json` for future runs.

**Subsequent refreshes**: The saved session is reused automatically. If it expires, you'll be prompted to log in again.

### What it does

1. Navigate to your saved posts page
2. Scroll through all saved posts, intercepting API responses
3. Download images and author profile pictures (videos are linked but not downloaded)
4. Generate one markdown file per post in your output directory
5. Save state for incremental backups
6. Regenerate the browsable HTML gallery (`index.html`)

### Gallery features

- **Feed**: scrollable timeline with full post text and images
- **Search**: filter posts by text content
- **Author filter**: dropdown listing all authors with post counts
- **Sort**: newest, most liked, oldest

### Output directory

By default, posts are saved to `./output/`. To write directly to your Obsidian vault (or any other folder), set the path once via the CLI and save it as the persistent default:

```bash
npm start -- --output ~/ObsidianVault/Threads --save-config
```

This writes `config.json`, which both `npm run serve` and `npm start` will read on subsequent runs.

Priority: `--output` flag (CLI only) > `config.json` > `./output`

## One-off CLI runs

If you'd rather run a single backup from the command line (no server, no browser UI), use `npm start`. It runs the exact same pipeline as serve mode and exits when finished — useful for scheduled jobs or scripted workflows. The output directory contains a standalone `index.html` you can open directly in a browser.

```bash
# Run a backup
npm start

# One-time output override (does not persist)
npm start -- --output ~/ObsidianVault/Threads
npm start -- -o ~/ObsidianVault/Threads

# Regenerate the gallery HTML without scraping (useful when iterating on the template)
npm start -- --gallery-only

# Scrape a single post into an isolated directory (skips state tracking)
npm start -- --url https://www.threads.net/post/XYZ --output /tmp/test
```

### Debugging: Raw JSON Dump

To inspect the raw API data for scraped posts (useful for debugging parser issues or investigating unsupported content types):

```bash
# Dump all saved posts
npm start -- --dump-raw

# Dump a single post
npm start -- --dump-raw --url https://www.threads.net/post/XYZ --output /tmp/test
```

This writes the raw JSON to `<outputDir>/raw-dump-<timestamp>.json` and exits without parsing, downloading, or updating state.

## Reset

To re-scrape all posts from scratch (e.g., after parser improvements):

```bash
# Delete posts + state + gallery, re-scrape. Preserves downloaded images.
npm start -- --reset

# Full clean slate — also deletes downloaded images and profile pics.
npm start -- --reset-all
```

## Incremental Backups

Post IDs are tracked in `state.json`. On subsequent runs, the tool stops scrolling when it encounters a previously backed-up post, so only new saves are fetched.

## Output Format

Each post becomes a markdown file in `output/posts/` with YAML frontmatter:

```markdown
---
id: "3465677153082105582"
author: "@zuck"
verified: true
date: 2024-09-26T14:28:52.000Z
url: "https://www.threads.net/post/DAYjwI_pV7u"
likes: 4161
replies: 0
reposts: 0
source: threads
---

Post text content here.

![](assets/3465677153082105582-0.jpg)

---
[View on Threads](https://www.threads.net/post/DAYjwI_pV7u)
```

Images are saved to `<outputDir>/assets/` and referenced with relative paths.

**Filename format**: `YYYY-MM-DD-username-first-few-words.md`

## Project Structure

```
src/
  index.ts        CLI entry point
  config.ts       Load/save config.json, parse CLI args
  auth.ts         Session management (login, save/load Playwright state)
  scraper.ts      Scroll saved page, intercept GraphQL responses
  parser.ts       Parse Threads JSON into structured PostData
  downloader.ts   Download images with concurrency limit
  markdown.ts     Generate .md files with YAML frontmatter
  gallery.ts      Generate self-contained HTML gallery viewer
  state.ts        Read/write state.json for incremental tracking
  pipeline.ts     Reusable scrape pipeline with progress callback
  server.ts       Local HTTP server for serve mode (npm run serve)
  types.ts        TypeScript interfaces
```

## Files (gitignored)

| File | Purpose |
|------|---------|
| `config.json` | Persistent settings (output directory) |
| `session.json` | Playwright browser session cookies |
| `state.json` | Incremental backup state (backed-up post IDs) |
| `output/` | Default output (markdown files and downloaded images) |

## Limitations

- Requires manual login on first run (no automated auth)
- Sessions expire periodically and require re-login
- Videos are linked, not downloaded
- Threads may change their internal API structure at any time, which could break the parser
- Anti-bot detection is possible; the tool uses realistic scroll timing to mitigate this

## Disclaimer

Threadsafe is an independent, open-source project. It is **not affiliated with, endorsed by, or associated with Meta Platforms, Inc.** or any of its products (including Threads, Instagram, or Facebook).

"Threads" is a trademark of Meta Platforms, Inc. All trademarks belong to their respective owners.

This tool accesses publicly available web pages through browser automation for the sole purpose of backing up your own saved content. It does not bypass authentication, circumvent access controls, or access data belonging to other users. Use of this tool is at your own risk and subject to the [Threads Terms of Use](https://help.instagram.com/769983657850450). The authors are not responsible for any consequences resulting from its use, including account restrictions or data loss.

## License

MIT
