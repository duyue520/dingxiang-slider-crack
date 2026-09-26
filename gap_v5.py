#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
缺口定位 v5 —— 暗区连通域（抗竖条干扰）
================================================================
观察（v4_sheet.png）：
  · 背景图确实被切成竖条打乱，边缘检测会被竖条干扰
  · 但缺口是【大块黑色三角】，在打乱图上依然清晰、面积大
⇒ 直接找"最大的暗色连通区域"，比找边缘鲁棒

策略：
  1. y 带内二值化（低于阈值 = 暗）
  2. 用简单两遍扫描 / 洪水填充找连通域
  3. 取面积最大的域，其最左列即缺口左边缘

用法: python gap_v5.py [组数]
"""
import io
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dx_captcha import DingXiangCaptcha

HERE = os.path.dirname(os.path.abspath(__file__))


def largest_dark_blob(g, y_hint, half=30, min_area=120):
    """返回 (left, top, right, bottom, area) —— 最大暗连通域的包围盒"""
    bh, bw = g.shape
    y0 = max(0, int(y_hint) - half) if y_hint is not None else 0
    y1 = min(bh, int(y_hint) + half) if y_hint is not None else bh
    band = g[y0:y1, :]
    h, w = band.shape

    # 阈值：带内均值 - 1.2*标准差
    thr = band.mean() - 1.15 * band.std()
    thr = max(thr, band.min() + 6)
    dark = band < thr

    seen = np.zeros((h, w), dtype=bool)
    best = None
    for yy in range(h):
        for xx in range(w):
            if not dark[yy, xx] or seen[yy, xx]:
                continue
            # BFS
            q = deque([(yy, xx)])
            seen[yy, xx] = True
            pts = []
            while q:
                cy, cx = q.popleft()
                pts.append((cy, cx))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and dark[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            if len(pts) < min_area:
                continue
            ys = [p[0] for p in pts]
            xs = [p[1] for p in pts]
            area = len(pts)
            box = (min(xs), min(ys), max(xs), max(ys), area)
            # 偏好"接近方形/三角"的大块（宽高比合理）
            bw_ = box[2] - box[0] + 1
            bh_ = box[3] - box[1] + 1
            if bw_ < 12 or bh_ < 10:
                continue
            ratio = bh_ / float(bw_)
            if ratio > 2.6 or ratio < 0.25:
                continue
            score = area
            if best is None or score > best[5]:
                best = box + (score,)
    return best


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 6
    rows = []
    for i in range(n):
        c = DingXiangCaptcha()
        info = c.apply()
        y = info.get('y')
        bg = Image.open(io.BytesIO(c.get_image(image_type=0))).convert('RGB')
        g = np.array(bg.convert('L'), dtype=np.float32)
        blob = largest_dark_blob(g, y)
        if blob:
            left, top, right, bot, area, score = blob
            print('第%2d组 y=%-4s -> 缺口 x=%-4s..%-4s y=%-3s..%-3s 面积=%s' % (i + 1, y, left, right, top, bot, area))
            rows.append((i + 1, y, left, right, area))
        else:
            print('第%2d组 y=%-4s -> 未找到暗区' % (i + 1, y))
            rows.append((i + 1, y, None, None, 0))

        vis = bg.copy()
        d = ImageDraw.Draw(vis)
        if blob:
            d.rectangle([left, top + max(0, int(y) - 30), right, bot + max(0, int(y) - 30)],
                        outline=(255, 0, 0), width=1)
            d.line([(left, 0), (left, vis.height)], fill=(255, 0, 0), width=1)
            d.line([(right, 0), (right, vis.height)], fill=(0, 200, 0), width=1)
        vis = vis.resize((vis.width * 2, vis.height * 2), Image.NEAREST)
        vis.save(os.path.join(HERE, 'v5_%d.png' % (i + 1)))

    print()
    print('=== 汇总 ===')
    for r in rows:
        print('  组%-2d  x=%-5s..%-5s 面积=%s' % (r[0], r[2], r[3], r[4]))

    imgs = [Image.open(os.path.join(HERE, 'v5_%d.png' % r[0])) for r in rows[:6]]
    if imgs:
        cols, rows_ = 2, (len(imgs) + 1) // 2
        W = max(im.width for im in imgs) * cols + 10
        H = max(im.height for im in imgs) * rows_ + 10 * rows_
        sheet = Image.new('RGB', (W, H), (255, 255, 255))
        for idx, im in enumerate(imgs):
            sheet.paste(im, ((idx % cols) * (im.width + 10), (idx // cols) * (im.height + 10)))
        sheet.save(os.path.join(HERE, 'v5_sheet.png'))
        print('  总览图 -> v5_sheet.png')


if __name__ == '__main__':
    main()
