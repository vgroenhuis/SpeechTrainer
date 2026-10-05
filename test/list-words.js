// Prints words one per line: node test/list-words.js en|nl [--practice]
// Default: everything the test bench needs (practice words + extra test words); --practice: only the app's practice words.
const D = require('../data.js'), cases = require('./cases.js');
const lang = process.argv[2] || 'en', practice = process.argv.includes('--practice');
const words = new Set([...D.WORDS[lang].map(w => w.w), ...(practice ? [] : Object.keys(cases[lang].extra))]);
console.log([...words].join('\n'));
