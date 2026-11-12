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
function getYouTubeVideoId(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || null;
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") return url.searchParams.get("v");
    const parts = url.pathname.split("/").filter(Boolean);
    if (["embed", "shorts", "live", "v"].includes(parts[0])) return parts[1] || null;
  }
  return null;
}
function resetPlatformPreview() {
  $("youtubeFrame").src = "about:blank";
  $("youtubePreview").classList.add("hidden");
}
$("switchToUpload").addEventListener("click", () => {
  resetPlatformPreview();
  document.querySelector('.tab[data-tab="upload"]').click();
  fileInput.click();
});
$("downloadFromUrl").addEventListener("click", async () => {
  const input = $("directVideoUrl");
  const raw = input.value.trim();
  let url;
  try { url = new URL(raw); } catch { return toast("Pega un enlace completo que comience con https://"); }
  if (url.protocol !== "https:") return toast("Por seguridad, utiliza un enlace HTTPS.");
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const message = $("sourceImportMessage");
  const official = $("sourceOfficialLink");
  message.classList.remove("hidden");
  official.classList.add("hidden");
  const showOfficial = (text, href, label = "Abrir opción oficial ↗") => {
    message.textContent = text;
    official.href = href;
    official.textContent = label;
    official.classList.remove("hidden");
  };
  if (["youtube.com","m.youtube.com","youtube-nocookie.com","youtu.be"].includes(host)) {
    const ownStudio = "https://studio.youtube.com/";
    showOfficial("YouTube no permite descargar videos de otros canales mediante esta función. Si el video es tuyo, descárgalo desde YouTube Studio y después súbelo a ClipAI.", ownStudio, "Abrir YouTube Studio ↗");
    return;
  }
  if (host === "kick.com" || host.endsWith(".kick.com")) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "video" || parts[0] === "clips" || parts[0] === "clip") {
      showOfficial("Abre el clip o VOD en Kick. Los clips disponibles muestran la opción Descargar en su página. Los VOD completos solo se descargan desde el panel del propietario del canal.", url.href, "Abrir video en Kick ↗");
    } else {
      showOfficial("Para descargar tus propios VOD de Kick, entra en Studio > VODs desde tu Creator Dashboard. Después sube el archivo a ClipAI.", "https://dashboard.kick.com/studio/vods", "Abrir VODs de Kick ↗");
    }
    return;
  }
  if (host === "twitch.tv" || host.endsWith(".twitch.tv")) {
    const parts = url.pathname.split("/").filter(Boolean);
    const isClip = parts[0] === "clip" || parts[0] === "clips";
    if (isClip) {
      showOfficial("Para clips de Twitch, la descarga automática requiere autorización OAuth del canal con permisos de editor. Abre el clip y usa las opciones disponibles en Twitch; luego sube el archivo a ClipAI.", url.href, "Abrir clip en Twitch ↗");
    } else {
      showOfficial("Para descargar tus propios VOD de Twitch, abre Video Producer y usa el menú del video. Después sube el archivo a ClipAI.", "https://dashboard.twitch.tv/content/video", "Abrir Video Producer ↗");
    }
    return;
  }
  const button = $("downloadFromUrl");
  button.disabled = true;
  button.textContent = "…";
  try {
    const response = await fetch(url.href);
    if (!response.ok) throw new Error("El servidor no permitió descargar el archivo (HTTP " + response.status + ").");
    const blob = await response.blob();
    const type = (blob.type || response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!type.startsWith("video/")) throw new Error("El enlace no devolvió un archivo de video. Necesitas un enlace directo MP4, WebM o MOV.");
    if (blob.size > 13_500_000) throw new Error("El archivo supera 13.5 MB, el límite actual del análisis con IA.");
    const nameFromUrl = decodeURIComponent(url.pathname.split("/").pop() || "video-importado");
    const extension = type.includes("webm") ? ".webm" : type.includes("quicktime") ? ".mov" : ".mp4";
    const name = /\.(mp4|webm|mov)$/i.test(nameFromUrl) ? nameFromUrl : "video-importado" + extension;
    loadFile(new File([blob], name, { type }));
    message.textContent = "Video importado correctamente. Ya puedes analizarlo.";
    toast("Video importado correctamente.");
  } catch (error) {
    console.error(error);
    const corsHint = error instanceof TypeError ? " El servidor puede bloquear la importación desde otros sitios (CORS)." : "";
    message.textContent = (error.message || "No se pudo importar el video.") + corsHint;
    toast("No se pudo importar el video.");
  } finally {
    button.disabled = false;
    button.textContent = "Continuar";
  }
});
$("checkYoutube").addEventListener("click", () => {
  const raw = $("youtubeUrl").value.trim();
  let parsed;
  try { parsed = new URL(raw); } catch { return toast("Pega un enlace completo que comience con https://"); }
  if (parsed.protocol !== "https:") return toast("Por seguridad, utiliza un enlace HTTPS.");
  const host = parsed.hostname.toLowerCase().replace("www.", "");
  let embed = "";
  let message = "";
  if (["youtube.com","m.youtube.com","youtube-nocookie.com","youtu.be"].includes(host)) {
    const id = getYouTubeVideoId(parsed);
    if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) return toast("No pude identificar el video de YouTube. Revisa el enlace.");
    embed = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id);
    message = "Si YouTube muestra restricción de edad, bloqueo de inserción o pantalla negra, abre el original o sube un archivo que tengas autorización para usar. ClipAI no puede quitar esas restricciones.";
  } else if (host === "twitch.tv" || host.endsWith(".twitch.tv")) {
    const parts = parsed.pathname.split("/").filter(Boolean);
    const parent = "danielsocialmedia08-rgb.github.io";
    if (parts[0] === "videos" && /^[0-9]+$/.test(parts[1] || "")) {
      embed = "https://player.twitch.tv/?video=" + encodeURIComponent("v" + parts[1]) + "&parent=" + parent;
    } else if (parts[0] === "clip" && parts[1]) {
      embed = "https://clips.twitch.tv/embed?clip=" + encodeURIComponent(parts[1]) + "&parent=" + parent;
    } else if (parts[0] && parts[0] !== "directory") {
      embed = "https://player.twitch.tv/?channel=" + encodeURIComponent(parts[0]) + "&parent=" + parent;
    } else {
      return toast("Pega un enlace de canal, VOD o clip de Twitch.");
    }
    message = "Vista previa de Twitch. Algunos VOD, canales o clips pueden requerir inicio de sesión o no permitir inserción.";
  } else if (host === "kick.com" || host.endsWith(".kick.com")) {
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length === 1 && !["categories","videos","clips"].includes(parts[0])) {
      embed = "https://player.kick.com/" + encodeURIComponent(parts[0]);
      message = "Vista previa del canal de Kick. Los VOD y clips pueden no admitir inserción; si no aparecen, abre el original o sube un archivo autorizado.";
    } else {
      message = "Este enlace de Kick parece ser un VOD o clip. Ábrelo en Kick; si tienes permiso para editarlo, descarga el archivo desde las opciones oficiales y súbelo a ClipAI.";
    }
  } else {
    return toast("Por ahora, pega un enlace de YouTube, Twitch o Kick.");
  }
  $("openOriginal").href = parsed.href;
  $("previewMessage").textContent = message;
  if (embed) {
    $("youtubeFrame").src = embed;
    $("youtubeFrame").title = "Vista previa de " + host;
  } else {
    $("youtubeFrame").src = "about:blank";
  }
  $("youtubePreview").classList.remove("hidden");
  toast(embed ? "Vista previa preparada. La reproducción depende de la plataforma." : "Enlace reconocido. Usa Abrir video original.");
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
async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

$("detectHighlights").addEventListener("click", async () => {
  if (!selectedFile) return;
  const button = $("detectHighlights");
  button.disabled = true;
  button.textContent = "La IA está analizando tu video…";
  try {
    if (selectedFile.size > 13_500_000) {
      throw new Error("Para este primer análisis, usa un video de menos de 13.5 MB. Después ampliaremos el límite.");
    }

    const videoBase64 = await fileToBase64(selectedFile);
    const response = await fetch("https://clipai-api.danielsocialmedia08.workers.dev/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoBase64,
        mimeType: selectedFile.type || "video/mp4"
      })
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "No se pudo analizar el video con Gemini.");
    }

    const moments = payload.result?.moments;
    if (!Array.isArray(moments) || moments.length === 0) {
      throw new Error("La IA no encontró momentos claros. Prueba con otro video.");
    }

    const validMoments = moments
      .filter(m => Number.isFinite(Number(m.start)) && Number.isFinite(Number(m.end)) &&
        Number(m.end) > Number(m.start) && Number(m.start) >= 0)
      .sort((a, b) => Number(b.end) - Number(b.start));

    if (!validMoments.length) {
      throw new Error("La IA devolvió tiempos que no son válidos. Inténtalo de nuevo.");
    }

    const best = validMoments[0];
    const duration = Number.isFinite(preview.duration) ? preview.duration : Number(best.end);
    const clipStart = Math.max(0, Math.min(Number(best.start), duration));
    const clipEnd = Math.max(clipStart + 1, Math.min(Number(best.end), duration));
    const toTime = value => [Math.floor(value / 3600), Math.floor(value % 3600 / 60), Math.floor(value % 60)]
      .map(n => String(n).padStart(2, "0")).join(":");

    $("startTime").value = toTime(clipStart);
    $("endTime").value = toTime(clipEnd);
    $("clipTitle").value = (best.title || "Mejor momento - ClipAI").slice(0, 70);
    toast("¡Gemini encontró " + validMoments.length + " momento(s)! Revisa el fragmento y crea tu clip.");
  } catch (error) {
    console.error(error);
    toast(error.message || "No se pudo analizar el video.");
  } finally {
    button.disabled = false;
    button.innerHTML = '<span>✦</span> Encontrar los mejores momentos <span class="ai-tag">IA GEMINI</span>';
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
    const style = $("clipStyle").value;
    const visualFilters = [];
    if (selectedFormat === "vertical") {
      visualFilters.push("scale=720:1280:force_original_aspect_ratio=decrease", "pad=720:1280:(ow-iw)/2:(oh-ih)/2");
    }
    const looks = {
      viral: "eq=contrast=1.12:saturation=1.18:brightness=0.01",
      funny: "eq=contrast=1.08:saturation=1.28:brightness=0.02",
      gaming: "eq=contrast=1.18:saturation=1.22",
      podcast: "eq=contrast=1.06:saturation=0.92:brightness=0.01",
      clean: "eq=contrast=1.03:saturation=1.04"
    };
    if (looks[style]) visualFilters.push(looks[style]);
    if ($("effectsMode").checked) visualFilters.push("unsharp=5:5:0.65:3:3:0.25", "vignette=PI/5");
    if (visualFilters.length) args.push("-vf", visualFilters.join(","));
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

// Generador de videos IA (requiere el Worker seguro configurado en VIDEO_AI_API).
const VIDEO_AI_API = "https://clipai-video.danielsocialmedia08.workers.dev";
const videoAIPrompt = $("aiVideoPrompt");
document.querySelectorAll("[data-prompt]").forEach(button => button.addEventListener("click", () => {
  videoAIPrompt.value = button.dataset.prompt;
  videoAIPrompt.focus();
}));
$("generateAIVideo").addEventListener("click", async () => {
  const prompt = videoAIPrompt.value.trim();
  const status = $("aiVideoStatus");
  const button = $("generateAIVideo");
  if (prompt.length < 8) {
    status.textContent = "Describe tu idea con un poco más de detalle para generar un mejor resultado.";
    status.classList.remove("hidden");
    return;
  }
  if (!VIDEO_AI_API || VIDEO_AI_API.includes("TU_WORKER")) {
    status.textContent = "El generador ya está preparado en ClipAI, pero falta conectar el servicio seguro de generación. La clave del proveedor debe guardarse en el servidor, nunca aquí en la página.";
    status.classList.remove("hidden");
    return;
  }
  button.disabled = true;
  button.textContent = "Enviando a la IA…";
  status.textContent = "Preparando tu solicitud. La generación puede tardar varios minutos.";
  status.classList.remove("hidden");
  try {
    const response = await fetch(VIDEO_AI_API + "/generate-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        duration: $("aiVideoDuration").value,
        aspect_ratio: $("aiVideoRatio").value,
        generate_audio: $("aiVideoAudio").checked
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.request_id) throw new Error(payload.error || "No se pudo iniciar la generación.");
    const requestId = payload.request_id;
    let completed = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const poll = await fetch(VIDEO_AI_API + "/generate-video?id=" + encodeURIComponent(requestId));
      const result = await poll.json();
      if (!poll.ok) throw new Error(result.error || "No se pudo consultar el progreso.");
      if (result.status === "COMPLETED" && result.video_url) {
        const video = $("aiGeneratedVideo");
        video.src = result.video_url;
        video.classList.remove("hidden");
        $("aiVideoDownload").href = result.video_url;
        $("aiVideoDownload").classList.remove("hidden");
        status.textContent = "¡Tu video está listo! Puedes reproducirlo y descargarlo.";
        completed = true;
        break;
      }
      if (result.status === "FAILED") throw new Error(result.error || "El proveedor no pudo generar el video.");
      status.textContent = result.status === "IN_PROGRESS" ? "La IA está creando tu video… (" + (attempt + 1) + "/90)" : "Tu solicitud está en cola…";
    }
    if (!completed) throw new Error("La generación está tardando más de lo esperado. Intenta consultar de nuevo en unos minutos.");
  } catch (error) {
    console.error(error);
    status.textContent = error.message || "Ocurrió un error al generar el video.";
  } finally {
    button.disabled = false;
    button.innerHTML = '<span>✦</span> Generar video con IA <span class="button-arrow">→</span>';
  }
});
