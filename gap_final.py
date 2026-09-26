#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
缺口定位 v3 —— 面向"暗色三角挖空区"的检测
================================================================
已确认事实：
  · 背景图无需还原（还原只会更差，见 restore_verify.py）
  · 滑块图是【三角形拼图块】（填充态），缺口是【三角形挖空区】（暗色）
  · 因此灰度模板匹配必然失效

本版策略（多路候选 + 打分投票）：
  P1 暗区法      : y 带内列均值的局部凹陷（缺口偏暗）
  P2 边缘对法    : 缺口左右边界是两条强竖直边缘，且间距 36~64
  P3 三角形轮廓法: 在 y 带内找"上宽下窄"的暗区，符合三角挖空形态
  P4 形状匹配    : 对滑块图取二值轮廓，在背景图上按形状匹配（用边缘图而非灰度）

用法: python gap_final.py [组数]
输出: gapv3_<i>.png 标注图（每条候选一把颜色），并打印各法结果
"""
import io
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dx_captcha import DingXiangCaptcha

HERE = os.path.dirname(os.path.abspath(__file__))


def band_of(g, y_hint, half=25):
    bh = g.shape[0]
    y0 = max(0, int(y_hint) - half) if y_hint is not None else 0
    y1 = min(bh, int(y_hint) + half) if y_hint is not None else bh
    return g[y0:y1, :]


def p1_dark(g, y_hint, win=44):
    band = band_of(g, y_hint)
    col = band.mean(axis=0)
    k = np.ones(win) / win
    sm = np.convolve(col, k, mode='same')
    diff = sm - col                      # 正值表示该列比邻域暗
    x = int(np.argmax(diff))
    return x, float(diff[x])


def p2_edges(g, y_hint, min_w=36, max_w=64):
    band = band_of(g, y_hint, half=22)
    col = np.abs(np.diff(band, axis=1)).mean(axis=0)
    order = np.argsort(col)[::-1]
    best = None
    for ii in order[:14]:
        for jj in order[:90]:
            if jj <= ii:
                continue
            if min_w <= (jj - ii) <= max_w:
                score = float(col[ii] + col[jj])
                if best is None or score > best[2]:
                    best = (int(ii), int(jj), score)
        if best:
            break
    if best:
        return best[0], best[1], round(best[2], 1)
    return int(order[0]), None, 0.0


def p3_triangle(g, y_hint):
    """三角挖空：在 y 带内统计每列"暗像素"(低于全带均值)的数量，
    暗像素数从某列开始显著高于基线，且随 y 增大而减少（上宽下窄）。"""
    band = band_of(g, y_hint, half=26)
    base = band.mean()
    dark = (band < base - 18).astype(np.float32)
    colcnt = dark.sum(axis=0)
    if colcnt.max() <= 0:
        return None, 0.0
    x = int(np.argmax(colcnt))
    # 三角形态打分：左侧累计暗像素应多于右侧
    lo = max(0, x - 25)
    hi = min(band.shape[1], x + 25)
    left = colcnt[lo:x].sum() if x > lo else 0
    right = colcnt[x:hi].sum()
    score = float(colcnt[x]) * (1.0 if left >= right * 0.7 else 0.4)
    return x, round(score, 1)


def p4_shape(g, sl, y_hint):
    """形状匹配：用滑块 alpha 掩码生成边缘模板，在背景图边缘图上匹配"""
    # 背景边缘图
    gy = np.abs(np.diff(g, axis=1))
    gy = np.pad(gy, ((0, 0), (0, 1)), mode='edge')
    gy = gy / (gy.max() + 1e-6)
    sa = np.array(sl.convert('RGBA'))
    mask = sa[:, :, 3] > 128
    if mask.sum() < 50:
        mask = np.ones_like(mask, dtype=bool)
    # 掩码边界（形态学膨胀差）
    m = mask.astype(np.uint8)
    pad = np.pad(m, 1)
    dil = pad.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            dil = np.maximum(dil, np.roll(np.roll(pad, dy, 0), dx, 1))
    edge_t = (dil[1:-1, 1:-1] - m).astype(bool)
    if edge_t.sum() < 20:
        edge_t = mask
    ys, xs = np.where(edge_t)
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
    et = edge_t[y0:y1, x0:x1]
    sh, sw = et.shape
    bh, bw = g.shape
    ylo = max(0, int(y_hint) - 25) if y_hint is not None else 0
    yhi = min(bh - sh, int(y_hint) + 25) if y_hint is not None else bh - sh
    best = (-1e18, 0)
    for y in range(ylo, yhi + 1):
        for x in range(0, bw - sw + 1):
            win = gy[y:y + sh, x:x + sw]
            s = float(win[et].mean()) - float(win[~et].mean())
            if s > best[0]:
                best = (s, x)
    return best[1], round(best[0], 3)


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    for i in range(n):
        c = DingXiangCaptcha()
        info = c.apply()
        y = info.get('y')
        bg = Image.open(io.BytesIO(c.get_image(image_type=0))).convert('RGB')
        sl = Image.open(io.BytesIO(c.get_image(image_type=1))).convert('RGBA')
        g = np.array(bg.convert('L'), dtype=np.float32)

        r1 = p1_dark(g, y)
        r2 = p2_edges(g, y)
        r3 = p3_triangle(g, y)
        r4 = p4_shape(g, sl, y)

        print('--- 第 %d 组  y=%s type=%s ---' % (i + 1, y, info.get('type')))
        print('  P1 暗区     x=%-4s (score=%.1f)' % (r1[0], r1[1]))
        print('  P2 边缘对   x=%-4s x2=%-5s (score=%s)' % (r2[0], r2[1], r2[2]))
        print('  P3 三角     x=%-4s (score=%.1f)' % (r3[0], r3[1]))
        print('  P4 形状     x=%-4s (score=%.3f)' % (r4[0], r4[1]))

        vis = bg.copy()
        d = ImageDraw.Draw(vis)
        for xx, col in [(r1[0], (255, 0, 0)), (r2[0], (0, 200, 0)), (r3[0], (255, 140, 0)), (r4[0], (0, 160, 255))]:
            d.line([(xx, 0), (xx, vis.height)], fill=col, width=1)
        vis = vis.resize((vis.width * 2, vis.height * 2), Image.NEAREST)
        vis.save(os.path.join(HERE, 'gapv3_%d.png' % (i + 1)))
        bg.save(os.path.join(HERE, 'gv3_bg_%d.png' % (i + 1)))
        print('  标注图 -> gapv3_%d.png (红=P1 绿=P2 橙=P3 蓝=P4)' % (i + 1))


if __name__ == '__main__':
    main()
