#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
竖条还原 + 缺口定位
------------------------------------------------------------
实测结论：顶象背景图按【纵向】切成 32 条竖条并打乱（不是横条）。
用 /api/a 返回的 o 参数还原后，缺口才可见。

用法: python restore_gap.py [组数]
"""
import io
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dx_captcha import DingXiangCaptcha, build_restore_order

HERE = os.path.dirname(os.path.abspath(__file__))
PIECES = 32


def restore_columns(bg: Image.Image, o: str, pieces: int = PIECES) -> Image.Image:
    """按列还原：把第 src 条竖条搬到第 dst 条位置。用浮点边界避免累计丢像素。"""
    arr = np.array(bg.convert('RGB'))
    h, w, _ = arr.shape
    order = build_restore_order(o, pieces)
    pw = w / float(pieces)
    out = np.zeros_like(arr)
    for dst_i, src_i in enumerate(order):
        sx0, sx1 = src_i * pw, (src_i + 1) * pw
        tx0, tx1 = dst_i * pw, (dst_i + 1) * pw
        n = int(round(tx1) - round(tx0))
        if n <= 0:
            n = 1
        for k in range(n):
            tx = int(round(tx0)) + k
            if tx >= w:
                break
            sx = int(round(sx0 + (k + 0.5) * (sx1 - sx0) / n))
            sx = max(0, min(w - 1, sx))
            out[:, tx] = arr[:, sx]
    return Image.fromarray(out)


def find_gap(bg: Image.Image, sl: Image.Image, y_hint=None):
    """alpha 掩码模板匹配 + NCC 双指标"""
    g = np.array(bg.convert('L'), dtype=np.float32)
    sa = np.array(sl.convert('RGBA'))
    s = np.array(sl.convert('L'), dtype=np.float32)
    mask = sa[:, :, 3] > 128
    if mask.sum() < 50:
        mask = np.ones_like(mask, dtype=bool)
    ys, xs = np.where(mask)
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
    sc, mc = s[y0:y1, x0:x1], mask[y0:y1, x0:x1]
    bh, bw = g.shape
    sh, sw = sc.shape
    ylo = max(0, int(y_hint) - 25) if y_hint is not None else 0
    yhi = min(bh - sh, int(y_hint) + 25) if y_hint is not None else bh - sh
    bestA = (1e18, 0)
    bestN = (-1e18, 0)
    scv = sc[mc]; scv = scv - scv.mean(); scn = float(np.linalg.norm(scv)) + 1e-6
    for y in range(ylo, yhi + 1):
        band = g[y:y + sh, :]
        for x in range(0, bw - sw + 1):
            win = band[:, x:x + sw]
            d = float(np.abs(win - sc)[mc].mean())
            if d < bestA[0]:
                bestA = (d, x)
            wv = win[mc]; wv = wv - wv.mean()
            ncc = float(np.dot(wv, scv)) / (np.linalg.norm(wv) + 1e-6) / scn
            if ncc > bestN[0]:
                bestN = (ncc, x)
    return bestA, bestN


def find_gap_dark(bg: Image.Image, y_hint):
    """缺口的无参考检测：缺口是有明确边界的暗色块"""
    g = np.array(bg.convert('L'), dtype=np.float32)
    bh, bw = g.shape
    y0 = max(0, int(y_hint) - 25) if y_hint is not None else 0
    y1 = min(bh, int(y_hint) + 25) if y_hint is not None else bh
    band = g[y0:y1, :]
    colmean = band.mean(axis=0)
    win = 48
    k = np.ones(win) / win
    sm = np.convolve(colmean, k, mode='same')
    diff = sm - colmean
    x = int(np.argmax(diff))
    return x, float(diff[x])


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    for i in range(n):
        c = DingXiangCaptcha()
        info = c.apply()
        y = info.get('y')
        o = info.get('o')
        bg_b = c.get_image(image_type=0)
        sl_b = c.get_image(image_type=1)
        raw = Image.open(io.BytesIO(bg_b)).convert('RGB')
        sl = Image.open(io.BytesIO(sl_b)).convert('RGBA')
        rest = restore_columns(raw, o)

        a_raw = find_gap(raw, sl, y)
        a_res = find_gap(rest, sl, y)
        dk = find_gap_dark(rest, y)

        print('--- 第 %d 组  y=%s o=%s ---' % (i + 1, y, o))
        print('  未还原  absdiff x=%s(%.1f)  NCC x=%s(%.3f)' % (a_raw[0][1], a_raw[0][0], a_raw[1][1], a_raw[1][0]))
        print('  已还原  absdiff x=%s(%.1f)  NCC x=%s(%.3f)' % (a_res[0][1], a_res[0][0], a_res[1][1], a_res[1][0]))
        print('  暗区法  x=%s(%.1f)' % dk)

        # 拼图：原图 / 还原图（各带标注）
        vis = Image.new('RGB', (raw.width, raw.height * 2 + 8), (255, 255, 255))
        vis.paste(raw, (0, 0))
        vis.paste(rest, (0, raw.height + 8))
        d = ImageDraw.Draw(vis)
        d.line([(a_res[1][1], 0), (a_res[1][1], vis.height)], fill=(0, 160, 255), width=1)
        d.line([(dk[0], 0), (dk[0], vis.height)], fill=(255, 140, 0), width=1)
        vis = vis.resize((vis.width * 2, vis.height * 2), Image.NEAREST)
        vis.save(os.path.join(HERE, 'restore_%d.png' % (i + 1)))
        print('  对比图 -> restore_%d.png（上=未还原 下=已还原；蓝=NCC 橙=暗区）' % (i + 1))


if __name__ == '__main__':
    main()
