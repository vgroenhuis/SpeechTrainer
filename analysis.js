/* Speech analysis engine, shared by the app (browser) and the test harness (Node).
   Everything runs at 16 kHz in 10 ms frames:
     samples → Resampler → frame features (FFT bands, pitch, LPC formants)
             → frame labels (S silence, V vowel, N nasal, F voiceless noise, Z voiced noise)
             → segments (merging, burst detection p/t/k with place estimate)
             → score against the target word. */
(function (root) {
'use strict';
const D = (typeof module !== 'undefined' && module.exports) ? require('./data.js') : root.SpeechData;

const FS = 16000, HOP = 160, WIN = 400, NFFT = 512, HALF = 256, BIN = FS / NFFT, FRAME_MS = 10;
const PWIN = 640, LAG_MIN = 32, LAG_MAX = 229;          // pitch 70–500 Hz
const NEED = 440;                                         // samples needed on both sides of a frame centre
const LWIN = 240;                                         // LPC window: 30 ms at 8 kHz

/* Tunable thresholds (exported so the test harness can experiment). */
const P = {
  silenceAboveFloor: 8,    // dB above noise floor
  silenceBelowPeak: 45,    // dB below loudest speech
  voicedClarity: 0.55,     // normalised autocorrelation needed for "voice on"
  weakVoicedClarity: 0.4,
  buzzHigh: 0.25,          // share of energy >3.5 kHz that makes a voiced frame a buzz (z, v)
  nasalUpper: 0.035,       // share of energy >500 Hz below which a voiced frame is a hum (m, n)
  creakHigh: 0.03,         // unvoiced but loud and almost nothing >3.5 kHz → creaky voice, not a hiss
  creakBelowPeak: 15,
  creakCentroid: 1300,
  lowRumble: 0.7,          // unvoiced frames with this share <500 Hz are breath/rumble, not a hiss
  burstMaxMs: 50,          // word-initial noise this short is always a burst
  burstOrHissMs: 130,      // ...and up to this long when it does not swell up like a hiss
  burstDecay: -7,          // dB (start minus end level); hisses grow louder (−17…−5), bursts do not (−6…+3)
  releaseMaxMs: 170,       // noise after a closure that follows a vowel: a released p/t/k (longer: p/t/k + hiss)
  noGapBurstMs: 100,       // noise straight after the vowel, no closure: burst if this short, else a hiss
  tailBelowPeak: 20,       // dB: fading voicing at the end of a voiced stretch is closure, not a sound
  leadBelowPeak: 25,
  closureHumBelow: 10,     // dB below the vowel: a hum this faint right before a burst is closure voicing
  weakBurstClick: -2,      // dB: onset click strength that may be a hidden unaspirated p/t/k
  guessZ: 0.4, guessS: 0.8, guessSCen: 4900, guessShHigh: 0.95, guessShCen: 3300, guessXCen: 2200,   // sound guesses
  placeMargin: 1.0        // how much closer the best place must be than the next before giving place feedback
};

const hamming = n => Float64Array.from({ length: n }, (_, i) => 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (n - 1)));
const HAMM = hamming(WIN), LHAMM = hamming(LWIN);

/* ---------------- FFT (radix 2, size 512) ---------------- */
const COS = new Float64Array(HALF), SIN = new Float64Array(HALF), REV = new Uint16Array(NFFT);
for (let i = 0; i < HALF; i++) { COS[i] = Math.cos(2 * Math.PI * i / NFFT); SIN[i] = -Math.sin(2 * Math.PI * i / NFFT); }
for (let i = 0; i < NFFT; i++) { let r = 0; for (let b = 0, v = i; b < 9; b++, v >>= 1) r = (r << 1) | (v & 1); REV[i] = r; }
function fft(re, im) {
  for (let i = 0; i < NFFT; i++) {
    const j = REV[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= NFFT; size <<= 1) {
    const h = size >> 1, step = NFFT / size;
    for (let s = 0; s < NFFT; s += size) for (let k = 0; k < h; k++) {
      const c = COS[k * step], sn = SIN[k * step], a = s + k, b = a + h;
      const tr = re[b] * c - im[b] * sn, ti = re[b] * sn + im[b] * c;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
}

/* ---------------- Resampling to 16 kHz + DC removal ---------------- */
class Resampler {
  constructor(inRate) {
    this.ratio = inRate / FS; this.pos = 0; this.last = 0; this.taps = null;
    this.dx = 0; this.dy = 0;
    if (inRate > FS) {
      const N = 63, fc = 7400 / inRate, t = new Float64Array(N); let sum = 0;
      for (let i = 0; i < N; i++) {
        const m = i - (N - 1) / 2, sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
        t[i] = sinc * (0.42 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (N - 1)));
        sum += t[i];
      }
      for (let i = 0; i < N; i++) t[i] /= sum;
      this.taps = t; this.hist = new Float32Array(N - 1);
    }
  }
  process(x) {
    let y = x;
    if (this.taps) {
      const N = this.taps.length, buf = new Float32Array(N - 1 + x.length);
      buf.set(this.hist); buf.set(x, N - 1);
      y = new Float32Array(x.length);
      for (let i = 0; i < x.length; i++) { let s = 0; for (let k = 0; k < N; k++) s += this.taps[k] * buf[i + k]; y[i] = s; }
      this.hist = buf.slice(buf.length - (N - 1));
    }
    let out;
    if (this.ratio === 1) out = Float32Array.from(y);
    else {
      const z = new Float32Array(y.length + 1); z[0] = this.last; z.set(y, 1);
      const o = [];
      while (this.pos + 1 < z.length) { const i = Math.floor(this.pos), fr = this.pos - i; o.push(z[i] * (1 - fr) + z[i + 1] * fr); this.pos += this.ratio; }
      this.pos -= z.length - 1; this.last = z[z.length - 1];
      out = Float32Array.from(o);
    }
    for (let i = 0; i < out.length; i++) { const v = out[i]; out[i] = v - this.dx + 0.995 * this.dy; this.dx = v; this.dy = out[i]; }
    return out;
  }
}
function to16k(samples, rate) { return new Resampler(rate).process(samples); }

/* ---------------- Pitch: normalised cross-correlation ---------------- */
function pitch(x, c) {
  const s0 = c - ((PWIN + LAG_MAX) >> 1);
  let e0 = 0, el = 0;
  for (let i = 0; i < PWIN; i++) { e0 += x[s0 + i] * x[s0 + i]; el += x[s0 + LAG_MIN + i] * x[s0 + LAG_MIN + i]; }
  if (e0 < 1e-9) return { f0: 0, clar: 0 };
  const r = new Float32Array(LAG_MAX + 2); let best = 0;
  for (let l = LAG_MIN; l <= LAG_MAX; l++) {
    let s = 0; for (let i = 0; i < PWIN; i++) s += x[s0 + i] * x[s0 + i + l];
    r[l] = s / Math.sqrt(e0 * el + 1e-20);
    if (r[l] > best) best = r[l];
    const out = x[s0 + l], inn = x[s0 + l + PWIN]; el += inn * inn - out * out;
  }
  // best local peak; then prefer a sub-multiple of it only when that is almost as good (avoids octave errors both ways)
  let lag = 0;
  for (let l = LAG_MIN + 1; l < LAG_MAX; l++) if (r[l] >= r[l - 1] && r[l] >= r[l + 1] && (!lag || r[l] > r[lag])) lag = l;
  if (!lag) return { f0: 0, clar: 0 };
  for (let k = 4; k >= 2; k--) {
    const c0 = Math.round(lag / k); if (c0 - 2 < LAG_MIN) continue;
    let pk = c0; for (let l = c0 - 2; l <= c0 + 2; l++) if (r[l] > r[pk]) pk = l;
    if (r[pk] >= 0.97 * r[lag] && r[pk] >= r[pk - 1] && r[pk] >= r[pk + 1]) { lag = pk; break; }
  }
  const a = r[lag - 1], b = r[lag], cc = r[lag + 1], den = a - 2 * b + cc;
  return { f0: FS / (lag + (den ? 0.5 * (a - cc) / den : 0)), clar: b };
}

/* ---------------- Formants: LPC (order 10 at 8 kHz) + polynomial roots ---------------- */
function polyRoots(a) {
  const p = a.length - 1, zr = new Float64Array(p), zi = new Float64Array(p);
  for (let k = 0; k < p; k++) { const ang = 2 * Math.PI * k / p + 0.4; zr[k] = 0.9 * Math.cos(ang); zi[k] = 0.9 * Math.sin(ang); }
  for (let it = 0; it < 120; it++) {
    let delta = 0;
    for (let k = 0; k < p; k++) {
      let pr = 1, pi = 0;
      for (let j = 1; j <= p; j++) { const tr = pr * zr[k] - pi * zi[k] + a[j]; pi = pr * zi[k] + pi * zr[k]; pr = tr; }
      let dr = 1, di = 0;
      for (let j = 0; j < p; j++) if (j !== k) { const ur = zr[k] - zr[j], ui = zi[k] - zi[j], tr = dr * ur - di * ui; di = dr * ui + di * ur; dr = tr; }
      const den = dr * dr + di * di || 1e-30, qr = (pr * dr + pi * di) / den, qi = (pi * dr - pr * di) / den;
      zr[k] -= qr; zi[k] -= qi; delta += Math.abs(qr) + Math.abs(qi);
    }
    if (delta < 1e-9) break;
  }
  return [zr, zi];
}
function formants(x, c) {
  const n = LWIN, v = new Float64Array(n);
  for (let i = 0; i < n; i++) { const j = c - n + 2 * i; v[i] = 0.25 * x[j - 1] + 0.5 * x[j] + 0.25 * x[j + 1]; }
  for (let i = n - 1; i > 0; i--) v[i] -= 0.94 * v[i - 1];
  for (let i = 0; i < n; i++) v[i] *= LHAMM[i];
  const p = 10, r = new Float64Array(p + 1);
  for (let k = 0; k <= p; k++) { let s = 0; for (let i = k; i < n; i++) s += v[i] * v[i - k]; r[k] = s; }
  if (r[0] < 1e-12) return null;
  r[0] *= 1.0001;
  const a = new Float64Array(p + 1); a[0] = 1; let err = r[0];
  for (let i = 1; i <= p; i++) {
    let acc = r[i]; for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / err, prev = a.slice();
    for (let j = 1; j < i; j++) a[j] = prev[j] + k * prev[i - j];
    a[i] = k; err *= 1 - k * k; if (err <= 0) return null;
  }
  const [zr, zi] = polyRoots(a), cand = [];
  for (let k = 0; k < p; k++) if (zi[k] > 0.01) {
    const f = Math.atan2(zi[k], zr[k]) * 8000 / (2 * Math.PI), bw = -Math.log(Math.hypot(zr[k], zi[k])) * 8000 / Math.PI;
    if (f > 150 && f < 3800 && bw < 600) cand.push(f);
  }
  cand.sort((u, w) => u - w);
  const F1 = cand.find(f => f >= 180 && f <= 1150); if (!F1) return null;
  const F2 = cand.find(f => f > F1 + 150 && f < 3200); if (!F2) return null;
  return [F1, F2];
}

/* ---------------- Frame features ---------------- */
function frame(x, c) {
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT), s0 = c - (WIN >> 1);
  let mean = 0, e = 0;
  for (let i = 0; i < WIN; i++) mean += x[s0 + i];
  mean /= WIN;
  for (let i = 0; i < WIN; i++) { const v = x[s0 + i] - mean; e += v * v; re[i] = v * HAMM[i]; }
  fft(re, im);
  const spec = new Float32Array(HALF);
  let b1 = 0, b2 = 0, b3 = 0, b4 = 0, cw = 0;
  for (let k = 1; k < HALF; k++) {
    const p = re[k] * re[k] + im[k] * im[k], f = k * BIN;
    spec[k] = 10 * Math.log10(p + 1e-10);
    if (f < 80) continue;
    if (f < 500) b1 += p; else if (f < 1500) b2 += p; else if (f < 3500) b3 += p; else b4 += p;
    cw += p * f;
  }
  const tot = b1 + b2 + b3 + b4 + 1e-20, pt = pitch(x, c);
  return {
    t: c / FS, db: 10 * Math.log10(e / WIN + 1e-12), hf: 10 * Math.log10(b3 + b4 + 1e-12),
    s1: b1 / tot, s2: b2 / tot, s3: b3 / tot, s4: b4 / tot, cen: cw / tot,
    clar: pt.clar, f0: pt.f0, fm: pt.clar > 0.5 ? formants(x, c) : null, spec
  };
}
function analyzeSamples(x16) {
  const frames = [];
  for (let c = NEED; c + NEED < x16.length; c += HOP) frames.push(frame(x16, c));
  return frames;
}

/* Streaming version for live display: push raw chunks at any sample rate, get frames back. */
class Stream {
  constructor(inRate) { this.rs = new Resampler(inRate); this.buf = new Float32Array(FS * 2); this.len = 0; this.next = NEED; this.onSamples = null; this.enabled = true; }
  /* Returns the new 10 ms frames (none while `enabled` is false; samples still reach onSamples). */
  push(chunk) {
    const x = this.rs.process(chunk);
    if (this.onSamples) this.onSamples(x);
    if (this.len + x.length > this.buf.length) {
      const drop = this.next - NEED;
      this.buf.copyWithin(0, drop, this.len); this.len -= drop; this.next -= drop;
      if (this.len + x.length > this.buf.length) { const nb = new Float32Array((this.len + x.length) * 2); nb.set(this.buf.subarray(0, this.len)); this.buf = nb; }
    }
    this.buf.set(x, this.len); this.len += x.length;
    if (!this.enabled) { this.next = Math.max(this.next, this.len - NEED); return []; }
    const out = [];
    while (this.next + NEED < this.len) { out.push(frame(this.buf, this.next)); this.next += HOP; }
    return out;
  }
}

/* ---------------- Frame labels ---------------- */
function labelFrame(f, floor, peak) {
  if (f.db < Math.max(floor + P.silenceAboveFloor, peak - P.silenceBelowPeak)) return 'S';
  const nasal = f.s2 + f.s3 + f.s4 < P.nasalUpper;   // nearly all energy below 500 Hz
  if (f.clar >= P.voicedClarity) {
    if (f.s4 > P.buzzHigh) return 'Z';
    return nasal ? 'N' : 'V';
  }
  if (f.clar >= P.weakVoicedClarity && f.s4 > P.buzzHigh) return 'Z';
  // no high-frequency noise and energy low in the spectrum: creaky voice when loud (common at the end of a word),
  // breath when soft. (A k puff also lacks >3.5 kHz energy but is centred around 1.5–2.5 kHz.)
  if (f.s4 < P.creakHigh && f.cen < P.creakCentroid) return f.db > peak - P.creakBelowPeak ? (nasal ? 'N' : 'V') : 'S';
  if (f.s1 > P.lowRumble) return 'S';
  return 'F';
}
/* Noise floor and speech peak of a whole recording. */
function levels(frames) {
  const d = frames.map(f => f.db).sort((a, b) => a - b);
  const q = p => d[Math.min(d.length - 1, Math.floor(p * (d.length - 1)))];
  return { floor: q(0.08), peak: q(0.98) };
}
/* Adaptive levels for live display. */
class LiveLabeler {
  constructor() { this.floor = -60; this.peak = -25; }
  label(f) {
    if (f.db < this.floor) this.floor = 0.8 * this.floor + 0.2 * f.db; else this.floor += 0.01;
    this.floor = Math.max(this.floor, -100);
    if (f.clar > P.voicedClarity && f.db > this.peak) this.peak = f.db;
    else this.peak = Math.max(this.floor + 25, this.peak - 0.02);
    return labelFrame(f, this.floor, this.peak);
  }
}

/* ---------------- Segments ---------------- */
const isVoiced = c => c === 'V' || c === 'N' || c === 'Z';
function runs(lab) {
  const r = [];
  lab.forEach((c, i) => { const l = r[r.length - 1]; if (l && l.c === c) l.b = i; else r.push({ c, a: i, b: i }); });
  return r;
}
const rlen = r => r.b - r.a + 1;
function relabel(lab, r, c) { for (let i = r.a; i <= r.b; i++) lab[i] = c; }

/* Place of a burst from the spectrum of its first 20 ms:
   t = energy high up (>4 kHz), k = one compact peak in the middle (peaky spectrum), p = flat, diffuse, weak.
   Nearest prototype in a normalised feature space; prototypes are medians measured on 13 synthetic voices
   (test/explore-place.js). `sure` is false when two places are almost equally close. */
const PLACE_PROTO = {
  p: { cen: Math.log2(2350), hm: -6.5, ml: 1, flat: -5 },
  t: { cen: Math.log2(4300), hm: 4, ml: 2, flat: -4 },
  k: { cen: Math.log2(2300), hm: -9, ml: 5, flat: -8.5 }
};
const PLACE_SCALE = { cen: 0.4, hm: 4, ml: 6, flat: 2.5 };
function burstPlace(frames, a, b) {
  const pw = new Float64Array(HALF);
  for (let i = a; i <= Math.min(b, a + 1); i++) frames[i].spec.forEach((d, k) => { pw[k] += Math.pow(10, d / 10); });
  const band = (lo, hi) => { let s = 0; for (let k = Math.ceil(lo / BIN); k < Math.min(HALF, hi / BIN); k++) s += pw[k]; return 10 * Math.log10(s + 1e-12); };
  let cw = 0, ct = 0, lg = 0, ar = 0, n = 0;
  for (let k = Math.ceil(1000 / BIN); k < HALF; k++) {
    cw += pw[k] * k * BIN; ct += pw[k];
    if (k < 6000 / BIN) { lg += Math.log(pw[k] + 1e-12); ar += pw[k]; n++; }
  }
  const f = { cen: Math.log2(cw / ct), hm: band(4000, 8000) - band(1500, 3500), ml: band(1500, 3500) - band(600, 1500),
              flat: 10 * Math.log10(Math.exp(lg / n) / (ar / n)) };
  const d = Object.entries(PLACE_PROTO).map(([pl, pr]) =>
    [pl, Math.hypot(...Object.keys(PLACE_SCALE).map(k => (f[k] - pr[k]) / PLACE_SCALE[k]))]).sort((u, w) => u[1] - w[1]);
  return { place: d[0][0], sure: d[1][1] - d[0][1] > P.placeMargin, pdist: Object.fromEntries(d), pf: f };
}
function onsetRise(frames, a) {
  if (a < 1) return 99;
  let base = Infinity;
  for (let i = Math.max(0, a - 3); i < a; i++) base = Math.min(base, frames[i].hf);
  return Math.max(frames[a].hf, a + 1 < frames.length ? frames[a + 1].hf : -999) - base;
}

/* Fine-grained look at a sound onset (1 ms blocks): a stop release is a short click of high-frequency energy
   that is stronger than the high frequencies of the vowel right after it, and the level rises very fast.
   Returns { click: dB of the HF click above the following 20–40 ms, riseMs: 10%→90% level rise time }. */
function onsetInfo(x, frameIdx) {
  if (!x) return null;
  const c = NEED + frameIdx * HOP, from = Math.max(1, c - 400), to = Math.min(x.length - 1, c + 960), B = 16;
  const nb = Math.floor((to - from) / B), full = new Float64Array(nb), hp = new Float64Array(nb);
  for (let b = 0; b < nb; b++) {
    let e = 0, h = 0;
    for (let i = from + b * B; i < from + (b + 1) * B; i++) { e += x[i] * x[i]; const d = x[i] - x[i - 1]; h += d * d; }
    full[b] = e; hp[b] = h;
  }
  // smoothed level (3 ms) to find the onset
  const sm = Array.from(full, (_, b) => (full[Math.max(0, b - 1)] + full[b] + full[Math.min(nb - 1, b + 1)]) / 3);
  let mx = 0; for (let b = 0; b < Math.min(nb, 45); b++) mx = Math.max(mx, sm[b]);
  let floor = Infinity; for (let b = 0; b < 10; b++) floor = Math.min(floor, sm[b]);
  const lvl = p => floor + (mx - floor) * p;
  const o10 = sm.findIndex(v => v > lvl(0.1)), o90 = sm.findIndex(v => v > lvl(0.9));
  if (o10 < 0) return null;
  let clickPeak = 0; for (let b = Math.max(0, o10 - 2); b < Math.min(nb, o10 + 8); b++) clickPeak = Math.max(clickPeak, hp[b]);
  let later = 0, n = 0; for (let b = o10 + 20; b < Math.min(nb, o10 + 40); b++) { later += hp[b]; n++; }
  return { click: 10 * Math.log10((clickPeak + 1e-12) / (later / Math.max(1, n) + 1e-12)), riseMs: Math.max(0, o90 - o10) };
}

function segment(frames, labels, sig) {
  const lab = labels.slice();
  let r = runs(lab);
  // a) 1–2 frame noise inside voicing is just roughness
  // (and a 10–20 ms dip into silence inside voicing is a pitch-tracking hiccup)
  r.forEach((x, i) => { if ((x.c === 'F' || x.c === 'S') && rlen(x) <= 2 && i > 0 && i < r.length - 1 && isVoiced(r[i - 1].c) && isVoiced(r[i + 1].c)) relabel(lab, x, r[i - 1].c); });
  r = runs(lab);
  // a2) a noise stretch with 10–20 ms dips below the threshold is still one sound
  r.forEach((x, i) => { if (x.c === 'S' && rlen(x) <= 2 && i > 0 && i < r.length - 1 && r[i - 1].c === 'F' && r[i + 1].c === 'F') relabel(lab, x, 'F'); });
  r = runs(lab);
  // a3) a short buzz inside a release (not touching a vowel or hum) is part of that noise
  r.forEach((x, i) => {
    const p = r[i - 1], n = r[i + 1];
    if (x.c === 'Z' && rlen(x) <= 5 && ((p && p.c === 'F') || (n && n.c === 'F')) && !(p && (p.c === 'V' || p.c === 'N')) && !(n && (n.c === 'V' || n.c === 'N'))) relabel(lab, x, 'F');
  });
  r = runs(lab);
  // b) voiced runs shorter than 30 ms join a voiced (or noise) neighbour, otherwise they are dropped
  r.forEach((x, i) => {
    if (!isVoiced(x.c) || rlen(x) >= 3) return;
    const p = r[i - 1], n = r[i + 1];
    const cands = [p, n].filter(y => y && y.c !== 'S' && rlen(y) >= rlen(x));
    if (x.c === 'Z') { const fz = cands.find(y => y.c === 'F'); if (fz) return relabel(lab, x, 'F'); }
    const v = cands.filter(y => isVoiced(y.c)).sort((u, w) => rlen(w) - rlen(u))[0];
    relabel(lab, x, v ? v.c : 'S');
  });
  r = runs(lab);
  // c) faint voicing at the edges of a voiced stretch is closure voicing (before a final p/t/k, or Dutch pre-voiced b/d), not a sound
  for (let i = 0; i < lab.length;) {
    if (!isVoiced(lab[i])) { i++; continue; }
    let j = i; while (j + 1 < lab.length && isVoiced(lab[j + 1])) j++;
    let pk = -Infinity; for (let k = i; k <= j; k++) pk = Math.max(pk, frames[k].db);
    for (let k = j; k > i && frames[k].db < pk - P.tailBelowPeak; k--) lab[k] = 'S';
    for (let k = i; k < j && frames[k].db < pk - P.leadBelowPeak && lab[k] !== 'S'; k++) lab[k] = 'S';
    i = j + 1;
  }
  r = runs(lab);
  // d) short hums next to a vowel are part of the vowel
  r.forEach((x, i) => { if (x.c === 'N' && rlen(x) < 4 && ((r[i - 1] && r[i - 1].c === 'V') || (r[i + 1] && r[i + 1].c === 'V'))) relabel(lab, x, 'V'); });
  r = runs(lab);
  // d) trim silence at both ends
  while (r.length && r[0].c === 'S') r.shift();
  while (r.length && r[r.length - 1].c === 'S') r.pop();

  const segs = [];
  r.forEach((x, i) => {
    if (x.c === 'S') return;
    const fr = frames.slice(x.a, x.b + 1);
    const s = { c: x.c, a: x.a, b: x.b, dur: rlen(x) * FRAME_MS,
      vfrac: fr.filter(f => f.clar > 0.5).length / fr.length, cen: fr.reduce((u, f) => u + f.cen, 0) / fr.length };
    const prev = r[i - 1];
    s.afterGap = i === 0 || (prev && prev.c === 'S' && rlen(prev) >= 2);
    s.initial = i === 0;
    s.prevC = segs.length ? segs[segs.length - 1].c : null;
    if (s.afterGap) s.onset = onsetInfo(sig, x.a);
    if (s.c === 'F') {
      s.rawC = 'F';
      s.rise = onsetRise(frames, x.a);
      const n = fr.length, head = Math.max(...fr.slice(0, 2).map(f => f.db)), tail = fr.slice(-2).reduce((u, f) => u + f.db, 0) / Math.min(2, n);
      s.decay = head - tail;   // bursts start at full strength, hisses swell up
      const afterVoice = segs.some(q => isVoiced(q.c));
      let burst, split = false;
      if (!afterVoice) burst = s.dur <= P.burstMaxMs || (s.dur <= P.burstOrHissMs && s.decay >= P.burstDecay);
      else if (s.afterGap) { burst = true; split = s.dur > P.releaseMaxMs; }   // closure, then release
      else burst = s.dur <= P.noGapBurstMs;
      if (split) {
        // closure + release followed by a long hiss: "ts" as in "fiets"
        segs.push({ ...s, c: 'P', b: x.a + 2, dur: 30, ...burstPlace(frames, x.a, x.a + 1) });
        s.a = x.a + 3; s.dur -= 30; s.afterGap = false;
      } else if (burst) { s.c = 'P'; Object.assign(s, burstPlace(frames, x.a, x.b)); }
    }
    segs.push(s);
  });
  // faint hum right before a burst is voicing during the closure, not an m/n
  let vpk = -Infinity;
  segs.forEach(s => { if (s.c === 'V') for (let k = s.a; k <= s.b; k++) vpk = Math.max(vpk, frames[k].db); });
  const kept = segs.filter((s, i) => {
    const n = segs[i + 1];
    if (s.c === 'N' && n && n.c === 'P' && i > 0) {
      let m = 0; for (let k = s.a; k <= s.b; k++) m += frames[k].db;
      if (m / (s.b - s.a + 1) < vpk - P.closureHumBelow) return false;
    }
    if (s.c === 'P' && s.dur <= 20 && i === segs.length - 1 && i > 0 && segs[i - 1].c === 'N') return false;   // nasal release click
    return true;
  });
  // merge neighbours of the same class
  const out = [];
  for (const s of kept) {
    const m = out[out.length - 1];
    if (m && m.c === s.c && s.c !== 'P') { m.b = s.b; m.dur += s.dur; } else out.push(s);
  }
  return out;
}

/* Full analysis of a recording (any sample rate). */
function analyzeRecording(samples, rate) {
  const x = rate === FS ? samples : to16k(samples, rate);
  const frames = analyzeSamples(x);
  const lv = levels(frames);
  const labels = frames.map(f => labelFrame(f, lv.floor, lv.peak));
  return { frames, labels, levels: lv, segs: segment(frames, labels, x) };
}

/* ---------------- Scoring ---------------- */
const clsOf = p => p.includes('/') || p in D.VOW.en || p in D.VOW.nl ? 'V' : (D.CCLS[p] || 'B');
/* How well a detected segment class fits a target class (0 = not at all). The vowel weighs most, so it is never
   given up for a soft match; b/d/g may show up as a burst or as pre-voicing (hum). */
function fit(t, d) {
  if (t === d) return t === 'V' ? 1.5 : 1;
  if ((t === 'F' || t === 'Z') && (d === 'F' || d === 'Z')) return 0.8;
  if (t === 'B' && (d === 'P' || d === 'N')) return 0.4;
  if (t === 'Z' && d === 'N') return 0.5;
  return 0;
}
function align(target, det) {
  const n = target.length, m = det.length, M = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const w = fit(target[i - 1].c, det[j - 1].c);
    M[i][j] = Math.max(M[i - 1][j], M[i][j - 1], w ? M[i - 1][j - 1] + w : -1);
  }
  const match = new Array(n).fill(-1);
  for (let i = n, j = m; i && j;) {
    const w = fit(target[i - 1].c, det[j - 1].c);
    if (w && Math.abs(M[i][j] - (M[i - 1][j - 1] + w)) < 1e-9) { match[i - 1] = j - 1; i--; j--; }
    else if (M[i - 1][j] >= M[i][j - 1]) i--; else j--;
  }
  return match;
}
/* Rough vocal-tract size from pitch (fallback when there is no calibration yet).
   Isolated words are said with a raised pitch, so use the lower part of the pitch range. */
function speakerScale(frames, labels) {
  const f0 = frames.filter((f, i) => labels[i] === 'V' && f.f0 && f.clar > 0.7).map(f => f.f0).sort((a, b) => a - b);
  if (!f0.length) return 1;
  const m = f0[Math.floor(f0.length * 0.2)];
  return m < 160 ? 1 : m < 260 ? 1.18 : 1.32;
}
const protos = (lang, v) => v.split('/').flatMap(a => D.VOW[lang][a] || []);
/* Better: learn the scale from earlier attempts. items: [{lang, target, f1, f2}] */
function estimateScale(items) {
  const r = items.map(({ lang, target, f1, f2 }) => protos(lang, target)
      .map(([t1, t2]) => Math.sqrt((f1 / t1) * (f2 / t2))).sort((a, b) => Math.abs(Math.log(a)) - Math.abs(Math.log(b)))[0])
    .filter(Boolean).sort((a, b) => a - b);
  if (r.length < 5) return null;
  return Math.max(0.85, Math.min(1.5, r[r.length >> 1]));
}
const vdist = (f1, f2, t1, t2) => Math.hypot(Math.log(f1 / t1), 0.8 * Math.log(f2 / t2));
/* Closest prototype of vowel v: { d, t1, t2 } (targets already scaled) */
function vowelMatch(lang, v, f1, f2, scale) {
  let best = { d: Infinity, t1: 0, t2: 0 };
  for (const [t1, t2] of protos(lang, v)) {
    const d = vdist(f1, f2, t1 * scale, t2 * scale);
    if (d < best.d) best = { d, t1: t1 * scale, t2: t2 * scale };
  }
  return best;
}
function nearestVowel(lang, f1, f2, scale, set) {
  let best = null, bd = Infinity;
  for (const v of set || Object.keys(D.VOW[lang])) { const d = vowelMatch(lang, v, f1, f2, scale).d; if (d < bd) { bd = d; best = v; } }
  return { v: best, d: bd };
}
/* Best guess (IPA) of which sound a segment is, from the sound alone — not from the target word.
   Shown under the spectrogram. Thresholds: test/explore-guess.js. */
function guessSound(frames, s, lang, scale) {
  const fr = frames.slice(s.a, s.b + 1), n = fr.length;
  if (!n) return '?';
  if (s.c === 'V') {
    const mid = fr.slice(Math.floor(n * 0.25), Math.max(Math.ceil(n * 0.75), Math.floor(n * 0.25) + 1));
    const fm = (mid.some(f => f.fm) ? mid : fr).filter(f => f.fm).map(f => f.fm);
    if (!fm.length) return '';
    const med = k => fm.map(x => x[k]).sort((a, b) => a - b)[fm.length >> 1];
    return nearestVowel(lang, med(0), med(1), typeof scale === 'number' ? scale : 1.1, D.VSET[lang]).v;
  }
  if (s.c === 'P') return s.place || burstPlace(frames, s.a, s.b).place;
  if (s.c === 'N') return 'm/n';
  // energy-weighted spectral shape of the hiss
  let w = 0, cen = 0, s3 = 0, s4 = 0;
  for (const f of fr) { const e = Math.pow(10, f.db / 10); w += e; cen += e * f.cen; s3 += e * f.s3; s4 += e * f.s4; }
  cen /= w; s3 /= w; s4 /= w;
  if (s.c === 'Z') return s4 > P.guessZ ? 'z' : 'v';
  // s: sharpest (centre of gravity ~5–6 kHz); ʃ: nearly all energy above 1.5 kHz but lower (~3.5–4.8 kHz); f: flatter, weaker
  const sCen = lang === 'nl' ? P.guessSCen - 600 : P.guessSCen;   // the Dutch s is lower, and Dutch has (almost) no ʃ
  if (cen > sCen || (s4 > P.guessS && cen > sCen - 500)) return 's';
  if (s3 + s4 > P.guessShHigh && cen > P.guessShCen) return 'ʃ';
  if (lang === 'nl' && cen < P.guessXCen) return 'x';
  return 'f';
}
function measureVowel(frames, segs) {
  const vs = segs.filter(s => s.c === 'V').sort((a, b) => b.dur - a.dur)[0];
  if (!vs) return null;
  const n = vs.b - vs.a + 1, from = vs.a + Math.floor(n * 0.25), to = vs.a + Math.ceil(n * 0.75);
  const fm = frames.slice(from, Math.max(to, from + 1)).filter(f => f.fm).map(f => f.fm);
  if (fm.length < 3) return null;
  const med = k => fm.map(x => x[k]).sort((a, b) => a - b)[fm.length >> 1];
  return [med(0), med(1)];
}

/* word: {w, ph}; an: result of analyzeRecording; opts: {lang, scale ('auto' or number), recScore (0–100 or null)} */
function scoreAttempt(word, an, opts) {
  const lang = opts.lang, issues = [], { frames, labels, segs } = an;
  const scale = opts.scale === 'auto' || !opts.scale ? speakerScale(frames, labels) : opts.scale;
  const target = word.ph.map((p, i) => ({ p, i, c: clsOf(p) }));
  const spoke = segs.length > 0;
  if (!spoke) issues.push({ k: 'noSpeech' });
  else if (an.levels.peak < -38) issues.push({ k: 'quiet' });

  const match = align(target, segs), marks = new Array(target.length).fill('');
  let credit = 0, required = 0;
  target.forEach((t, k) => {
    const j = match[k], s = j >= 0 ? segs[j] : null;
    if (t.c === 'B') {   // voiced bursts are often silent; only check for a too strong puff of air at the start
      if (s && k === 0 && s.dur >= 50 && s.vfrac < 0.3) { marks[k] = '~'; issues.push({ k: 'aspirated', p: t.p }); }
      return;
    }
    if (t.c === 'V') return;   // scored separately
    required++;
    if (!s && t.c === 'P') {
      // unaspirated (Dutch) p/t/k: the release can hide in the vowel onset; unreleased final p/t/k: only a closure.
      // Give the benefit of the doubt when there is an abrupt, click-like onset or a closure, and say it was weak.
      const first = segs[0], last = segs[segs.length - 1];
      const weakStart = k === 0 && first && first.c !== 'P' && first.onset && first.onset.click >= P.weakBurstClick;
      const closedEnd = k === target.length - 1 && last && last.c === 'V';
      if (weakStart || closedEnd) { marks[k] = '~'; credit += weakStart ? 0.7 : 0.5; issues.push({ k: 'weakBurst', p: t.p, end: !weakStart }); return; }
    }
    if (!s) { marks[k] = '✗'; issues.push({ k: 'missing', p: t.p }); return; }
    let c = 1;
    if (t.c === 'Z' && s.vfrac < 0.35 && s.c !== 'Z') { c = 0.5; issues.push({ k: 'voicedNeed', p: t.p }); }
    if (t.c === 'Z' && s.c === 'N') c = 0.7;   // voice but hardly any hiss
    if (t.c === 'F' && (s.c === 'Z' || s.vfrac > 0.6)) { c = 0.5; issues.push({ k: 'voicelessNeed', p: t.p }); }
    if (t.c === 'P' && s.place && s.place !== D.PLACE[t.p]) {
      // penalty grows with how much closer the burst is to another place than to the intended one
      const gap = s.pdist[D.PLACE[t.p]] - s.pdist[s.place];
      c = 1 - 0.5 * Math.min(1, gap / P.placeMargin);
      if (s.sure) issues.push({ k: 'place', p: t.p, heard: s.place });
    }
    marks[k] = c === 1 ? '✓' : '~'; credit += c;
  });
  // vowel is matched by alignment too: missing vowel = no V segment at all
  const used = new Set(match.filter(j => j >= 0));
  const extras = segs.filter((s, j) => !used.has(j)).length;
  if (extras > 0 && spoke) issues.push({ k: 'extra', n: extras });
  const seq = !spoke ? 0 : required ? Math.max(0, Math.round(100 * credit / required - Math.min(30, 10 * extras))) : Math.max(0, 100 - Math.min(30, 10 * extras));

  let vowel = null, meas = null, near = null;
  const tv = target.find(t => t.c === 'V');
  if (tv) {
    meas = measureVowel(frames, segs);
    const alts = tv.p.split('/');
    if (meas) {
      const [f1, f2] = meas, { d: bd, t1, t2 } = vowelMatch(lang, tv.p, f1, f2, scale);
      near = nearestVowel(lang, f1, f2, scale);
      // absolute closeness, but never punish a vowel that is clearly closest to the target
      let v = 100 * Math.max(0, Math.min(1, 1 - (bd - 0.12) / 0.4));
      if (alts.includes(near.v)) v = Math.max(v, 80);
      vowel = Math.round(v);
      if (vowel >= 75) { marks[tv.i] = '✓'; issues.push({ k: 'vowelGood', p: alts[0] }); }
      else {
        marks[tv.i] = vowel >= 45 ? '~' : '✗';
        if (!alts.includes(near.v)) issues.push({ k: 'vowelLike', p: alts[0], near: near.v });
        if (f1 / t1 > 1.15) issues.push({ k: 'vClose' }); else if (f1 / t1 < 0.87) issues.push({ k: 'vOpen' });
        if (f2 / t2 > 1.15) issues.push({ k: 'vBack' }); else if (f2 / t2 < 0.87) issues.push({ k: 'vFront' });
      }
    } else if (spoke) { marks[tv.i] = '✗'; issues.push({ k: 'vNone' }); vowel = segs.some(s => s.c === 'V') ? 40 : 0; }
  }
  const acoustic = vowel == null ? seq : Math.round(0.55 * seq + 0.45 * vowel);
  let total = opts.recScore == null ? acoustic : Math.round(0.5 * opts.recScore + 0.5 * acoustic);
  if (!spoke) total = 0;
  return { total, rec: opts.recScore, seq, vowel, acoustic, marks, issues, meas, near: near && near.v, scale, segs };
}

const A = { FS, HOP, FRAME_MS, P, Resampler, to16k, Stream, analyzeSamples, labelFrame, levels, LiveLabeler,
            segment, analyzeRecording, scoreAttempt, clsOf, align, guessSound, nearestVowel, vowelMatch, measureVowel, speakerScale, estimateScale };
if (typeof module !== 'undefined' && module.exports) module.exports = A; else root.SpeechAnalysis = A;
})(this);
