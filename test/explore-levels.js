/* Peak level of segments relative to the loudest segment of the word (dB): real sounds vs. unmatched extras.
   Used to choose the noise filter (P.weakNoiseBelow / P.weakVoiceBelow).  node test/explore-levels.js [--noise room] */
const fs = require('fs'), path = require('path');
const A = require('../analysis.js'), D = require('../data.js');
const { prepare } = require('./audio.js');
const args = process.argv.slice(2), cond = args.includes('--noise') ? args[args.indexOf('--noise') + 1] : 'room';
const g = {};
const add = (k, v) => (g[k] = g[k] || []).push(v);
for (const lang of ['en', 'nl']) {
  const root = path.join(__dirname, 'audio', lang);
  for (const voice of fs.readdirSync(root)) for (const wd of D.WORDS[lang]) {
    const f = path.join(root, voice, wd.w + '.wav'); if (!fs.existsSync(f)) continue;
    const an = A.analyzeRecording(prepare(f, cond, wd.w.length * 7919 + voice.length), A.FS);
    const target = wd.ph.map((p, i) => ({ p, i, c: A.clsOf(p) })), m = A.align(target, an.segs), used = new Set(m);
    an.segs.forEach((s, j) => {
      const grp = 'FP'.includes(s.c) ? 'noise(F/P)' : 'voiced(V/N/Z)';
      add(`${used.has(j) ? 'real ' : 'EXTRA'} ${grp}`, s.rel);
      add(`${used.has(j) ? 'real ' : 'EXTRA'} ${grp} above floor`, s.peak - an.levels.floor);
    });
  }
}
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
for (const [k, a] of Object.entries(g).sort())
  console.log(`${k.padEnd(24)} n=${String(a.length).padStart(5)}  rel dB 1/5/10/25/50%: ${[0.01, 0.05, 0.1, 0.25, 0.5].map(p => q(a, p).toFixed(0)).join(' / ')}`);
