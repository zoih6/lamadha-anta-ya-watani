"""
make_textures.py
================
Bake the film grain / paper texture ONCE into small tiles.

Why: animating an SVG feTurbulence filter forces Chromium to re-evaluate the
filter on every single frame (~2900 frames) which is ruinously slow. A static
tile that we pan around per frame is visually equivalent and essentially free.
"""
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "tex")
os.makedirs(OUT, exist_ok=True)

rng = np.random.default_rng(20261017)


def grain(size=320, alpha=0.55):
    # monochrome fractal-ish noise: blur white noise at two scales and mix
    a = rng.random((size, size)).astype(np.float32)
    b = rng.random((size // 4, size // 4)).astype(np.float32)
    b = np.repeat(np.repeat(b, 4, 0), 4, 1)
    c = rng.random((size // 16, size // 16)).astype(np.float32)
    c = np.repeat(np.repeat(c, 16, 0), 16, 1)
    n = 0.62 * a + 0.28 * b + 0.10 * c
    n = (n - n.min()) / (n.max() - n.min())
    g = (128 + (n - 0.5) * 200).astype(np.uint8)
    img = np.zeros((size, size, 4), np.uint8)
    img[..., 0] = img[..., 1] = img[..., 2] = g
    img[..., 3] = np.full((size, size), int(255 * alpha), np.uint8)
    return Image.fromarray(img, "RGBA")


def paper(size=512):
    """ fibrous paper / cloth weave texture (subtle, for the collage scenes) """
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    fib = np.sin(x * 0.9) * 0.5 + np.sin(y * 0.7 + x * 0.05) * 0.5
    blotch = rng.random((size // 8, size // 8)).astype(np.float32)
    blotch = np.repeat(np.repeat(blotch, 8, 0), 8, 1)
    n = 0.5 + 0.22 * fib + 0.28 * (blotch - 0.5)
    n = np.clip(n, 0, 1)
    g = (n * 255).astype(np.uint8)
    img = np.zeros((size, size, 4), np.uint8)
    img[..., 0] = img[..., 1] = img[..., 2] = g
    img[..., 3] = 46
    return Image.fromarray(img, "RGBA")


def fibres(size=900):
    """ sparse long fibres / scratches for the grunge pass """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    for _ in range(260):
        x, y = rng.integers(0, size, 2)
        L = int(rng.integers(20, 190))
        ang = float(rng.random() * np.pi)
        v = int(rng.integers(30, 120))
        for i in range(L):
            xx = int(x + np.cos(ang) * i)
            yy = int(y + np.sin(ang) * i)
            if 0 <= xx < size and 0 <= yy < size:
                a = int(70 * (1 - i / L))
                px[xx, yy] = (v, v, v, a)
    return img


def main():
    grain().save(os.path.join(OUT, "grain.png"))
    paper().save(os.path.join(OUT, "paper.png"))
    fibres().save(os.path.join(OUT, "fibres.png"))
    for f in ("grain.png", "paper.png", "fibres.png"):
        p = os.path.join(OUT, f)
        print(f"  {f:12s} {os.path.getsize(p)/1024:7.1f} KB")


if __name__ == "__main__":
    main()
