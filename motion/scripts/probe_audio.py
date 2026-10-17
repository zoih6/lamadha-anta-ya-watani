"""
probe_audio.py - diagnostic: where is the energy / the voice in this track?
"""
import json
import librosa
import numpy as np

y, sr = librosa.load("/tmp/audio16k.wav", sr=16000, mono=True)
dur = len(y) / sr
print(f"duration {dur:.2f}s")

# 1) loudness per second
sec = 1.0
n = int(dur / sec)
rows = []
for i in range(n):
    a = int(i * sr)
    b = int((i + 1) * sr)
    r = float(np.sqrt((y[a:b] ** 2).mean()))
    rows.append(r)
mx = max(rows) or 1
print("\n--- loudness per second (0-9 scale) ---")
for i in range(0, n, 5):
    chunk = rows[i : i + 5]
    bar = "".join(str(min(9, int(v / mx * 9))) for v in chunk)
    print(f"{i:4d}s |{bar}| {sum(chunk)/len(chunk):.4f}")

# 2) spectral profile: is there a voice band?
S = np.abs(librosa.stft(y, n_fft=2048, hop_length=512)) ** 2
freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
bands = {
    "sub  0-120": (0, 120),
    "bass 120-300": (120, 300),
    "voice 300-3400": (300, 3400),
    "pres 3400-6000": (3400, 6000),
    "air  6000-8000": (6000, 8000),
}
print("\n--- energy distribution ---")
tot = S.sum()
for name, (lo, hi) in bands.items():
    m = (freqs >= lo) & (freqs < hi)
    print(f"  {name:16s} {S[m].sum()/tot*100:5.1f}%")

# 3) vocal segments already computed
try:
    b = json.load(open("/home/user/vox-why-you/analysis/beats.json"))
    segs = b["vocalSegments"]
    print(f"\n--- {len(segs)} vocal segments ---")
    # merge gaps < 0.35
    merged = []
    for s in segs:
        if merged and s[0] - merged[-1][1] < 0.4:
            merged[-1][1] = s[1]
        else:
            merged.append(list(s))
    print(f"merged -> {len(merged)}")
    for s in merged:
        print(f"   {s[0]:7.2f} -> {s[1]:7.2f}  ({s[1]-s[0]:5.2f}s)")
except Exception as e:
    print("beats.json err", e)
