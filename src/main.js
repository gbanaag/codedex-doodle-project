import { createClient } from "@supabase/supabase-js";

// --- Supabase client (Vite .env) ---
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// --- DOM ---
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const captionEl = document.getElementById("caption");
const galleryEl = document.getElementById("gallery");

const submitBtn = document.getElementById("submit");
const clearBtn = document.getElementById("clear");
const refreshBtn = document.getElementById("refresh");
const statusEl = document.getElementById("status");

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
  console.log(msg);
}

// --- Canvas drawing (mouse + touch via pointer events) ---
let isDrawing = false;

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function startDraw(e) {
  isDrawing = true;
  const { x, y } = getPos(e);
  ctx.beginPath();
  ctx.moveTo(x, y);
}

function draw(e) {
  if (!isDrawing) return;

  const { x, y } = getPos(e);

  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#111";

  ctx.lineTo(x, y);
  ctx.stroke();

  if (e.cancelable) e.preventDefault();
}

function endDraw() {
  isDrawing = false;
  ctx.closePath();
}

canvas.addEventListener("pointerdown", startDraw);
canvas.addEventListener("pointermove", draw);
canvas.addEventListener("pointerup", endDraw);
canvas.addEventListener("pointercancel", endDraw);
canvas.addEventListener("pointerleave", endDraw);

// White background so PNG isn’t transparent
function clearCanvas() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  setStatus("Cleared.");
}
clearCanvas();

clearBtn?.addEventListener("click", clearCanvas);
refreshBtn?.addEventListener("click", loadGallery);

function resetDrawing() {
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
}

window.resetDrawing = resetDrawing;
resetDrawing();

// --- Simple flagging (optional) ---
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

  const inkRatio = nonWhite / totalPixels;
  return inkRatio < 0.003; // mostly blank => flagged
}

// --- Helpers ---
function canvasToBlob() {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))), "image/png");
  });
}

function addToGallery(publicUrl, caption, flagged) {
  const outer = document.createElement("div");
  outer.className = "envelopeWrap" + (flagged ? " flagged" : "");

  outer.innerHTML = `
    <div class="wrapper">
      <div class="bottom-flap"></div>
      <div class="envelope"></div>
      <div class="lid one"></div>
      <div class="lid two"></div>

      <div class="letter">
        <div class="paper">
          <img src="${publicUrl}" alt="drawing" loading="lazy" />
          ${caption ? `<div class="note">${escapeHtml(caption)}</div>` : ""}
        </div>
      </div>
    </div>
  `;

  outer.addEventListener("click", () => {
    outer.classList.toggle("open");
  });

  galleryEl.prepend(outer);

  // optional: auto-open newest
  // outer.classList.add("open");
}

// tiny helper so captions can't break your HTML
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[c]));
}

// --- SUBMIT: upload to Storage + insert DB row ---
async function submitDrawing() {
  try {
    setStatus("Uploading...");

    const caption = (captionEl?.value ?? "").trim().slice(0, 140);

    // Flagging based on pixels (optional)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const flagged = decideFlagging(imageData.data);

    const blob = await canvasToBlob();

    const filename = `${Date.now()}-${crypto.randomUUID()}.png`;
    const path = `public/${filename}`;

    // 1) Upload image file to Storage bucket "drawings"
    const { error: uploadError } = await supabase.storage
      .from("drawings")
      .upload(path, blob, { contentType: "image/png", upsert: false });

    if (uploadError) {
      console.error("UPLOAD ERROR:", uploadError);
      throw uploadError;
    }

    // 2) Insert metadata row into DB table "drawings"
    const { error: insertError } = await supabase
      .from("drawings")
      .insert([{ path, caption, flagged }]);

    if (insertError) {
      console.error("INSERT ERROR:", insertError);
      throw insertError;
    }

    // 3) Render immediately
    const { data: publicData } = supabase.storage.from("drawings").getPublicUrl(path);
    addToGallery(publicData.publicUrl, caption, flagged);

    // Reset UI
    clearCanvas();
    resetDrawing();
    if (captionEl) captionEl.value = "";

    setStatus("Planted ✅");
  } catch (err) {
    setStatus(`Failed ❌ ${err?.message ?? err}`);
  }
}

submitBtn?.addEventListener("click", submitDrawing);

// --- LOAD GALLERY: read DB rows + render images ---
async function loadGallery() {
  try {
    setStatus("Loading gallery...");
    galleryEl.innerHTML = "";

    const { data, error } = await supabase
      .from("drawings")
      .select("path, caption, flagged, created_at")
      .order("created_at", { ascending: false })
      .limit(40);

    if (error) throw error;

    for (const row of data) {
      const { data: publicData } = supabase.storage.from("drawings").getPublicUrl(row.path);
      addToGallery(publicData.publicUrl, row.caption ?? "", !!row.flagged);
    }

    setStatus(`Loaded ${data.length} drawings.`);
  } catch (err) {
    setStatus(`Gallery load failed ❌ ${err?.message ?? err}`);
  }
}

loadGallery();