#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
端到端编排器（推荐入口）
================================================================
把四个步骤拆成独立进程，各司其职：

  [Python] ① GET  /api/a                -> sid / y / o / p1 / p2
  [Python] ② GET  /api/p1 (imageType 0/1)-> 图 -> 缺口识别 -> dragX
  [Node  ] ③ engine.cjs                 -> Param -> GET /udid/c1 -> token (c)
  [Node  ] ④ solve.cjs                  -> ac（官方 UA 模块生成，s_v3# 前缀）
  [Python] ⑤ POST /api/v1               -> 最终结果

用法:
    python orchestrate.py                 # 默认拖动距离由缺口识别得出
    python orchestrate.py --drag 150      # 手动指定拖动像素
"""
import argparse
import io
import json
import os
import subprocess
import sys
import time
from urllib.parse import urlencode

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dx_captcha import (DingXiangCaptcha, find_gap_x, gap_by_edge, gen_speed,
                        to_upload_x, AK_DEFAULT, UA)

HERE = os.path.dirname(os.path.abspath(__file__))
NODE = os.environ.get('NODE_BIN', 'node')
API = 'https://captcha.gdtspace.com'


def run_node(script, args, timeout=180):
    cmd = [NODE, os.path.join(HERE, script)] + [str(a) for a in args]
    p = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8',
                       errors='replace', timeout=timeout, cwd=HERE,
                       stdin=subprocess.DEVNULL)
    return p.stdout or '', p.stderr or ''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--drag', type=float, default=None, help='手动指定拖动像素')
    ap.add_argument('--ak', default=AK_DEFAULT)
    args = ap.parse_args()

    log = lambda *a: print(*a, flush=True)
    result = {}

    # ---------------- ① /api/a ----------------
    c = DingXiangCaptcha(ak=args.ak)
    info = c.apply()
    sid, y, typ, o = info['sid'], info['y'], info['type'], info['o']
    log('① /api/a    sid=%s  y=%s  type=%s' % (sid, y, typ))
    result['step1'] = {'sid': sid, 'y': y, 'type': typ, 'o': o, 'aid': info['aid']}

    # ---------------- ② 图片 + 缺口 ----------------
    drag = args.drag
    if drag is None:
        try:
            from PIL import Image
            bg = c.get_image(image_type=0)
            sl = c.get_image(image_type=1)
            open(os.path.join(HERE, 'bg.webp'), 'wb').write(bg)
            open(os.path.join(HERE, 'slider.webp'), 'wb').write(sl)
            gx, gy, diff = find_gap_x(Image.open(io.BytesIO(bg)), Image.open(io.BytesIO(sl)), y)
            sp = gen_speed()
            up, real = to_upload_x(gx, sp, 10 if typ == 0 else 0)
            drag = real
            log('② 缺口      x=%s diff=%.2f  speed=%.4f  -> 拖动 %.1fpx (上传 x=%.1f)'
                % (gx, diff, sp, real, up))
            result['step2'] = {'gapX': gx, 'diff': diff, 'speed': sp, 'drag': real, 'uploadX': up}
        except Exception as e:
            drag = 120
            log('② 缺口识别失败(%s)，回退拖动 %.0fpx' % (str(e)[:60], drag))
    else:
        log('② 手动指定拖动 %.1fpx' % drag)
    drag = float(drag)

    # ---------------- ③ Param -> token ----------------
    token = None
    out, err = run_node('engine.cjs', ['token', args.ak])
    try:
        j = json.loads(out[out.index('{'):])
        params = [p['param'] for p in (j.get('params') or [])]
        log('③ engine    Param 数量 = %s  长度 = %s' % (len(params), [len(p) for p in params]))
        # ★ engine.cjs 内部已真实请求过 /udid/c1（放行 XHR），Param 是一次性的。
        #   直接复用它在进程内拿到的 token，避免"接口防重放"(-9)。
        token = (j.get('tokens') or [None])[0]
        if token:
            log('   复用 engine 内部 token = %s' % token)
        s = requests.Session()
        s.headers.update({'User-Agent': UA, 'Referer': 'https://www.hb56.com/',
                          'Accept': 'application/json, text/plain, */*'})
        for i in ([] if token else range(len(params) - 1, -1, -1)):
            r = s.get(API + '/udid/c1', headers={'Param': params[i]}, timeout=20)
            try:
                jj = r.json()
                log('   c1[%d] len=%d -> status %s %s' % (i, len(params[i]), jj.get('status'), jj.get('msg')))
                if jj.get('status') == 2:
                    token = jj.get('data')
                    break
            except Exception:
                log('   c1 解析失败:', r.text[:120])
    except Exception as e:
        log('③ engine 失败:', str(e)[:200], err[:200])
    result['step3'] = {'token': token}
    if not token:
        log('③ 未拿到 token，终止')
        open(os.path.join(HERE, 'orchestrate_result.json'), 'w', encoding='utf-8').write(
            json.dumps(result, ensure_ascii=False, indent=2))
        return 1

    # ---------------- ④ ac ----------------
    out2, err2 = run_node('solve.cjs', [drag, args.ak, sid, y, token], timeout=240)
    log('④ solve.cjs 输出:')
    for line in (out2 or '').strip().splitlines()[-8:]:
        log('   ' + line)
    ac = None
    acp = os.path.join(HERE, 'ac.txt')
    if os.path.exists(acp):
        ac = open(acp, encoding='utf-8').read().strip()
    result['step4'] = {'acLen': len(ac or ''), 'prefix': (ac or '')[:6]}
    log('④ ac 长度=%d 前缀=%s' % (len(ac or ''), (ac or '')[:6]))
    if not ac:
        log('④ 未生成 ac，终止')
        open(os.path.join(HERE, 'orchestrate_result.json'), 'w', encoding='utf-8').write(
            json.dumps(result, ensure_ascii=False, indent=2))
        return 1

    # ---------------- ⑤ 提交 ----------------
    x_up = round(drag + (10 if typ == 0 else 0))
    body = urlencode({'ac': ac, 'ak': args.ak, 'aid': info['aid'], 'sid': sid,
                      'x': x_up, 'y': y, 'c': token})
    r = requests.post(API + '/api/v1', data=body, timeout=25,
                      headers={'Content-Type': 'application/x-www-form-urlencoded',
                               'User-Agent': UA, 'Referer': 'https://www.hb56.com/'})
    try:
        result['step5'] = r.json()
    except Exception:
        result['step5'] = r.text[:400]
    log('⑤ 提交结果 :', json.dumps(result['step5'], ensure_ascii=False))

    open(os.path.join(HERE, 'orchestrate_result.json'), 'w', encoding='utf-8').write(
        json.dumps(result, ensure_ascii=False, indent=2))
    log('\n结果已写入 orchestrate_result.json')
    return 0


if __name__ == '__main__':
    sys.exit(main())
