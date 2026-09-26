#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
顶象滑块（captcha.gdtspace.com）纯算客户端
================================================================
实测站点：https://www.hb56.com/Login.aspx?type=pw
ak      ：90762f230adee6af3957d9a029269461
jsv     ：v1.4.0(81)

四步协议（与 52pojie 帖《某象滑块纯算逆向分析》流程逐条对应）：
  1) GET  /api/a      取滑块参数 —— o(32位还原序)/sid/p1/p2/type/y
  2) GET  /api/p1     取图 —— imageType=0 背景图, imageType=1 滑块图
  3) GET  /udid/c1    设备认证 —— lid 放【请求头 Param】,返回 token(即第4步的 c)
  4) POST /api/v1     过滑块 —— body: ac=s_v3#...  + aid/sid/x/y/c

本模块负责 1/2/4 的纯算与图像部分；第 3 步的 Param 与第 4 步的 ac 明文
由 engine.cjs（Node 补环境直调官方 SDK）产出。
"""
import base64
import io
import json
import math
import os
import random
import re
import string
import subprocess
import sys
import time
from urllib.parse import urlencode

import requests

try:
    from PIL import Image
    import numpy as np
except ImportError:  # pragma: no cover
    Image = None
    np = None

API = 'https://captcha.gdtspace.com'
AK_DEFAULT = '90762f230adee6af3957d9a029269461'
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36')
NODE = os.environ.get('NODE_BIN', 'node')
ENGINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'engine.cjs')


# ----------------------------------------------------------------------
# 1. 基础参数生成（帖子第三步：aid / _r 纯算）
# ----------------------------------------------------------------------
def gen_aid() -> str:
    """aid = dx-<13位时间戳>-<8位随机数字>-<t>，t 实测恒为 1"""
    ts = int(time.time() * 1000)
    rnd = ''.join(random.choice(string.digits) for _ in range(8))
    return 'dx-%d-%s-1' % (ts, rnd)


def gen_r() -> str:
    """_r = (0,1) 之间的随机小数（帖子：'熟能生巧，多重复几次就知道'）"""
    return repr(random.random())


def make_local_id() -> str:
    """makeLocalID(): 32 位随机串，取值含大小写字母+数字"""
    alphabet = string.ascii_letters + string.digits
    return ''.join(random.choice(alphabet) for _ in range(32))


def gen_lid() -> str:
    """lid = 13位时间戳 + makeLocalID()（帖子第四步 / 源码 libs_const-id.js:823）"""
    return '%d%s' % (int(time.time() * 1000), make_local_id())


# ----------------------------------------------------------------------
# 2. 图片还原（帖子第六步：o 列表算法）
# ----------------------------------------------------------------------
def build_restore_order(o: str, pieces: int = 32):
    """
    源码逻辑：32 个字符逐个取十进制，%32 取余；
      余数不在列表中 -> 放入；已存在 -> 十进制+1 再 %32，直到不重复。
    返回还原顺序列表（长度 pieces）。
    """
    order = []
    for ch in o[:pieces]:
        v = ord(ch)
        while True:
            idx = v % pieces
            if idx not in order:
                order.append(idx)
                break
            v += 1
    return order


def restore_bg(raw: bytes, o: str, pieces: int = 32):
    """
    顶象把背景图纵向切成 pieces 片并打乱。按 order 重排。
    注意：150/32 = 4.6875px，必须用浮点边界，否则累计丢像素会让 x 偏小。
    """
    if Image is None:
        raise RuntimeError('需要 Pillow:  pip install pillow numpy')
    im = Image.open(io.BytesIO(raw)).convert('RGBA')
    w, h = im.size
    order = build_restore_order(o, pieces)
    ph = h / float(pieces)
    out = Image.new('RGBA', (w, h))
    for dst_i, src_i in enumerate(order):
        y0 = src_i * ph
        y1 = (src_i + 1) * ph
        box = (0, int(round(y0)), w, int(round(y1)))
        piece = im.crop(box)
        # 目标位置同样用浮点还原，尺寸取整后补足
        ty0 = int(round(dst_i * ph))
        out.paste(piece, (0, ty0))
    return out


def restore_bg_precise(raw: bytes, o: str, pieces: int = 32):
    """更精确：按行(y) 逐行映射，绝不丢像素。推荐使用。"""
    if Image is None or np is None:
        raise RuntimeError('需要 Pillow + numpy')
    im = Image.open(io.BytesIO(raw)).convert('RGB')
    arr = np.array(im)                      # (h, w, 3)
    h, w, _ = arr.shape
    order = build_restore_order(o, pieces)
    ph = h / float(pieces)
    out = np.zeros_like(arr)
    for dst_i, src_i in enumerate(order):
        # 该片在源图中的行范围（浮点）
        sy0, sy1 = src_i * ph, (src_i + 1) * ph
        ty0, ty1 = dst_i * ph, (dst_i + 1) * ph
        n = int(round(ty1) - round(ty0))
        if n <= 0:
            n = 1
        for k in range(n):
            ty = int(round(ty0)) + k
            if ty >= h:
                break
            # 在源片内按比例取行
            sy = int(round(sy0 + (k + 0.5) * (sy1 - sy0) / n))
            sy = max(0, min(h - 1, sy))
            out[ty] = arr[sy]
    return Image.fromarray(out)


# ----------------------------------------------------------------------
# 3. 缺口识别
# ----------------------------------------------------------------------
def find_gap_x(bg_img, slider_img, y_hint=None, step=1):
    """
    缺口定位。滑块图 p2 是 50x50 RGBA 的拼图块，alpha 以外是透明区，
    因此必须用 alpha 掩码，只比较“有内容”的像素（直接整图比会被透明区污染）。

    返回 (x, y, diff)。x 为缺口左边界在背景图中的像素坐标。
    """
    if np is None:
        raise RuntimeError('需要 numpy')
    bg = np.array(bg_img.convert('L'), dtype=np.float32)
    sl_rgba = np.array(slider_img.convert('RGBA'))
    sl = np.array(slider_img.convert('L'), dtype=np.float32)
    alpha = sl_rgba[:, :, 3]
    mask = alpha > 128
    if mask.sum() < 50:                     # 没有 alpha 信息则退回全图
        mask = np.ones_like(mask, dtype=bool)
    # 收缩到 mask 的 bbox，减小搜索量
    ys, xs = np.where(mask)
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    sl_c = sl[y0:y1, x0:x1]
    m_c = mask[y0:y1, x0:x1]
    sh, sw = sl_c.shape
    bh, bw = bg.shape
    if sh > bh or sw > bw:
        return None
    y_lo, y_hi = 0, bh - sh
    if y_hint is not None:
        y_lo = max(0, int(y_hint) - 35)
        y_hi = min(bh - sh, int(y_hint) + 35)
    best = (1e18, 0, 0)
    for y in range(y_lo, y_hi + 1, step):
        band = bg[y:y + sh, :]
        for x in range(0, bw - sw + 1, step):
            win = band[:, x:x + sw]
            d = float(np.abs(win - sl_c)[m_c].mean())
            if d < best[0]:
                best = (d, x, y)
    return best[1], best[2], round(best[0], 2)


def gap_by_edge(bg_img, y_hint=None, min_w=36, max_w=64):
    """
    备用：不依赖滑块图，直接在背景图上找“缺口”竖直边缘。
    顶象缺口在背景上是带暗边的空洞，表现为一强一弱的两条竖直边缘。
    """
    if np is None:
        raise RuntimeError('需要 numpy')
    bg = np.array(bg_img.convert('L'), dtype=np.float32)
    bh, bw = bg.shape
    y0 = 0 if y_hint is None else max(0, int(y_hint) - 30)
    y1 = bh if y_hint is None else min(bh, int(y_hint) + 30)
    band = bg[y0:y1, :]
    col = np.abs(np.diff(band, axis=1)).mean(axis=0)   # 每列的平均竖直梯度
    if len(col) == 0:
        return None
    # 找最强边缘，且右侧 min_w~max_w 处应有次强边缘
    order = np.argsort(col)[::-1]
    for i in order[:8]:
        for j in order[:60]:
            if j <= i:
                continue
            if min_w <= (j - i) <= max_w:
                return int(i), int(j)
    return int(order[0]), None


# ----------------------------------------------------------------------
# 4. 轨迹生成（帖子：轨迹要"观察规律"，1/10 成功率说明随便造不行）
# ----------------------------------------------------------------------
def gen_track(distance: float, speed: float = 1.0):
    """
    生成两段轨迹：
      seg1: 鼠标从页面移动到滑块（帖子红框1）
      seg2: 按住滑块拖动（帖子红框2）
    返回 (seg1, seg2)，每个元素为 (dt_ms, dx, dy)
    拖动总位移 = distance（真实滑动距离，不含初始 10px）
    """
    seg1 = []
    t = 0.0
    for _ in range(random.randint(6, 12)):
        t += random.uniform(12, 40)
        seg1.append((round(t), round(random.uniform(-3, 3), 1), round(random.uniform(-2, 2), 1)))

    seg2 = []
    t = 0.0
    cur = 0.0
    # 先快后慢 + 末端回拉微调（更像人）
    while cur < distance:
        remain = distance - cur
        step = remain * random.uniform(0.12, 0.32) if remain > 12 else remain * random.uniform(0.4, 0.8)
        step = max(0.5, step)
        cur = min(distance, cur + step)
        t += random.uniform(9, 26)
        dy = math.sin(cur / 9.0) * random.uniform(0.3, 1.4) + random.uniform(-0.6, 0.6)
        seg2.append((round(t), round(cur, 2), round(dy, 2)))
    # 末端回拉 1~3px 再回来（顶象对末段速度敏感）
    if seg2:
        back = random.uniform(1.0, 3.0)
        t += random.uniform(40, 90)
        seg2.append((round(t), round(max(0, distance - back), 2), 0))
        t += random.uniform(60, 120)
        seg2.append((round(t), round(distance, 2), 0))
    return seg1, seg2


def gen_speed():
    """speed 为 [0.9, 1.2] 的倍数（帖子第六步）"""
    return round(random.uniform(0.9, 1.2), 4)


# ----------------------------------------------------------------------
# 5. 协议客户端
# ----------------------------------------------------------------------
class DingXiangCaptcha:
    def __init__(self, ak=AK_DEFAULT, server=API, timeout=20):
        self.ak = ak
        self.server = server.rstrip('/')
        self.s = requests.Session()
        self.s.headers.update({
            'User-Agent': UA,
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://www.hb56.com/',
            'Origin': 'https://www.hb56.com',
        })
        self.timeout = timeout
        self.info = {}

    # ---- 第 1 步 --------------------------------------------------
    def apply(self, w=300, h=150, s=50):
        aid = gen_aid()
        _r = gen_r()
        params = {
            'aid': aid, 'ak': self.ak, 'c': '', 'de': 0, 'h': h,
            'jsv': 'v1.4.0(81)', 'lf': 0, 'm': '', 's': s, 'sid': '',
            'tpc': '', 'uid': '', 'w': w, 'wp': 1, 'dt': 1, 'wtf': 'false',
            '_r': _r,
        }
        r = self.s.get(self.server + '/api/a', params=params, timeout=self.timeout)
        data = r.json()
        self.info = {
            'aid': aid, '_r': _r,
            'sid': data.get('sid'),
            'o': data.get('o'),
            'y': data.get('y'),
            'type': data.get('type'),
            'p1': data.get('p1'),
            'p2': data.get('p2'),
            'sc1': data.get('sc1'),
            'raw': data,
        }
        return self.info

    # ---- 第 2 步 --------------------------------------------------
    def get_image(self, sid=None, sc1=None, image_type=0, code='', wp=1):
        """
        ★关键：/api/a 的响应里已经给出完整可用的图片路径
            p1 -> imageType=0（背景图）, p2 -> imageType=1（滑块图）
        其中 _r(32位hex) 由服务端下发，**不要自己造**，直接复用该路径即可。
        """
        path = None
        if image_type == 0:
            path = self.info.get('p1') or self.info.get('sc1')
        else:
            path = self.info.get('p2')
        if path:
            url = self.server + path.rstrip('&')
            r = self.s.get(url, timeout=self.timeout)
        else:
            url = self.server + '/api/p1'
            params = {'sid': sid, 'ak': self.ak, 'code': code, 'wp': wp,
                      'imageType': image_type, '_r': _r32()}
            r = self.s.get(url, params=params, timeout=self.timeout)
        body = r.content
        # 响应可能是 base64 文本，也可能直接是二进制
        try:
            txt = body.decode('utf-8')
            if re.fullmatch(r'[A-Za-z0-9+/=\s]+', txt) and len(txt) > 200:
                return base64.b64decode(txt)
        except Exception:
            pass
        return body

    # ---- 第 3 步（Param 由 Node 引擎生成） -------------------------
    def get_token(self, param_override=None):
        """
        lid 放请求头 Param。返回 (token, lid, param)。
        param_override: 若已由 engine.cjs 生成可传入；否则本地调 engine.cjs。
        """
        if param_override:
            param = param_override
            lid = None
        else:
            eng = run_engine('token', self.ak)
            tok = (eng.get('tokens') or [None])[0]
            lids = eng.get('lids') or []
            params = eng.get('params') or []
            lid = lids[-1]['lid'] if lids else None
            param = (params[-1]['param'] if params else None)
            if tok:
                return tok, lid, param
        r = self.s.get(self.server + '/udid/c1', headers={'Param': param}, timeout=self.timeout)
        j = r.json()
        return j.get('data'), lid, param

    # ---- 第 4 步 --------------------------------------------------
    def verify(self, ac, aid, sid, x, y, c, sc1=None):
        payload = {
            'ac': ac, 'ak': self.ak, 'aid': aid, 'sid': sid,
            'x': x, 'y': y, 'c': c,
        }
        if sc1:
            payload['sc1'] = sc1
        body = urlencode(payload)
        r = self.s.post(self.server + '/api/v1', data=body,
                        headers={'Content-Type': 'application/x-www-form-urlencoded'}, timeout=self.timeout)
        return r.json()


def _r32() -> str:
    """32 位 hex 的 _r（协议 2 的参数之一，源码 XuRhstZ 输出形态之一）"""
    return os.urandom(16).hex()


# ----------------------------------------------------------------------
# 6. Node 引擎桥
# ----------------------------------------------------------------------
def run_engine(mode='token', ak=AK_DEFAULT, timeout=90):
    cmd = [NODE, ENGINE, mode, ak]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                       cwd=os.path.dirname(ENGINE))
    out = p.stdout.strip()
    i = out.find('{')
    if i < 0:
        raise RuntimeError('engine 无输出: ' + (p.stderr or '')[:400])
    return json.loads(out[i:])


# ----------------------------------------------------------------------
def to_upload_x(gap_x: float, speed: float, y_offset: int = 10):
    """
    帖子第六步的 x 换算（type=0 时 +10px）：
        实际滑块移动距离 = (gap_x - y_offset) / speed
        实际上传 x       = 实际滑块移动距离 + y_offset
    其中 gap_x 是缺口左边界坐标，speed ∈ [0.9, 1.2]。
    """
    real = (gap_x - y_offset) / speed
    return real + y_offset, real


if __name__ == '__main__':
    c = DingXiangCaptcha()
    info = c.apply()
    print('[1] /api/a ->', json.dumps({k: v for k, v in info.items() if k != 'raw'}, ensure_ascii=False))
    print('    y=%s type=%s o=%s' % (info['y'], info['type'], info['o']))
    bg = c.get_image(image_type=0)
    sl = c.get_image(image_type=1)
    print('[2] 背景图 %d 字节, 滑块图 %d 字节' % (len(bg), len(sl)))
    open('bg.webp', 'wb').write(bg)
    open('slider.webp', 'wb').write(sl)
    if Image:
        Image.open(io.BytesIO(bg)).convert('RGB').save('bg_orig.png')
        # ★ 实测：hb56 站的背景图未打乱（无 4.69px 周期边界），直接使用
        res = find_gap_x(Image.open(io.BytesIO(bg)), Image.open(io.BytesIO(sl)), info.get('y'))
        print('    缺口匹配 -> x=%s y=%s diff=%s' % res)
        if res and res[0]:
            sp = gen_speed()
            up, real = to_upload_x(res[0], sp)
            print('    speed=%.4f  实际上传 x=%.2f (真实滑动 %.2f)' % (sp, up, real))
        e = gap_by_edge(Image.open(io.BytesIO(bg)), info.get('y'))
        print('    边缘法 -> %s' % (e,))
    print('[3] Param/token（Node 引擎）:')
    try:
        eng = run_engine('token', c.ak)
        print('    lid  =', (eng.get('lids') or [{}])[-1].get('lid'))
        print('    token=', (eng.get('tokens') or [None])[0])
    except Exception as ex:
        print('    engine 未运行:', ex)
