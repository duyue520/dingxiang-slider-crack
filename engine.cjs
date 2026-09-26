/**
 * 顶象滑块 · Node 纯算引擎（无浏览器）
 * ------------------------------------------------------------------
 * 作用：在 jsdom 补环境里加载顶象官方 SDK，直接调用其内部实现产出：
 *   - lid        : 13位时间戳 + 32位随机串（makeLocalID）
 *   - Param      : XuRhstZ({lid,lidType,cache,appKey})  → 请求头 Param
 *   - ua         : greenseer 设备/轨迹字节流（ac 的明文体）
 *
 * 用法：
 *   node engine.cjs token [ak]      # 输出 lid / param / token
 *   node engine.cjs ua    [ak]      # 输出 ua 字节流 hex
 *   node engine.cjs dump  [ak]      # 输出全部中间值（调试）
 *
 * 输出：stdout 一行 JSON
 */
'use strict';
const fs = require('fs');
const path = require('path');

let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
catch (e) { ({ JSDOM, VirtualConsole } = require('C:/Users/34498/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }

const AK_DEFAULT = '90762f230adee6af3957d9a029269461';   // hb56.com 的 appKey（死值）
const CDN = 'https://cdn.gdtspace.com/static/dx-captcha';
const API = 'https://captcha.gdtspace.com';

const mode = process.argv[2] || 'dump';
const AK = process.argv[3] || AK_DEFAULT;
const WAIT = parseInt(process.env.DX_WAIT || '12000', 10);

const logs = [];
const caps = { params: [], lids: [], ua_hex: null, ua_len: 0, tokens: [], resp: [] };

const vc = new VirtualConsole();
vc.on('jsdomError', e => logs.push('[E] ' + String(e.message).slice(0, 200)));
['log', 'warn', 'error'].forEach(k => vc.on(k, (...a) => {
  try {
    const line = a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ');
    logs.push('[' + k + '] ' + line.slice(0, 500));
    // XuRhstZ 内部有 console.log(输入)，输入里含 lid
    const m = line.match(/"lid":"([^"]+)"/);
    if (m) caps.lids.push({ lid: m[1], raw: line.slice(0, 800) });
  } catch (e) {}
}));

const html = `<!DOCTYPE html><html><head>
<script src="${CDN}/index.js"></script>
</head><body><div id="demo"></div></body></html>`;

const dom = new JSDOM(html, {
  url: 'https://www.hb56.com/Login.aspx?type=pw',
  referrer: 'https://www.hb56.com/',
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(w) {
    /* ---- canvas 兜底（jsdom 无原生 canvas） ---- */
    w.HTMLCanvasElement.prototype.getContext = function () {
      const ctx = {
        canvas: this,
        fillRect() {}, fillText() {}, strokeText() {}, beginPath() {}, arc() {}, stroke() {},
        closePath() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
        drawImage() {}, clearRect() {}, putImageData() {}, setTransform() {}, transform() {},
        lineTo() {}, moveTo() {}, fill() {}, bezierCurveTo() {}, quadraticCurveTo() {},
        clip() {}, isPointInPath: () => false, setLineDash() {}, getLineDash: () => [],
        createLinearGradient: () => ({ addColorStop() {} }),
        createRadialGradient: () => ({ addColorStop() {} }),
        createPattern: () => ({}),
        getContextAttributes: () => ({}),
        measureText: () => ({ width: 10 }),
        getImageData: (x, y, ww, hh) => ({ data: new Uint8ClampedArray(Math.max(4, (ww || 1) * (hh || 1) * 4)), width: ww || 1, height: hh || 1 }),
      };
      return ctx;
    };
    w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    /* ---- 拦截 XHR：抓 Param 头与响应 ---- */
    const X = w.XMLHttpRequest;
    const oOpen = X.prototype.open, oSend = X.prototype.send, oHdr = X.prototype.setRequestHeader;
    X.prototype.open = function (m, u) { this.__m = m; this.__u = String(u); return oOpen.apply(this, arguments); };
    X.prototype.setRequestHeader = function (k, v) {
      (this.__h = this.__h || {})[k] = String(v);
      if (/^param$/i.test(k)) caps.params.push({ url: this.__u, param: String(v), len: String(v).length });
      return oHdr.apply(this, arguments);
    };
    X.prototype.send = function (b) {
      const self = this;
      this.addEventListener('load', function () {
        try {
          const t = self.responseText || '';
          caps.resp.push({ url: self.__u, status: self.status, body: t.slice(0, 400) });
          const m = t.match(/"data":"([A-Za-z0-9]+)"/);
          if (m && /token has been generated/.test(t)) caps.tokens.push(m[1]);
        } catch (e) {}
      });
      return oSend.apply(this, arguments);
    };
  },
});

function dumpUA(w) {
  try {
    const UA = w._dx && w._dx.UA;
    if (!UA) return { err: 'no _dx.UA' };
    const inst = UA.init({ sid: caps.sid || 'sid', ak: AK, appKey: AK, server: API });
    const methods = ['getTM', 'getBR', 'getLO', 'getCF', 'getDI', 'getEM', 'getJSV', 'getTK', 'getSC'];
    const per = {};
    for (const m of methods) {
      if (typeof inst[m] !== 'function') { per[m] = 'missing'; continue; }
      try { inst[m](); per[m] = 'ok'; } catch (e) { per[m] = 'ERR:' + String(e.message).slice(0, 80); }
    }
    const ua = inst.ua || inst._ua || '';
    caps.ua_len = String(ua).length;
    caps.ua_hex = Buffer.from(String(ua), 'binary').toString('hex');
    const info = { methods: per, ua_len: String(ua).length, ua_preview: String(ua).slice(0, 120) };
    if (mode === 'dump') {
      info.ua_full = String(ua);
      info.props = Object.getOwnPropertyNames(inst);
      info.src = {};
      for (const m of ['app', 'recordSA', 'process', 'bss', 'bs2', 'syncToForm', 'start', 'getUA']) {
        try {
          const keys = Object.getOwnPropertyNames(inst).filter(k => k !== m && typeof inst[k] === 'function');
          info.src[m] = typeof inst[m] === 'function' ? String(inst[m]).slice(0, 700) : ('typeof=' + typeof inst[m]);
        } catch (e) { info.src[m] = 'ERR ' + e.message; }
      }
      // 在原型链上找方法
      let p = inst, depth = 0, protoMethods = [];
      while (p && depth < 4) {
        protoMethods.push(...Object.getOwnPropertyNames(p).filter(k => { try { return typeof p[k] === 'function'; } catch (e) { return false; } }));
        p = Object.getPrototypeOf(p); depth++;
      }
      info.methods_all = [...new Set(protoMethods)];
    }
    return info;
  } catch (e) { return { err: String(e.message).slice(0, 200) }; }
}

setTimeout(() => {
  const w = dom.window;
  const out = { mode, ak: AK, ok: false, steps: {} };
  try {
    const el = w.document.getElementById('demo');
    w._dx.Captcha(el, {
      appId: AK, appKey: AK,
      server: API, apiServer: API,
      constIDServer: API + '/udid/c1',
      constID_js: CDN + '/libs/const-id.js',
      ua_js: CDN + '/libs/greenseer.js',
      picCDN: 'https://cdn.gdtspace.com',
      style: 'inline', type: 'basic', https: true,
    });
    out.steps.init = 'ok';
  } catch (e) { out.steps.init = 'ERR:' + String(e.message).slice(0, 160); }

  setTimeout(() => {
    out.steps.ua = dumpUA(w);
    out.lids = caps.lids;
    out.params = caps.params;
    out.tokens = caps.tokens;
    out.responses = caps.resp;
    out.ok = caps.params.length > 0;
    if (mode === 'ua') { delete out.lids; delete out.params; delete out.tokens; delete out.responses; }
    if (mode === 'token') { out.logs = logs.filter(l => /lid|Param|token/.test(l)).slice(0, 20); }
    if (mode === 'dump') { out.logs = logs.slice(-40); }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    process.exit(0);
  }, 7000);
}, WAIT);
