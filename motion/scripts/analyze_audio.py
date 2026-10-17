"""
1_analyze_audio.py
==================
Deep analysis of the Suno track for "لماذا أنت يا وطني" (راجح المحمدي).

Produces:
  analysis/whisper.json   -> raw faster-whisper segments + word timestamps
  analysis/beats.json     -> tempo, beat grid, onset envelope, section boundaries
  analysis/vocal.json     -> rough vocal-activity envelope (upper-midband energy)

The AUDIO IS THE AUTHORITATIVE CLOCK. Nothing from the written storyboard
is trusted for timing; scene boundaries are re-derived here.
"""
import json
import os
import sys
import math
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO = sys.argv[1] if len(sys.argv) > 1 else "/home/user/repo/audio.mp3"
WAV16 = "/tmp/audio16k.wav"
OUT = os.path.join(ROOT, "analysis")
os.makedirs(OUT, exist_ok=True)

MODEL = os.environ.get("WHISPER_MODEL", "medium")
DEVICE = "cpu"
COMPUTE = "int8"


# ----------------------------------------------------------------------------- librosa
def analyse_signal():
    import librosa

    y, sr = librosa.load(WAV16, sr=16000, mono=True)
    dur = len(y) / sr

    # ---- tempo + beat grid
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="frames", tightness=100)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    tempo = float(np.atleast_1d(tempo)[0])

    # ---- onset strength envelope (for micro-timing / kinetic hits)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=512)
    onset_times = librosa.frames_to_time(np.arange(len(onset_env)), sr=sr, hop_length=512)
    onsets = librosa.onset.onset_detect(
        y=y, sr=sr, hop_length=512, backtrack=True, delta=0.25, units="time"
    )

    # ---- vocal-ish activity: energy in 300-3400 Hz (speech formant band)
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=512)) ** 2
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    band = (freqs >= 300) & (freqs <= 3400)
    vocal = S[band].mean(axis=0)
    vocal_db = librosa.power_to_db(vocal + 1e-10, ref=np.max)
    v_times = librosa.frames_to_time(np.arange(len(vocal_db)), sr=sr, hop_length=512)

    # smooth
    k = 9
    ker = np.ones(k) / k
    vocal_s = np.convolve(vocal_db, ker, mode="same")

    thr = np.percentile(vocal_s, 35)
    active = vocal_s > thr
    # run-length -> segments
    segs = []
    i = 0
    while i < len(active):
        if active[i]:
            j = i
            while j + 1 < len(active) and active[j + 1]:
                j += 1
            if (j - i) * (v_times[1] - v_times[0]) > 0.35:
                segs.append([round(float(v_times[i]), 3), round(float(v_times[j]), 3)])
            i = j + 1
        else:
            i += 1

    # ---- loudness curve (normalized 0..1) for "intensity" driven motion
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
    rms_t = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=512)
    rms_n = (rms - rms.min()) / (np.maximum(rms.max() - rms.min(), 1e-9))

    # downsample curves to ~20 Hz to keep the JSON small
    step = max(1, int(round(len(rms_n) / (dur * 20))))
    curves = {
        "duration": round(float(dur), 3),
        "hopSec": round(float(rms_t[1] - rms_t[0]) * step, 5),
        "rms": [round(float(v), 4) for v in rms_n[::step]],
        "vocal": [round(float((v + 80) / 80), 4) for v in vocal_s[::step]],
    }

    beats = {
        "duration": round(float(dur), 3),
        "tempo": round(tempo, 2),
        "beatTimes": [round(float(t), 3) for t in beat_times],
        "onsetTimes": [round(float(t), 3) for t in onsets],
        "vocalSegments": segs,
        "curves": curves,
    }
    with open(os.path.join(OUT, "beats.json"), "w", encoding="utf-8") as f:
        json.dump(beats, f, ensure_ascii=False, indent=1)
    print(f"[beats] dur={dur:.2f}s tempo={tempo:.1f} beats={len(beat_times)} "
          f"onsets={len(onsets)} vocalSegs={len(segs)}")
    return beats


# ----------------------------------------------------------------------------- whisper
def transcribe():
    from faster_whisper import WhisperModel

    print(f"[whisper] loading model={MODEL} device={DEVICE} compute={COMPUTE} ...")
    model = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE, cpu_threads=2)

    init = (
        "لماذا لا أرى وطنا ولا ظلا ولا شيئا يسمى أنت. "
        "لماذا كل هذا الحزن في قلبي يسمى أنت. "
        "لماذا لا أرى الآهات والآلام إلا أنت. "
        "أنت يا وطني رديف الآهة الحرى، رديف الغصة الكبرى، رديف مواجع الدنيا. "
        "على الأيام مصلوب، على الطرقات مسفوك، على الأنقاض مشنوق. "
        "كلما أبكي أرى وجعي، أرى جزعي، أرى دمعي الذي ينساب مني أنت."
    )

    print("[whisper] transcribing (this is the slow part) ...")
    segments, info = model.transcribe(
        WAV16,
        language="ar",
        beam_size=5,
        word_timestamps=True,
        vad_filter=False,
        initial_prompt=init,
        condition_on_previous_text=False,
        temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
        no_speech_threshold=0.9,
        log_prob_threshold=-1.2,
        compression_ratio_threshold=2.8,
    )

    out = {
        "language": info.language,
        "languageProbability": round(float(info.language_probability), 4),
        "duration": round(float(info.duration), 3),
        "segments": [],
    }
    for s in segments:
        out["segments"].append(
            {
                "id": s.id,
                "start": round(float(s.start), 3),
                "end": round(float(s.end), 3),
                "text": s.text,
                "avgLogprob": round(float(s.avg_logprob), 3),
                "noSpeechProb": round(float(s.no_speech_prob), 3),
                "words": [
                    {
                        "w": (w.word or "").strip(),
                        "s": round(float(w.start), 3),
                        "e": round(float(w.end), 3),
                        "p": round(float(w.probability), 3),
                    }
                    for w in (s.words or [])
                ],
            }
        )

    with open(os.path.join(OUT, "whisper.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    nw = sum(len(s["words"]) for s in out["segments"])
    print(f"[whisper] lang={out['language']} segs={len(out['segments'])} words={nw}")
    for s in out["segments"]:
        print(f"   {s['start']:7.2f} -> {s['end']:7.2f}  {s['text']}")
    return out


if __name__ == "__main__":
    if not os.path.exists(WAV16):
        os.system(f"ffmpeg -y -v error -i {AUDIO} -ac 1 -ar 16000 -c:a pcm_s16le {WAV16}")
    mode = sys.argv[2] if len(sys.argv) > 2 else "all"
    if mode in ("all", "beats"):
        analyse_signal()
    if mode in ("all", "whisper"):
        transcribe()
    print("[done] analysis/ written")
