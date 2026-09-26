#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
按源码真实算法还原背景图
================================================================
源码（basic-captcha-js.js）：
    var c = Math.floor(width / o.length);   // 片宽 = floor(300/32) = 9
    o.forEach(function(t, r){               // t = o[r]
        ctx.drawImage(img, t*c, 0, c, h,    // 源：第 t 条
                            r*c, 0, c, h)   // 目标：第 r 条
    });

要点：
  · 片宽必须用 floor 取整（9，不是 9.375），否则像素错位逐片累积
  · 纵向切条，映射方向 目标[r] = 源[o[r]]
  · 32*9 = 288 < 300，最右侧 12px 不会被覆盖（源码先画了整图打底）

用法: python restore_fix.py [组数]
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


def restore_by_source(bg: Image.Image, o: str, pieces: int = PIECES) -> Image.Image:
    """严格按源码实现"""
    arr = np.array(bg.convert('RGB'))
    h, w, _ = arr.shape
    c = int(w // pieces)                    # ★ floor
    order = build_restore_order(o, pieces)
    out = arr.copy()                        # 源码先画整图打底
    for r, src_i in enumerate(order):
        sx = src_i * c
        tx = r * c
        if tx + c > w or sx + c > w:
            continue
        out[:, tx:tx + c] = arr[:, sx:sx + c]
    return Image.fromarray(out)


def col_continuity(img: Image.Image) -> float:
    a = np.array(img.convert('L'), dtype=np.float32)
    return float(np.abs(np.diff(a, axis=1)).mean())


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    for i in range(n):
        c = DingXiangCaptcha()
        info = c.apply()
        raw = Image.open(io.BytesIO(c.get_image(image_type=0))).convert('RGB')
        fixed = restore_by_source(raw, info.get('o') or '')
        a0, a1 = col_continuity(raw), col_continuity(fixed)
        print('第%d组 o=%s  原图列连续性=%.3f  还原后=%.3f  (%+.1f%%)'
              % (i + 1, (info.get('o') or '')[:12], a0, a1, (a0 - a1) / a0 * 100))
        raw.save(os.path.join(HERE, 'fx_%d_raw.png' % (i + 1)))
        fixed.save(os.path.join(HERE, 'fx_%d_fixed.png' % (i + 1)))

    imgs = []
    for i in range(n):
        imgs.append(Image.open(os.path.join(HERE, 'fx_%d_raw.png' % (i + 1))))
        imgs.append(Image.open(os.path.join(HERE, 'fx_%d_fixed.png' % (i + 1))))
    cols = 2
    rows = (len(imgs) + 1) // 2
    W = max(im.width for im in imgs) * cols + 12
    H = max(im.height for im in imgs) * rows + 12 * rows
    sheet = Image.new('RGB', (W, H), (255, 255, 255))
    for idx, im in enumerate(imgs):
        sheet.paste(im, ((idx % cols) * (im.width + 12), (idx // cols) * (im.height + 12)))
    sheet = sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST)
    sheet.save(os.path.join(HERE, 'fx_sheet.png'))
    print('对比图 -> fx_sheet.png（每行：左=原图 右=还原后）')


if __name__ == '__main__':
    main()
