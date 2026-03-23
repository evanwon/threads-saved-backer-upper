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
npm start
```

### Output Directory

By default, posts are saved to `./output/`. To write directly to your Obsidian vault (or any other folder):

```bash
# One-time override
npm start -- --output ~/ObsidianVault/Threads

# Save as persistent default (writes config.json)
npm start -- --output ~/ObsidianVault/Threads --save-config

# After saving, just run without flags
npm start
```

The `-o` short flag also works: `npm start -- -o ~/ObsidianVault/Threads`

Priority: `--output` flag > `config.json` > `./output`

### Login

**First run**: A Chromium browser opens to `threads.com/login`. Log in manually. Once logged in, the session is saved to `session.json` for future runs.

**Subsequent runs**: The saved session is reused automatically. If it expires, you'll be prompted to log in again.

### What it does

1. Navigate to your saved posts page
2. Scroll through all saved posts, intercepting API responses
3. Download images (videos are linked but not downloaded)
4. Generate one markdown file per post in your output directory
5. Save state for incremental backups
6. Generate a browsable HTML gallery (`index.html`)

## Gallery Viewer

Each backup run also generates `index.html` in your output directory — a self-contained gallery for browsing all your saved posts in the browser. No server needed, just open the file.

- **Feed view** (default): scrollable timeline with full post text and images
- **Grid view**: Pinterest-style card grid for visual scanning
- **Search**: filter posts by text content
- **Author filter**: dropdown listing all authors with post counts
- **Sort**: newest, most liked, oldest

The gallery is regenerated automatically after every backup, including runs where no new posts are found.

To regenerate the gallery without scraping new data (useful when iterating on the gallery template):

```bash
npm start -- --gallery-only
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
