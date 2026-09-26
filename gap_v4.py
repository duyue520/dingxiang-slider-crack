#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
缺口定位 v4 —— 组合打分（边缘 + 暗区 + 形态）
================================================================
针对"每组图不同、缺口位置不同"的问题，做多组批量验证。

评分模型（在 y 带内）：
    score(x, w) = 左边缘强度 + 右边缘强度 + 缺口内暗度 × k
    约束：36 <= w <= 64（缺口宽度范围）

同时输出每组标注图，便于肉眼复核。

用法: python gap_v4.py [组数]
"""
import io
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dx_captcha import DingXiangCaptcha

HERE = os.path.dirname(os.path.abspath(__file__))


def smooth(a, k=15):
    ker = np.ones(k) / k
    return np.convolve(a, ker, mode='same')


def find_gap_v4(g, y_hint, wmin=36, wmax=64, half=26, k_dark=1.6):
    bh, bw = g.shape
    y0 = max(0, int(y_hint) - half) if y_hint is not None else 0
    y1 = min(bh, int(y_hint) + half) if y_hint is not None else bh
    band = g[y0:y1, :]
    edge = np.abs(np.diff(band, axis=1)).mean(axis=0)
    edge = np.concatenate([edge, edge[-1:]])
    colmean = band.mean(axis=0)
    dark = smooth(colmean, 41) - colmean          # >0 表示该列比邻域暗
    dark = np.clip(dark, 0, None)

    best = (-1e18, 0, 0, 0.0)
    for x in range(1, bw - wmin - 1):
        le = edge[x]
        if le < 4:                                # 左边缘太弱直接跳过
            continue
        for w in range(wmin, min(wmax, bw - x - 1) + 1):
            xr = x + w
            re = edge[min(xr, bw - 1)]
            din = dark[x:xr].mean()
            score = le + re + din * k_dark
            if score > best[0]:
                best = (score, x, w, din)
    if best[1] == 0 and best[0] < 0:
        return 0, 0, 0.0
    return best[1], best[2], round(best[0], 1)


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 6
    rows = []
    for i in range(n):
        c = DingXiangCaptcha()
        info = c.apply()
        y = info.get('y')
        bg = Image.open(io.BytesIO(c.get_image(image_type=0))).convert('RGB')
        g = np.array(bg.convert('L'), dtype=np.float32)
        x, w, score = find_gap_v4(g, y)
        rows.append((i + 1, y, x, w, score))
        print('第%2d组 y=%-4s -> 缺口左边缘 x=%-4s 宽=%s 分=%.1f' % (i + 1, y, x, w, score))

        vis = bg.copy()
        d = ImageDraw.Draw(vis)
        d.line([(x, 0), (x, vis.height)], fill=(255, 0, 0), width=1)
        if w:
            d.line([(x + w, 0), (x + w, vis.height)], fill=(0, 200, 0), width=1)
            d.rectangle([x, 2, x + w, 8], fill=(255, 255, 0))
        vis = vis.resize((vis.width * 2, vis.height * 2), Image.NEAREST)
        vis.save(os.path.join(HERE, 'v4_%d.png' % (i + 1)))

    print()
    print('=== 汇总 ===')
    for r in rows:
        print('  组%-2d x=%-4s w=%-3s score=%s' % (r[0], r[2], r[3], r[4]))
    # 拼接总览
    imgs = [Image.open(os.path.join(HERE, 'v4_%d.png' % r[0])) for r in rows[:6]]
    if imgs:
        cols = 2
        rws = (len(imgs) + cols - 1) // cols
        W = max(im.width for im in imgs) * cols + 10
        H = max(im.height for im in imgs) * rws + 10 * rws
        sheet = Image.new('RGB', (W, H), (255, 255, 255))
        for idx, im in enumerate(imgs):
            cx = (idx % cols) * (im.width + 10)
            cy = (idx // cols) * (im.height + 10)
            sheet.paste(im, (cx, cy))
        sheet.save(os.path.join(HERE, 'v4_sheet.png'))
        print('  总览图 -> v4_sheet.png')


if __name__ == '__main__':
    main()
