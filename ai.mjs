/* =========================================================
   netlify/functions/ai.mjs
   A tiny server function that runs on Netlify, not in the
   browser. It holds the Gemini API key (from a Netlify
   environment variable) so the key is never sent to visitors.

   The web page calls it at /api/ai:
     GET  /api/ai  -> { ready: true }  when the key is set up
     POST /api/ai  { prompt, images: [{ mime_type, data }] }
                   -> { text }         Gemini's reply (JSON as text)
   ========================================================= */

// Free Gemini models to try, in order. Set GEMINI_MODEL in Netlify to
// use a different one (for example a Flash-Lite model, which has a
// higher free daily limit).
const MODELS = [process.env.GEMINI_MODEL, 'gemini-3.8-flash'].filter(Boolean);

const GEMINI_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// Limits that keep the function from being used for anything else
const MAX_PROMPT_CHARS = 12000;
const MAX_IMAGES = 1;
const MAX_IMAGE_CHARS = 4_000_000; // about 3 MB of base64
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export default async (req) => {
  const key = process.env.GEMINI_API_KEY;

  // Health check: lets the page know AI is ready
  if (req.method === 'GET') {
    return Response.json({ ready: Boolean(key) });
  }
  if (req.method !== 'POST') {
    return Response.json({ code: 'bad_request' }, { status: 405 });
  }
  if (!key) {
    return Response.json({ code: 'not_configured' }, { status: 503 });
  }

  // Only answer requests sent by this same website
  const origin = req.headers.get('origin');
  let sameSite = true;
  if (origin) {
    try { sameSite = new URL(origin).host === new URL(req.url).host; } catch (err) { sameSite = false; }
  }
  if (!sameSite) {
    return Response.json({ code: 'forbidden' }, { status: 403 });
  }

  // Check the request before spending any of the free quota
  let body;
  try {
    body = await req.json();
  } catch (err) {
    return Response.json({ code: 'bad_request' }, { status: 400 });
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  const images = Array.isArray(body.images) ? body.images : [];
  const imagesOk = images.length <= MAX_IMAGES && images.every((img) =>
    img && IMAGE_TYPES.includes(img.mime_type) &&
    typeof img.data === 'string' && img.data.length <= MAX_IMAGE_CHARS);
  if (!prompt || prompt.length > MAX_PROMPT_CHARS || !imagesOk) {
    return Response.json({ code: 'bad_request' }, { status: 400 });
  }

  // Gemini request: images first, then the instruction, and ask for JSON back
  const geminiBody = JSON.stringify({
    contents: [{
      parts: [
        ...images.map((img) => ({ inline_data: { mime_type: img.mime_type, data: img.data } })),
        { text: prompt },
      ],
    }],
    generationConfig: { responseMimeType: 'application/json' },
  });

  for (const model of MODELS) {
    let res;
    try {
      res = await fetch(GEMINI_URL(model), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: geminiBody,
      });
    } catch (err) {
      return Response.json({ code: 'network' }, { status: 502 });
    }

    if (res.status === 404) continue; // model not available: try the next one
    if (res.status === 429) return Response.json({ code: 'rate_limited' }, { status: 429 });
    if (res.status === 400 || res.status === 403) {
      const detail = await res.text();
      const code = /api key/i.test(detail) ? 'not_configured' : 'bad_request';
      console.log('Gemini error', res.status, detail.slice(0, 300)); // shows in Netlify function logs
      return Response.json({ code }, { status: 502 });
    }
    if (!res.ok) return Response.json({ code: 'upstream_error' }, { status: 502 });

    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || '').join('');
    if (!text) return Response.json({ code: 'refused' }, { status: 502 }); // blocked by safety filters
    return Response.json({ text });
  }

  return Response.json({ code: 'upstream_error' }, { status: 502 });
};

// Serve this function at /api/ai
export const config = { path: '/api/ai' };
