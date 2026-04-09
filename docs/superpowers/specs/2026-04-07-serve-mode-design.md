# Serve Mode: In-App Gallery Refresh

## Problem

The workflow to update threadsafe output requires switching to a terminal, navigating to the project directory, running `npm start`, then opening the HTML file. This friction discourages frequent refreshes and adds unnecessary steps between "I want my latest saved posts" and "I'm looking at them."

## Solution

Add a local HTTP server mode (`npm run serve`) that serves the gallery on `localhost:3000` and enables a refresh button within the gallery UI. Clicking refresh triggers the full scrape pipeline, streams real-time progress updates via Server-Sent Events (SSE), and auto-reloads the page when complete.

The existing `npm start` CLI workflow is unchanged.

## Design Decisions

- **SSE over WebSocket or polling** -- Progress updates are one-way (server to client). SSE is purpose-built for this, uses browser-native `EventSource`, and requires zero new dependencies. WebSocket would add the `ws` package for bidirectional capability we don't need. Polling introduces latency and misses fast steps.
- **Node `http` module, no framework** -- Keeps the dependency footprint at zero new packages. The server only needs 4 routes.
- **Inject refresh UI at serve-time, not in gallery.ts** -- The server string-replaces before `</body>` to insert the refresh button, progress overlay, and SSE client script. `gallery.ts` and `generateHtml()` stay completely untouched. The static `index.html` on disk remains a standalone file that works via `file://`.
- **Extract pipeline into reusable module** -- The scrape pipeline logic moves from `index.ts` into `pipeline.ts` with a progress callback. `index.ts` calls it with `console.log`; the server calls it with SSE broadcast. Pure refactor, no behavior change.
- **Single concurrent refresh** -- A boolean mutex prevents overlapping scrapes. POST to `/api/refresh` returns 409 if one is already running. The Playwright browser instance can only handle one scrape at a time.
- **Auto-open browser on startup** -- `npm run serve` opens `localhost:3000` in the default browser automatically using the `open` npm package or platform-native approach via `execFile` (not `exec`, to avoid shell injection).

## Architecture

### New Files

**`src/pipeline.ts`** -- Extracted scrape pipeline with progress callback.

```typescript
export type ProgressCallback = (step: string, detail: string) => void;

export interface PipelineResult {
  newPosts: number;
  totalPosts: number;
  error?: string;
}

export async function runPipeline(
  outputDir: string,
  onProgress: ProgressCallback
): Promise<PipelineResult>
```

The function runs: authenticate -> scrape -> parse -> download -> markdown -> state -> gallery. Calls `onProgress` at each phase transition and at key milestones within phases (e.g., scroll count during scraping, download progress). Returns a result summary.

Progress steps emitted:
- `("auth", "Validating session...")`
- `("auth", "Session expired - please log in via the browser window")`
- `("auth", "Login successful")`
- `("scrape", "Navigating to saved posts...")`
- `("scrape", "Scrolling... 12 posts found")`
- `("parse", "Parsed 12 posts")`
- `("download", "Downloading images...")`
- `("download", "Downloading profile pictures...")`
- `("markdown", "Writing markdown files...")`
- `("state", "Updating backup state...")`
- `("gallery", "Regenerating gallery...")`
- `("done", "Complete - 5 new posts backed up")`

**`src/server.ts`** -- HTTP server entry point for serve mode.

Routes:

| Route | Method | Purpose |
|-------|--------|---------|
| `/` | GET | Serve `index.html` with refresh UI injected before `</body>` |
| `/assets/*` | GET | Serve static images/videos with correct MIME types |
| `/api/events` | GET | SSE endpoint -- `text/event-stream`, keeps connection alive |
| `/api/refresh` | POST | Trigger pipeline; returns 200 to confirm start (progress streams on `/api/events` SSE channel); returns 409 if already running |

Server lifecycle:
1. `resolveConfig()` to get `outputDir`
2. Ensure output directories exist
3. `generateGallery(outputDir)` to ensure `index.html` exists
4. Start HTTP server on port 3000 (or `PORT` env var)
5. Auto-open browser to `localhost:PORT`
6. Serve requests until Ctrl+C

SSE client management: a `Set<http.ServerResponse>` of active connections. `broadcast(data)` iterates and writes `data: ${JSON.stringify(data)}\n\n` to each. Clients removed on connection close.

### Modified Files

**`src/index.ts`** -- The normal scrape path (currently lines 70-128) is replaced with a call to `runPipeline(outputDir, (step, detail) => console.log(`[${step}] ${detail}`))`. Special modes (galleryOnly, dumpRaw, url) remain in `index.ts` as-is. This is a pure refactor.

**`package.json`** -- Add script: `"serve": "tsx src/server.ts"`.

### Unchanged Files

`gallery.ts`, `auth.ts`, `scraper.ts`, `parser.ts`, `downloader.ts`, `markdown.ts`, `state.ts`, `types.ts`, `config.ts` -- no modifications needed.

## Injected Refresh UI

The server injects the following before `</body>` in the served HTML:

### Refresh Button
- Fixed position, bottom-right corner
- Positioned above the existing scroll-to-top button
- Circular button with a refresh/sync icon (SVG or Unicode)
- Styled to match the gallery's dark theme (#181818 background, white icon, blue hover)
- Disabled (grayed out) while a refresh is in progress

### Progress Overlay
- Full-screen semi-transparent backdrop
- Centered card with current step name (bold) and detail text
- Animated indicator (pulsing dot or spinner)
- Appears when refresh starts, disappears on completion
- Shows error message with retry button if pipeline fails

### Auth Wait State
- When the pipeline reports `("auth", "Session expired...")`, the overlay shows: "Session expired -- please log in via the browser window that just opened"
- Updates to "Login successful, continuing..." when auth completes

### SSE Client Script
```javascript
const evtSource = new EventSource('/api/events');

evtSource.addEventListener('progress', (e) => {
  const { step, detail } = JSON.parse(e.data);
  updateOverlay(step, detail);
});

evtSource.addEventListener('complete', (e) => {
  const { newPosts } = JSON.parse(e.data);
  showComplete(newPosts);
  setTimeout(() => location.reload(), 1500);
});

evtSource.addEventListener('error', (e) => {
  const { message } = JSON.parse(e.data);
  showError(message);
});
```

On refresh button click: POST to `/api/refresh`, show overlay. If 409 response, show "Refresh already in progress."

## Testing & Verification

1. **Type check**: `npx tsc --noEmit` -- pipeline.ts and server.ts must type-check
2. **Unit tests**: `npm test` -- existing tests must still pass (no gallery.ts changes)
3. **Render validation**: `npm run validate` -- existing gallery HTML must still validate (no gallery.ts changes)
4. **Manual end-to-end**:
   - Run `npm run serve` -- server starts, browser opens to localhost:3000
   - Gallery displays correctly (same as file:// version)
   - Click refresh button -- progress overlay appears with step updates
   - After completion -- page reloads with updated content
   - Click refresh while one is running -- shows "already in progress"
5. **CLI regression**: `npm start` still works identically to before
6. **Auth flow**: With an expired session, clicking refresh should open the Playwright login browser and show "Waiting for login..." in the overlay
