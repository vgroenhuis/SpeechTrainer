/* Statistics of onset and noise-segment cues, grouped by the true sound, to choose detection thresholds.
   node test/explore.js [--noise room] */
const fs = require('fs'), path = require('path');
const A = require('../analysis.js'), D = require('../data.js'), CASES = require('./cases.js');
const { prepare } = require('./audio.js');
const args = process.argv.slice(2), cond = args.includes('--noise') ? args[args.indexOf('--noise') + 1] : 'room';

const groups = {};
const add = (key, vals) => { const g = groups[key] = groups[key] || {}; for (const k in vals) if (vals[k] != null && isFinite(vals[k])) (g[k] = g[k] || []).push(vals[k]); };
const truth = p => { const c = A.clsOf(p); return c; };

for (const lang of ['en', 'nl']) {
  const root = path.join(__dirname, 'audio', lang);
  const words = [...D.WORDS[lang], ...Object.entries(CASES[lang].extra).map(([w, ph]) => ({ w, ph: ph.split(' ') }))];
  for (const voice of fs.readdirSync(root)) for (const wd of words) {
    const f = path.join(root, voice, wd.w + '.wav'); if (!fs.existsSync(f)) continue;
    const an = A.analyzeRecording(prepare(f, cond, wd.w.length * 7919 + voice.length), A.FS);
    const s0 = an.segs[0]; if (!s0) continue;
    const t0 = truth(wd.ph[0]);
    add(`${lang} initial onset | true ${t0}`, { click: s0.onset && s0.onset.click, riseMs: s0.onset && s0.onset.riseMs });
    if (s0.c === 'V') add(`${lang} initial VOWEL-labelled onset | true ${t0}`, { click: s0.onset && s0.onset.click, riseMs: s0.onset && s0.onset.riseMs });
    if (s0.rawC === 'F') add(`${lang} initial noise | true ${t0}`, { dur: s0.dur, rise: s0.rise, decay: s0.decay, click: s0.onset && s0.onset.click });
    const last = wd.ph[wd.ph.length - 1], tl = truth(last);
    const noise = an.segs.filter(s => s.rawC === 'F' && !s.initial);
    for (const s of noise) {
      const pos = s.afterGap && s.prevC && 'VNZ'.includes(s.prevC) ? 'after-gap' : s.prevC && 'VNZ'.includes(s.prevC) ? 'after-voice' : 'other';
      add(`${lang} later noise ${pos} | word ends ${tl}`, { dur: s.dur, rise: s.rise, decay: s.decay, click: s.onset && s.onset.click });
    }
  }
}
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
for (const k of Object.keys(groups).sort()) {
  const g = groups[k], n = Math.max(...Object.values(g).map(a => a.length));
  console.log(`${k.padEnd(48)} n=${String(n).padStart(4)}  ` + Object.entries(g).map(([m, a]) => `${m} ${[0.1, 0.25, 0.5, 0.75, 0.9].map(p => q(a, p).toFixed(0)).join('/')}`).join('   '));
}
