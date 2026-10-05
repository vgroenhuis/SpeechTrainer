// Prints every word that the test bench needs as audio, one per line: node test/list-words.js en|nl
const D = require('../data.js'), cases = require('./cases.js');
const lang = process.argv[2] || 'en';
const words = new Set([...D.WORDS[lang].map(w => w.w), ...Object.keys(cases[lang].extra)]);
console.log([...words].join('\n'));
