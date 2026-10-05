/* Measured vowel formants per target vowel (normalised by each voice's calibrated scale) vs the reference table.
   node test/explore-vowels.js [--noise room] */
const fs = require('fs'), path = require('path');
const A = require('../analysis.js'), D = require('../data.js'), CASES = require('./cases.js');
const { prepare } = require('./audio.js');
const args = process.argv.slice(2), cond = args.includes('--noise') ? args[args.indexOf('--noise') + 1] : 'room';

for (const lang of ['en', 'nl']) {
  const root = path.join(__dirname, 'audio', lang), per = {};
  const words = [...D.WORDS[lang], ...Object.entries(CASES[lang].extra).map(([w, ph]) => ({ w, ph: ph.split(' ') }))];
  for (const voice of fs.readdirSync(root)) {
    const meas = [];
    for (const wd of words) {
      const f = path.join(root, voice, wd.w + '.wav'); if (!fs.existsSync(f)) continue;
      const an = A.analyzeRecording(prepare(f, cond, wd.w.length * 7919 + voice.length), A.FS);
      const m = A.measureVowel(an.frames, an.segs), tv = wd.ph.find(p => A.clsOf(p) === 'V');
      if (m && tv) meas.push({ lang, target: tv, f1: m[0], f2: m[1], w: wd.w });
    }
    const scale = A.estimateScale(meas.filter(x => D.WORDS[lang].some(w => w.w === x.w))) || 1;
    for (const x of meas) {
      const near = A.nearestVowel(lang, x.f1, x.f2, scale, Object.keys(D.VOW[lang])).v;
      const o = per[x.target] = per[x.target] || { f1: [], f2: [], near: {} };
      o.f1.push(x.f1 / scale); o.f2.push(x.f2 / scale); o.near[near] = (o.near[near] || 0) + 1;
    }
  }
  console.log(`\n${lang.toUpperCase()}  target: table F1/F2 → measured median (IQR) | identified as`);
  const med = a => { const s = a.slice().sort((x, y) => x - y); return [s[s.length >> 2], s[s.length >> 1], s[(3 * s.length) >> 2]].map(Math.round); };
  for (const [v, o] of Object.entries(per)) {
    const ref = v.split('/').map(x => D.VOW[lang][x].join('/')).join(' | ');
    const [a1, m1, b1] = med(o.f1), [a2, m2, b2] = med(o.f2), n = o.f1.length;
    console.log(`  ${v.padEnd(4)} ${ref.padEnd(18)} → ${m1} (${a1}-${b1}) / ${m2} (${a2}-${b2})  n=${n} | ` + Object.entries(o.near).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${Math.round(100 * c / n)}%`).join(' '));
  }
}
