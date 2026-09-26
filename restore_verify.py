#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
还原方向客观判定
------------------------------------------------------------
用「列连续性」作为客观指标：还原正确的图，相邻列差异应显著变小。
候选：
  A 原图不还原
  B out[dst] = src[order[dst]]      （当前实现）
  C out[order[src]] = src           （反向映射）
  D 使用 order 的逆序

用法: python restore_verify.py [组数]
"""
import io
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dx_captcha import DingXiangCaptcha, build_restore_order

HERE = os.path.dirname(os.path.abspath(__file__))
PIECES = 32


def col_continuity(img: Image.Image) -> float:
    """列连续性：相邻列平均绝对差，越小越连续（越像自然图像）"""
    a = np.array(img.convert('L'), dtype=np.float32)
    return float(np.abs(np.diff(a, axis=1)).mean())


def row_continuity(img: Image.Image) -> float:
    a = np.array(img.convert('L'), dtype=np.float32)
    return float(np.abs(np.diff(a, axis=0)).mean())


def restore(img: Image.Image, order, mode: str) -> Image.Image:
    arr = np.array(img.convert('RGB'))
    h, w, _ = arr.shape
    pw = w / float(PIECES)
    out = np.zeros_like(arr)

    def put(dst_i, src_i):
        sx0, sx1 = src_i * pw, (src_i + 1) * pw
        tx0, tx1 = dst_i * pw, (dst_i + 1) * pw
        n = max(1, int(round(tx1) - round(tx0)))
        for k in range(n):
            tx = int(round(tx0)) + k
            if tx >= w:
                break
            sx = int(round(sx0 + (k + 0.5) * (sx1 - sx0) / n))
            sx = max(0, min(w - 1, sx))
            out[:, tx] = arr[:, sx]

    if mode == 'B':
        for dst_i, src_i in enumerate(order):
            put(dst_i, src_i)
    elif mode == 'C':
        for src_i, dst_i in enumerate(order):
            put(dst_i, src_i)
    elif mode == 'D':
        inv = [0] * PIECES
        for i, v in enumerate(order):
            if 0 <= v < PIECES:
                inv[v] = i
        for dst_i, src_i in enumerate(inv):
            put(dst_i, src_i)
    return Image.fromarray(out)


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    for i in range(n):
        c = DingXiangCaptcha()
        info = c.apply()
        raw = Image.open(io.BytesIO(c.get_image(image_type=0))).convert('RGB')
        order = build_restore_order(info.get('o') or '', PIECES)
        res = {'A(原图)': (col_continuity(raw), row_continuity(raw))}
        for m in ['B', 'C', 'D']:
            img = restore(raw, order, m)
            res[m] = (col_continuity(img), row_continuity(img))
            img.save(os.path.join(HERE, 'rv_%d_%s.png' % (i + 1, m)))
        raw.save(os.path.join(HERE, 'rv_%d_A.png' % (i + 1)))
        base = res['A(原图)'][0]
        print('--- 第 %d 组  o=%s ---' % (i + 1, (info.get('o') or '')[:16]))
        for k, (cc, rc) in res.items():
            gain = (base - cc) / base * 100 if base else 0
            print('  %-8s 列连续性=%.3f (相对原图 %+.1f%%)  行连续性=%.3f' % (k, cc, gain, rc))
        best = min(res.items(), key=lambda kv: kv[1][0])
        print('  ⇒ 列连续性最优: %s' % best[0])


if __name__ == '__main__':
    main()
