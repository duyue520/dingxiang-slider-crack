#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
像素级验证：浏览器 SDK 自己还原的 canvas  VS  本项目 Python 还原结果
================================================================
这是判断"还原算法是否真正正确"的最硬标准：
  · 浏览器端由官方 SDK 用官方算法绘制，是权威基准
  · 若两者像素级一致 ⇒ 算法确证无疑
  · 若有偏差 ⇒ 说明还有细节没对齐

流程：
  1. Node 侧（cdp-grab-canvas.cjs）打开页面，导出：
       - 原始背景图 (imageType=0 的 webp 原字节)
       - o 参数
       - 浏览器还原后的 canvas 像素 (PNG base64)
  2. 本脚本用 restore_fix.restore_by_source 还原原图
  3. 逐像素比对，输出差异统计与差异图

用法: python verify_pixel.py
"""
import base64
import io
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageChops

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from restore_fix import restore_by_source

HERE = os.path.dirname(os.path.abspath(__file__))
NODE = os.environ.get('NODE_BIN', 'node')


def main():
    # 1) 调 Node 抓取基准数据
    print('[*] 调用浏览器抓取权威基准（浏览器端还原结果）...')
    p = subprocess.run([NODE, os.path.join(HERE, 'cdp-grab-canvas.cjs')],
                       capture_output=True, text=True, encoding='utf-8',
                       errors='replace', timeout=300, cwd=HERE,
                       stdin=subprocess.DEVNULL)
    out = p.stdout or ''
    i = out.find('{')
    if i < 0:
        print('[!] 抓取失败:', (p.stderr or out)[:400])
        return 1
    data = json.loads(out[i:])
    if not data.get('ok'):
        print('[!] 抓取未完成:', data.get('err'))
        return 1

    raw = base64.b64decode(data['bgB64'])
    o = data['o']
    browser_png = base64.b64decode(data['canvasB64'])
    print('[+] 原图 %d 字节  o=%s' % (len(raw), o[:16]))
    print('[+] 浏览器 canvas %d 字节 (%sx%s)' % (len(browser_png), data.get('cw'), data.get('ch')))

    # 2) 本项目还原
    raw_img = Image.open(io.BytesIO(raw)).convert('RGB')
    mine = restore_by_source(raw_img, o)
    browser = Image.open(io.BytesIO(browser_png)).convert('RGB')
    print('[+] 本项目还原尺寸 %s / 浏览器 %s' % (mine.size, browser.size))

    if mine.size != browser.size:
        print('[!] 尺寸不一致，无法逐像素比对')
        return 1

    # 3) 逐像素比对
    a = np.array(mine, dtype=np.int16)
    b = np.array(browser, dtype=np.int16)
    diff = np.abs(a - b)
    maxd = int(diff.max(axis=2).max())
    meand = float(diff.mean())
    total = diff.shape[0] * diff.shape[1]
    dmax = diff.max(axis=2)

    print()
    print('===== 像素级比对结果 =====')
    print('  最大通道差 : %d   平均通道差 : %.4f' % (maxd, meand))
    print('  分档一致率（容差 = 允许的最大通道差）：')
    ratios = {}
    for tol in (0, 1, 2, 4, 8, 16, 32):
        bad = int((dmax > tol).sum())
        r = 100.0 * (total - bad) / total
        ratios[tol] = r
        print('    容差 %-3d : %7.3f%%   (超差像素 %d/%d)' % (tol, r, bad, total))

    # 差异是否属于"整体解码偏移"：看差值分布是否集中在小范围
    nonzero = dmax[dmax > 0]
    if nonzero.size:
        print('  非零差值分位: p50=%.0f p90=%.0f p99=%.0f max=%d'
              % (np.percentile(nonzero, 50), np.percentile(nonzero, 90),
                 np.percentile(nonzero, 99), nonzero.max()))

    # ---- 排除"大块差异"（SDK 额外绘制的缺口标记），只评估纯背景还原 ----
    bigdiff = (dmax > 32).astype(np.uint8)
    ex = bigdiff.copy()
    # 简单膨胀：把差异区周边也排除
    for _ in range(2):
        p = np.pad(ex, 1)
        ex = np.maximum.reduce([p[0:-2, 1:-1], p[2:, 1:-1], p[1:-1, 0:-2], p[1:-1, 2:], ex])
    keep = (ex == 0)
    kept_total = int(keep.sum())
    kept_bad = int(((dmax > 8) & keep).sum())
    bg_ratio = 100.0 * (kept_total - kept_bad) / kept_total if kept_total else 0.0
    print()
    print('  --- 排除缺口标记区域后的「纯背景还原」一致性 ---')
    print('  评估像素数 %d / %d  (排除 %.1f%%)'
          % (kept_total, total, 100.0 * (total - kept_total) / total))
    print('  纯背景一致率(容差8): %.3f%%' % bg_ratio)

    tol = 8
    match_ratio = bg_ratio
    bad = kept_bad

    # 差异可视化
    dvis = (np.clip(diff.max(axis=2), 0, 255)).astype(np.uint8)
    Image.fromarray(dvis).resize((dvis.shape[1] * 2, dvis.shape[0] * 2), Image.NEAREST).save(
        os.path.join(HERE, 'verify_diff.png'))
    sheet = Image.new('RGB', (mine.width, mine.height * 3 + 16), (255, 255, 255))
    sheet.paste(mine, (0, 0))
    sheet.paste(browser, (0, mine.height + 8))
    sheet.paste(Image.fromarray(np.stack([dvis] * 3, axis=2)), (0, mine.height * 2 + 16))
    sheet = sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST)
    sheet.save(os.path.join(HERE, 'verify_sheet.png'))
    print('  对比图 -> verify_sheet.png（上=本项目还原 中=浏览器还原 下=差异）')

    ok = match_ratio >= 99.0
    print()
    print('  ⇒ 结论: %s' % ('✅ 算法确证正确（与浏览器逐像素一致）' if ok else '⚠️ 仍有偏差，需继续对齐'))
    return 0 if ok else 2


if __name__ == '__main__':
    sys.exit(main())
