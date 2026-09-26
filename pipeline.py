#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
完整流程：取图 -> 按源码还原 -> 缺口检测 -> 输出标注图
用法: python pipeline.py [组数]
"""
import io
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dx_captcha import DingXiangCaptcha, build_restore_order
from restore_fix import restore_by_source, col_continuity

HERE = os.path.dirname(os.path.abspath(__file__))


def detect_gap(g, y_hint, half=34, min_area=150):
    """在还原后的图上找最大暗色连通域 -> 缺口包围盒"""
    bh, bw = g.shape
    y0 = max(0, int(y_hint) - half) if y_hint is not None else 0
    y1 = min(bh, int(y_hint) + half) if y_hint is not None else bh
    band = g[y0:y1, :]
    h, w = band.shape
    thr = band.mean() - 1.05 * band.std()
    dark = band < thr

    seen = np.zeros((h, w), dtype=bool)
    best = None
    for yy in range(h):
        for xx in range(w):
            if not dark[yy, xx] or seen[yy, xx]:
                continue
            q = deque([(yy, xx)]); seen[yy, xx] = True
            pts = []
            while q:
                cy, cx = q.popleft(); pts.append((cy, cx))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and dark[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True; q.append((ny, nx))
            if len(pts) < min_area:
                continue
            ys = [p[0] for p in pts]; xs = [p[1] for p in pts]
            bw_ = max(xs) - min(xs) + 1; bh_ = max(ys) - min(ys) + 1
            if bw_ < 20 or bh_ < 18:
                continue
            r = bh_ / float(bw_)
            if r > 2.2 or r < 0.35:
                continue
            if best is None or len(pts) > best[4]:
                best = (min(xs), min(ys) + y0, max(xs), max(ys) + y0, len(pts))
    return best


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    for i in range(n):
        c = DingXiangCaptcha()
        info = c.apply()
        y = info.get('y')
        raw = Image.open(io.BytesIO(c.get_image(image_type=0))).convert('RGB')
        fixed = restore_by_source(raw, info.get('o') or '')
        g = np.array(fixed.convert('L'), dtype=np.float32)
        box = detect_gap(g, y)

        vis = fixed.copy()
        d = ImageDraw.Draw(vis)
        if box:
            x0, yy0, x1, yy1, area = box
            d.rectangle([x0, yy0, x1, yy1], outline=(255, 0, 0), width=2)
            d.line([(x0, 0), (x0, vis.height)], fill=(255, 0, 0), width=1)
            right_shift = round(x0 + 10 + (0 if info.get('type') else 0))
            print('第%d组 y=%-4s -> 缺口 x=%s..%s (宽%s) 面积=%s | 预计上传x≈%s'
                  % (i + 1, y, x0, x1, x1 - x0 + 1, area, right_shift))
        else:
            print('第%d组 y=%-4s -> 未检出' % (i + 1, y))
        vis = vis.resize((vis.width * 2, vis.height * 2), Image.NEAREST)
        vis.save(os.path.join(HERE, 'pipe_%d.png' % (i + 1)))

    imgs = [Image.open(os.path.join(HERE, 'pipe_%d.png' % (i + 1))) for i in range(n)]
    cols = 2; rows = (n + 1) // 2
    W = max(im.width for im in imgs) * cols + 12
    H = max(im.height for im in imgs) * rows + 12 * rows
    sheet = Image.new('RGB', (W, H), (255, 255, 255))
    for idx, im in enumerate(imgs):
        sheet.paste(im, ((idx % cols) * (im.width + 12), (idx // cols) * (im.height + 12)))
    sheet.save(os.path.join(HERE, 'pipe_sheet.png'))
    print('总览 -> pipe_sheet.png')


if __name__ == '__main__':
    main()
