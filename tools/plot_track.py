#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把真人拖动轨迹画成图（供学习参考）—— 仅依赖 Pillow，无需 matplotlib

用法: python tools/plot_track.py
读取仓库根目录 real_track2.json / real_track.json（若存在），
输出 docs/track-real-human.png
"""
import json
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 1200, 800
BG = (255, 255, 255)
FG = (27, 39, 51)
GRID = (228, 234, 240)


def load(name):
    p = os.path.join(HERE, name)
    if not os.path.exists(p):
        return None
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def split_drags(events):
    segs, cur = [], None
    for e in events:
        t = e.get('type')
        if t == 'mousedown':
            cur = []
        elif t == 'mouseup' and cur is not None:
            segs.append(cur)
            cur = None
        elif t == 'mousemove' and cur is not None:
            cur.append(e)
    return [s for s in segs if len(s) >= 3]


def draw_panel(d, box, title, xs, ys, color, xlabel, ylabel):
    x0, y0, x1, y1 = box
    d.rectangle([x0, y0, x1, y1], fill=BG, outline=GRID)
    # 网格
    for i in range(1, 5):
        gx = x0 + (x1 - x0) * i / 5
        gy = y0 + (y1 - y0) * i / 5
        d.line([gx, y0, gx, y1], fill=GRID)
        d.line([x0, gy, x1, gy], fill=GRID)
    d.text((x0 + 6, y0 + 4), title, fill=FG)
    if not xs:
        return
    mnx, mxx = min(xs), max(xs)
    mny, mxy = min(ys), max(ys)
    if mxx == mnx:
        mxx = mnx + 1
    if mxy == mny:
        mxy = mny + 1
    pad = 30
    pts = []
    for x, y in zip(xs, ys):
        px = x0 + pad + (x - mnx) / (mxx - mnx) * (x1 - x0 - 2 * pad)
        py = y1 - pad - (y - mny) / (mxy - mny) * (y1 - y0 - 2 * pad)
        pts.append((px, py))
    if len(pts) > 1:
        d.line(pts, fill=color, width=2)
    for p in pts[::max(1, len(pts) // 60)]:
        d.ellipse([p[0] - 2, p[1] - 2, p[0] + 2, p[1] + 2], fill=color)
    d.text((x0 + 6, y1 - 16), xlabel, fill=(120, 135, 150))
    d.text((x0 + 6, y0 + 20), ylabel, fill=(120, 135, 150))


def main():
    data = load('real_track2.json') or load('real_track.json')
    if not data:
        print('未找到 real_track*.json，跳过')
        return
    ev = (data.get('track') or {}).get('events') or []
    segs = split_drags(ev)
    if not segs:
        print('未找到有效拖动段')
        return
    seg = max(segs, key=len)

    xs = [e['x'] for e in seg]
    ys = [e['y'] for e in seg]
    ts = [e['t'] for e in seg]
    t0 = ts[0]
    rt = [t - t0 for t in ts]
    dist = [x - xs[0] for x in xs]
    dts = [rt[i] - rt[i - 1] for i in range(1, len(rt))]
    vel = []
    for i in range(1, len(seg)):
        dt = rt[i] - rt[i - 1]
        vel.append((dist[i] - dist[i - 1]) / dt if dt > 0 else 0)

    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)
    d.text((20, 14), 'REAL HUMAN DRAG TRACK  (points=%d, duration=%.0f ms)' % (len(seg), rt[-1]),
           fill=FG)

    m = 24
    pw = (W - m * 3) // 2
    ph = (H - 90 - m * 2) // 2
    b1 = (m, 50, m + pw, 50 + ph)
    b2 = (m * 2 + pw, 50, m * 2 + pw * 2, 50 + ph)
    b3 = (m, 50 + ph + m, m + pw, 50 + ph + m + ph)
    b4 = (m * 2 + pw, 50 + ph + m, m * 2 + pw * 2, 50 + ph + m + ph)

    draw_panel(d, b1, 'Drag distance vs time', rt, dist, (45, 127, 249), 'time (ms)', 'distance (px)')
    draw_panel(d, b2, 'Y jitter (range %.1f px)' % (max(ys) - min(ys)), rt, ys, (192, 57, 43), 'time (ms)', 'clientY')
    draw_panel(d, b3, 'Speed profile (px/ms)', rt[1:], vel, (27, 138, 90), 'time (ms)', 'speed')
    # 间隔直方图
    d_ = ImageDraw.Draw(img)
    x0, y0, x1, y1 = b4
    d_.rectangle([x0, y0, x1, y1], fill=BG, outline=GRID)
    d_.text((x0 + 6, y0 + 4), 'Inter-event interval (median %.1f ms)' % sorted(dts)[len(dts) // 2], fill=FG)
    if dts:
        bins = 18
        mx = max(dts)
        cnt = [0] * bins
        for v in dts:
            i = min(bins - 1, int(v / mx * bins))
            cnt[i] += 1
        peak = max(cnt)
        bw = (x1 - x0 - 40) / bins
        for i, c in enumerate(cnt):
            hgt = (c / peak) * (y1 - y0 - 60) if peak else 0
            bx0 = x0 + 20 + i * bw
            d_.rectangle([bx0, y1 - 30 - hgt, bx0 + bw - 2, y1 - 30], fill=(255, 140, 0))
    d_.text((x0 + 6, y1 - 16), 'dt (ms)', fill=(120, 135, 150))

    out = os.path.join(HERE, 'docs', 'track-real-human.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out)
    print('saved ->', out)
    print('  points=%d  median_dt=%.1fms  y_jitter=%.1fpx  distance=%.0fpx'
          % (len(seg), sorted(dts)[len(dts) // 2], max(ys) - min(ys), dist[-1]))


if __name__ == '__main__':
    main()
