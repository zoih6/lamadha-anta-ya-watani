"""
make_geo.py
===========
Convert the real country GeoJSON outlines into simplified SVG path data
(equirectangular projection, Douglas-Peucker simplification) so the renderer
can draw an accurate - not hand-waved - map of the homeland in pure vector.
Outputs analysis/geo_paths.json
"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO = os.path.join(ROOT, "assets", "geo")
OUT = os.path.join(ROOT, "analysis", "geo_paths.json")

# Which outlines we want, and how aggressively to simplify each.
WANT = {
    "yemen": 0.006,
    "oman": 0.02,
    "jordan": 0.02,
    "iraq": 0.02,
    "egypt": 0.02,
    "sudan": 0.02,
    "eritrea": 0.02,
    "djibouti": 0.02,
    "iran": 0.02,
    "turkey": 0.02,
    "syria": 0.02,
    "lebanon": 0.02,
    "qatar": 0.02,
    "kuwait": 0.02,
}

# Reference window we draw (lon/lat) - centred on Yemen / the peninsula.
WIN = {"lon0": 32.0, "lon1": 60.0, "lat0": 11.5, "lat1": 34.5}
VB = {"w": 1000.0, "h": 1000.0}


def project(lon, lat):
    x = (lon - WIN["lon0"]) / (WIN["lon1"] - WIN["lon0"]) * VB["w"]
    # Mercator-ish vertical stretch keeps the peninsula from looking squashed
    lat0, lat1 = WIN["lat0"], WIN["lat1"]
    my0 = math.log(math.tan(math.pi / 4 + math.radians(lat0) / 2))
    my1 = math.log(math.tan(math.pi / 4 + math.radians(lat1) / 2))
    my = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    y = (my1 - my) / (my1 - my0) * VB["h"]
    return x, y


def rdp(pts, eps):
    """Douglas-Peucker"""
    if len(pts) < 3:
        return pts
    dmax, idx = 0.0, 0
    x1, y1 = pts[0]
    x2, y2 = pts[-1]
    dx, dy = x2 - x1, y2 - y1
    den = math.hypot(dx, dy) or 1e-12
    for i in range(1, len(pts) - 1):
        x0, y0 = pts[i]
        d = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / den
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        return rdp(pts[: idx + 1], eps)[:-1] + rdp(pts[idx:], eps)
    return [pts[0], pts[-1]]


def ring_to_path(coords, eps, min_area=1.5):
    pts = [project(c[0], c[1]) for c in coords]
    # GeoJSON rings are closed (first == last). Douglas-Peucker degenerates on a
    # closed ring (zero-length chord -> every distance measured as 0), so drop
    # the duplicated closing vertex first and re-close with Z afterwards.
    if len(pts) > 1 and abs(pts[0][0] - pts[-1][0]) < 1e-9 and abs(pts[0][1] - pts[-1][1]) < 1e-9:
        pts = pts[:-1]
    pts = rdp(pts, eps)
    if len(pts) < 4:
        return None
    # area filter (drop specks / tiny islands)
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    if abs(a) / 2 < min_area:
        return None
    d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + " Z"
    return d


def bbox_of(paths):
    xs, ys = [], []
    for d in paths:
        for tok in d[1:-2].split(" L"):
            x, y = tok.split(",")
            xs.append(float(x)); ys.append(float(y))
    return [round(min(xs), 1), round(min(ys), 1), round(max(xs), 1), round(max(ys), 1)]


def load(name):
    p = os.path.join(GEO, name + ".json")
    if not os.path.exists(p):
        return None
    d = json.load(open(p, encoding="utf-8"))
    feats = d["features"] if d.get("type") == "FeatureCollection" else [d]
    rings = []
    for f in feats:
        g = f.get("geometry") or {}
        t = g.get("type")
        if t == "Polygon":
            polys = [g["coordinates"]]
        elif t == "MultiPolygon":
            polys = g["coordinates"]
        else:
            continue
        for poly in polys:
            for ring in poly:
                rings.append(ring)
    return rings


def main():
    out = {"viewBox": f"0 0 {int(VB['w'])} {int(VB['h'])}", "window": WIN, "countries": {}}
    for name, eps in WANT.items():
        rings = load(name)
        if not rings:
            continue
        paths = []
        for r in rings:
            d = ring_to_path(r, eps)
            if d:
                paths.append(d)
        if paths:
            # keep the biggest few only
            def area(dstr):
                pts = [tuple(map(float, p.split(","))) for p in
                       dstr[1:-2].split(" L")]
                a = 0.0
                for i in range(len(pts)):
                    x1, y1 = pts[i]
                    x2, y2 = pts[(i + 1) % len(pts)]
                    a += x1 * y2 - x2 * y1
                return abs(a) / 2

            paths.sort(key=area, reverse=True)
            out["countries"][name] = paths[:4]
            print(f"  {name:10s} rings={len(rings)} kept={len(paths[:4])}")

    # combined neighbours path (context) - everything except yemen
    ctx = []
    for k, v in out["countries"].items():
        if k != "yemen":
            ctx += v
    out["context"] = ctx
    for k, v in list(out["countries"].items()):
        out["countries"][k] = {"paths": v, "bbox": bbox_of(v)}
    out["contextBBox"] = bbox_of(ctx)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    kb = os.path.getsize(OUT) / 1024
    print(f"[geo] wrote {OUT} ({kb:.1f} KB) countries={len(out['countries'])}")


if __name__ == "__main__":
    main()
