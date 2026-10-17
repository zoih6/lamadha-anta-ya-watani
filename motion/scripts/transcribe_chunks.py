"""
transcribe_chunks.py
====================
Second, exhaustive pass: transcribe the track in overlapping windows so that
no sung region is skipped (a single global pass dropped ~25s of vocals).

Merges with the global pass (analysis/whisper.json) and writes
analysis/whisper_merged.json
"""
import json
import os
import subprocess
import sys

from faster_whisper import WhisperModel

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AN = os.path.join(ROOT, "analysis")
WAV = "/tmp/audio16k.wav"
MODEL = os.environ.get("WHISPER_MODEL", "medium")

WIN = float(os.environ.get("WIN", "26"))     # window seconds
HOP = float(os.environ.get("HOP", "22"))     # hop seconds
T0 = float(os.environ.get("START", "0"))     # analyse from
T1 = float(os.environ.get("END", "-1"))      # analyse to (-1 = whole file)
OUTF = os.environ.get("OUTF", "whisper_merged.json")

INIT = (
    "لماذا لا أرى وطنا ولا ظلا ولا شيئا يسمى أنت. "
    "لماذا كل هذا الحزن في قلبي يسمى أنت. "
    "لماذا لا أرى الآهات والآلام إلا أنت. "
    "أنت يا وطني رديف الآهة الحرى، رديف الغصة الكبرى، رديف مواجع الدنيا. "
    "على الأيام مصلوب، على الطرقات مسفوك، على الأنقاض مشنوق. "
    "كلما أبكي أرى وجعي، أرى جزعي، أرى دمعي الذي ينساب مني أنت."
)


def dur_of(path):
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", path]
    )
    return float(out.decode().strip())


def main():
    full = dur_of(WAV)
    total = full if T1 < 0 else min(T1, full)
    print(f"[chunk] range={T0:.2f}->{total:.2f}s model={MODEL} win={WIN} hop={HOP}")
    model = WhisperModel(MODEL, device="cpu", compute_type="int8", cpu_threads=2)

    segs = []
    t = T0
    idx = 0
    while t < total - 1.0:
        end = min(t + WIN, total)
        tmp = f"/tmp/chunk_{idx:03d}.wav"
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-ss", f"{t}", "-t", f"{end - t}",
             "-i", WAV, "-ar", "16000", "-ac", "1", tmp],
            check=True,
        )
        s_iter, info = model.transcribe(
            tmp,
            language="ar",
            beam_size=3,
            word_timestamps=True,
            vad_filter=False,
            initial_prompt=INIT,
            condition_on_previous_text=False,
            temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
            no_speech_threshold=0.9,
            log_prob_threshold=-1.2,
        )
        n = 0
        for s in s_iter:
            txt = (s.text or "").strip()
            if not txt:
                continue
            if s.no_speech_prob > 0.75:
                continue
            if s.avg_logprob < -1.1:
                continue
            words = []
            for w in (s.words or []):
                if not w.word:
                    continue
                words.append({
                    "w": w.word.strip(),
                    "s": round(float(w.start) + t, 3),
                    "e": round(float(w.end) + t, 3),
                    "p": round(float(w.probability), 3),
                })
            if not words:
                continue
            segs.append({
                "src": f"chunk{idx:03d}",
                "start": round(float(s.start) + t, 3),
                "end": round(float(s.end) + t, 3),
                "text": txt,
                "avgLogprob": round(float(s.avg_logprob), 3),
                "noSpeechProb": round(float(s.no_speech_prob), 3),
                "words": words,
            })
            n += 1
        print(f"  [{t:6.2f}->{end:6.2f}] chunk{idx:03d}: {n} segs")
        os.remove(tmp)
        t += HOP
        idx += 1

    # ---- merge with global pass
    gp = os.path.join(AN, os.environ.get("MERGE", "whisper.json"))
    if gp and os.path.exists(gp):
        g = json.load(open(gp, encoding="utf-8"))
        for s in g.get("segments", []):
            segs.append({
                "src": "global",
                "start": s["start"], "end": s["end"], "text": s["text"],
                "avgLogprob": s.get("avgLogprob", 0),
                "noSpeechProb": s.get("noSpeechProb", 0),
                "words": s.get("words", []),
            })

    segs.sort(key=lambda s: (s["start"], -(s["avgLogprob"] or 0)))

    # ---- de-duplicate overlapping segments: keep the higher-confidence one
    kept = []
    for s in segs:
        dup = False
        for k in kept:
            ov = min(s["end"], k["end"]) - max(s["start"], k["start"])
            if ov > 0.6 * min(s["end"] - s["start"], k["end"] - k["start"]):
                dup = True
                if (s["avgLogprob"] or -9) > (k["avgLogprob"] or -9):
                    k.update(s)
                break
        if not dup:
            kept.append(s)
    kept.sort(key=lambda s: s["start"])

    out = {"duration": round(total, 3), "segments": kept}
    with open(os.path.join(AN, OUTF), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    nw = sum(len(s["words"]) for s in kept)
    print(f"[chunk] kept {len(kept)} segments / {nw} words")
    for s in kept:
        print(f"  {s['start']:7.2f}->{s['end']:7.2f} [{s['src']}] {s['text']}")


if __name__ == "__main__":
    main()
