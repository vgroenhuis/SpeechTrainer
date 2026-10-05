"""Synthesise all test words with Microsoft Edge neural voices (needs internet).
Usage: python test/make-audio-edge.py      -> writes test/audio/<lang>/<voice>-<rate>/<word>.wav
Requires: pip install edge-tts soundfile"""
import asyncio, io, os, subprocess, sys
import edge_tts, soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
VOICES = {
    'nl': ['nl-NL-ColetteNeural', 'nl-NL-FennaNeural', 'nl-NL-MaartenNeural', 'nl-BE-ArnaudNeural', 'nl-BE-DenaNeural'],
    'en': ['en-US-GuyNeural', 'en-US-JennyNeural', 'en-GB-RyanNeural', 'en-GB-SoniaNeural'],
}
RATES = {'normal': '+0%', 'slow': '-35%'}


def words(lang):
    out = subprocess.run(['node', os.path.join(HERE, 'list-words.js'), lang], capture_output=True, text=True, encoding='utf-8', check=True)
    return [w for w in out.stdout.split() if w]


async def synth(sem, text, voice, rate, path):
    if os.path.exists(path):
        return
    async with sem:
        for attempt in range(3):
            try:
                mp3 = b''
                async for chunk in edge_tts.Communicate(text, voice, rate=rate).stream():
                    if chunk['type'] == 'audio':
                        mp3 += chunk['data']
                data, sr = sf.read(io.BytesIO(mp3), dtype='float32')
                if data.ndim > 1:
                    data = data.mean(axis=1)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                sf.write(path, data, sr, subtype='PCM_16')
                return
            except Exception as e:  # network hiccups
                if attempt == 2:
                    print('FAILED', voice, text, e, file=sys.stderr)
                await asyncio.sleep(1)


async def main():
    sem = asyncio.Semaphore(6)
    jobs = []
    for lang, voices in VOICES.items():
        ws = words(lang)
        for v in voices:
            short = v.split('-')[1] + '-' + v.split('-')[2].replace('Neural', '')
            for rname, rate in RATES.items():
                for w in ws:
                    jobs.append(synth(sem, w, v, rate, os.path.join(HERE, 'audio', lang, f'edge-{short}-{rname}', w + '.wav')))
    print(f'{len(jobs)} files')
    await asyncio.gather(*jobs)
    print('done')

asyncio.run(main())
