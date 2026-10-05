"""Create the example recordings the app plays and analyses ("Listen" button).
Usage: python tools/make-reference-audio.py   -> ref/<lang>/<male|female>/<word>.mp3  (needs internet)
Requires: pip install edge-tts.  Words come from data.js (via test/list-words.js --practice)."""
import asyncio, os, subprocess, sys
import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOICES = {
    'nl': {'male': 'nl-NL-MaartenNeural', 'female': 'nl-NL-ColetteNeural'},
    'en': {'male': 'en-GB-RyanNeural', 'female': 'en-GB-SoniaNeural'},
}
RATE = '-10%'   # a little slower than normal, clearer for practice


def words(lang):
    out = subprocess.run(['node', os.path.join(ROOT, 'test', 'list-words.js'), lang, '--practice'],
                         capture_output=True, text=True, encoding='utf-8', check=True)
    return [w for w in out.stdout.split() if w]


async def synth(sem, text, voice, path):
    if os.path.exists(path):
        return
    async with sem:
        for attempt in range(3):
            try:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                await edge_tts.Communicate(text, voice, rate=RATE).save(path)
                return
            except Exception as e:
                if attempt == 2:
                    print('FAILED', voice, text, e, file=sys.stderr)
                await asyncio.sleep(2)


async def main():
    sem = asyncio.Semaphore(4)
    jobs = [synth(sem, w, v, os.path.join(ROOT, 'ref', lang, sex, w + '.mp3'))
            for lang, vs in VOICES.items() for sex, v in vs.items() for w in words(lang)]
    print(f'{len(jobs)} files')
    await asyncio.gather(*jobs)
    print('done')

asyncio.run(main())
