/**
 * ClipAI Video Generation Worker
 * Deploy as a separate Cloudflare Worker.
 * Add secret FAL_KEY in Worker settings; never put it in browser code.
 */
const MODEL = "fal-ai/kling-video/v3/pro/text-to-video";
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
      if (!["15", "30", "60", "90", "120"].includes(duration)) return json({ error: "Duración no válida." }, 400);
      if (!["9:16", "16:9", "1:1"].includes(aspect)) return json({ error: "Formato no válido." }, 400);
      const requestedSeconds = Number(duration);
      const shotPrompts = [
        prompt + ". Escena inicial: establece el lugar, los personajes y la atmósfera con un plano cinematográfico.",
        prompt + ". Continúa la misma historia y conserva los personajes, vestuario, ambiente y estilo visual; muestra la acción desarrollándose desde otro ángulo.",
        prompt + ". Continúa exactamente la secuencia anterior, manteniendo continuidad visual; acerca la cámara a los detalles importantes.",
        prompt + ". La historia avanza de forma natural; muestra una nueva acción o reacción sin cambiar la identidad de los personajes.",
        prompt + ". Continúa la misma escena con movimiento fluido, iluminación coherente y un encuadre cinematográfico diferente.",
        prompt + ". Desarrolla el momento siguiente de la historia, manteniendo el mismo escenario, personajes y estética.",
        prompt + ". Lleva la acción hacia su momento culminante con una toma dinámica y coherente con las escenas anteriores.",
        prompt + ". Cierra la secuencia de forma satisfactoria, conservando la continuidad y dando sensación de final."
      ];
      const input = requestedSeconds === 15
        ? { prompt, duration: "15" }
        : {
            multi_prompt: shotPrompts.slice(0, requestedSeconds / 15).map(scenePrompt => ({ prompt: scenePrompt, duration: "15" })),
            shot_type: "customize"
          };
      Object.assign(input, {
        aspect_ratio: aspect,
        generate_audio: Boolean(body.generate_audio),
        enable_safety_checker: true,
        negative_prompt: "blur, distort, low quality, watermark, text artifacts"
      });
      const upstream = await fetch(FAL_QUEUE, {
        method: "POST",
        headers: { "Authorization": "Key " + env.FAL_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(input)
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
