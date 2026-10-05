/* Test cases for the detection test bench.
   extra: additional words to synthesise (with their sounds), used as "wrong" pronunciations.
   pairs: [target, spoken]: the spoken word differs from the target and should score clearly lower. */
module.exports = {
  en: {
    extra: {
      pat:'p æ t', at:'æ t', cut:'k ʌ t', pup:'p ʌ p', pit:'p ɪ t', it:'ɪ t', peep:'p i p', tip:'t ɪ p',
      pop:'p ɑ p', cop:'k ɑ p', eat:'i t', sue:'s u', fit:'f ɪ t', man:'m æ n', pin:'p ɪ n',
      mat:'m æ t', bad:'b æ d', nut:'n ʌ t', bit:'b ɪ t', tack:'t æ k', kin:'k ɪ n', tin:'t ɪ n', cap:'k æ p'
    },
    pairs: [
      ['cat','pat'], ['cat','at'], ['cat','cut'], ['cup','pup'], ['cup','cut'], ['kit','pit'], ['kit','it'],
      ['keep','peep'], ['tick','tip'], ['top','pop'], ['top','cop'], ['sheep','ship'], ['ship','sheep'],
      ['seat','eat'], ['seat','sit'], ['sit','it'], ['zoo','sue'], ['fish','fit'], ['feet','fit'], ['moon','man'],
      ['pan','pin'], ['map','mat'], ['bed','bad'], ['pet','pat'], ['net','nut'], ['boot','bit'], ['foot','feet'],
      ['pot','pat'], ['tap','tack'], ['kiss','kit'], ['cook','book'], ['cat','cap']
    ]
  },
  nl: {
    extra: {
      pat:'p ɑ t', at:'ɑ t', kit:'k ɪ t', tip:'t ɪ p', pip:'p ɪ p', kop:'k ɔ p', baas:'b a s', kies:'k i s',
      thee:'t e', sop:'s ɔ p', man:'m ɑ n', pan:'p ɑ n', bos:'b ɔ s', mis:'m ɪ s', teen:'t e n', bot:'b ɔ t',
      tok:'t ɔ k', pook:'p o k'
    },
    pairs: [
      ['kat','pat'], ['kat','at'], ['kat','kit'], ['kip','tip'], ['kip','pip'], ['pop','kop'], ['tak','pak'],
      ['pak','tak'], ['kaas','baas'], ['kaas','kies'], ['boek','boot'], ['zee','thee'], ['soep','sop'], ['maan','man'],
      ['pen','pan'], ['bus','bos'], ['mus','mis'], ['tien','teen'], ['boot','bot'], ['sok','sop'], ['zak','pak'],
      ['kok','tok'], ['kook','pook'], ['nat','pat']
    ]
  }
};
