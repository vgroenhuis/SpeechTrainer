"""Create the example recordings the app plays and analyses ("Listen" button).
Usage: python tools/make-reference-audio.py [--force]   (--force: also replace files that exist)
       -> ref/<lang>/<male|female>/<word>.mp3
Requires: pip install piper-tts lameenc numpy. The voices (~70-110 MB each) are downloaded once into tools/voices/.
Words come from data.js (via test/list-words.js --practice, needs Node); without Node, the words already in ref/.

The voices are Piper voices trained on openly licensed recordings, so the generated files may be published
(see VOICES and the README): unlike the Edge voices used for the tests, which are for testing only."""
import json, os, subprocess, sys, urllib.request
import numpy as np
import lameenc
from piper import PiperVoice, SynthesisConfig

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', 'voices')
HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/'
# (Piper voice, speaker or None, dataset license)
VOICES = {
    'nl': {'male': ('nl/nl_NL/pim/medium/nl_NL-pim-medium', None, 'CC0'),
           'female': ('nl/nl_BE/nathalie/medium/nl_BE-nathalie-medium', None, 'CC0; Belgian Dutch')},
    'en': {'male': ('en/en_GB/vctk/medium/en_GB-vctk-medium', 'p226', 'CC BY 4.0, CSTR VCTK Corpus'),
           'female': ('en/en_GB/vctk/medium/en_GB-vctk-medium', 'p228', 'CC BY 4.0, CSTR VCTK Corpus')},
}
LENGTH = 1.1        # a little slower than normal, clearer for practice
PAD = 0.15          # s of silence before and after the word
KBPS = 48


def voice_file(path):
    os.makedirs(CACHE, exist_ok=True)
    local = os.path.join(CACHE, os.path.basename(path))
    for ext in ('.onnx', '.onnx.json'):
        if not os.path.exists(local + ext):
            print('downloading', os.path.basename(path) + ext)
            urllib.request.urlretrieve(HF + path + ext, local + ext + '.part')
            os.replace(local + ext + '.part', local + ext)
    return local + '.onnx'


def words(lang):
    try:
        out = subprocess.run(['node', os.path.join(ROOT, 'test', 'list-words.js'), lang, '--practice'],
                             capture_output=True, text=True, encoding='utf-8', check=True)
        return [w for w in out.stdout.split() if w]
    except (OSError, subprocess.CalledProcessError):
        d = os.path.join(ROOT, 'ref', lang, 'male')
        return sorted(f[:-4] for f in os.listdir(d) if f.endswith('.mp3'))


def synth(voice, speaker, text):
    sid = voice.config.speaker_id_map[speaker] if speaker else None
    cfg = SynthesisConfig(speaker_id=sid, length_scale=LENGTH)
    a = np.concatenate([c.audio_float_array for c in voice.synthesize(text, syn_config=cfg)])
    keep = np.flatnonzero(np.abs(a) > 0.01)              # trim Piper's own silence, then a fixed margin
    if len(keep):
        a = a[keep[0]:keep[-1] + 1]
    sr = voice.config.sample_rate
    a = np.concatenate([np.zeros(int(PAD * sr)), a, np.zeros(int(PAD * sr))])
    a = a / max(1e-6, np.abs(a).max()) * 0.89            # peak at -1 dBFS
    return (a * 32767).astype(np.int16), sr


def mp3(pcm, sr):
    enc = lameenc.Encoder()
    enc.set_bit_rate(KBPS); enc.set_in_sample_rate(sr); enc.set_channels(1); enc.set_quality(2)
    return enc.encode(pcm.tobytes()) + enc.flush()


def main():
    force = '--force' in sys.argv
    n = 0
    for lang, vs in VOICES.items():
        ws = words(lang)
        for sex, (path, speaker, _) in vs.items():
            voice = PiperVoice.load(voice_file(path))
            for w in ws:
                out = os.path.join(ROOT, 'ref', lang, sex, w + '.mp3')
                if os.path.exists(out) and not force:
                    continue
                os.makedirs(os.path.dirname(out), exist_ok=True)
                with open(out, 'wb') as f:
                    f.write(mp3(*synth(voice, speaker, w)))
                n += 1
            print(lang, sex, len(ws), 'words')
    print(n, 'files written')


if __name__ == '__main__':
    main()
