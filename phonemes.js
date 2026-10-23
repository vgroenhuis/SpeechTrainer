/* Letter recognition (opt-in): which sounds were said, as IPA letters, by a neural phoneme recogniser.
   Model: wav2vec2-lv-60-espeak-cv-ft (Facebook AI, Apache-2.0), ONNX version by onnx-community, run with onnxruntime-web.
   It is downloaded once (~320 MB, int8) and kept in the browser's cache storage. Independent of the target word. */
(function (root) {
'use strict';
const REPO = 'https://huggingface.co/onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX/resolve/c69750f5043e5e1f8a71ab95dd3b98338c280c92/';
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
const CFG = { model: REPO + 'onnx/model_quantized.onnx', vocab: REPO + 'vocab.json', cache: 'speechtrainer-letters-v1' };
const SR = 16000, STRIDE = 320;   // the model gives one letter guess per 20 ms

let session = null, inv = null, loading = null;
function script(src) {
  return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('could not load ' + src)); document.head.appendChild(s); });
}
/* fetch a file through the cache storage (the model is far too big to download every visit) */
async function cached(url, onProgress) {
  let cache = null;
  try { cache = await caches.open(CFG.cache); const hit = await cache.match(url); if (hit) return hit.arrayBuffer(); } catch (e) { cache = null; }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed (${r.status})`);
  const total = +r.headers.get('content-length') || 0, parts = [];
  let got = 0;
  const rd = r.body.getReader();
  for (;;) {
    const { done, value } = await rd.read(); if (done) break;
    parts.push(value); got += value.length;
    if (onProgress && total) onProgress(got / total);
  }
  const blob = new Blob(parts);
  if (cache) try { await cache.put(url, new Response(blob, { headers: { 'content-type': 'application/octet-stream' } })); } catch (e) { /* full: use it this visit only */ }
  return blob.arrayBuffer();
}
async function isCached() {
  try { return !!(await (await caches.open(CFG.cache)).match(CFG.model)); } catch (e) { return false; }
}
function load(onProgress) {
  if (session) return Promise.resolve();
  if (!loading) loading = (async () => {
    if (!root.ort) await script(ORT + 'ort.min.js');
    root.ort.env.wasm.wasmPaths = ORT;
    const [voc, buf] = await Promise.all([cached(CFG.vocab), cached(CFG.model, onProgress)]);
    const v = JSON.parse(new TextDecoder().decode(voc));
    inv = []; for (const k in v) inv[v[k]] = k;
    session = await root.ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
  })().catch(e => { loading = null; throw e; });
  return loading;
}
async function forget() {
  session = null; loading = null;
  try { await caches.delete(CFG.cache); } catch (e) {}
}

/* The app's letters for the model's (espeak) letters. Length marks and tones are dropped. */
const MAP = { 'ɾ':'r', 'ɹ':'r', 'ʁ':'r', 'ɡ':'g', 'ɐ':'ə', 'ᵻ':'ɪ', 'ɜ':'ə', 'ɚ':'ə r', 'ɒ':'ɑ', 'eɪ':'e', 'oʊ':'o', 'əʊ':'o',
              'ts':'t s', 'tʃ':'t ʃ', 'dʒ':'d ʒ', 'əl':'ə l', 'ɣ':'x', 'χ':'x', 'ɫ':'l', 'ç':'x' };
const MAP_NL = { 'œ':'ʏ', 'ø':'ʏ', 'ɵ':'ʏ', 'ʉ':'y', 'ʋ':'v', 'ɔu':'ɔ u', 'ɛi':'ɛ i', 'œy':'ʏ y' };
const MAP_EN = { a:'æ', 'aɪ':'a ɪ', 'aʊ':'a ʊ', 'ɔɪ':'ɔ ɪ', 'ɔ':'ɑ', 'ʉ':'u' };
function letters(tok, lang) {
  let t = tok.replace(/[ː:]/g, '').replace(/[0-9]/g, '');
  const m = (lang === 'nl' ? MAP_NL : MAP_EN)[t] || MAP[t];
  return (m || t).split(' ').filter(Boolean);
}

/* x: 16 kHz samples. Returns [{ ph, t }]: each letter with the time (s, from the start of x) where it was heard. */
async function recognize(x, lang, from = 0, to = x.length) {
  await load();
  const seg = x.subarray(Math.max(0, from), Math.min(x.length, to));
  let m = 0, s2 = 0; for (const v of seg) m += v; m /= seg.length || 1;
  for (const v of seg) s2 += (v - m) * (v - m);
  const sd = Math.sqrt(s2 / (seg.length || 1)) + 1e-7, inp = new Float32Array(seg.length);
  for (let i = 0; i < seg.length; i++) inp[i] = (seg[i] - m) / sd;
  const name = session.inputNames[0];
  const res = await session.run({ [name]: new root.ort.Tensor('float32', inp, [1, inp.length]) });
  const lg = res[session.outputNames[0]], [, T, V] = lg.dims, d = lg.data, out = [];
  let prev = -1;
  for (let t = 0; t < T; t++) {
    let best = 0, bv = -Infinity;
    for (let k = 0; k < V; k++) { const v = d[t * V + k]; if (v > bv) { bv = v; best = k; } }
    if (best !== prev && best > 3) for (const ph of letters(inv[best] || '', lang)) out.push({ ph, t: (Math.max(0, from) + t * STRIDE + STRIDE / 2) / SR, raw: inv[best] });
    prev = best;
  }
  return out;
}

root.SpeechLetters = { CFG, load, isCached, forget, recognize, ready: () => !!session };
})(this);
