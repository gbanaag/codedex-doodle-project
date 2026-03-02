import { createClient } from "@supabase/supabase-js";

/* =========================
   Supabase
========================= */
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
const BUCKET = "drawings";
const TABLE = "drawings";

/* =========================
   DOM (safe across pages)
========================= */
const galleryEl = document.getElementById("gallery");
const statusEl = document.getElementById("status");

const canvas = document.getElementById("canvas");
let ctx = null;

const captionEl = document.getElementById("caption");
const submitBtn = document.getElementById("submit");
const clearBtn = document.getElementById("clear");
const brushSizeEl = document.getElementById("brushSize");

/* =========================
   Helpers
========================= */
function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
  console.log(msg);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[c]));
}

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const FRAMES = [
  { src: "/images/frame-wide.png", stageRatio: "3 / 2", orient: "h", win: { left: 9, right: 9, top: 14, bottom: 17 } },
  { src: "/images/frame-vertical.png", stageRatio: "3 / 4", orient: "v", win: { left: 18, right: 18, top: 12, bottom: 13 } },
  { src: "/images/frame-empty.png", stageRatio: "4 / 3", orient: "h", win: { left: 7, right: 7, top: 10, bottom: 12 } },
];

function pickRandomFrame() {
  return FRAMES[Math.floor(Math.random() * FRAMES.length)];
}

/* =========================
   Museum-frame renderer
========================= */
function addToGallery(publicUrl, caption, flagged, createdAt) {
  if (!galleryEl) return;

  const frame = pickRandomFrame();
  const title = caption?.trim() || "Untitled";
  const date = createdAt
  ? new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "numeric",
    }).format(new Date(createdAt))
  : "";

  const wrap = document.createElement("div");
  wrap.className = "artCard";

  wrap.innerHTML = `
  <div class="frameStage">
    <div class="backboard"></div>
    <div class="artWindow">
      <div class="artSquare">
        <img src="${publicUrl}" alt="${escapeHtml(title)}" loading="lazy" />
      </div>
    </div>
    <img class="frameImg" src="${frame.src}" alt="frame" />
  </div>

  <div class="placard">
    <div class="placardTitle">${escapeHtml(title)}</div>
    <div class="placardMeta">Anonymous · ${date}</div>
  </div>
`;

  // Apply frame-specific layout using CSS variables
  const stage = wrap.querySelector(".frameStage");
  stage.dataset.orient = frame.orient; 
  stage.style.setProperty("--stage-ratio", frame.stageRatio);
  stage.style.setProperty("--win-left", frame.win.left + "%");
  stage.style.setProperty("--win-right", frame.win.right + "%");
  stage.style.setProperty("--win-top", frame.win.top + "%");
  stage.style.setProperty("--win-bottom", frame.win.bottom + "%");

  // Optional: blur flagged
  if (flagged) {
    const img = wrap.querySelector(".artSquare img");
    if (img) img.style.filter = "blur(10px) saturate(0.7)";
  }

  galleryEl.prepend(wrap);

}
/* =========================
   Load gallery (newest or random)
========================= */
async function loadGallery(limit = 40, randomize = false) {
  if (!galleryEl) return;

  try {
    setStatus("Loading gallery...");
    galleryEl.innerHTML = "";

    // If randomizing, pull a bigger pool then shuffle client-side
    const poolSize = randomize ? Math.max(500, limit) : limit;

    const { data, error } = await supabase
      .from(TABLE)
      .select("path, caption, flagged, created_at")
      .order("created_at", { ascending: false })
      .limit(poolSize);

    if (error) throw error;

    let rows = data ?? [];
    if (randomize) rows = shuffleArray(rows).slice(0, limit);
    else rows = rows.slice(0, limit);

    for (const row of rows) {
      const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(row.path);
      addToGallery(publicData.publicUrl, row.caption ?? "", !!row.flagged, row.created_at);
    }

    setStatus(`Loaded ${rows.length} drawings.`);
  } catch (err) {
    console.error(err);
    setStatus(`Gallery load failed ❌ ${err?.message ?? err}`);
  }
}

/* =========================
   Drawing palette + canvas (only if canvas exists)
========================= */
const PALETTE = ["#111111", "#E11D48", "#FB7185", "#F59E0B", "#10B981", "#3B82F6", "#fff"];
let strokeColor = PALETTE[0];

function initPaletteUI() {
  const paletteEl = document.getElementById("palette");
  if (!paletteEl) return;

  paletteEl.innerHTML = "";
  PALETTE.forEach((c, idx) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch" + (idx === 0 ? " active" : "");
    b.style.background = c;

    b.addEventListener("click", () => {
      strokeColor = c;
      paletteEl.querySelectorAll(".swatch").forEach(s => s.classList.remove("active"));
      b.classList.add("active");
    });

    paletteEl.appendChild(b);
  });
}

function getBrushSize() {
  const n = Number(brushSizeEl?.value ?? 50);
  return Number.isFinite(n) ? n : 50;
}

function clearCanvas() {
  if (!canvas || !ctx) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  setStatus("Cleared.");
}
clearCanvas();

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
}

let isDrawing = false;

function startDraw(e) {
  if (!canvas || !ctx) return;
  isDrawing = true;
  const { x, y } = getPos(e);
  ctx.beginPath();
  ctx.moveTo(x, y);
}

function draw(e) {
  if (!canvas || !ctx || !isDrawing) return;

  const { x, y } = getPos(e);

  ctx.lineWidth = getBrushSize();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = strokeColor;

  ctx.lineTo(x, y);
  ctx.stroke();

  if (e.cancelable) e.preventDefault();
}

function endDraw() {
  if (!canvas || !ctx) return;
  isDrawing = false;
  ctx.closePath();
}

function decideFlagging(pixelData) {
  let nonWhite = 0;
  const totalPixels = pixelData.length / 4;

  for (let i = 0; i < pixelData.length; i += 4) {
    const r = pixelData[i];
    const g = pixelData[i + 1];
    const b = pixelData[i + 2];
    const a = pixelData[i + 3];
    if (a === 0) continue;
    const isWhite = r > 245 && g > 245 && b > 245;
    if (!isWhite) nonWhite++;
  }

  return nonWhite / totalPixels < 0.003;
}

function canvasToBlob() {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))), "image/png");
  });
}

function findContentBounds(imageData, w, h) {
  const data = imageData.data;

  let minX = w, minY = h, maxX = -1, maxY = -1;

  // treat anything not near-white as "ink"
  const isInk = (r,g,b,a) => a > 10 && !(r > 245 && g > 245 && b > 245);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
      if (isInk(r,g,b,a)) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX === -1) return null; // nothing drawn
  return { minX, minY, maxX, maxY };
}

function makeCenteredSquarePng(canvas, pad = 24) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);

  const bounds = findContentBounds(img, w, h);
  if (!bounds) return canvas; // blank

  // crop bounds + padding
  const bw = bounds.maxX - bounds.minX + 1;
  const bh = bounds.maxY - bounds.minY + 1;

  const size = Math.max(bw, bh) + pad * 2;

  // temp canvas for centered export
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const octx = out.getContext("2d");

  // white background
  octx.fillStyle = "white";
  octx.fillRect(0, 0, size, size);

  // center the crop into the square
  const dx = Math.floor((size - bw) / 2);
  const dy = Math.floor((size - bh) / 2);

  octx.drawImage(
    canvas,
    bounds.minX, bounds.minY, bw, bh,  // source crop
    dx, dy, bw, bh                     // destination centered
  );

  return out;
}

async function submitDrawing() {
  if (!canvas || !ctx) {
    setStatus("No canvas on this page.");
    return;
  }

  try {
    setStatus("Uploading...");

    const caption = (captionEl?.value ?? "").trim().slice(0, 140);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const flagged = decideFlagging(imageData.data);

    const exportCanvas = makeCenteredSquarePng(canvas, 32);
    const blob = await new Promise((resolve, reject) => {
      exportCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
    });

    const filename = `${Date.now()}-${crypto.randomUUID()}.png`;
    const path = `public/${filename}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, { contentType: "image/png", upsert: false });

    if (uploadError) throw uploadError;

    const { error: insertError } = await supabase
      .from(TABLE)
      .insert([{ path, caption, flagged }]);

    if (insertError) throw insertError;

    // Render immediately if gallery exists on this page
    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    addToGallery(publicData.publicUrl, caption, flagged, new Date().toISOString());

    // Reset
    clearCanvas();
    if (captionEl) captionEl.value = "";

    setStatus("Added ✅");
  } catch (err) {
    console.error(err);
    setStatus(`Failed ❌ ${err?.message ?? err}`);
  }
}

/* =========================
   Init
========================= */
(function init() {
  // Gallery: always load if the element exists
  const limit = Number(window.GALLERY_LIMIT ?? 40);
  const randomize = Boolean(window.GALLERY_RANDOM ?? false);
  if (galleryEl) loadGallery(limit, randomize);

  // Canvas: only if canvas exists
  if (canvas) {
    ctx = canvas.getContext("2d", { willReadFrequently: true });

    canvas.addEventListener("pointerdown", startDraw);
    canvas.addEventListener("pointermove", draw);
    canvas.addEventListener("pointerup", endDraw);
    canvas.addEventListener("pointercancel", endDraw);
    canvas.addEventListener("pointerleave", endDraw);

    initPaletteUI();
    clearCanvas();
  }

  submitBtn?.addEventListener("click", submitDrawing);
  clearBtn?.addEventListener("click", clearCanvas);

  // Optional: expose for onclick usage
  window.loadGallery = loadGallery;
  window.submitDrawing = submitDrawing;
  window.clearCanvas = clearCanvas;
})();