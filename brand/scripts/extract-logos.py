#!/usr/bin/env python3
"""Extract the logo geometry from the designer's source artwork into src/logo/geometry.ts.

Usage: pnpm extract:logos   (then: pnpm build:logos)
Needs poppler (pdftocairo) on PATH. Rerun only when a source file changes.

Stick to Accounting comes from source/sta-artwork.ai (the designer's "STA_artwork share.ai").
pdftocairo exports it with the Illustrator transparency rebuilt as masks, filters and bitmaps; this script follows those
references back to the original vector paths and bakes every transform into plain absolute
coordinates. The tape's photographic crinkle is dropped: the tape is a flat shape.
The Rest Is Accountancy comes from source/tria-wordmark.svg, the designer's SVG export.

The geometry is the single source for the logo: the React components draw from it, and
scripts/build-logos.mjs renders those components into the SVG files in assets/logos/.
"""
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "logo" / "geometry.ts"
STA_SOURCE = ROOT / "source" / "sta-artwork.ai"
TRIA_SOURCE = ROOT / "source" / "tria-wordmark.svg"

SVG_NS = "{http://www.w3.org/2000/svg}"
XLINK = "{http://www.w3.org/1999/xlink}href"
CAIRO_TAPE = "rgb(96.862793%, 83.529663%, 16.470337%)"
CAIRO_INK = "rgb(13.725281%, 12.156677%, 12.548828%)"

# ---------- path geometry ----------

TOKEN = re.compile(r"[MmLlHhVvCcSsQqTtZzAa]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")
ARITY = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "Z": 0}


def parse(d):
    """Path data -> absolute segments [(cmd, [points])] using only M, L, C, Q and Z."""
    toks = TOKEN.findall(d)
    segs, i = [], 0
    cx = cy = sx = sy = 0.0
    prev_ctrl = None
    prev_q = None
    cmd = None
    while i < len(toks):
        if re.match(r"[A-Za-z]", toks[i]):
            cmd = toks[i]
            i += 1
            if cmd in "Zz":
                segs.append(("Z", []))
                cx, cy = sx, sy
                prev_ctrl = None
                continue
        if cmd in "Aa":
            raise ValueError("arc commands are not expected in logo artwork")
        n = ARITY[cmd.upper()]
        vals = [float(v) for v in toks[i:i + n]]
        i += n
        rel = cmd.islower()
        up = cmd.upper()
        if up == "M":
            x, y = vals
            if rel:
                x, y = cx + x, cy + y
            segs.append(("M", [(x, y)]))
            cx, cy = sx, sy = x, y
            cmd = "l" if rel else "L"
            prev_ctrl = None
        elif up in "LHV":
            if up == "H":
                x, y = (cx + vals[0] if rel else vals[0]), cy
            elif up == "V":
                x, y = cx, (cy + vals[0] if rel else vals[0])
            else:
                x, y = vals
                if rel:
                    x, y = cx + x, cy + y
            segs.append(("L", [(x, y)]))
            cx, cy = x, y
            prev_ctrl = None
        elif up in "CS":
            if up == "C":
                p = [(vals[0], vals[1]), (vals[2], vals[3]), (vals[4], vals[5])]
            else:
                c1 = (2 * cx - prev_ctrl[0], 2 * cy - prev_ctrl[1]) if prev_ctrl else (cx, cy)
                p = [None, (vals[0], vals[1]), (vals[2], vals[3])]
            if rel:
                p = [None if q is None else (cx + q[0], cy + q[1]) for q in p]
            if up == "S":
                p[0] = c1
            segs.append(("C", p))
            prev_ctrl = p[1]
            cx, cy = p[2]
        elif up in "QT":
            if up == "Q":
                q1, end = (vals[0], vals[1]), (vals[2], vals[3])
                if rel:
                    q1, end = (cx + q1[0], cy + q1[1]), (cx + end[0], cy + end[1])
            else:
                end = (cx + vals[0], cy + vals[1]) if rel else (vals[0], vals[1])
                q1 = (2 * cx - prev_q[0], 2 * cy - prev_q[1]) if prev_q else (cx, cy)
            # A quadratic is exactly the cubic whose controls sit two thirds of the way to q1.
            c1 = (cx + 2 / 3 * (q1[0] - cx), cy + 2 / 3 * (q1[1] - cy))
            c2 = (end[0] + 2 / 3 * (q1[0] - end[0]), end[1] + 2 / 3 * (q1[1] - end[1]))
            segs.append(("C", [c1, c2, end]))
            prev_q = q1
            prev_ctrl = None
            cx, cy = end
            continue
        if up not in "QT":
            prev_q = None
    return segs


def transform(segs, m):
    a, b, c, d, e, f = m
    return [(cmd, [(a * x + c * y + e, b * x + d * y + f) for x, y in pts]) for cmd, pts in segs]


def bbox(segs):
    """Exact bounds: sample each cubic, not just its control points."""
    xs, ys = [], []
    cur = (0.0, 0.0)
    for cmd, pts in segs:
        if cmd == "C":
            p0, p1, p2, p3 = cur, *pts
            for k in range(25):
                t = k / 24
                mt = 1 - t
                xs.append(mt**3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t**3 * p3[0])
                ys.append(mt**3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t**3 * p3[1])
            cur = pts[2]
        elif pts:
            xs.append(pts[0][0])
            ys.append(pts[0][1])
            cur = pts[0]
    return min(xs), min(ys), max(xs), max(ys)


def union(boxes):
    return min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)


def fmt(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s == "-0" else s


def to_d(segs, ox, oy):
    out = []
    for cmd, pts in segs:
        out.append(cmd + " ".join(f"{fmt(x - ox)} {fmt(y - oy)}" for x, y in pts))
    return "".join(out)


# ---------- Stick to Accounting ----------

def mat(t):
    if not t:
        return (1, 0, 0, 1, 0, 0)
    kind, args = re.match(r"(\w+)\(([^)]*)\)", t).groups()
    v = [float(x) for x in re.split(r"[ ,]+", args.strip())]
    if kind == "matrix":
        return tuple(v)
    if kind == "translate":
        return (1, 0, 0, 1, v[0], v[1] if len(v) > 1 else 0)
    if kind == "scale":
        return (v[0], 0, 0, v[1] if len(v) > 1 else v[0], 0, 0)
    raise ValueError(t)


def mul(a, b):
    return (a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3],
            a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5])


def sta_paths():
    """Every filled vector path in the artwork, with its colour and resolved transform."""
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / "sta.svg"
        subprocess.run(["pdftocairo", "-svg", str(STA_SOURCE), str(target)], check=True)
        root = ET.parse(target).getroot()
    ids = {el.get("id"): el for el in root.iter() if el.get("id")}
    found, seen = [], set()

    def ref(attr):
        m = re.match(r"url\(#([^)]+)\)", attr or "")
        return ids.get(m.group(1)) if m else None

    def walk(el, ctm, depth):
        tag = el.tag.replace(SVG_NS, "")
        if depth > 60 or tag in ("image", "filter", "clipPath", "rect", "defs"):
            return
        local = mul(ctm, mat(el.get("transform")))
        if tag == "path":
            fill = el.get("fill")
            if fill in (CAIRO_TAPE, CAIRO_INK, "rgb(100%, 100%, 100%)"):
                key = (el.get("d"), tuple(round(v, 4) for v in local))
                if key not in seen:
                    seen.add(key)
                    found.append((fill, transform(parse(el.get("d")), local)))
            return
        if tag == "use":
            target_el = ids.get((el.get(XLINK) or "").lstrip("#"))
            if target_el is not None:
                walk(target_el, mul(local, (1, 0, 0, 1, float(el.get("x", 0)), float(el.get("y", 0)))), depth + 1)
            return
        filt = ref(el.get("filter"))
        if filt is not None:
            for fe in filt.iter(SVG_NS + "feImage"):
                img = ids.get((fe.get(XLINK) or "").lstrip("#"))
                if img is not None:
                    walk(img, local, depth + 1)
        mask = ref(el.get("mask"))
        if mask is not None:
            for ch in mask:
                walk(ch, local, depth + 1)
        for ch in el:
            walk(ch, local, depth + 1)

    for ch in root:
        walk(ch, (1, 0, 0, 1, 0, 0), 1)
    return found


def sta_parts():
    """Split the ink-on-white lockup (lower artboard half) into tape, label, wordmark, tagline."""
    lower = [(f, s, bbox(s)) for f, s in sta_paths() if bbox(s)[1] > 540]
    tape = [s for f, s, b in lower if f == CAIRO_TAPE]
    assert len(tape) == 1, f"expected one tape shape, found {len(tape)}"
    tb = bbox(tape[0])
    ink = [(s, b) for f, s, b in lower if f == CAIRO_INK]
    inside = lambda b: tb[0] <= (b[0] + b[2]) / 2 <= tb[2] and tb[1] <= (b[1] + b[3]) / 2 <= tb[3]
    label = [s for s, b in ink if inside(b)]
    rest = [(s, b) for s, b in ink if not inside(b)]
    # The tagline is the line below the wordmark: split at the widest vertical gap between glyph tops.
    rest.sort(key=lambda item: item[1][1])
    gaps = [rest[i + 1][1][1] - rest[i][1][1] for i in range(len(rest) - 1)]
    cut = gaps.index(max(gaps)) + 1
    wordmark = [s for s, _ in rest[:cut]]
    tagline = [s for s, _ in rest[cut:]]
    assert label and wordmark and tagline, "artwork split failed"
    return {"tape": tape, "label": label, "wordmark": wordmark, "tagline": tagline}


def ts_paths(segs_list):
    return "[\n" + "".join(f'    "{to_d(s, 0, 0)}",\n' for s in segs_list) + "  ]"


def ts_box(segs_list):
    x0, y0, x1, y1 = union([bbox(s) for s in segs_list])
    return f"[{fmt(x0)}, {fmt(y0)}, {fmt(x1 - x0)}, {fmt(y1 - y0)}]"


def main():
    parts = sta_parts()
    root = ET.parse(TRIA_SOURCE).getroot()
    club = [parse(p.get("d")) for p in root.iter(SVG_NS + "path")]
    assert club, "no paths in the club logo source"
    lockup = parts["tape"] + parts["label"] + parts["wordmark"]
    ts = f"""// Generated by scripts/extract-logos.py from the designer's artwork. Do not edit by hand.
// Coordinates are absolute in each source artboard; a box is [x, y, width, height].

export type Box = readonly [x: number, y: number, width: number, height: number];

export const clubGeometry = {{
  box: {ts_box(club)},
  wordmark: {ts_paths(club)},
}} as const;

export const podcastGeometry = {{
  boxes: {{
    lockup: {ts_box(lockup)},
    tagline: {ts_box(lockup + parts["tagline"])},
    wordmark: {ts_box(parts["wordmark"])},
  }},
  tape: {ts_paths(parts["tape"])},
  label: {ts_paths(parts["label"])},
  wordmark: {ts_paths(parts["wordmark"])},
  tagline: {ts_paths(parts["tagline"])},
}} as const;
"""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(ts)
    print(f"wrote {OUT.relative_to(ROOT)}: {len(club)} club paths, "
          + ", ".join(f"{len(v)} {k}" for k, v in parts.items()))


if __name__ == "__main__":
    main()
