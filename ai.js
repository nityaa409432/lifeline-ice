/* =========================================================
   Lifeline ICE: ai.js
   A small wrapper so the rest of the app can ask Claude a
   question without caring where the page is running.

   It works in one of four modes, checked in this order:
   - "claude": the page is open inside Claude (a claude.ai artifact).
     window.claude.use("sample") gives access to the viewer's own
     Claude account. No key needed.
   - "free":   the site is on Netlify with the function in
     netlify/functions/ai.mjs. The page calls /api/ai, and that
     function calls Google Gemini's free tier with a key that stays
     on the server. Free for you and for visitors.
   - "key":    optional. A visitor pastes their own Anthropic API key.
     It is kept in localStorage on their device and sent only to
     api.anthropic.com.
   - "off":    none of these. AI buttons explain what to do.

   Everything else in the app calls just two things:
     AI.mode()                      -> "claude" | "free" | "key" | "off"
     AI.askJson(prompt, {images})   -> a parsed JSON value
   ========================================================= */
'use strict';

window.AI = (function () {
  // Claude model used with an API key. 'claude-haiku-5-5' is far cheaper
  // per request if you want to keep costs down.
  const MODEL = 'claude-opus-5-5';
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const API_VERSION = '2026-10-21';
  const KEY_STORAGE = 'ice-card:api-key';

  const SERVER_URL = '/api/ai'; // the Netlify function

  let sample = null;          // the Claude "sample" function, when inside Claude
  let canSendImages = false;  // whether that function accepts photos
  let serverReady = false;    // true when the free Netlify function answers
  const listeners = [];       // functions to call when the mode changes

  // Inside Claude, window.claude exists before this script runs.
  // use() answers a moment later, so we update the UI when it does.
  // Everywhere else, ask the Netlify function whether it is set up.
  if (window.claude && typeof window.claude.use === 'function') {
    window.claude.use('sample')
      .then(async (fn) => {
        sample = fn;
        if (sample) {
          const limits = await sample.limits().catch(() => null);
          canSendImages = Boolean(limits && limits.images);
        }
        notify();
      })
      .catch(() => notify());
  } else if (location.protocol.startsWith('http')) {
    fetch(SERVER_URL)
      .then((res) => (res.ok ? res.json() : null))
      .then((info) => {
        serverReady = Boolean(info && info.ready);
        notify();
      })
      .catch(() => { /* no function here (GitHub Pages, Netlify Drop): stay as is */ });
  }

  function notify() {
    listeners.forEach((fn) => fn(mode()));
  }

  /* ---------- API key storage ---------- */

  function getKey() {
    try { return localStorage.getItem(KEY_STORAGE) || ''; } catch (err) { return ''; }
  }

  function setKey(key) {
    try {
      if (key) localStorage.setItem(KEY_STORAGE, key);
      else localStorage.removeItem(KEY_STORAGE);
    } catch (err) { /* storage blocked: the key lasts until reload */ }
    notify();
  }

  function mode() {
    if (sample) return 'claude';
    if (serverReady) return 'free';
    if (getKey()) return 'key';
    return 'off';
  }

  function supportsImages() {
    return mode() === 'claude' ? canSendImages : mode() !== 'off';
  }

  /* ---------- Asking Claude ---------- */

  /** Our own error shape: { code, message } */
  function aiError(code, message) {
    return { code, message: message || code };
  }

  /** Sends a prompt (and optional image Blobs) and returns parsed JSON. */
  async function askJson(prompt, { images = [] } = {}) {
    if (mode() === 'claude') {
      try {
        const options = images.length ? { images } : {};
        return await sample.json(prompt, options);
      } catch (err) {
        // The platform rejects with a plain {code, message} object
        throw aiError(err && err.code ? err.code : 'upstream_error', err && err.message);
      }
    }

    if (mode() === 'free') {
      const text = await callServer(prompt, images);
      return parseJson(text);
    }

    if (mode() === 'key') {
      const text = await callApi(prompt, images);
      return parseJson(text);
    }

    throw aiError('off');
  }

  /** Calls our own Netlify function, which calls Gemini for free. */
  async function callServer(prompt, images) {
    const payload = { prompt, images: [] };
    for (const image of images) {
      payload.images.push({ mime_type: image.type || 'image/jpeg', data: await blobToBase64(image) });
    }

    let response;
    try {
      response = await fetch(SERVER_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw aiError('network');
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok || typeof body.text !== 'string') {
      throw aiError(body.code || 'upstream_error');
    }
    return body.text;
  }

  /** Calls the Anthropic Messages API directly from the browser. */
  async function callApi(prompt, images) {
    // Images go first as base64 blocks, then the text instruction
    const content = [];
    for (const image of images) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: image.type || 'image/jpeg', data: await blobToBase64(image) },
      });
    }
    content.push({ type: 'text', text: prompt });

    let response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': getKey(),
          'anthropic-version': API_VERSION,
          // Required for calls made straight from a web page
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4000,
          output_config: { effort: 'low' }, // short, simple tasks
          messages: [{ role: 'user', content }],
        }),
      });
    } catch (err) {
      throw aiError('network');
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body.error && body.error.message;
      if (response.status === 401 || response.status === 403) throw aiError('bad_key', message);
      if (response.status === 429) throw aiError('rate_limited', message);
      if (response.status === 400 && /image/i.test(message || '')) throw aiError('image_rejected', message);
      throw aiError('upstream_error', message);
    }
    if (body.stop_reason === 'refusal') throw aiError('refused');

    // The reply can contain thinking blocks too; keep only the text
    return (body.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }

  /** Reads JSON even if the model wrapped it in a code fence or a sentence. */
  function parseJson(text) {
    const attempts = [
      text,
      (text.match(/```(?:json)?\s*([\s\S]*?)```/) || [])[1],
      text.slice(text.search(/[[{]/), Math.max(text.lastIndexOf('}'), text.lastIndexOf(']')) + 1),
    ];
    for (const attempt of attempts) {
      if (!attempt) continue;
      try { return JSON.parse(attempt); } catch (err) { /* try the next way */ }
    }
    throw aiError('invalid_json');
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      // result looks like "data:image/jpeg;base64,AAAA..." so drop the prefix
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /** Turns an error code into a sentence for the user. */
  function describeError(err) {
    const messages = {
      off: 'AI is not switched on for this site yet (the owner adds a free Gemini key in Netlify).',
      bad_key: 'That API key was not accepted. Check it in AI settings.',
      not_granted: 'This page was not allowed to use Claude. Reload the page and allow it to use AI.',
      sampling_disabled: 'Claude is not available for this account.',
      rate_limited: mode() === 'free'
        ? 'The free AI limit has been reached. Try again in a minute, or tomorrow if today\'s limit is used up.'
        : 'Too many AI requests right now. Wait a minute and try again.',
      not_configured: 'The AI key on the server is missing or wrong. Check GEMINI_API_KEY in your Netlify settings.',
      bad_request: 'That request was too large or not allowed. Try a smaller photo.',
      session_expired: 'Your Claude session has expired. Sign in again and reload.',
      image_rejected: 'That image could not be read. Try a clear JPG or PNG photo.',
      images_unavailable: 'Photos cannot be sent to Claude from this view.',
      invalid_json: 'The AI reply could not be read. Try again.',
      refused: 'Claude declined this request. Try a different photo or wording.',
      network: 'Could not reach the AI service. Check your internet connection.',
    };
    return messages[err && err.code] || 'The AI request did not work. Try again in a moment.';
  }

  return {
    mode,
    supportsImages,
    askJson,
    describeError,
    getKey,
    setKey,
    onChange: (fn) => listeners.push(fn),
    model: MODEL,
  };
})();
