#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
端到端编排：第1步 -> 第2步 -> 第3步 -> (第4步需轨迹)
------------------------------------------------------------------
第 4 步的 ac 由 greenseer 的 ua 字节流构成（前缀 s_v3#），
其中「设备段」已可由 engine.cjs 产出，「轨迹段」需真实拖动数据。
"""
import io
import json
import os
import sys

from PIL import Image

from dx_captcha import (DingXiangCaptcha, find_gap_x, gap_by_edge, gen_speed,
                        gen_track, run_engine, to_upload_x)


def main():
    c = DingXiangCaptcha()

    # ---------- 第 1 步：取滑块参数 ----------
    info = c.apply()
    print('=== 第1步 /api/a ===')
    print('sid  =', info['sid'])
    print('o    =', info['o'], '(32位还原序)')
    print('y    =', info['y'], ' type =', info['type'], '(0 表示要 +10px)')
    print('aid  =', info['aid'])

    # ---------- 第 2 步：取图 ----------
    bg = c.get_image(image_type=0)
    sl = c.get_image(image_type=1)
    print('\n=== 第2步 /api/p1 ===')
    print('背景图 %d 字节 / 滑块图 %d 字节' % (len(bg), len(sl)))
    open('bg.webp', 'wb').write(bg)
    open('slider.webp', 'wb').write(sl)
    Image.open(io.BytesIO(bg)).convert('RGB').save('bg_orig.png')

    # ---------- 缺口定位 + x 换算 ----------
    print('\n=== 缺口定位 ===')
    gx, gy, diff = find_gap_x(Image.open(io.BytesIO(bg)), Image.open(io.BytesIO(sl)), info.get('y'))
    print('模板匹配: x=%s y=%s (diff=%.2f)' % (gx, gy, diff))
    sp = gen_speed()
    upx, real = to_upload_x(gx, sp)
    print('speed=%.4f -> 真实滑动 %.2fpx, 上传 x=%.2f' % (sp, real, upx))
    print('边缘法参考:', gap_by_edge(Image.open(io.BytesIO(bg)), info.get('y')))

    # ---------- 轨迹 ----------
    seg1, seg2 = gen_track(real, sp)
    print('\n=== 轨迹 ===')
    print('段1(移动到滑块) %d 点, 段2(拖动) %d 点' % (len(seg1), len(seg2)))
    print('段2 末尾:', seg2[-3:])

    # ---------- 第 3 步：设备认证拿 token ----------
    print('\n=== 第3步 /udid/c1 ===')
    eng = run_engine('token', c.ak)
    lid = (eng.get('lids') or [{}])[-1].get('lid')
    params = eng.get('params') or []
    param = params[-1]['param'] if params else None
    print('lid   =', lid)
    print('Param =', (param or '')[:80], '... (%d 字节)' % len(param or ''))
    token = (eng.get('tokens') or [None])[0]
    print('token =', token, ' <- 第4步的 c')

    # ---------- 第 4 步：验证 ----------
    print('\n=== 第4步 POST /api/v1 ===')
    if token:
        res = c.verify(ac='<由 greenseer ua 字节流生成>', aid=info['aid'],
                       sid=info['sid'], x=round(upx), y=info['y'], c=token,
                       sc1=info['sc1'])
        print('响应:', json.dumps(res, ensure_ascii=False)[:300])
    else:
        print('未拿到 token，终止')

    out = {
        'step1': {k: v for k, v in info.items() if k != 'raw'},
        'gap': {'x': gx, 'y': gy, 'diff': diff, 'speed': sp, 'upload_x': upx},
        'step3': {'lid': lid, 'param_len': len(param or ''), 'token': token},
    }
    open('run_result.json', 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, indent=2))
    print('\n结果已写入 run_result.json')


if __name__ == '__main__':
    main()
