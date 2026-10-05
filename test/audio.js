/* Audio helpers for the test bench: WAV reading and "microphone-like" preparation. */
const fs = require('fs');
const A = require('../analysis.js');

const NOISE = { clean: -90, room: -58, noisy: -46 };

function readWav(file) {
  const b = fs.readFileSync(file);
  let p = 12, fmt = null, data = null;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { tag: b.readUInt16LE(p + 8), ch: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') data = b.subarray(p + 8, p + 8 + Math.min(size, b.length - p - 8));
    p += 8 + size + (size & 1);
  }
  const bytes = fmt.bits / 8, n = Math.floor(data.length / bytes / fmt.ch), x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) {
      const o = (i * fmt.ch + c) * bytes;
      s += fmt.tag === 3 ? data.readFloatLE(o) : fmt.bits === 16 ? data.readInt16LE(o) / 32768 : fmt.bits === 32 ? data.readInt32LE(o) / 2147483648 : (data[o] - 128) / 128;
    }
    x[i] = s / fmt.ch;
  }
  return { x, rate: fmt.rate };
}
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* Like a microphone with automatic gain: speech peak at -6 dBFS, 0.4 s lead-in, room noise (mostly low-frequency). */
function prepare(file, cond, seed) {
  const { x, rate } = readWav(file), s = A.to16k(x, rate);
  let pk = 0; for (const v of s) pk = Math.max(pk, Math.abs(v));
  const lead = 6400, tail = 4800, y = new Float32Array(lead + s.length + tail), r = rng(seed);
  const g = 0.5 / (pk || 1), amp = Math.pow(10, NOISE[cond] / 20) * Math.sqrt(3);
  let lp = 0;
  for (let i = 0; i < y.length; i++) {
    const w = (r() * 2 - 1) * amp; lp = 0.97 * lp + 0.03 * w * 6;
    y[i] = (i >= lead && i < lead + s.length ? s[i - lead] * g : 0) + 0.5 * w + lp;
  }
  return y;
}
module.exports = { NOISE, readWav, prepare };
