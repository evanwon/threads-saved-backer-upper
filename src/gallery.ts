import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GalleryPost, GalleryMediaItem } from "./types.js";

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns null if frontmatter is malformed.
 */
export function parseFrontmatter(
  content: string
): { meta: Record<string, string>; body: string } | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) return null;

  const secondDelim = trimmed.indexOf("\n---\n", 3);
  const secondDelimAlt = secondDelim === -1 ? trimmed.indexOf("\n---\r\n", 3) : -1;
  const delimIdx = secondDelim !== -1 ? secondDelim : secondDelimAlt;
  if (delimIdx === -1) return null;

  const frontmatterBlock = trimmed.slice(3, delimIdx).trim();
  const delimLen = secondDelim !== -1 ? 5 : 6; // \n---\n or \n---\r\n
  const body = trimmed.slice(delimIdx + delimLen).trim();

  const meta: Record<string, string> = {};
  for (const line of frontmatterBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Strip surrounding double-quotes from YAML-quoted values
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value
        .slice(1, -1)
        .replace(/\\\\/g, "\\")
        .replace(/\\"/g, '"')
        .replace(/\\n/g, "\n");
    }

    meta[key] = value;
  }

  return { meta, body };
}

/**
 * Extract post text and media items from the markdown body.
 * Detects image-before-video adjacency to pair thumbnails with videos.
 */
export function parseBody(body: string): { text: string; media: GalleryMediaItem[] } {
  const lines = body.split("\n");
  const textLines: string[] = [];
  const media: GalleryMediaItem[] = [];
  let pendingImage: string | null = null;
  let inText = true;

  const imageRegex = /^!\[.*?\]\(([^)]+)\)$/;
  const videoRegex = /^\[Video\]\(([^)]+)\)$/;

  for (const line of lines) {
    const trimmed = line.trim();

    // Stop at footer separator
    if (trimmed === "---" && (textLines.length > 0 || media.length > 0)) {
      if (pendingImage) {
        media.push({ type: "image", src: pendingImage });
        pendingImage = null;
      }
      break;
    }

    const imgMatch = trimmed.match(imageRegex);
    const vidMatch = trimmed.match(videoRegex);

    if (imgMatch) {
      inText = false;
      // Flush any previously pending image as a standalone image
      if (pendingImage) {
        media.push({ type: "image", src: pendingImage });
      }
      pendingImage = imgMatch[1];
    } else if (vidMatch) {
      inText = false;
      if (pendingImage) {
        // Image immediately before video = thumbnail-video pair
        media.push({ type: "video", src: vidMatch[1], poster: pendingImage });
        pendingImage = null;
      } else {
        media.push({ type: "video", src: vidMatch[1] });
      }
    } else if (inText) {
      textLines.push(line);
    }
  }

  // Flush any remaining pending image
  if (pendingImage) {
    media.push({ type: "image", src: pendingImage });
  }

  return { text: textLines.join("\n").trim(), media };
}

/**
 * Scan the assets directory and group image files by post ID.
 */
async function scanAssets(assetsDir: string): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!existsSync(assetsDir)) return map;

  const files = await readdir(assetsDir);
  const imageRegex = /^(\d+)-(\d+)\.(jpe?g|png|webp|gif)$/i;

  for (const file of files) {
    const m = imageRegex.exec(file);
    if (!m) continue;

    const postId = m[1];
    const existing = map.get(postId) || [];
    existing.push(`assets/${file}`);
    map.set(postId, existing);
  }

  // Sort each array by the numeric index
  for (const [, paths] of map) {
    paths.sort((a, b) => {
      const idxA = parseInt(a.match(/-(\d+)\.[^.]+$/)?.[1] || "0", 10);
      const idxB = parseInt(b.match(/-(\d+)\.[^.]+$/)?.[1] || "0", 10);
      return idxA - idxB;
    });
  }

  return map;
}

/**
 * Read all markdown files and build GalleryPost objects.
 */
async function readAllPosts(
  postsDir: string,
  assetMap: Map<string, string[]>
): Promise<GalleryPost[]> {
  const files = await readdir(postsDir);
  const mdFiles = files.filter((f) => f.endsWith(".md"));
  const posts: GalleryPost[] = [];

  for (const file of mdFiles) {
    const content = await readFile(join(postsDir, file), "utf-8");
    const parsed = parseFrontmatter(content);

    if (!parsed) {
      console.warn(`Skipping malformed file: ${file}`);
      continue;
    }

    const { meta, body } = parsed;
    const { text, media: parsedMedia } = parseBody(body);

    // Use parsed media from body; fall back to asset map if body had no images
    let media = parsedMedia;
    if (media.length === 0) {
      const fallbackImages = assetMap.get(meta.id) || [];
      media = fallbackImages.map((src) => ({ type: "image" as const, src }));
    }

    posts.push({
      id: meta.id || "",
      author: meta.author || "@unknown",
      verified: meta.verified === "true",
      date: meta.date || "",
      url: meta.url || "",
      likes: parseInt(meta.likes, 10) || 0,
      replies: parseInt(meta.replies, 10) || 0,
      reposts: parseInt(meta.reposts, 10) || 0,
      text,
      media,
    });
  }

  // Sort newest first
  posts.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  return posts;
}

/**
 * Generate the self-contained HTML gallery.
 */
export function generateHtml(posts: GalleryPost[]): string {
  // Escape </ sequences to prevent </script> from breaking out of the script block
  const postsJson = JSON.stringify(posts).replace(/<\//g, "<\\/");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Threadsafe</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='5 3 22 14.5'%3E%3Crect x='6' y='4' width='20' height='3' rx='1.5' fill='white'/%3E%3Crect x='10' y='7' width='12' height='8' fill='white'/%3E%3Crect x='6' y='15' width='20' height='3' rx='1.5' fill='white'/%3E%3Crect x='14' y='5' width='4' height='7' rx='1' fill='%230095f6'/%3E%3Cpolygon points='11,11 16,16.5 21,11' fill='%230095f6'/%3E%3C/svg%3E">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#000;--surface:#181818;--border:#2d2d2d;--hover:#222;
  --text:#f5f5f5;--text2:#999;--text3:#666;--accent:#0095f6;
  --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
body{background:var(--bg);color:var(--text);font-family:var(--font);line-height:1.4}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}

/* Header */
.header{
  position:sticky;top:0;z-index:100;
  background:var(--bg);border-bottom:1px solid var(--border);
  padding:12px 16px;
}
.header-inner{
  max-width:960px;margin:0 auto;
  display:flex;align-items:center;gap:12px;flex-wrap:wrap;
}
.logo{font-weight:700;font-size:18px;margin-right:auto;letter-spacing:-.3px}
.logo span{font-weight:400;color:var(--text2);font-size:14px;margin-left:8px}
.search{
  background:var(--surface);border:1px solid var(--border);border-radius:10px;
  padding:8px 12px;color:var(--text);font-size:14px;width:220px;
  font-family:var(--font);outline:none;
}
.search:focus{border-color:var(--accent)}
.search::placeholder{color:var(--text3)}
select{
  background:var(--surface);border:1px solid var(--border);border-radius:10px;
  padding:8px 12px;color:var(--text2);font-size:14px;
  font-family:var(--font);outline:none;cursor:pointer;
  -webkit-appearance:none;appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23999' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 10px center;
  padding-right:28px;
}
.view-toggle{display:flex;border-radius:10px;overflow:hidden;border:1px solid var(--border)}
.view-btn{
  padding:7px 12px;border:none;background:var(--surface);
  color:var(--text3);font-size:14px;cursor:pointer;transition:all .15s;
}
.view-btn.active{background:var(--text);color:#000}
.stats{text-align:center;color:var(--text3);font-size:13px;padding:10px 0}

/* Feed */
#feed{max-width:600px;margin:0 auto;padding:8px 0}
.post{border-bottom:1px solid var(--border);padding:16px}
.post:hover{background:var(--hover)}
.post .author-row{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.avatar{
  width:40px;height:40px;border-radius:50%;background:#333;
  display:flex;align-items:center;justify-content:center;
  font-weight:600;font-size:16px;flex-shrink:0;color:#fff;
}
.author-name{font-weight:600;font-size:15px}
.verified{display:inline-flex;margin-left:4px;vertical-align:middle}
.date{color:var(--text2);font-size:14px;margin-left:auto}
.post-text{font-size:15px;line-height:1.5;white-space:pre-wrap;margin-bottom:12px;word-break:break-word}
.post-img{max-width:100%;border-radius:8px;margin-bottom:8px;display:block}
.video-container{position:relative;cursor:pointer;margin-bottom:8px}
.video-container .post-img{margin-bottom:0}
.play-overlay{
  position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  background:rgba(0,0,0,.3);border-radius:8px;transition:background .15s;
}
.video-container:hover .play-overlay{background:rgba(0,0,0,.15)}
.post-video{max-width:100%;border-radius:8px;margin-bottom:8px;display:block;background:#000}
.metrics{display:flex;gap:16px;font-size:14px;color:var(--text2);margin-top:8px}
.actions{display:flex;gap:16px;margin-top:8px;font-size:13px}
.actions a,.actions button{
  color:var(--text3);background:none;border:none;font-size:13px;
  font-family:var(--font);cursor:pointer;padding:0;
}
.actions a:hover,.actions button:hover{color:var(--text)}

/* Grid */
#feed.grid-mode{
  max-width:960px;display:grid;
  grid-template-columns:repeat(3,1fr);gap:1px;
  background:var(--border);padding:0;
}
#feed.grid-mode .post{
  background:var(--bg);padding:0;border:none;
  aspect-ratio:1;overflow:hidden;position:relative;cursor:pointer;
}
#feed.grid-mode .post:hover{opacity:.85}
#feed.grid-mode .post .grid-cover{
  width:100%;height:100%;object-fit:cover;display:block;
}
#feed.grid-mode .post .grid-text-cover{
  width:100%;height:100%;display:flex;align-items:center;justify-content:center;
  padding:16px;background:var(--surface);
  font-size:14px;color:var(--text2);text-align:center;line-height:1.4;
  overflow:hidden;
}
#feed.grid-mode .post .grid-overlay{
  position:absolute;bottom:0;left:0;right:0;padding:8px 10px;
  background:linear-gradient(transparent,rgba(0,0,0,.85));
  font-size:12px;color:var(--text);
}
#feed.grid-mode .post .grid-overlay .grid-author{font-weight:600}
#feed.grid-mode .post .badge{
  position:absolute;top:8px;right:8px;
  background:rgba(0,0,0,.75);backdrop-filter:blur(4px);
  color:#fff;font-size:11px;padding:3px 8px;border-radius:12px;
}
#feed.grid-mode .post .feed-content{display:none}
#feed:not(.grid-mode) .post .grid-cover,
#feed:not(.grid-mode) .post .grid-text-cover,
#feed:not(.grid-mode) .post .grid-overlay,
#feed:not(.grid-mode) .post .badge{display:none}
#feed.grid-mode .sentinel{grid-column:1/-1;height:1px;overflow:hidden;padding:0}
.sentinel{padding:40px;text-align:center}

/* Modal */
.modal-backdrop{
  position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:200;
  display:flex;align-items:flex-start;justify-content:center;
  overflow-y:auto;padding:40px 16px;
}
.modal{
  max-width:600px;width:100%;background:var(--bg);border-radius:12px;
  border:1px solid var(--border);overflow:hidden;
}
.modal .post{border:none}
.modal-close{
  position:fixed;top:16px;right:16px;z-index:201;
  background:rgba(255,255,255,.15);border:none;border-radius:50%;
  width:36px;height:36px;color:#fff;font-size:20px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
}
.modal-close:hover{background:rgba(255,255,255,.25)}

/* Responsive */
@media(max-width:720px){
  #feed.grid-mode{grid-template-columns:repeat(2,1fr)}
  .header-inner{gap:8px}
  .search{width:160px}
}
</style>
</head>
<body>

<div class="header">
  <div class="header-inner">
    <div class="logo">Threadsafe <span id="postCount"></span></div>
    <input class="search" id="search" type="text" placeholder="Search posts...">
    <select id="authorFilter"></select>
    <select id="sortMode">
      <option value="newest">Newest</option>
      <option value="most-liked">Most liked</option>
      <option value="oldest">Oldest</option>
    </select>
    <div class="view-toggle">
      <button class="view-btn" id="feedBtn" onclick="setView('feed')">&#9776; Feed</button>
      <button class="view-btn" id="gridBtn" onclick="setView('grid')">&#9638; Grid</button>
    </div>
  </div>
</div>
<div class="stats" id="stats"></div>
<div id="feed"></div>

<script>
const POSTS=` + postsJson + `;
const BATCH=50;
let currentView=localStorage.getItem("threads-gallery-view")||"feed";
let searchQuery="";
let authorFilter="";
let sortMode="newest";
let filtered=[];
let rendered=0;
let debounceTimer=null;

const verifiedSvg='<svg class="verified" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="#0095f6"/><path d="M6.8 11.2L4 8.4l1-1 1.8 1.8 4.2-4.2 1 1z" fill="#fff"/></svg>';
const playSvg='<svg width="48" height="48" viewBox="0 0 48 48"><circle cx="24" cy="24" r="23" fill="none" stroke="#fff" stroke-width="2" opacity=".7"/><polygon points="20,16 34,24 20,32" fill="#fff" opacity=".7"/></svg>';

function stripAt(a){return a.replace(/^@/,"")}
function esc(s){
  if(!s)return"";
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function fmtDate(d){
  try{var dt=new Date(d);return dt.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
  catch(e){return d}
}
function fmtNum(n){return n>=1000?(n/1000).toFixed(n>=10000?0:1)+"k":String(n)}

function avatarColor(name){
  var h=0;for(var i=0;i<name.length;i++)h=name.charCodeAt(i)+((h<<5)-h);
  return "hsl("+(Math.abs(h)%360)+",45%,40%)";
}

function init(){
  var counts=new Map();
  for(var i=0;i<POSTS.length;i++){
    var a=POSTS[i].author;
    counts.set(a,(counts.get(a)||0)+1);
  }
  var sorted=Array.from(counts.entries()).sort(function(a,b){return b[1]-a[1]});
  var sel=document.getElementById("authorFilter");
  sel.innerHTML='<option value="">All authors ('+sorted.length+')</option>';
  for(var j=0;j<sorted.length;j++){
    var pair=sorted[j];
    sel.innerHTML+='<option value="'+esc(pair[0])+'">'+esc(stripAt(pair[0]))+" ("+pair[1]+")</option>";
  }

  document.getElementById("search").addEventListener("input",function(){
    clearTimeout(debounceTimer);
    var self=this;
    debounceTimer=setTimeout(function(){searchQuery=self.value.toLowerCase();applyFilters()},150);
  });
  sel.addEventListener("change",function(){authorFilter=this.value;applyFilters()});
  document.getElementById("sortMode").addEventListener("change",function(){sortMode=this.value;applyFilters()});

  updateViewBtns();
  applyFilters();
}

function setView(v){
  currentView=v;
  localStorage.setItem("threads-gallery-view",v);
  updateViewBtns();
  applyFilters();
}

function updateViewBtns(){
  document.getElementById("feedBtn").classList.toggle("active",currentView==="feed");
  document.getElementById("gridBtn").classList.toggle("active",currentView==="grid");
}

function applyFilters(){
  filtered=POSTS.filter(function(p){
    if(authorFilter&&p.author!==authorFilter)return false;
    if(searchQuery){
      if(p.text.toLowerCase().indexOf(searchQuery)===-1&&p.author.toLowerCase().indexOf(searchQuery)===-1)return false;
    }
    return true;
  });
  if(sortMode==="newest")filtered.sort(function(a,b){return new Date(b.date)-new Date(a.date)});
  else if(sortMode==="oldest")filtered.sort(function(a,b){return new Date(a.date)-new Date(b.date)});
  else if(sortMode==="most-liked")filtered.sort(function(a,b){return b.likes-a.likes});

  document.getElementById("stats").textContent="Showing "+filtered.length+" of "+POSTS.length+" posts";
  document.getElementById("postCount").textContent=filtered.length+" posts";

  var feed=document.getElementById("feed");
  feed.innerHTML="";
  feed.className=currentView==="grid"?"grid-mode":"";
  rendered=0;
  renderBatch();
}

function renderBatch(){
  var feed=document.getElementById("feed");
  var batch=filtered.slice(rendered,rendered+BATCH);
  for(var i=0;i<batch.length;i++){
    feed.insertAdjacentHTML("beforeend",renderPost(batch[i]));
  }
  rendered+=batch.length;
  if(rendered<filtered.length){
    var sentinel=document.createElement("div");
    sentinel.className="sentinel";
    sentinel.textContent="Loading more...";
    feed.appendChild(sentinel);
    var obs=new IntersectionObserver(function(entries){
      if(entries[0].isIntersecting){obs.disconnect();sentinel.remove();renderBatch()}
    },{rootMargin:"200px"});
    obs.observe(sentinel);
  }
}

function renderMediaHtml(p){
  var html="";
  for(var i=0;i<p.media.length;i++){
    var m=p.media[i];
    if(m.type==="image"){
      html+='<img class="post-img" src="'+esc(m.src)+'" loading="lazy" alt="">';
    }else if(m.poster){
      html+='<div class="video-container" data-video="'+esc(m.src)+'" onclick="playVideo(event,this)">'
        +'<img class="post-img" src="'+esc(m.poster)+'" loading="lazy" alt="">'
        +'<div class="play-overlay">'+playSvg+'</div></div>';
    }else{
      html+='<video class="post-video" controls playsinline preload="metadata">'
        +'<source src="'+esc(m.src)+'" type="video/mp4"></video>';
    }
  }
  return html;
}

function renderPost(p){
  var author=esc(stripAt(p.author));
  var initial=stripAt(p.author).charAt(0).toUpperCase();
  var color=avatarColor(p.author);
  var vBadge=p.verified?verifiedSvg:"";
  var dateStr=fmtDate(p.date);
  var hasVideo=false;
  var firstCoverSrc="";
  for(var i=0;i<p.media.length;i++){
    var m=p.media[i];
    if(m.type==="video")hasVideo=true;
    if(!firstCoverSrc){
      if(m.type==="image")firstCoverSrc=m.src;
      else if(m.poster)firstCoverSrc=m.poster;
    }
  }

  var gridCover="";
  var badge="";
  if(firstCoverSrc){
    gridCover='<img class="grid-cover" src="'+esc(firstCoverSrc)+'" loading="lazy" alt="">';
  }else if(hasVideo){
    gridCover='<div class="grid-text-cover" style="background:var(--surface)">'+playSvg+'</div>';
  }else{
    gridCover='<div class="grid-text-cover">'+esc(p.text.slice(0,200))+'</div>';
  }
  if(p.media.length>1)badge='<span class="badge">1/'+p.media.length+'</span>';
  else if(hasVideo)badge='<span class="badge">&#9654; video</span>';

  return '<div class="post" data-id="'+esc(p.id)+'" onclick="handlePostClick(event,this)">'
    +gridCover+badge
    +'<div class="grid-overlay"><span class="grid-author">'+author+'</span> &middot; '+esc(dateStr)
    +(p.media.length>1?' &middot; &#10084; '+fmtNum(p.likes):'')+'</div>'
    +'<div class="feed-content">'
    +'<div class="author-row">'
    +'<div class="avatar" style="background:'+color+'">'+initial+'</div>'
    +'<div><span class="author-name">'+author+'</span>'+vBadge+'</div>'
    +'<span class="date">'+esc(dateStr)+'</span></div>'
    +(p.text?'<div class="post-text">'+esc(p.text)+'</div>':'')
    +renderMediaHtml(p)
    +'<div class="metrics"><span>&#10084; '+fmtNum(p.likes)+'</span><span>&#128172; '+fmtNum(p.replies)+'</span><span>&#128260; '+fmtNum(p.reposts)+'</span></div>'
    +'<div class="actions">'
    +(p.url?'<a href="'+esc(p.url)+'" target="_blank" rel="noopener">View on Threads &#8599;</a>':'')
    +(p.url?'<button onclick="copyLink(event,this.dataset.url)" data-url="'+esc(p.url)+'">Copy link</button>':'')
    +'</div>'
    +'</div></div>';
}

function handlePostClick(e,el){
  if(currentView!=="grid")return;
  if(e.target.closest(".video-container"))return;
  var id=el.dataset.id;
  var post=null;
  for(var i=0;i<POSTS.length;i++){if(POSTS[i].id===id){post=POSTS[i];break}}
  if(post)openModal(post);
}

function openModal(p){
  var existing=document.querySelector(".modal-backdrop");
  if(existing)existing.remove();

  var author=esc(stripAt(p.author));
  var initial=stripAt(p.author).charAt(0).toUpperCase();
  var color=avatarColor(p.author);
  var vBadge=p.verified?verifiedSvg:"";
  var dateStr=fmtDate(p.date);

  var html='<div class="modal-backdrop" onclick="if(event.target===this)closeModal()">'
    +'<button class="modal-close" onclick="closeModal()">&times;</button>'
    +'<div class="modal"><div class="post">'
    +'<div class="author-row" style="padding:16px 16px 0">'
    +'<div class="avatar" style="background:'+color+'">'+initial+'</div>'
    +'<div><span class="author-name">'+author+'</span>'+vBadge+'</div>'
    +'<span class="date">'+esc(dateStr)+'</span></div>'
    +'<div style="padding:12px 16px 16px">'
    +(p.text?'<div class="post-text">'+esc(p.text)+'</div>':'')
    +renderMediaHtml(p)
    +'<div class="metrics"><span>&#10084; '+fmtNum(p.likes)+'</span><span>&#128172; '+fmtNum(p.replies)+'</span><span>&#128260; '+fmtNum(p.reposts)+'</span></div>'
    +'<div class="actions">'
    +(p.url?'<a href="'+esc(p.url)+'" target="_blank" rel="noopener">View on Threads &#8599;</a>':'')
    +(p.url?'<button onclick="copyLink(event,this.dataset.url)" data-url="'+esc(p.url)+'">Copy link</button>':'')
    +'</div></div></div></div></div>';

  document.body.insertAdjacentHTML("beforeend",html);
  document.body.style.overflow="hidden";
}

function playVideo(e,container){
  e.stopPropagation();
  var url=container.dataset.video;
  var video=document.createElement("video");
  video.className="post-video";
  video.controls=true;
  video.playsInline=true;
  video.autoplay=true;
  var source=document.createElement("source");
  source.src=url;
  source.type="video/mp4";
  video.appendChild(source);
  container.replaceWith(video);
  video.addEventListener("error",function(){
    var msg=document.createElement("div");
    msg.style.cssText="padding:20px;text-align:center;color:var(--text2);font-size:13px";
    msg.textContent="Video unavailable";
    video.replaceWith(msg);
  });
}

function closeModal(){
  var m=document.querySelector(".modal-backdrop");
  if(m)m.remove();
  document.body.style.overflow="";
}

function copyLink(e,url){
  e.stopPropagation();
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(url).then(function(){
      var btn=e.target;
      var orig=btn.textContent;
      btn.textContent="Copied!";
      setTimeout(function(){btn.textContent=orig},1500);
    }).catch(function(){});
  }
}

document.addEventListener("keydown",function(e){
  if(e.key==="Escape")closeModal();
});

document.addEventListener("DOMContentLoaded",init);
</script>
</body>
</html>`;
}

/**
 * Generate the gallery HTML file from all backed-up posts.
 */
export async function generateGallery(outputDir: string): Promise<void> {
  console.log("\nGenerating gallery...");

  const postsDir = join(outputDir, "posts");
  const assetsDir = join(outputDir, "assets");

  if (!existsSync(postsDir)) {
    console.log("No posts directory found, skipping gallery generation.");
    return;
  }

  const assetMap = await scanAssets(assetsDir);
  const posts = await readAllPosts(postsDir, assetMap);

  if (posts.length === 0) {
    console.log("No posts found, skipping gallery generation.");
    return;
  }

  const html = generateHtml(posts);
  await writeFile(join(outputDir, "index.html"), html, "utf-8");
  console.log(
    `Gallery generated: ${join(outputDir, "index.html")} (${posts.length} posts)`
  );
}
