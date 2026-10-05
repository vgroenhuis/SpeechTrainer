/* Detection test bench: runs the app's analysis on synthesised speech.
   node test/run-tests.js [--lang en|nl] [--noise clean|room|noisy] [--verbose] [--dump word] [--voice part] [--set name=value]
   Audio is created with test/make-audio-windows.ps1 and test/make-audio-edge.py. */
const fs = require('fs'), path = require('path');
const A = require('../analysis.js'), D = require('../data.js'), CASES = require('./cases.js');

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const has = k => args.includes('--' + k);
args.forEach((a, i) => { if (a === '--set') { const [k, v] = args[i + 1].split('='); A.P[k] = parseFloat(v); } });
const { NOISE, prepare } = require('./audio.js');
const LANGS = opt('lang') ? [opt('lang')] : ['en', 'nl'];
const CONDS = opt('noise') ? [opt('noise')] : Object.keys(NOISE);
const VOICE = opt('voice'), DUMP = opt('dump'), VERBOSE = has('verbose');

const segStr = segs => segs.map(s => s.c + (s.place ? ':' + s.place : '') + `(${s.dur})`).join(' ');
const pct = (a, b) => b ? (100 * a / b).toFixed(0).padStart(3) + '%' : '  - ';
function wordInfo(lang, w) {
  const t = D.WORDS[lang].find(x => x.w === w);
  return t || (CASES[lang].extra[w] ? { w, ph: CASES[lang].extra[w].split(' ') } : null);
}

let grand = [];
for (const lang of LANGS) {
  const root = path.join(__dirname, 'audio', lang);
  if (!fs.existsSync(root)) { console.log(`(no audio for ${lang})`); continue; }
  const voices = fs.readdirSync(root).filter(v => !VOICE || v.includes(VOICE));
  for (const cond of CONDS) {
    const st = { cons: {}, place: {}, vowelOk: 0, vowelN: 0, vowelScore: 0, self: [], extras: 0, files: 0, pairs: 0, pairOk: 0, gap: 0, fails: [] };
    for (const voice of voices) {
      const cache = {};
      const analyse = w => {
        if (!cache[w]) { const f = path.join(root, voice, w + '.wav'); if (!fs.existsSync(f)) return null; cache[w] = A.analyzeRecording(prepare(f, cond, w.length * 7919 + voice.length), A.FS); }
        return cache[w];
      };
      // calibration, like the app: learn the speaker's vowel scale from the practice words
      let scale = 'auto';
      if (!has('nocalib')) {
        const calib = [];
        for (const tw of D.WORDS[lang]) {
          const an = analyse(tw.w); if (!an) continue;
          const m = A.measureVowel(an.frames, an.segs), tv = tw.ph.find(p => A.clsOf(p) === 'V');
          if (m && tv) calib.push({ lang, target: tv, f1: m[0], f2: m[1] });
        }
        scale = A.estimateScale(calib) || 'auto';
      }
      if (VERBOSE) console.log(`  ${voice}: scale ${typeof scale === 'number' ? scale.toFixed(2) : scale}`);
      const files = fs.readdirSync(path.join(root, voice)).filter(f => f.endsWith('.wav')).map(f => f.slice(0, -4));
      for (const w of files) {
        const info = wordInfo(lang, w); if (!info) continue;
        const an = analyse(w), res = A.scoreAttempt(info, an, { lang, scale });
        st.files++; st.extras += res.issues.filter(i => i.k === 'extra').reduce((u, i) => u + i.n, 0);
        if (DUMP === w) {
          console.log(`\n=== ${voice} ${w} [${cond}] floor ${an.levels.floor.toFixed(1)} peak ${an.levels.peak.toFixed(1)}`);
          an.frames.forEach((f, i) => { if (an.labels[i] !== 'S' || (an.labels[i - 1] && an.labels[i - 1] !== 'S') || (an.labels[i + 1] && an.labels[i + 1] !== 'S'))
            console.log(`${(f.t * 1000).toFixed(0).padStart(5)} ${an.labels[i]} db ${f.db.toFixed(1).padStart(6)} hf ${f.hf.toFixed(1).padStart(6)} clar ${f.clar.toFixed(2)} s1-4 ${[f.s1, f.s2, f.s3, f.s4].map(v => v.toFixed(2)).join(' ')} cen ${f.cen.toFixed(0).padStart(5)} f0 ${f.f0.toFixed(0).padStart(3)} fm ${f.fm ? f.fm.map(Math.round).join('/') : '-'}`); });
          console.log('segments:', segStr(an.segs), '| score', res.total, 'marks', res.marks.join(''), res.meas ? res.meas.map(Math.round) : '');
        }
        const isTarget = D.WORDS[lang].some(x => x.w === w);
        if (isTarget) st.self.push(res.total);
        // consonant detection + place (raw classifier output, and how often a confident verdict is wrong)
        const tg = info.ph.map((p, i) => ({ p, i, c: A.clsOf(p) })), mt = A.align(tg, an.segs);
        tg.forEach((t, k) => {
          if (t.c !== 'P' || mt[k] < 0 || an.segs[mt[k]].c !== 'P') return;
          const s = an.segs[mt[k]];
          st.rawPlace = st.rawPlace || { n: 0, ok: 0, sure: 0, sureWrong: 0 };
          st.rawPlace.n++; if (s.place === D.PLACE[t.p]) st.rawPlace.ok++;
          if (s.sure) { st.rawPlace.sure++; if (s.place !== D.PLACE[t.p]) st.rawPlace.sureWrong++; }
        });
        info.ph.forEach((p, k) => {
          const c = A.clsOf(p); if (c === 'V' || c === 'B') return;
          const o = st.cons[p] = st.cons[p] || { n: 0, ok: 0 }; o.n++;
          const missing = res.issues.some(i => i.k === 'missing' && i.p === p) && res.marks[k] === '✗';
          if (!missing) o.ok++;
          if (c === 'P') {
            const heard = missing ? '-' : (res.issues.find(i => i.k === 'place' && i.p === p) || { heard: p }).heard;
            st.place[p] = st.place[p] || {}; st.place[p][heard] = (st.place[p][heard] || 0) + 1;
          }
        });
        const tv = info.ph.find(p => A.clsOf(p) === 'V');
        if (tv) { st.vowelN++; if (res.near && tv.split('/').includes(res.near)) st.vowelOk++; st.vowelScore += res.vowel || 0; }
        if (isTarget && (res.total < 75 || VERBOSE)) st.fails.push(`${voice.padEnd(24)} ${w.padEnd(7)} ${String(res.total).padStart(3)}  ${res.marks.map((m, i) => info.ph[i] + (m || '·')).join(' ').padEnd(16)} vowel ${res.meas ? res.meas.map(Math.round).join('/') + '→' + res.near : '-'}  ${segStr(an.segs)}`);
      }
      // discrimination: a different word should score clearly lower than the right one
      for (const [tw, sw] of CASES[lang].pairs) {
        const t = wordInfo(lang, tw), a1 = analyse(tw), a2 = analyse(sw); if (!t || !a1 || !a2) continue;
        const s1 = A.scoreAttempt(t, a1, { lang, scale }).total, s2 = A.scoreAttempt(t, a2, { lang, scale }).total;
        st.pairs++; st.gap += s1 - s2; if (s1 - s2 >= 10) st.pairOk++;
        else if (VERBOSE) st.fails.push(`PAIR ${voice} target ${tw} (${s1}) vs said ${sw} (${s2})  ${segStr(a2.segs)}`);
      }
    }
    // report
    console.log(`\n##### ${lang.toUpperCase()} — ${cond} (${voices.length} voices, ${st.files} recordings)`);
    const cons = Object.entries(st.cons).sort();
    console.log('Consonant detected: ' + cons.map(([p, o]) => `${p} ${pct(o.ok, o.n)}`).join(' | '));
    const pl = ['p', 't', 'k'].filter(p => st.place[p]);
    console.log('Burst place (said → heard): ' + pl.map(p => { const m = st.place[p], n = Object.values(m).reduce((a, b) => a + b, 0); return `${p}: ` + ['p', 't', 'k', '-'].map(h => `${h}${pct(m[h] || 0, n)}`).join(' '); }).join('  ||  '));
    const rp = st.rawPlace || { n: 0, ok: 0, sure: 0, sureWrong: 0 };
    console.log(`Place classifier: ${pct(rp.ok, rp.n)} correct; confident in ${pct(rp.sure, rp.n)} of bursts, of which ${pct(rp.sureWrong, rp.sure)} wrong (only those give feedback)`);
    const selfAvg = st.self.reduce((a, b) => a + b, 0) / st.self.length;
    console.log(`Vowel identified: ${pct(st.vowelOk, st.vowelN)}  avg vowel score ${(st.vowelScore / st.vowelN).toFixed(0)}`);
    console.log(`Correct words: avg score ${selfAvg.toFixed(1)}, ≥75: ${pct(st.self.filter(s => s >= 75).length, st.self.length)}   extra segments/recording ${(st.extras / st.files).toFixed(2)}`);
    console.log(`Wrong words scored ≥10 lower: ${pct(st.pairOk, st.pairs)}  (avg gap ${(st.gap / st.pairs).toFixed(1)})`);
    if (VERBOSE || has('fails')) st.fails.forEach(f => console.log('  ' + f));
    const consAll = cons.reduce((a, [, o]) => [a[0] + o.ok, a[1] + o.n], [0, 0]);
    grand.push({ lang, cond, cons: consAll[0] / consAll[1], place: rp.ok / rp.n, vowel: st.vowelOk / st.vowelN, self: selfAvg, pair: st.pairOk / st.pairs });
  }
}
console.log('\n===== SUMMARY =====');
console.log('lang cond   consonants  place  vowel  self-score  pair-discrimination');
for (const g of grand) console.log(`${g.lang}   ${g.cond.padEnd(6)} ${(100 * g.cons).toFixed(0).padStart(6)}%    ${(100 * g.place).toFixed(0).padStart(4)}%  ${(100 * g.vowel).toFixed(0).padStart(4)}%  ${g.self.toFixed(1).padStart(8)}   ${(100 * g.pair).toFixed(0).padStart(6)}%`);
