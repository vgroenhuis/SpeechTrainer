/* What are the unmatched ("extra") segments in correctly spoken words?  node test/explore-extras.js [--noise room] */
const fs = require('fs'), path = require('path');
const A = require('../analysis.js'), D = require('../data.js');
const { prepare } = require('./audio.js');
const args = process.argv.slice(2), cond = args.includes('--noise') ? args[args.indexOf('--noise') + 1] : 'room';
const hist = {}, examples = {};
for (const lang of ['en', 'nl']) {
  const root = path.join(__dirname, 'audio', lang);
  for (const voice of fs.readdirSync(root)) for (const wd of D.WORDS[lang]) {
    const f = path.join(root, voice, wd.w + '.wav'); if (!fs.existsSync(f)) continue;
    const an = A.analyzeRecording(prepare(f, cond, wd.w.length * 7919 + voice.length), A.FS);
    const target = wd.ph.map((p, i) => ({ p, i, c: A.clsOf(p) })), m = A.align(target, an.segs), used = new Set(m);
    an.segs.forEach((s, j) => {
      if (used.has(j)) return;
      const pos = j === 0 ? 'first' : j === an.segs.length - 1 ? 'last' : 'middle';
      const key = `${lang} ${s.c}${s.c === 'P' ? '' : ''} ${pos} ${s.dur <= 30 ? '≤30ms' : s.dur <= 80 ? '≤80ms' : '>80ms'}`;
      hist[key] = (hist[key] || 0) + 1;
      (examples[key] = examples[key] || []).push(`${voice}/${wd.w}: ` + an.segs.map((x, k) => (k === j ? '[' : '') + x.c + (x.place || '') + x.dur + (k === j ? ']' : '')).join(' '));
    });
  }
}
Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, n]) => console.log(String(n).padStart(4), k.padEnd(28), examples[k].slice(0, 2).join('  |  ')));
