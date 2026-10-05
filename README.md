# Speech Trainer / Spraaktrainer

A browser app for practising speech, made for people with a hearing impairment who follow speech therapy.
Everything you say is shown **visually**, in Dutch or English.

**Open the app:** https://vgroenhuis.github.io/SpeechTrainer/ (use Chrome or Edge for word recognition)

## What it does

- **Explore sounds** – live view of your voice:
  - type of sound in colour: vowel, hiss (s, sh, f), buzz (z, v), burst (p, t, k), hum (m, n)
  - voice on/off (vocal folds) with pitch, loudness meter
  - scrolling spectrogram
  - vowel map: a dot shows where your tongue is (front/back, open/closed)
- **Practise words** – a word is shown, you say it, and you get:
  - a score out of 100 (word recognised + sounds in the right order + vowel quality)
  - a ✓ / ~ / ✗ per sound, concrete tips ("open your mouth a bit more", "the k was very soft…")
  - your vowel on the vowel map next to the target
  - the recording as a picture with the detected sounds, and playback (normal or slow) with a moving marker
- **Example voice** – 🔊 plays a natural male or female voice saying the word and analyses it the same way,
  so you can compare its picture and vowel position (◆) with your own attempt (★)
- **Detected sounds in IPA** under the spectrogram (live and in recordings), guessed from the sound alone,
  before matching to the word; F1/F2 lines drawn in the spectrogram
- **Sound details** – the raw measurements behind each letter (voicing and pitch, loudness, F1/F2 with meaning,
  spectral centre of gravity, energy per frequency band, and a mini spectrum). These follow the microphone,
  the playback marker, or the mouse over a recording
- Vowel map with Hz axes: F2 (tongue front/back) horizontally, F1 (mouth open/closed) vertically
- With voice setting **Automatic**, the app learns the size of your vocal tract from your attempts,
  so the vowel targets fit your voice.

Privacy: the sound analysis runs entirely in your browser. Only the "word recognised" part uses the
browser's online speech recognition (Google in Chrome, Microsoft in Edge).

This is a practice aid, not a replacement for your speech therapist.

## Run locally

Double-click `start.bat` (needs Python), or run any static web server in this folder and open
`http://localhost:8765/`. Microphone and word recognition need `http://localhost` or `https://`, not `file://`.

## How the analysis works

`analysis.js` (shared by the app and the tests) works at 16 kHz in 10 ms frames:

1. **Frame features:** FFT band energies, normalised-autocorrelation pitch, and LPC formants (roots of an
   order-10 predictor at 8 kHz).
2. **Frame labels:** silence / vowel / hum / voiceless noise / voiced noise, with rules for creaky voice and
   closure voicing.
3. **Segments:** noise is split into bursts and hisses using position, duration and how the level develops
   (bursts start at full strength, hisses swell up). The burst place (p/t/k) comes from the release spectrum,
   and place feedback is only given when the classifier is confident.
4. **Scoring:** the detected segments are weighted-aligned to the target sounds. The vowel is compared with
   accent-aware formant prototypes (`data.js`), scaled to the speaker.

## Test bench

The detection is tested on synthesised speech: 13 voices (Windows voices plus Microsoft Edge neural voices,
Dutch from the Netherlands and Belgium, and English), normal and slow, with three levels of room noise.

```
powershell -File test\make-audio-windows.ps1      # English, Windows voices (offline)
pip install edge-tts soundfile
python test\make-audio-edge.py                    # Dutch + English, Edge voices (needs internet)
node test\run-tests.js                            # all languages and noise levels
node test\run-tests.js --lang nl --noise room --verbose
node test\run-tests.js --dump kat --voice Maarten-normal   # frame-by-frame features of one recording
```

`test/explore*.js` print the statistics used to choose the thresholds (`explore-guess.js` for the IPA labels).

The example recordings in `ref/` come from `python tools/make-reference-audio.py` (Edge TTS).

Results (room noise):

| | consonants detected | p/t/k place | vowel identified | correct-word score |
|---|---|---|---|---|
| English | 96% | 76% | 57% | 79 |
| Dutch | 96% | 73% | 51% | 81 |

Known limits: unaspirated Dutch p/t/k at the start of a word are hard to see in the sound, so they are judged
leniently ("~"). Neighbouring vowels (Dutch o/ɔ, i/ɪ/e) are hard to tell apart from a single measurement.
Word recognition in the browser covers part of this.
