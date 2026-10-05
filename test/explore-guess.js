/* Accuracy of the word-independent sound guesses (labels under the spectrogram), per true sound,
   plus the spectral shape of hisses to tune the s / ʃ / f / x thresholds.  node test/explore-guess.js [--noise room] */
const fs = require('fs'), path = require('path');
const A = require('../analysis.js'), D = require('../data.js'), CASES = require('./cases.js');
const { prepare } = require('./audio.js');
const args = process.argv.slice(2), cond = args.includes('--noise') ? args[args.indexOf('--noise') + 1] : 'room';

const conf = {}, shape = {};
for (const lang of ['en', 'nl']) {
  const root = path.join(__dirname, 'audio', lang);
  const words = [...D.WORDS[lang], ...Object.entries(CASES[lang].extra).map(([w, ph]) => ({ w, ph: ph.split(' ') }))];
  for (const voice of fs.readdirSync(root)) {
    const male = /Guy|Ryan|George|Maarten|Arnaud/.test(voice), scale = male ? 1 : 1.18;
    for (const wd of words) {
      const f = path.join(root, voice, wd.w + '.wav'); if (!fs.existsSync(f)) continue;
      const an = A.analyzeRecording(prepare(f, cond, wd.w.length * 7919 + voice.length), A.FS);
      const target = wd.ph.map((p, i) => ({ p, i, c: A.clsOf(p) })), m = A.align(target, an.segs);
      target.forEach((t, k) => {
        if (m[k] < 0 || t.c === 'B') return;
        const s = an.segs[m[k]], g = A.guessSound(an.frames, s, lang, scale);
        const key = `${lang} ${t.p}`, o = conf[key] = conf[key] || {};
        const ok = t.p.split('/').includes(g) ? t.p : g;
        o[ok] = (o[ok] || 0) + 1;
        if (s.c === 'F' || s.c === 'Z') {
          const fr = an.frames.slice(s.a, s.b + 1); let w = 0, cen = 0, s3 = 0, s4 = 0;
          for (const q of fr) { const e = Math.pow(10, q.db / 10); w += e; cen += e * q.cen; s3 += e * q.s3; s4 += e * q.s4; }
          const sh = shape[key] = shape[key] || { cen: [], s4: [], s34: [] };
          sh.cen.push(cen / w); sh.s4.push(s4 / w); sh.s34.push((s3 + s4) / w);
        }
      });
    }
  }
}
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
console.log('Guess per true sound:');
for (const [k, o] of Object.entries(conf).sort()) {
  const n = Object.values(o).reduce((a, b) => a + b, 0), t = k.split(' ')[1];
  console.log(`  ${k.padEnd(8)} n=${String(n).padStart(4)}  correct ${String(Math.round(100 * (o[t] || 0) / n)).padStart(3)}%   ` +
    Object.entries(o).sort((a, b) => b[1] - a[1]).map(([g, c]) => `${g} ${Math.round(100 * c / n)}%`).join(' '));
}
console.log('\nHiss shape (10/25/50/75/90%):');
for (const [k, sh] of Object.entries(shape).sort())
  console.log(`  ${k.padEnd(8)} ` + Object.entries(sh).map(([m, a]) => `${m} ${[0.1, 0.25, 0.5, 0.75, 0.9].map(p => m === 'cen' ? q(a, p).toFixed(0) : q(a, p).toFixed(2)).join('/')}`).join('   '));
