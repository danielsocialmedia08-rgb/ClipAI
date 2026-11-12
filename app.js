const $ = (id) => document.getElementById(id);
const fileInput = $("videoFile");
const preview = $("preview");
let selectedFile = null;
let outputUrl = null;
let selectedFormat = "original";
let ffmpegInstance = null;
let analysisLogs = [];

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3200);
}
function secondsFromTime(value) {
  const parts = value.trim().split(":").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return NaN;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}
function formatBytes(bytes) {
  return bytes > 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(1) + " MB" : (bytes / 1024).toFixed(0) + " KB";
}
function updateButton() {
  $("createClip").disabled = !selectedFile;
  $("detectHighlights").disabled = !selectedFile;
}
function clearFile() {
  if (preview.src) URL.revokeObjectURL(preview.src);
  preview.removeAttribute("src");
  preview.classList.add("hidden");
  $("fileInfo").classList.add("hidden");
  selectedFile = null;
  updateButton();
}
$("browseBtn").addEventListener("click", () => fileInput.click());
$("dropzone")?.addEventListener("click", () => fileInput.click());
$("uploadPane").addEventListener("dragover", (e) => { e.preventDefault(); $("uploadPane").style.borderColor = "#9a80ff"; });
$("uploadPane").addEventListener("dragleave", () => { $("uploadPane").style.borderColor = ""; });
$("uploadPane").addEventListener("drop", (e) => {
  e.preventDefault();
  $("uploadPane").style.borderColor = "";
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});
fileInput.addEventListener("change", () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });
function loadFile(file) {
  if (!file.type.startsWith("video/")) return toast("Selecciona un archivo de video válido.");
  selectedFile = file;
  preview.src = URL.createObjectURL(file);
  preview.classList.remove("hidden");
  $("fileName").textContent = file.name;
  $("fileSize").textContent = formatBytes(file.size);
  $("fileInfo").classList.remove("hidden");
  $("uploadPane").classList.add("hidden");
  $("youtubePane").classList.add("hidden");
  updateButton();
  preview.onloadedmetadata = () => {
    const duration = Math.floor(preview.duration);
    $("endTime").value = [Math.floor(duration / 3600), Math.floor(duration % 3600 / 60), duration % 60].map(n => String(n).padStart(2, "0")).join(":");
  };
}
$("removeFile").addEventListener("click", () => {
  clearFile();
  $("uploadPane").classList.remove("hidden");
  fileInput.value = "";
});
document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
  const youtube = tab.dataset.tab === "youtube";
  $("uploadPane").classList.toggle("hidden", youtube || !!selectedFile);
  $("youtubePane").classList.toggle("hidden", !youtube);
  if (!youtube && !selectedFile) $("uploadPane").classList.remove("hidden");
}));
$("checkYoutube").addEventListener("click", () => {
  const url = $("youtubeUrl").value.trim();
  let parsed;
  try { parsed = new URL(url); } catch { return toast("Pega un enlace web válido que comience con https://"); }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const platforms = [
    {name:"YouTube",domains:["youtube.com","youtu.be","m.youtube.com"]},
    {name:"Twitch",domains:["twitch.tv","m.twitch.tv"]},
    {name:"Kick",domains:["kick.com"]},
    {name:"Facebook",domains:["facebook.com","fb.watch","m.facebook.com"]},
    {name:"TikTok",domains:["tiktok.com","vm.tiktok.com"]},
    {name:"Instagram",domains:["instagram.com"]},
    {name:"X",domains:["x.com","twitter.com"]}
  ];
  const platform = platforms.find(p => p.domains.some(d => host === d || host.endsWith("." + d)));
  if (!platform) return toast("Plataforma no reconocida todavía. Prueba YouTube, Kick, Twitch, Facebook, TikTok, Instagram o X.");
  toast("Enlace de " + platform.name + " reconocido. La importación directa se habilitará al conectar el servidor de video.");
});
document.querySelectorAll(".format").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".format").forEach((b) => b.classList.toggle("active", b === button));
  selectedFormat = button.dataset.format;
}));
async function getFFmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  if (!window.FFmpegWASM || !window.FFmpegUtil) throw new Error("No se pudo cargar el motor de video. Comprueba tu conexión a internet y recarga la página.");
  const { FFmpeg } = window.FFmpegWASM;
  const { toBlobURL } = window.FFmpegUtil;
  const ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => { console.log("[ClipAI]", message); analysisLogs.push(message); });
  const base = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
  await ffmpeg.load({
    coreURL: await toBlobURL(base + "/ffmpeg-core.js", "text/javascript"),
    wasmURL: await toBlobURL(base + "/ffmpeg-core.wasm", "application/wasm")
  });
  ffmpegInstance = ffmpeg;
  return ffmpeg;
}
$("detectHighlights").addEventListener("click", async () => {
  if (!selectedFile) return;
  const button = $("detectHighlights");
  button.disabled = true;
  button.textContent = "Analizando audio del video…";
  try {
    const ffmpeg = await getFFmpeg();
    const inputName = "clipai-analysis" + (selectedFile.name.match(/\.[^.]+$/)?.[0] || ".mp4");
    await ffmpeg.writeFile(inputName, new Uint8Array(await selectedFile.arrayBuffer()));
    analysisLogs = [];
    await ffmpeg.exec(["-i", inputName, "-af", "silencedetect=noise=-32dB:d=0.6", "-f", "null", "-"]);
    const duration = Number.isFinite(preview.duration) ? preview.duration : 0;
    const events = analysisLogs.join("\n");
    const starts = [...events.matchAll(/silence_start: ([0-9.]+)/g)].map(m => Number(m[1]));
    const ends = [...events.matchAll(/silence_end: ([0-9.]+)/g)].map(m => Number(m[1]));
    const active = [];
    let cursor = 0;
    for (let i = 0; i < starts.length; i++) {
      const stop = starts[i];
      if (stop > cursor) active.push({ start: cursor, end: stop, length: stop - cursor });
      if (ends[i] !== undefined) cursor = ends[i];
    }
    if (duration > cursor) active.push({ start: cursor, end: duration, length: duration - cursor });
    let best = active.filter(x => x.length >= 5).sort((a,b) => b.length-a.length)[0];
    if (!best) {
      const fallbackLength = Math.min(20, duration);
      best = { start: Math.max(0, (duration - fallbackLength) / 2), end: Math.min(duration, (duration + fallbackLength) / 2), length: fallbackLength };
    }
    const clipLength = Math.min(30, best.length);
    const start = best.start + Math.max(0, (best.length - clipLength) / 2);
    const end = start + clipLength;
    const toTime = value => [Math.floor(value/3600), Math.floor(value%3600/60), Math.floor(value%60)].map(n=>String(n).padStart(2,"0")).join(":");
    $("startTime").value = toTime(start);
    $("endTime").value = toTime(end);
    $("clipTitle").value = "Mejor momento - ClipAI";
    toast("¡Encontramos un momento destacado! Puedes ajustar los tiempos antes de crear el clip.");
    await ffmpeg.deleteFile(inputName);
  } catch (error) {
    console.error(error);
    toast("No se pudo analizar el audio. Inténtalo de nuevo.");
  } finally {
    button.disabled = false;
    button.innerHTML = '<span>✦</span> Encontrar los mejores momentos <span class="ai-tag">AUTOMÁTICO</span>';
    updateButton();
  }
});
$("createClip").addEventListener("click", async () => {
  if (!selectedFile) return;
  const start = secondsFromTime($("startTime").value);
  const end = secondsFromTime($("endTime").value);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return toast("Revisa las horas de inicio y final.");
  if (preview.duration && end > preview.duration + 1) return toast("El final supera la duración del video.");
  const button = $("createClip");
  button.disabled = true;
  button.innerHTML = "Preparando motor de video…";
  try {
    const ffmpeg = await getFFmpeg();
    const inputName = "clipai-input" + (selectedFile.name.match(/\.[^.]+$/)?.[0] || ".mp4");
    const outputName = "clipai-output.mp4";
    await ffmpeg.writeFile(inputName, new Uint8Array(await selectedFile.arrayBuffer()));
    const args = ["-ss", String(start), "-i", inputName, "-t", String(end - start)];
    if (selectedFormat === "vertical") args.push("-vf", "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2");
    args.push("-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-c:a", "aac", "-movflags", "+faststart", outputName);
    button.textContent = "Creando clip…";
    await ffmpeg.exec(args);
    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([data.buffer], { type: "video/mp4" });
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(blob);
    $("resultVideo").src = outputUrl;
    $("downloadClip").href = outputUrl;
    $("downloadClip").download = ($("clipTitle").value.trim() || "clipai").replace(/[^a-z0-9-_]/gi, "-") + ".mp4";
    $("resultName").textContent = $("clipTitle").value.trim() || "Mi nuevo clip";
    $("resultPanel").classList.remove("hidden");
    $("resultPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);
    toast("¡Tu clip está listo para descargar!");
  } catch (error) {
    console.error(error);
    toast(error.message || "No se pudo crear el clip. Inténtalo de nuevo.");
  } finally {
    button.disabled = false;
    button.innerHTML = '<span>✦</span> Crear mi clip <span class="button-arrow">→</span>';
    updateButton();
  }
});