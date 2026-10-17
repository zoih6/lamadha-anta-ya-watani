# -*- coding: utf-8 -*-
"""
make_logo.py
============
Prepare the studio mark (استوديو ومض) for the end card:

  * crop the transparent padding off the supplied master
  * re-encode at a sane size, keeping the alpha channel intact
  * sample its own pixels into a point cloud, so the reveal can assemble the
    logo OUT OF its own colours instead of fading a flat PNG in

Outputs
  assets/brand/wamd_logo.png      the mark, alpha preserved
  analysis/logo_particles.json    {w,h,n, x[], y[], c[]} normalised 0..1
"""
import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.environ.get("LOGO", "/home/user/uploads/2.png")
OUTDIR = os.path.join(ROOT, "assets", "brand")
os.makedirs(OUTDIR, exist_ok=True)

TARGET_H = 900          # master kept large enough for any future 4K deliverable
GRID = 64               # particle sampling resolution
ALPHA_MIN = 120         # a cell counts as "part of the mark" above this

im = Image.open(SRC).convert("RGBA")
a = np.array(im).astype(np.float32)
alpha = a[..., 3]

ys, xs = np.where(alpha > 8)
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
print(f"[logo] master {im.size} -> content bbox {x1 - x0}x{y1 - y0} at ({x0},{y0})")

crop = im.crop((x0, y0, x1, y1))
cw, ch = crop.size
nh = TARGET_H
nw = max(1, round(cw * nh / ch))
crop = crop.resize((nw, nh), Image.LANCZOS)
logo_path = os.path.join(OUTDIR, "wamd_logo.png")
crop.save(logo_path, "PNG", optimize=True)
print(f"[logo] wrote {logo_path}  {nw}x{nh}  {os.path.getsize(logo_path)/1024:.0f} KB")

# ---------------------------------------------------------------- point cloud
g = np.array(crop).astype(np.float32)
H, Wd = nh, nw
cell_h = H / GRID
cell_w = Wd / GRID

px, py, pc = [], [], []
for gy in range(GRID):
    for gx in range(GRID):
        ya, yb = int(gy * cell_h), max(int(gy * cell_h) + 1, int((gy + 1) * cell_h))
        xa, xb = int(gx * cell_w), max(int(gx * cell_w) + 1, int((gx + 1) * cell_w))
        blk = g[ya:yb, xa:xb]
        if blk.size == 0:
            continue
        al = blk[..., 3]
        if al.mean() < ALPHA_MIN:
            continue
        rgb = blk[..., :3]
        m = al > 200
        col = rgb[m].mean(0) if m.any() else rgb.reshape(-1, 3).mean(0)
        px.append(round(((xa + xb) / 2) / Wd, 4))
        py.append(round(((ya + yb) / 2) / H, 4))
        pc.append("#%02X%02X%02X" % tuple(int(v) for v in np.clip(col, 0, 255)))

data = {"w": nw, "h": nh, "aspect": round(nw / nh, 4),
        "n": len(px), "x": px, "y": py, "c": pc}
out = os.path.join(ROOT, "analysis", "logo_particles.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False)
print(f"[logo] point cloud: {len(px)} particles from a {GRID}x{GRID} grid "
      f"({os.path.getsize(out)/1024:.0f} KB)")

# colour summary so the treatment can be reasoned about without seeing it
cc = np.array([[int(c[i:i + 2], 16) for i in (1, 3, 5)] for c in pc], dtype=float)
print(f"[logo] mean particle colour RGB {cc.mean(0).round(0)}  "
      f"luminance {(0.299*cc[:,0]+0.587*cc[:,1]+0.114*cc[:,2]).mean():.0f}")
