# --reset Flag Design

## Context

After adding new parser features (reply detection, quote reposts), existing markdown files lack the new fields. The only way to pick them up is to re-scrape all saved posts. Currently this requires manually deleting `state.json` and `output/posts/` — there's no built-in way to do it.

## Design

Two new CLI flags:

### `--reset`

Deletes posts and state, preserves downloaded assets, then runs a full scrape.

What it deletes:
- `<outputDir>/posts/` (all markdown files)
- `state.json` (backup state tracking)
- `<outputDir>/index.html` (gallery — will be regenerated)

What it preserves:
- `<outputDir>/assets/` (images and profile pics — the downloader skips existing files, so these get reused)
- `config.json` (output directory setting)
- `session.json` (browser cookies)

After deletion, the normal scrape pipeline runs automatically (authenticate, scrape, parse, download, markdown, state, gallery).

### `--reset-all`

Same as `--reset` but also deletes `<outputDir>/assets/`. Full clean slate — everything gets re-downloaded.

### Behavior

- Both flags print what they're about to delete and a summary of what was removed (e.g., "Deleted 1118 posts, cleared state.").
- No confirmation prompt — the user explicitly passed the flag. Threadsafe is a backup tool; the source of truth is Threads, not the local files.
- Compatible with `--output` (resets the specified output directory).
- Incompatible with `--gallery-only`, `--url`, `--dump-raw` — these are separate modes. Print an error if combined.

### Implementation

**`src/config.ts`**: Add `reset` and `resetAll` boolean fields to the config return type. Parse `--reset` and `--reset-all` from CLI args.

**`src/index.ts`**: After resolving config but before authenticate, if `reset` or `resetAll`:
1. Validate no incompatible flags are set.
2. Delete `<outputDir>/posts/` directory.
3. Delete `state.json`.
4. Delete `<outputDir>/index.html`.
5. If `resetAll`, also delete `<outputDir>/assets/`.
6. Print summary.
7. Re-create empty `posts/` and `assets/` directories.
8. Continue with normal scrape flow (the existing code handles everything from here).

**No changes needed to**: `scraper.ts`, `parser.ts`, `markdown.ts`, `gallery.ts`, `downloader.ts`, `state.ts`, `auth.ts`.

### Files to modify
- `src/config.ts` — parse new flags
- `src/index.ts` — reset logic before scrape
- `CLAUDE.md` — document new flags
- `README.md` — document new flags

### Verification
1. `npx tsc --noEmit`
2. `npm test`
3. Manual: `npm start -- --reset --output /tmp/reset-test` with a small pre-populated output dir, confirm posts/state are deleted and re-scraped.
