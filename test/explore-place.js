/* Burst spectra grouped by true place of articulation (p / t / k), to tune the place classifier.
   node test/explore-place.js [--noise room] */
const fs = require('fs'), path = require('path');
const A = require('../analysis.js'), D = require('../data.js'), CASES = require('./cases.js');
const { prepare } = require('./audio.js');
const args = process.argv.slice(2), cond = args.includes('--noise') ? args[args.indexOf('--noise') + 1] : 'room';
const BIN = 16000 / 512;

/* Candidate features of the first `n` frames of a burst. */
function feats(frames, a, b, n) {
  const fr = frames.slice(a, Math.min(b, a + n - 1) + 1);
  const pw = new Float64Array(256);
  fr.forEach(f => f.spec.forEach((d, k) => { pw[k] += Math.pow(10, d / 10); }));
  const band = (lo, hi) => { let s = 0; for (let k = Math.ceil(lo / BIN); k < Math.min(256, hi / BIN); k++) s += pw[k]; return 10 * Math.log10(s + 1e-12); };
  let cw = 0, ct = 0, pkF = 0, pkV = -1;
  for (let k = Math.ceil(1000 / BIN); k < 256; k++) {
    cw += pw[k] * k * BIN; ct += pw[k];
    const sm = (pw[k - 1] + pw[k] + pw[k + 1]) / 3;
    if (k > Math.ceil(1200 / BIN) && sm > pkV) { pkV = sm; pkF = k * BIN; }
  }
  // compactness: share of 1–8 kHz energy within ±400 Hz of the main peak; flatness: geometric/arithmetic mean 1–6 kHz
  const compact = band(pkF - 400, pkF + 400) - band(1000, 8000);
  let lg = 0, ar = 0, nn = 0;
  for (let k = Math.ceil(1000 / BIN); k < 6000 / BIN; k++) { lg += Math.log(pw[k] + 1e-12); ar += pw[k]; nn++; }
  const flat = 10 * Math.log10(Math.exp(lg / nn) / (ar / nn));
  return { cen1k: cw / ct, peak: pkF, hiMinusMid: band(4000, 8000) - band(1500, 3500), midMinusLow: band(1500, 3500) - band(600, 1500),
           compact, flat };
}

const groups = {};
const add = (key, vals) => { const g = groups[key] = groups[key] || {}; for (const k in vals) (g[k] = g[k] || []).push(vals[k]); };
for (const lang of ['en', 'nl']) {
  const root = path.join(__dirname, 'audio', lang);
  const words = [...D.WORDS[lang], ...Object.entries(CASES[lang].extra).map(([w, ph]) => ({ w, ph: ph.split(' ') }))];
  for (const voice of fs.readdirSync(root)) for (const wd of words) {
    const f = path.join(root, voice, wd.w + '.wav'); if (!fs.existsSync(f)) continue;
    const an = A.analyzeRecording(prepare(f, cond, wd.w.length * 7919 + voice.length), A.FS);
    const target = wd.ph.map((p, i) => ({ p, i, c: A.clsOf(p) }));
    const m = A.align(target, an.segs);
    target.forEach((t, k) => {
      if (t.c !== 'P' || m[k] < 0) return;
      const s = an.segs[m[k]]; if (s.c !== 'P') return;
      const pos = k === 0 ? 'initial' : 'final';
      add(`${lang} ${pos} ${D.PLACE[t.p]}`, { ...feats(an.frames, s.a, s.b, 2), dur: s.dur });
    });
  }
}
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
for (const k of Object.keys(groups).sort()) {
  const g = groups[k];
  console.log(`${k.padEnd(14)} n=${String(g.dur.length).padStart(4)}  ` + Object.entries(g).map(([m, a]) => `${m} ${[0.1, 0.25, 0.5, 0.75, 0.9].map(p => q(a, p).toFixed(0)).join('/')}`).join('  '));
}
