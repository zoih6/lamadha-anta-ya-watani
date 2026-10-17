# -*- coding: utf-8 -*-
"""
build_timeline.py
=================
The audio is the clock. This script takes:
  * the canonical poem (what the poet actually wrote)
  * every word Whisper detected, from all passes
and produces a frame-accurate, word-accurate timeline.

Method
------
1. pool every detected word from all transcription passes, in time order
2. normalise Arabic on both sides (strip tashkeel, unify alef/ya/ta-marbuta)
3. global monotone sequence alignment (Needleman-Wunsch) between the canonical
   word sequence and the detected word sequence
4. canonical words that were detected inherit the detected timing
5. canonical words that were missed are interpolated between their anchored
   neighbours, weighted by estimated syllable length
6. everything is finally clamped into its scene window

Output: timeline.json + lyrics.srt
"""
import json
import os
import re
import difflib
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AN = os.path.join(ROOT, "analysis")

# ------------------------------------------------------------------ the poem
# Only what is actually sung in THIS recording (verse 3 is not in the take).
POEM = [
    # (scene-id, [lines])
    ("s2", ["لِمَاذَا",
            "لَا أَرَى وَطَنًا",
            "وَلَا ظِلًّا",
            "وَلَا شَيْئًا يُسَمَّى أَنْتْ"]),
    ("s3", ["لِمَاذَا",
            "كُلُّ هَذَا الْحُزْنِ",
            "فِي قَلْبِي",
            "يُسَمَّى أَنْتْ"]),
    ("s4", ["لِمَاذَا",
            "أَنْتَ يَا وَطَنِي",
            "رَدِيفُ الْآهَةِ الْحَرَّى",
            "رَدِيفُ الْغُصَّةِ الْكُبْرَى",
            "رَدِيفُ مَوَاجِعِ الدُّنْيَا",
            "لِمَاذَا أَنْتْ"]),
    ("s5", ["لِمَاذَا",
            "أَنْتَ يَا وَطَنِي",
            "عَلَى الْأَيَّامِ مَصْلُوبٌ",
            "عَلَى الطُّرُقَاتِ مَسْفُوكٌ",
            "عَلَى الْأَنْقَاضِ مَشْنُوقٌ",
            "لِمَاذَا أَنْتْ"]),
    ("s6", ["لِمَاذَا",
            "كُلَّمَا أَبْكِي",
            "أَرَى وَجَعِي",
            "أَرَى جَزَعِي",
            "أَرَى دَمْعِي الَّذِي يَنْسَابُ مِنِّي أَنْتْ",
            "لِمَاذَا أَنْتْ"]),
]

# scene windows, cut from the measured audio (see analysis/_*.log)
SCENES = [
    dict(id="s1", start=0.00,  end=21.90, art="title",     cam="zoomIn",
         bg="s01_map_dust.png", bgOpacity=.40, bgFilter="brightness(1.70) contrast(1.05) saturate(.65)", type="title"),
    dict(id="s2", start=21.90, end=31.10, art="desert",    cam="panRight",
         bg="s02_lone_desert.png", bgOpacity=.50, bgFilter="brightness(.20) contrast(1.30) saturate(.30)", type="verse"),
    dict(id="s3", start=31.10, end=39.40, art="heart",     cam="beat",
         bg="s03_heart_chart.png", bgOpacity=.38, bgFilter="brightness(1.25) contrast(1.10) saturate(.60)", type="verse"),
    dict(id="s4", start=39.40, end=53.60, art="brutalist", cam="shake",
         bg="s05_brutalist.png", bgOpacity=.42, bgFilter="brightness(1.35) contrast(1.08) saturate(.70)", type="chorus", shakeGain=1.1),
    dict(id="s5", start=53.60, end=65.20, art="split3",    cam="split",
         bg="s06_isometric_ruins.png", bgOpacity=.40, bgFilter="brightness(.36) contrast(1.15) saturate(.55)", type="split"),
    dict(id="s6", start=65.20, end=89.20, art="tear",      cam="orbit",
         bg="s07_teardrop.png", bgOpacity=.44, bgFilter="brightness(1.15) contrast(1.05) saturate(.70)", type="verse"),
    dict(id="s7", start=89.20, end=104.00, art="collage",  cam="morph",
         bg="s04_faces_collage.png", bgOpacity=.34, bgFilter="brightness(1.20) contrast(1.05) saturate(.60)", type="instrumental"),
    dict(id="s8", start=104.00, end=113.00, art="bridge",  cam="drift",
         bg="s01_map_dust.png", bgOpacity=.26, bgFilter="brightness(1.60) contrast(1.05) saturate(.60)", type="instrumental"),
    dict(id="s9", start=113.00, end=116.21, art="final",   cam="zoomIn",
         bg=None, bgOpacity=0, bgFilter="none", type="outro"),
    dict(id="s10", start=116.21, end=123.21, art="logo",   cam="drift",
         bg=None, bgOpacity=0, bgFilter="none", type="endcard", typeShiftY=175),
]

# text that is not sung (title card, interlude, signature)
STATIC = {
    "s1": dict(
        lines=[dict(text="لِمَاذَا أَنْتَ..!!؟؟", size=132, style="title", revealAt=6.4,
                    kw=[3])],
        sub="رَاجِح المُحَمَّدِي", subSize=36, subAt=.42,
        meta="قَصِيدَة", metaAt=.30,
    ),
    "s7": dict(
        lines=[dict(text="أَنْتَ", size=96, style="kwonly", revealAt=2.2, kw=[0])],
        meta="مَقْطَعٌ مُوسِيقِيّ", metaAt=.10,
    ),
    "s8": dict(
        lines=[],
        meta="لِمَاذَا أَنْتَ", metaAt=.05,
    ),
    "s10": dict(
        lines=[dict(text="إنتاج وتصميم — استوديو ومض", size=42, style="caption", revealAt=3.7,
                    kw=[])],
        metaAt=.90,
    ),
    "s9": dict(
        lines=[dict(text="لِمَاذَا أَنْتَ..!!؟؟", size=118, style="title", revealAt=.6,
                    kw=[1, 3])],
        sub="رَاجِح المُحَمَّدِي", subSize=34, subAt=.35,
        meta="٢٠٢٦ / ١٠ / ١٧", metaAt=.55,
    ),
}

DUR = 116.208

# ---------------------------------------------------------------- normalising
TASHKEEL = re.compile(r"[ً-ْٰـؐ-ًؚ]")
NONLETTER = re.compile(r"[^ء-ي0-9]")


def norm(s):
    s = TASHKEEL.sub("", s)
    s = (s.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
          .replace("ٱ", "ا").replace("ى", "ي").replace("ة", "ه")
          .replace("ؤ", "و").replace("ئ", "ي"))
    s = NONLETTER.sub("", s)
    return s


def sim(a, b):
    if not a or not b:
        return 0.0
    r = difflib.SequenceMatcher(None, a, b).ratio()
    if a in b or b in a:
        r = max(r, 0.80 * min(len(a), len(b)) / max(len(a), len(b)) + 0.16)
    return r


def weight(w):
    """rough syllable cost of an Arabic word, for interpolating gaps"""
    n = len(NONLETTER.sub("", TASHKEEL.sub("", w)))
    longs = sum(1 for c in w if c in "اويآ")
    shadda = 1 if "ّ" in w else 0
    return max(0.5, n * 0.55 + longs * 0.5 + shadda * 0.6)


# ------------------------------------------------------------------- the pool
def pool_words():
    files = ["whisper.json", "whisper_merged.json", "whisper_head.json", "whisper_tail.json"]
    seen = []
    for f in files:
        p = os.path.join(AN, f)
        if not os.path.exists(p):
            continue
        d = json.load(open(p, encoding="utf-8"))
        for s in d.get("segments", []):
            for w in s.get("words", []):
                t = (w.get("w") or "").strip()
                if not t:
                    continue
                if norm(t) in ("موسيقى", ""):
                    continue                     # Whisper's "music" tag
                seen.append({"w": t, "s": w["s"], "e": w["e"],
                             "p": w.get("p", 0.5), "src": f})
    # de-duplicate: same normalised word starting within 0.25s -> keep best prob
    seen.sort(key=lambda x: x["s"])
    out = []
    for w in seen:
        if out and norm(out[-1]["w"]) == norm(w["w"]) and abs(out[-1]["s"] - w["s"]) < 0.35:
            if w["p"] > out[-1]["p"]:
                out[-1] = w
            continue
        out.append(w)
    return out


# ----------------------------------------------------------------- alignment
def align(canon, det):
    """NW alignment. canon/det are lists of dicts with 'n' (normalised)."""
    n, m = len(canon), len(det)
    GAP = -0.28
    S = [[0.0] * (m + 1) for _ in range(n + 1)]
    B = [[0] * (m + 1) for _ in range(n + 1)]      # 1 diag, 2 up, 3 left
    for i in range(1, n + 1):
        S[i][0] = S[i - 1][0] + GAP
        B[i][0] = 2
    for j in range(1, m + 1):
        S[0][j] = S[0][j - 1] + GAP * 0.35        # skipping detections is cheap
        B[0][j] = 3
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            sc = sim(canon[i - 1]["n"], det[j - 1]["n"])
            dg = S[i - 1][j - 1] + (sc * 1.6 - 0.62)   # match reward / mismatch
            up = S[i - 1][j] + GAP                     # canonical word not heard
            lf = S[i][j - 1] + GAP * 0.35              # detection we do not need
            best = max(dg, up, lf)
            S[i][j] = best
            B[i][j] = 1 if best == dg else (2 if best == up else 3)
    i, j = n, m
    pairs = []
    while i > 0 or j > 0:
        b = B[i][j]
        if i > 0 and j > 0 and b == 1:
            pairs.append((i - 1, j - 1))
            i -= 1; j -= 1
        elif i > 0 and (b == 2 or j == 0):
            i -= 1
        else:
            j -= 1
    pairs.reverse()
    return pairs


def main():
    det = pool_words()
    print(f"[pool] {len(det)} detected words")

    # ---- canonical word list (flat, with scene + line back-references)
    canon = []
    for sid, lines in POEM:
        for li, ln in enumerate(lines):
            for tok in ln.split():
                canon.append({"t": tok, "n": norm(tok), "sid": sid, "li": li})

    # restrict detections to the sung window
    sung0, sung1 = 21.0, 90.0
    deti = [d for d in det if sung0 - 2 <= d["s"] <= sung1 + 2]
    print(f"[pool] {len(deti)} inside the sung window")

    for d in deti:
        d["n"] = norm(d["w"])
    pairs = align(canon, deti)
    matched = 0
    for ci, di in pairs:
        c, d = canon[ci], deti[di]
        if sim(c["n"], d["n"]) >= 0.55:
            c["s"], c["e"], c["hit"] = d["s"], d["e"], d["w"]
            matched += 1
    print(f"[align] {matched}/{len(canon)} canonical words anchored to audio")

    # ---- interpolate the misses, per stanza
    byscene = defaultdict(list)
    for c in canon:
        byscene[c["sid"]].append(c)

    for sid, ws in byscene.items():
        anchors = [i for i, w in enumerate(ws) if "s" in w]
        if not anchors:
            continue
        # before the first anchor
        for i in range(0, anchors[0]):
            pass
        # between anchors
        segs = []
        prev = None
        for a in anchors:
            if prev is not None:
                segs.append((prev, a))
            prev = a
        for (a, b) in segs:
            t0, t1 = ws[a]["e"], ws[b]["s"]
            if t1 <= t0:
                t1 = t0 + 0.15
            tot = sum(weight(ws[k]["t"]) for k in range(a + 1, b))
            acc = 0.0
            for k in range(a + 1, b):
                wk = weight(ws[k]["t"])
                ws[k]["s"] = round(t0 + (t1 - t0) * (acc / tot), 3)
                acc += wk
                ws[k]["e"] = round(t0 + (t1 - t0) * (acc / tot), 3)
                ws[k]["interp"] = True
        # leading words before the first anchor: back-fill
        a = anchors[0]
        t0 = ws[a]["s"]
        tot = sum(weight(ws[k]["t"]) for k in range(0, a)) or 1
        span = min(2.6, tot * 0.30)
        acc = 0.0
        for k in range(0, a):
            wk = weight(ws[k]["t"])
            ws[k]["s"] = round(t0 - span + span * (acc / tot), 3)
            acc += wk
            ws[k]["e"] = round(t0 - span + span * (acc / tot), 3)
            ws[k]["interp"] = True
        # trailing words after the last anchor
        b = anchors[-1]
        t0 = ws[b]["e"]
        tot = sum(weight(ws[k]["t"]) for k in range(b + 1, len(ws))) or 1
        span = min(3.2, tot * 0.30)
        acc = 0.0
        for k in range(b + 1, len(ws)):
            wk = weight(ws[k]["t"])
            ws[k]["s"] = round(t0 + span * (acc / tot), 3)
            acc += wk
            ws[k]["e"] = round(t0 + span * (acc / tot), 3)
            ws[k]["interp"] = True

    # ---- sanity: monotonic + clamp inside the scene
    for sid, ws in byscene.items():
        sc = next(s for s in SCENES if s["id"] == sid)
        for w in ws:
            if "s" not in w:
                w["s"], w["e"] = sc["start"] + 0.5, sc["start"] + 1.2
            w["s"] = max(sc["start"] + 0.05, min(w["s"], sc["end"] - 0.15))
            w["e"] = max(w["s"] + 0.10, min(w["e"], sc["end"] - 0.02))
        # a word shorter than this cannot be read, so borrow room from the
        # silence on either side rather than flashing it for one frame
        MIN = 0.24
        for k in range(len(ws)):
            if ws[k]["e"] - ws[k]["s"] < MIN:
                need = MIN - (ws[k]["e"] - ws[k]["s"])
                prev_end = ws[k - 1]["e"] if k > 0 else sc["start"]
                next_st = ws[k + 1]["s"] if k + 1 < len(ws) else sc["end"]
                tb = min(need / 2, max(0.0, ws[k]["s"] - prev_end))
                ws[k]["s"] -= tb
                need -= tb
                ta = min(need, max(0.0, next_st - ws[k]["e"]))
                ws[k]["e"] += ta
        for k in range(1, len(ws)):
            if ws[k]["s"] < ws[k - 1]["e"] - 0.02:
                ws[k]["s"] = ws[k - 1]["e"]
                if ws[k]["e"] <= ws[k]["s"]:
                    ws[k]["e"] = ws[k]["s"] + 0.14

    # ------------------------------------------------------------ build scenes
    def is_kw(tok):
        return norm(tok).endswith("نت") and len(norm(tok)) <= 4

    scenes = []
    for sc in SCENES:
        s = dict(sc)
        s["__in"] = {"s9": 0.30, "s10": 0.55}.get(sc["id"], 0.42)
        s["__out"] = {"s9": 0.35, "s10": 0.00}.get(sc["id"], 0.42)
        s["size"] = {"s4": 96, "s5": 74, "s6": 78, "s10": 42}.get(sc["id"], 86)
        s["lineGap"] = {"s4": 2, "s5": 8}.get(sc["id"], 6)
        s["vig"] = 1.0
        if sc["id"] in byscene:
            ws = byscene[sc["id"]]
            lines = []
            for li, ln in enumerate(dict(POEM)[sc["id"]]):
                toks = ln.split()
                lw = [w for w in ws if w["li"] == li]
                words = []
                for ti, tok in enumerate(toks):
                    m = lw[ti] if ti < len(lw) else None
                    words.append({
                        "t": tok,
                        "s": round(m["s"], 3) if m else None,
                        "e": round(m["e"], 3) if m else None,
                        "k": is_kw(tok),
                    })
                st = min(w["s"] for w in words if w["s"] is not None) if any(w["s"] is not None for w in words) else None
                en = max(w["e"] for w in words if w["e"] is not None) if any(w["e"] is not None for w in words) else None
                lines.append({"text": ln, "words": words, "start": st, "end": en,
                              "size": s["size"], "revealAt": None})
            s["lines"] = lines
        else:
            st = STATIC.get(sc["id"], {"lines": []})
            lines = []
            for ln in st["lines"]:
                toks = ln["text"].split()
                kwi = set(ln.get("kw", []))
                words = [{"t": tk, "s": None, "e": None, "k": (i in kwi) or is_kw(tk)}
                         for i, tk in enumerate(toks)]
                lines.append({"text": ln["text"], "words": words,
                              "size": ln.get("size", 86), "style": ln.get("style", ""),
                              "revealAt": ln.get("revealAt", 0.4)})
            s["lines"] = lines
            for k in ("sub", "subSize", "subAt", "meta", "metaAt"):
                if k in st:
                    s[k] = st[k]
        scenes.append(s)

    tl = {"video": {"width": 1920, "height": 1080, "fps": 25, "duration": DUR},
          "scenes": scenes}
    with open(os.path.join(ROOT, "timeline.json"), "w", encoding="utf-8") as f:
        json.dump(tl, f, ensure_ascii=False, indent=1)

    # -------------------------------------------------------------------- SRT
    def tc(x):
        h = int(x // 3600); m = int((x % 3600) // 60); s = x % 60
        return f"{h:02d}:{m:02d}:{int(s):02d},{int(round((s % 1) * 1000)):03d}"

    srt, n = [], 0
    for sc in scenes:
        for ln in sc["lines"]:
            ws = [w for w in ln["words"] if w["s"] is not None]
            if not ws:
                continue
            n += 1
            a, b = min(w["s"] for w in ws), max(w["e"] for w in ws)
            srt.append(f"{n}\n{tc(a)} --> {tc(b)}\n{ln['text']}\n")
    with open(os.path.join(ROOT, "lyrics.srt"), "w", encoding="utf-8") as f:
        f.write("\n".join(srt))

    print(f"[timeline] wrote timeline.json ({len(scenes)} scenes) + lyrics.srt ({n} cues)")
    for sc in scenes:
        nw = sum(len(l["words"]) for l in sc["lines"])
        print(f"   {sc['id']} {sc['start']:7.2f}->{sc['end']:7.2f} "
              f"({sc['end']-sc['start']:5.2f}s) art={sc['art']:10s} words={nw}")


if __name__ == "__main__":
    main()
