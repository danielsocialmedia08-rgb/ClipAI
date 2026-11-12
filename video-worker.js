/**
 * ClipAI Video Generation Worker
 * Deploy as a separate Cloudflare Worker.
 * Add secret FAL_KEY in Worker settings; never put it in browser code.
 */
const MODEL = "fal-ai/kling-video/v2.6/pro/text-to-video";
const FAL_QUEUE = "https://queue.fal.run/" + MODEL;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (!env.FAL_KEY) return json({ error: "FAL_KEY no está configurada en Cloudflare Worker Secrets." }, 503);
    if (url.pathname !== "/generate-video") return json({ error: "Ruta no encontrada." }, 404);
    if (request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Solicitud JSON inválida." }, 400); }
      const prompt = String(body.prompt || "").trim();
      const duration = String(body.duration || "5");
      const aspect = String(body.aspect_ratio || "9:16");
      if (prompt.length < 8 || prompt.length > 1800) return json({ error: "El texto debe tener entre 8 y 1800 caracteres." }, 400);
      if (!["5", "10"].includes(duration)) return json({ error: "Duración no válida." }, 400);
      if (!["9:16", "16:9", "1:1"].includes(aspect)) return json({ error: "Formato no válido." }, 400);
      const upstream = await fetch(FAL_QUEUE, {
        method: "POST",
        headers: { "Authorization": "Key " + env.FAL_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          duration,
          aspect_ratio: aspect,
          generate_audio: Boolean(body.generate_audio),
          enable_safety_checker: true,
          negative_prompt: "blur, distort, low quality, watermark, text artifacts"
        })
      });
      const data = await upstream.json();
      if (!upstream.ok || !data.request_id) return json({ error: data.detail || data.error || "El proveedor rechazó la solicitud." }, 502);
      return json({ request_id: data.request_id });
    }
    if (request.method === "GET") {
      const id = url.searchParams.get("id");
      if (!id || !/^[a-zA-Z0-9-]{8,100}$/.test(id)) return json({ error: "Identificador de solicitud no válido." }, 400);
      const statusResponse = await fetch(FAL_QUEUE + "/requests/" + encodeURIComponent(id) + "/status", {
        headers: { "Authorization": "Key " + env.FAL_KEY }
      });
      const statusData = await statusResponse.json();
      if (!statusResponse.ok) return json({ error: statusData.detail || "No se pudo consultar el estado." }, 502);
      if (statusData.status !== "COMPLETED") {
        if (statusData.status === "FAILED") return json({ status: "FAILED", error: "El proveedor no pudo generar el video." });
        return json({ status: statusData.status || "IN_QUEUE" });
      }
      const resultResponse = await fetch(FAL_QUEUE + "/requests/" + encodeURIComponent(id), {
        headers: { "Authorization": "Key " + env.FAL_KEY }
      });
      const resultData = await resultResponse.json();
      if (!resultResponse.ok || !resultData.video?.url) return json({ error: "El proveedor terminó, pero no devolvió el video." }, 502);
      return json({ status: "COMPLETED", video_url: resultData.video.url });
    }
    return json({ error: "Método no permitido." }, 405);
  }
};
