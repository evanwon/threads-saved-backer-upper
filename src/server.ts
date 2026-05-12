import { createServer, type ServerResponse } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, extname, resolve, relative, isAbsolute } from "node:path";
import { execFile } from "node:child_process";
import { loadConfig } from "./config.js";
import { generateGallery } from "./gallery.js";
import { runPipeline } from "./pipeline.js";

const PORT = parseInt(process.env.PORT || "3000", 10);

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".svg": "image/svg+xml",
};

// SSE client management
const sseClients = new Set<ServerResponse>();

function broadcast(data: { type: string; [key: string]: unknown }) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch {
      // Client socket is dead; drop it so we don't retry next broadcast.
      sseClients.delete(client);
    }
  }
}

// Refresh mutex
let refreshRunning = false;

// The HTML/CSS/JS to inject before </body> for the refresh UI
const REFRESH_UI_INJECTION = `
<style>
.refresh-btn{
  position:fixed;bottom:76px;right:24px;z-index:150;
  width:40px;height:40px;border-radius:50%;border:none;
  background:rgba(255,255,255,.15);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  color:#fff;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  transition:opacity .25s,transform .25s,background .15s;
}
.refresh-btn:hover{background:rgba(255,255,255,.25);transform:scale(1.1)}
.refresh-btn:active{transform:scale(.95)}
.refresh-btn:disabled{opacity:.4;cursor:not-allowed;transform:none}
.refresh-btn svg{width:20px;height:20px}
.refresh-btn.spinning svg{animation:spin 1s linear infinite}
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}

.refresh-overlay{
  display:none;position:fixed;inset:0;z-index:200;
  background:rgba(0,0,0,.7);backdrop-filter:blur(4px);
  align-items:center;justify-content:center;
}
.refresh-overlay.visible{display:flex}
.refresh-card{
  background:#181818;border:1px solid #2d2d2d;border-radius:16px;
  padding:32px 40px;text-align:center;max-width:360px;width:90%;
}
.refresh-card .step{font-size:14px;font-weight:600;color:#f5f5f5;margin-bottom:8px;text-transform:capitalize}
.refresh-card .detail{font-size:13px;color:#999;min-height:20px}
.refresh-card .spinner{
  width:24px;height:24px;border:2px solid #333;border-top-color:#0095f6;
  border-radius:50%;animation:spin 1s linear infinite;
  margin:0 auto 16px;
}
.refresh-card .done-icon{
  font-size:28px;margin-bottom:12px;
}
.refresh-card .error-msg{color:#ff6b6b;margin-bottom:12px}
.refresh-card .retry-btn{
  background:#0095f6;color:#fff;border:none;border-radius:8px;
  padding:8px 20px;cursor:pointer;font-size:13px;margin-top:8px;
}
.refresh-card .retry-btn:hover{background:#0081d6}
</style>

<button class="refresh-btn" id="refreshBtn" aria-label="Refresh saved posts" title="Refresh saved posts">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
    <path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
  </svg>
</button>

<div class="refresh-overlay" id="refreshOverlay">
  <div class="refresh-card" id="refreshCard">
    <div class="spinner" id="refreshSpinner"></div>
    <div class="step" id="refreshStep">Starting...</div>
    <div class="detail" id="refreshDetail"></div>
  </div>
</div>

<script>
(function(){
  var btn=document.getElementById("refreshBtn");
  var overlay=document.getElementById("refreshOverlay");
  var card=document.getElementById("refreshCard");
  var stepEl=document.getElementById("refreshStep");
  var detailEl=document.getElementById("refreshDetail");
  var spinnerEl=document.getElementById("refreshSpinner");
  var evtSource=null;
  // Only the tab that clicked "refresh" should react to progress events.
  // Without this, other open tabs would also show the modal and reload,
  // clobbering whatever the user was doing there.
  var didInitiate=false;

  function connectSSE(){
    if(evtSource)return;
    evtSource=new EventSource("/api/events");
    evtSource.addEventListener("message",function(e){
      if(!didInitiate)return;
      var data=JSON.parse(e.data);
      if(data.type==="progress"){
        stepEl.textContent=data.step;
        detailEl.textContent=data.detail;
      }
      if(data.type==="complete"){
        spinnerEl.style.display="none";
        var icon=document.createElement("div");
        icon.className="done-icon";
        icon.textContent="\\u2705";
        card.insertBefore(icon,card.firstChild);
        stepEl.textContent="Done";
        detailEl.textContent=data.newPosts+" new post"+(data.newPosts===1?"":"s")+" backed up";
        btn.disabled=false;
        btn.classList.remove("spinning");
        didInitiate=false;
        setTimeout(function(){location.reload()},1500);
      }
      if(data.type==="error"){
        spinnerEl.style.display="none";
        stepEl.textContent="Error";
        while(detailEl.firstChild)detailEl.removeChild(detailEl.firstChild);
        var msg=document.createElement("div");
        msg.className="error-msg";
        msg.textContent=data.message;
        var retry=document.createElement("button");
        retry.className="retry-btn";
        retry.textContent="Retry";
        retry.onclick=function(){startRefresh()};
        detailEl.appendChild(msg);
        detailEl.appendChild(retry);
        btn.disabled=false;
        btn.classList.remove("spinning");
        didInitiate=false;
      }
    });
  }

  function resetCard(){
    var icons=card.querySelectorAll(".done-icon");
    for(var i=0;i<icons.length;i++)icons[i].parentNode.removeChild(icons[i]);
    spinnerEl.style.display="";
    stepEl.textContent="Starting...";
    while(detailEl.firstChild)detailEl.removeChild(detailEl.firstChild);
  }

  function startRefresh(){
    resetCard();
    overlay.classList.add("visible");
    btn.disabled=true;
    btn.classList.add("spinning");
    didInitiate=true;
    connectSSE();
    fetch("/api/refresh",{method:"POST"}).then(function(res){
      if(res.status===409){
        stepEl.textContent="Already running";
        detailEl.textContent="A refresh is already in progress in another tab";
        btn.disabled=false;
        btn.classList.remove("spinning");
        didInitiate=false;
      }
    }).catch(function(err){
      stepEl.textContent="Error";
      detailEl.textContent="Could not reach server: "+err.message;
      btn.disabled=false;
      btn.classList.remove("spinning");
      didInitiate=false;
    });
  }

  btn.addEventListener("click",startRefresh);

  overlay.addEventListener("click",function(e){
    if(e.target===overlay&&!btn.disabled){
      overlay.classList.remove("visible");
    }
  });

  document.addEventListener("keydown",function(e){
    if(e.key==="Escape"&&overlay.classList.contains("visible")&&!btn.disabled){
      overlay.classList.remove("visible");
    }
  });

  connectSSE();
})();
</script>
`;

async function serveFile(
  res: ServerResponse,
  filePath: string,
  contentType: string
) {
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

async function main() {
  const config = await loadConfig();
  const outputDir = config.outputDir;

  // Ensure output directories exist
  await mkdir(resolve(outputDir, "posts"), { recursive: true });
  await mkdir(resolve(outputDir, "assets"), { recursive: true });

  // Ensure gallery HTML exists
  await generateGallery(outputDir);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // SSE endpoint
    if (pathname === "/api/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(":\n\n"); // SSE comment to establish connection
      sseClients.add(res);
      // Any of these can fire when the client goes away; all must drop the client
      // so a later broadcast doesn't write to a dead socket and crash the server.
      req.on("close", () => sseClients.delete(res));
      res.on("error", () => sseClients.delete(res));
      res.on("close", () => sseClients.delete(res));
      return;
    }

    // Refresh endpoint
    if (pathname === "/api/refresh" && req.method === "POST") {
      if (refreshRunning) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Refresh already in progress" }));
        return;
      }

      refreshRunning = true;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "started" }));

      // Run pipeline in background (don't await in request handler)
      runPipeline(outputDir, (step, detail) => {
        console.log(`[${step}] ${detail}`);
        broadcast({ type: "progress", step, detail });
      })
        .then((result) => {
          if (result.error) {
            broadcast({ type: "error", message: result.error });
          } else {
            broadcast({
              type: "complete",
              newPosts: result.newPosts,
              totalPosts: result.totalPosts,
            });
          }
        })
        .catch((err) => {
          broadcast({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          refreshRunning = false;
        });

      return;
    }

    // Serve gallery HTML with refresh UI injected
    if (pathname === "/" && req.method === "GET") {
      try {
        const htmlPath = join(outputDir, "index.html");
        let html = await readFile(htmlPath, "utf-8");
        html = html.replace("</body>", REFRESH_UI_INJECTION + "</body>");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      } catch {
        res.writeHead(500);
        res.end("Gallery not found. Try refreshing.");
      }
      return;
    }

    // Serve static assets
    if (pathname.startsWith("/assets/")) {
      const assetPath = join(outputDir, pathname);
      // Prevent directory traversal: relative path must stay inside outputDir
      const rel = relative(resolve(outputDir), resolve(assetPath));
      if (rel.startsWith("..") || isAbsolute(rel)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      const ext = extname(assetPath).toLowerCase();
      const mime = MIME_TYPES[ext] || "application/octet-stream";
      await serveFile(res, assetPath, mime);
      return;
    }

    // 404 for everything else
    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`Threadsafe gallery server running at ${url}`);
    console.log(`Serving from: ${outputDir}`);
    console.log("Press Ctrl+C to stop.\n");

    // Auto-open browser
    openBrowser(url);
  });
}

function openBrowser(url: string) {
  // execFile errors are surfaced asynchronously via the 'error' event and the
  // callback argument, not sync throws — a try/catch around it is a no-op.
  const swallow = () => {};
  const platform = process.platform;
  let child;
  if (platform === "win32") {
    child = execFile("cmd", ["/c", "start", "", url], swallow);
  } else if (platform === "darwin") {
    child = execFile("open", [url], swallow);
  } else {
    child = execFile("xdg-open", [url], swallow);
  }
  child.on("error", swallow);
}

main();
