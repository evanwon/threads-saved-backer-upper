# Threads Saved Posts Backer-Upper

Back up your saved posts from [Threads](https://threads.com) as Obsidian-compatible markdown files with downloaded images.

The official Threads API does not expose saved/bookmarked posts. This tool uses Playwright browser automation to scroll through your saved posts page, intercept the GraphQL responses, and generate local markdown files.

## Setup

```bash
npm install
npx playwright install chromium
```

## Usage

```bash
npm start
```

**First run**: A Chromium browser opens to `threads.com/login`. Log in manually. Once logged in, the session is saved to `session.json` for future runs.

**Subsequent runs**: The saved session is reused automatically. If it expires, you'll be prompted to log in again.

The tool will:
1. Navigate to your saved posts page
2. Scroll through all saved posts, intercepting API responses
3. Download images (videos are linked but not downloaded)
4. Generate one markdown file per post in `output/posts/`
5. Save state for incremental backups

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

Images are saved to `output/assets/` and referenced with relative paths.

**Filename format**: `@username-first-few-words-YYYY-MM-DD.md`

## Project Structure

```
src/
  index.ts        CLI entry point
  auth.ts         Session management (login, save/load Playwright state)
  scraper.ts      Scroll saved page, intercept GraphQL responses
  parser.ts       Parse Threads JSON into structured PostData
  downloader.ts   Download images with concurrency limit
  markdown.ts     Generate .md files with YAML frontmatter
  state.ts        Read/write state.json for incremental tracking
  types.ts        TypeScript interfaces
```

## Files (gitignored)

| File | Purpose |
|------|---------|
| `session.json` | Playwright browser session cookies |
| `state.json` | Incremental backup state (backed-up post IDs) |
| `output/` | Generated markdown files and downloaded images |

## Limitations

- Requires manual login on first run (no automated auth)
- Sessions expire periodically and require re-login
- Videos are linked, not downloaded
- Threads may change their internal API structure at any time, which could break the parser
- Anti-bot detection is possible; the tool uses realistic scroll timing to mitigate this
