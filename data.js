/* Shared phonetic data and word lists (browser + Node test harness). */
(function (root) {
'use strict';

/* Vowel formant prototypes [F1, F2] in Hz for adult male speakers (women ≈ ×1.18, children ≈ ×1.32).
   A vowel can have several prototypes for accent variants; the closest one counts.
   Values are a 50/50 blend of published averages and measurements of 13 modern synthetic voices (test/explore-vowels.js):
   English: Hillenbrand et al. (1995, American) and modern Southern British (lowered "cat", fronted "moon", rounded "pot").
   Dutch: Pols, Tromp & Plomp (1973) / Adank et al. (2004). */
const VOW = {
  en: { i:[[320,2300]], 'ɪ':[[420,2050]], 'ɛ':[[600,1830]], 'æ':[[790,1530],[650,1850]], 'ʌ':[[680,1250]],
        'ɑ':[[750,1300],[620,1000]], 'ʊ':[[460,1180]], u:[[360,970],[350,1500]] },
  nl: { i:[[285,2230]], y:[[295,1760]], 'ɪ':[[385,2090]], 'ʏ':[[420,1520]], e:[[410,2130]], 'ɛ':[[545,1800]],
        a:[[830,1330]], 'ɑ':[[695,1110]], 'ɔ':[[480,860]], o:[[470,880]], u:[[330,830]] }
};
/* Vowels shown on the vowel map. */
const VSET = { en:['i','ɪ','ɛ','æ','ʌ','ɑ','ʊ','u'], nl:['i','y','ɪ','ʏ','e','ɛ','a','ɑ','ɔ','o','u'] };
const VHINT = {
  en:{i:'ee','ɪ':'i','ɛ':'e','æ':'a','ʌ':'u','ɑ':'o','ʊ':'oo',u:'oo'},
  nl:{i:'ie',y:'uu','ɪ':'i','ʏ':'u',e:'ee','ɛ':'e',a:'aa','ɑ':'a','ɔ':'o',o:'oo',u:'oe'}
};
/* Consonant classes: F voiceless hiss, Z voiced hiss, P voiceless burst, B voiced burst, N nasal hum. */
const CCLS = { s:'F', 'ʃ':'F', f:'F', z:'Z', v:'Z', p:'P', t:'P', k:'P', b:'B', d:'B', g:'B', m:'N', n:'N' };
const PLACE = { p:'p', b:'p', t:'t', d:'t', k:'k', g:'k' };

/* Single-syllable words with one vowel, so the vowel can be measured. */
const WORDS = {
  en: [
    ['sheep','ʃ i p','vowel hiss burst'], ['ship','ʃ ɪ p','vowel hiss burst'], ['seat','s i t','vowel hiss burst'],
    ['sit','s ɪ t','vowel hiss burst'], ['sun','s ʌ n','hiss hum'], ['cat','k æ t','vowel burst'],
    ['cup','k ʌ p','vowel burst'], ['kiss','k ɪ s','burst hiss'], ['pot','p ɑ t','vowel burst'],
    ['top','t ɑ p','burst'], ['pan','p æ n','burst hum'], ['map','m æ p','hum burst'], ['moon','m u n','vowel hum'],
    ['fish','f ɪ ʃ','hiss'], ['feet','f i t','hiss vowel'], ['foot','f ʊ t','hiss vowel'], ['shoe','ʃ u','hiss vowel'],
    ['zoo','z u','hiss'], ['bed','b ɛ d','vowel'], ['book','b ʊ k','vowel burst'], ['boot','b u t','vowel burst'],
    ['net','n ɛ t','hum burst'], ['pet','p ɛ t','vowel burst'], ['tap','t æ p','burst'],
    ['kit','k ɪ t','burst'], ['cook','k ʊ k','burst'], ['keep','k i p','burst'], ['tick','t ɪ k','burst']
  ],
  nl: [
    ['zee','z e','hiss vowel'], ['boek','b u k','vowel burst'], ['vis','v ɪ s','hiss vowel'], ['kat','k ɑ t','burst vowel'],
    ['maan','m a n','vowel hum'], ['pen','p ɛ n','burst hum'], ['tas','t ɑ s','burst hiss'], ['kip','k ɪ p','burst vowel'],
    ['bus','b ʏ s','vowel hiss'], ['mus','m ʏ s','hum hiss'], ['pet','p ɛ t','burst vowel'], ['soep','s u p','hiss vowel'],
    ['sok','s ɔ k','hiss burst'], ['pop','p ɔ p','burst vowel'], ['nat','n ɑ t','hum burst'], ['zak','z ɑ k','hiss burst'],
    ['been','b e n','vowel hum'], ['kaas','k a s','burst hiss'], ['naam','n a m','hum vowel'], ['boot','b o t','vowel burst'],
    ['fiets','f i t s','hiss vowel'], ['tien','t i n','burst hum'], ['duf','d ʏ f','vowel hiss'], ['mos','m ɔ s','hum hiss'],
    ['vet','v ɛ t','hiss burst'], ['som','s ɔ m','hiss hum'], ['nu','n y','hum vowel'],
    ['kok','k ɔ k','burst'], ['kook','k o k','burst'], ['pak','p ɑ k','burst'], ['tak','t ɑ k','burst']
  ]
};
const parseWord = ([w, ph, c]) => ({ w, ph: ph.split(' '), cats: c.split(' ') });
for (const k in WORDS) WORDS[k] = WORDS[k].map(parseWord);

const D = { VOW, VSET, VHINT, CCLS, PLACE, WORDS, parseWord };
if (typeof module !== 'undefined' && module.exports) module.exports = D; else root.SpeechData = D;
})(this);
