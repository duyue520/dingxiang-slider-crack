#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
缺口定位算法对比测试
抓一组真实图，用多种算法算缺口 x 并输出标注图，选出最稳的那个。

用法: python gap_test.py [次数]
"""
import io
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dx_captcha import DingXiangCaptcha

HERE = os.path.dirname(os.path.abspath(__file__))


def m1_alpha_absdiff(bg, sl, y_hint):
    """方法1：alpha 掩码 + 绝对差（当前实现）"""
    g = np.array(bg.convert('L'), dtype=np.float32)
    sa = np.array(sl.convert('RGBA'))
    s = np.array(sl.convert('L'), dtype=np.float32)
    mask = sa[:, :, 3] > 128
    if mask.sum() < 50:
        mask = np.ones_like(mask, dtype=bool)
    ys, xs = np.where(mask)
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
    sc, mc = s[y0:y1, x0:x1], mask[y0:y1, x0:x1]
    sh, sw = sc.shape
    bh, bw = g.shape
    ylo = max(0, int(y_hint) - 20) if y_hint is not None else 0
    yhi = min(bh - sh, int(y_hint) + 20) if y_hint is not None else bh - sh
    best = (1e18, 0)
    for y in range(ylo, yhi + 1):
        band = g[y:y + sh, :]
        for x in range(0, bw - sw + 1):
            d = float(np.abs(band[:, x:x + sw] - sc)[mc].mean())
            if d < best[0]:
                best = (d, x)
    return best[1], best[0]


def m2_ncc(bg, sl, y_hint):
    """方法2：alpha 掩码 + 归一化互相关（对亮度整体偏移更鲁棒）"""
    g = np.array(bg.convert('L'), dtype=np.float32)
    sa = np.array(sl.convert('RGBA'))
    s = np.array(sl.convert('L'), dtype=np.float32)
    mask = sa[:, :, 3] > 128
    if mask.sum() < 50:
        mask = np.ones_like(mask, dtype=bool)
    ys, xs = np.where(mask)
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
    sc, mc = s[y0:y1, x0:x1], mask[y0:y1, x0:x1]
    scv = sc[mc]
    scv = scv - scv.mean()
    scn = float(np.linalg.norm(scv)) + 1e-6
    sh, sw = sc.shape
    bh, bw = g.shape
    ylo = max(0, int(y_hint) - 20) if y_hint is not None else 0
    yhi = min(bh - sh, int(y_hint) + 20) if y_hint is not None else bh - sh
    best = (-1e18, 0)
    for y in range(ylo, yhi + 1):
        band = g[y:y + sh, :]
        for x in range(0, bw - sw + 1):
            w = band[:, x:x + sw][mc]
            wv = w - w.mean()
            ncc = float(np.dot(wv, scv)) / (np.linalg.norm(wv) + 1e-6) / scn
            if ncc > best[0]:
                best = (ncc, x)
    return best[1], best[0]


def m3_edge_profile(bg, y_hint, min_w=36, max_w=64):
    """方法3：不依赖滑块图，找缺口两侧的竖直边缘对"""
    g = np.array(bg.convert('L'), dtype=np.float32)
    bh, bw = g.shape
    y0 = max(0, int(y_hint) - 22) if y_hint is not None else 0
    y1 = min(bh, int(y_hint) + 22) if y_hint is not None else bh
    band = g[y0:y1, :]
    col = np.abs(np.diff(band, axis=1)).mean(axis=0)
    order = np.argsort(col)[::-1]
    for i in order[:12]:
        for j in order[:80]:
            if j <= i:
                continue
            if min_w <= (j - i) <= max_w:
                return int(i), float(col[i] + col[j])
    return int(order[0]), 0.0


def m4_darkness(bg, y_hint, win=48):
    """方法4：缺口区域通常比邻域更暗"""
    g = np.array(bg.convert('L'), dtype=np.float32)
    bh, bw = g.shape
    y0 = max(0, int(y_hint) - 20) if y_hint is not None else 0
    y1 = min(bh, int(y_hint) + 20) if y_hint is not None else bh
    band = g[y0:y1, :]
    colmean = band.mean(axis=0)
    k = np.ones(win) / win
    sm = np.convolve(colmean, k, mode='same')
    diff = sm - colmean
    x = int(np.argmax(diff[:len(diff) - win])) if len(diff) > win else int(np.argmax(diff))
    return x, float(diff[x])


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    for i in range(n):
        c = DingXiangCaptcha()
        info = c.apply()
        y = info.get('y')
        bg_b = c.get_image(image_type=0)
        sl_b = c.get_image(image_type=1)
        bg = Image.open(io.BytesIO(bg_b)).convert('RGB')
        sl = Image.open(io.BytesIO(sl_b)).convert('RGBA')
        print('--- 第 %d 组  y=%s type=%s 图=%s/%s ---' % (i + 1, y, info.get('type'), bg.size, sl.size))

        r1 = m1_alpha_absdiff(bg, sl, y)
        r2 = m2_ncc(bg, sl, y)
        r3 = m3_edge_profile(bg, y)
        r4 = m4_darkness(bg, y)
        print('  m1 alpha-absdiff : x=%s  (diff=%.2f)' % (r1[0], r1[1]))
        print('  m2 NCC           : x=%s  (ncc=%.3f)' % (r2[0], r2[1]))
        print('  m3 边缘对        : x=%s x2=%s (score=%.1f)' % (r3[0], r3[0], r3[1]))
        print('  m4 暗区          : x=%s  (score=%.1f)' % (r4[0], r4[1]))

        # 标注图
        vis = bg.copy()
        d = ImageDraw.Draw(vis)
        for xx, col in [(r1[0], (255, 0, 0)), (r2[0], (0, 160, 255)), (r3[0], (0, 200, 0)), (r4[0], (255, 140, 0))]:
            d.line([(xx, 0), (xx, vis.height)], fill=col, width=1)
        vis = vis.resize((vis.width * 2, vis.height * 2), Image.NEAREST)
        vis.save(os.path.join(HERE, 'gap_vis_%d.png' % (i + 1)))
        bg.save(os.path.join(HERE, 'gap_bg_%d.png' % (i + 1)))
        sl.save(os.path.join(HERE, 'gap_sl_%d.png' % (i + 1)))
        print('  标注图 -> gap_vis_%d.png (红=m1 蓝=m2 绿=m3 橙=m4)' % (i + 1))


if __name__ == '__main__':
    main()
