'use strict';
// Image-generation providers: OpenRouter, Groq, OpenAI.
//  - image models  -> real image generation (then pixelated locally)
//  - text models   -> asked for a 16x16 pixel grid (JSON) which we draw locally
// Groq has no image models, so it always uses the pixel-grid route.

const PROVIDERS = {
  openrouter: { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', hint: 'sk-or-...' },
  groq:       { label: 'Groq',       base: 'https://api.groq.com/openai/v1', hint: 'gsk_...' },
  openai:     { label: 'OpenAI',     base: 'https://api.openai.com/v1', hint: 'sk-...' },
};

async function http(url, { method = 'GET', key, body, timeout = 120000, raw = false } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    if (raw) {
      if (!res.ok) throw httpError(res.status, await res.text());
      return Buffer.from(await res.arrayBuffer());
    }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    if (!res.ok) throw httpError(res.status, json ? (json.error && (json.error.message || json.error)) || json.message || text : text);
    return json;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The request timed out.');
    throw e;
  } finally { clearTimeout(t); }
}
function httpError(status, msg) {
  const m = typeof msg === 'string' ? msg : JSON.stringify(msg);
  const e = new Error(`HTTP ${status}: ${m.slice(0, 240)}`); e.status = status; return e;
}
const clean = (msg, key) => (key ? String(msg).split(key).join('***') : String(msg));

// ---------- model listing ----------
async function listModels(provider, key) {
  const P = PROVIDERS[provider];
  if (provider === 'openrouter') {
    try { await http(`${P.base}/key`, { key }); } catch (e) { if (e.status === 401 || e.status === 403) throw new Error('OpenRouter rejected this key (401). Check it and try again.'); }
    const j = await http(`${P.base}/models`, { key });
    return (j.data || []).map((m) => {
      const out = (m.architecture && (m.architecture.output_modalities || String(m.architecture.modality || '').split('->')[1]?.split('+'))) || [];
      const outs = Array.isArray(out) ? out : [out];
      const kind = outs.includes('image') ? 'image' : (outs.includes('text') ? 'chat' : 'other');
      return { id: m.id, name: m.name || m.id, kind };
    });
  }
  const j = await http(`${P.base}/models`, { key }).catch((e) => {
    if (e.status === 401 || e.status === 403) throw new Error(`${P.label} rejected this key (${e.status}). Check it and try again.`);
    throw e;
  });
  return (j.data || []).map((m) => {
    const id = m.id;
    let kind = 'other';
    if (provider === 'openai') {
      if (/^(gpt-image|dall-e|chatgpt-image)/.test(id)) kind = 'image';
      else if (/^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|transcribe|tts|search|embedding|moderation|image|instruct)/.test(id)) kind = 'chat';
    } else if (provider === 'groq') {
      if (!/(whisper|tts|guard|embed)/.test(id)) kind = 'chat';
    }
    return { id, name: id, kind };
  });
}

function sortModels(list) {
  const rank = { image: 0, chat: 1, other: 2 };
  return [...list].sort((a, b) => rank[a.kind] - rank[b.kind] || a.id.localeCompare(b.id));
}

// ---------- generation ----------
function imagePrompt(name) {
  return `Pixel art app icon for an app called "${name}". Retro 32x32 pixel grid look with crisp square pixels, a limited bright color palette, one simple centered symbol that fits the name, solid dark background, no text, no letters.`;
}
function gridPrompt(name) {
  return `Design a 16x16 pixel-art app icon for an app called "${name}". Reply with ONLY a JSON object, no markdown, no explanation:\n` +
    `{"palette":["#RRGGBB", ...up to 8 colors],"rows":[16 strings, each exactly 16 characters, each character a palette index 0-7]}\n` +
    `Index 0 is the background color. Use a simple symbol that fits the name, centered, with a clear outline.`;
}

function dataUrlToBuffer(u) { return Buffer.from(u.split(',')[1], 'base64'); }

async function chat(provider, key, model, content) {
  const P = PROVIDERS[provider];
  const j = await http(`${P.base}/chat/completions`, { method: 'POST', key, body: { model, messages: [{ role: 'user', content }] } });
  const c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (Array.isArray(c)) return c.map((p) => p.text || '').join('');
  return c || '';
}

function parseGrid(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('The model did not return JSON.');
  const j = JSON.parse(m[0]);
  const palette = (j.palette || []).filter((c) => /^#?[0-9a-f]{6}$/i.test(c)).map((c) => (c[0] === '#' ? c : '#' + c));
  const rows = (j.rows || []).map(String);
  if (palette.length < 2 || rows.length < 8) throw new Error('The pixel grid was incomplete.');
  return { palette, rows };
}

// returns { type: 'image', buffer } | { type: 'grid', palette, rows }
async function generate({ provider, key, model, kind, name }) {
  try {
    if (kind === 'image') {
      if (provider === 'openai') {
        const body = { model, prompt: imagePrompt(name), size: model.startsWith('dall-e-3') ? '1024x1024' : (model.startsWith('dall-e') ? '1024x1024' : '1024x1024'), n: 1 };
        if (model.startsWith('dall-e')) body.response_format = 'b64_json';
        const j = await http(`${PROVIDERS.openai.base}/images/generations`, { method: 'POST', key, body, timeout: 180000 });
        const d = j.data && j.data[0];
        if (!d) throw new Error('No image returned.');
        if (d.b64_json) return { type: 'image', buffer: Buffer.from(d.b64_json, 'base64') };
        if (d.url) return { type: 'image', buffer: await http(d.url, { raw: true }) };
        throw new Error('No image returned.');
      }
      if (provider === 'openrouter') {
        const call = (modalities) => http(`${PROVIDERS.openrouter.base}/chat/completions`, {
          method: 'POST', key, timeout: 180000,
          body: { model, messages: [{ role: 'user', content: imagePrompt(name) }], modalities },
        });
        let j;
        try { j = await call(['image', 'text']); } catch (e) { if (e.status && e.status < 500) j = await call(['image']); else throw e; }
        const msg = j.choices && j.choices[0] && j.choices[0].message;
        const img = msg && msg.images && msg.images[0] && msg.images[0].image_url && msg.images[0].image_url.url;
        if (!img) throw new Error('The model returned no image.');
        return { type: 'image', buffer: img.startsWith('data:') ? dataUrlToBuffer(img) : await http(img, { raw: true }) };
      }
    }
    const text = await chat(provider, key, model, gridPrompt(name));
    return { type: 'grid', ...parseGrid(text) };
  } catch (e) {
    throw new Error(clean(e.message, key));
  }
}

module.exports = { PROVIDERS, listModels, sortModels, generate };
