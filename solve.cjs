/**
 * 端到端求解器 v2（混合模式 · 纯 Node 驱动，不启动浏览器）
 * ---------------------------------------------------------------
 * jsdom 负责两件事：① 用官方 constID 模块生成 Param  ② 用官方 UA 模块生成 ac
 * 所有 HTTP 请求由 Node 自己发出（可控、可重试、可看原始响应）
 *
 * 流程：
 *   [Node]  GET  /api/a          -> sid / y / p1 / p2
 *   [jsdom] constID              -> Param  (lid)
 *   [Node]  GET  /udid/c1 (Param)-> token  (c)
 *   [jsdom] UA.init({token:sid}) -> start + 事件 -> ac
 *   [Node]  POST /api/v1         -> 最终结果
 *
 * 用法: node solve.cjs [dragX] [ak]
 */
const fs = require('fs');
const path = require('path');
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
catch (e) { ({ JSDOM, VirtualConsole } = require('C:/Users/34498/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }

const DRAG_X = parseFloat(process.argv[2] || '120');
const EXT_SID = process.argv[4] || null;   // 由编排层传入的 sid（跳过自建会话）
const AK = process.argv[3] || '90762f230adee6af3957d9a029269461';
const CDN = 'https://cdn.gdtspace.com/static/dx-captcha';
const API = 'https://captcha.gdtspace.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const logs = [];
const UA_STR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

/* ================= jsdom 环境 ================= */
const vc = new VirtualConsole();
vc.on('jsdomError', e => { const m = String(e.message || ''); if (!/Could not load|Loading chunk/.test(m)) logs.push('[E] ' + m.slice(0, 140)); });
['log', 'warn', 'error'].forEach(k => vc.on(k, () => {}));

const caps = { params: [] };
const dom = new JSDOM(`<!DOCTYPE html><html><head><script src="${CDN}/index.js"></script></head><body><div id="demo"></div></body></html>`, {
  url: 'https://www.hb56.com/Login.aspx?type=pw', referrer: 'https://www.hb56.com/',
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    const D = (o, k, v) => { try { Object.defineProperty(o, k, { get: () => v, configurable: true }); } catch (e) {} };
    D(w.navigator, 'userAgent', UA_STR); D(w.navigator, 'appVersion', UA_STR.replace('Mozilla/', ''));
    D(w.navigator, 'platform', 'Win32'); D(w.navigator, 'hardwareConcurrency', 8);
    D(w.navigator, 'deviceMemory', 8); D(w.navigator, 'languages', ['zh-CN', 'zh', 'en']);
    D(w.navigator, 'language', 'zh-CN'); D(w.navigator, 'vendor', 'Google Inc.');
    D(w.navigator, 'webdriver', undefined);
    const mk = (n, f, d) => ({ name: n, filename: f, description: d, length: 1 });
    D(w.navigator, 'plugins', [mk('PDF Viewer', 'internal-pdf-viewer', 'PDF'), mk('Chrome PDF Viewer', 'internal-pdf-viewer', 'PDF')]);
    D(w.navigator, 'mimeTypes', [{ type: 'application/pdf', suffixes: 'pdf', description: 'PDF' }]);
    D(w.screen, 'width', 1920); D(w.screen, 'height', 1080);
    D(w.screen, 'availWidth', 1920); D(w.screen, 'availHeight', 1040);
    D(w.screen, 'colorDepth', 24); D(w.screen, 'pixelDepth', 24);
    D(w, 'devicePixelRatio', 1); D(w, 'outerWidth', 1920); D(w, 'outerHeight', 1080);
    D(w, 'innerWidth', 1920); D(w, 'innerHeight', 947);
    w.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}), app: { isInstalled: false } };
    try {
      const nc = require('crypto');
      if (!w.crypto || !w.crypto.subtle) Object.defineProperty(w, 'crypto', { value: nc.webcrypto, configurable: true });
      const util = require('util');
      if (!w.TextEncoder) w.TextEncoder = util.TextEncoder;
      if (!w.TextDecoder) w.TextDecoder = util.TextDecoder;
    } catch (e) {}
    if (!w.btoa) w.btoa = s => Buffer.from(String(s), 'binary').toString('base64');
    if (!w.atob) w.atob = s => Buffer.from(String(s), 'base64').toString('binary');

    const ctx = cv => ({
      canvas: cv, fillRect() {}, fillText() {}, beginPath() {}, arc() {}, stroke() {}, closePath() {},
      save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, drawImage() {}, clearRect() {},
      putImageData() {}, setTransform() {}, lineTo() {}, moveTo() {}, fill() {}, clip() {},
      createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
      createPattern: () => ({}), getContextAttributes: () => ({}), measureText: () => ({ width: 10 }),
      isPointInPath: () => false, setLineDash() {}, getLineDash: () => [],
      getImageData: (x, y, ww, hh) => {
        const n = Math.max(4, (ww || 1) * (hh || 1) * 4); const d = new Uint8ClampedArray(n);
        for (let i = 0; i < n; i++) d[i] = (i * 131 + 17) & 0xff;
        return { data: d, width: ww || 1, height: hh || 1 };
      },
    });
    w.HTMLCanvasElement.prototype.getContext = function (kind) {
      if (kind === 'webgl' || kind === 'experimental-webgl') {
        return { canvas: this, getExtension: () => null, getParameter: p => (p === 0x1F01 ? 'WebKit' : 4096),
          getShaderPrecisionFormat: () => ({ rangeMin: 127, rangeMax: 127, precision: 23 }),
          getSupportedExtensions: () => [], getContextAttributes: () => ({ alpha: true, depth: true }),
          createBuffer: () => ({}), bindBuffer() {}, bufferData() {}, createProgram: () => ({}), createShader: () => ({}),
          shaderSource() {}, compileShader() {}, getShaderParameter: () => true, attachShader() {}, linkProgram() {},
          useProgram() {}, getProgramParameter: () => true, enableVertexAttribArray() {}, vertexAttribPointer() {},
          drawArrays() {}, clear() {}, clearColor() {} };
      }
      return ctx(this);
    };
    w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    // 拦截 XHR：不真发，只捕获 Param（真正的请求由 Node 发）
    const X = w.XMLHttpRequest;
    X.prototype.open = function (m, u) { this.__u = String(u); };
    X.prototype.setRequestHeader = function (k, v) { if (/^param$/i.test(k)) caps.params.push(String(v)); };
    X.prototype.send = function () {};
  },
});

/* ================= Node HTTP ================= */
const HDR = { 'User-Agent': UA_STR, Referer: 'https://www.hb56.com/', Accept: 'application/json, text/plain, */*' };
async function httpGet(url) { const r = await fetch(url, { headers: HDR }); return { status: r.status, text: await r.text() }; }
async function httpPost(url, body, extra) {
  const r = await fetch(url, { method: 'POST', body, headers: Object.assign({}, HDR, { 'Content-Type': 'application/x-www-form-urlencoded' }, extra || {}) });
  return { status: r.status, text: await r.text() };
}

(async () => {
  const w = dom.window;
  await sleep(10000);
  const result = { step1: null, step3: null, step4: null, step5: null, logs: [] };

  /* ---------- ① GET /api/a（若外部已给 sid 则跳过） ---------- */
  let A = {};
  if (EXT_SID) { A.sid = EXT_SID; A.y = Number(process.argv[5] || 0); A.type = 0; A.o = ''; }
  const ts = Date.now();
  const rnd8 = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  const aid = `dx-${ts}-${rnd8}-1`;
  const q = new URLSearchParams({
    aid, ak: AK, c: '', de: '0', h: '150', jsv: 'v1.4.0(81)', lf: '0', m: '',
    s: '50', sid: '', tpc: '', uid: '', w: '300', wp: '1', dt: '1', wtf: 'false',
    _r: String(Math.random()),
  });
  if (!EXT_SID) {
    const rA = await httpGet(`${API}/api/a?${q}`);
    try { A = JSON.parse(rA.text); } catch (e) { console.log('api/a 解析失败:', rA.text.slice(0, 200)); }
  }
  result.step1 = { aid, sid: A.sid, y: A.y, type: A.type, o: A.o, ok: !!A.sid };
  console.log('[1] /api/a -> sid =', A.sid, '| y =', A.y, '| type =', A.type);

  /* ---------- ② jsdom: 生成 Param ---------- */
  try {
    w._dx.Captcha(w.document.getElementById('demo'), {
      appId: AK, appKey: AK, server: API, apiServer: API,
      constIDServer: API + '/udid/c1',
      picCDN: 'https://cdn.gdtspace.com',
      ua_js: CDN + '/libs/greenseer.js',        // ★ 必须显式指定，否则走降级模式
      constID_js: CDN + '/libs/const-id.js',
      style: 'inline', type: 'basic', https: true,
    });
  } catch (e) { logs.push('[INIT-ERR] ' + e.message.slice(0, 120)); }
  await sleep(3000);
  await sleep(4000);
  console.log('[2a] _dx keys =', Object.keys(w._dx || {}));

  const params = [];

  /* ---------- ③ GET /udid/c1 -> token ---------- */
  let token = process.argv[6] || null;      // 由编排层传入
  for (let i = params.length - 1; i >= 0 && !token; i--) {
    const r2 = await fetch(`${API}/udid/c1`, { headers: Object.assign({}, HDR, { Param: params[i] }) });
    const t = await r2.text();
    try {
      const j = JSON.parse(t);
      console.log(`    Param[${i}] len=${params[i].length} -> status ${j.status} ${j.msg || ''}`);
      if (j.status === 2) { token = j.data; break; }
    } catch (e) { console.log('    c1 解析失败:', t.slice(0, 100)); }
  }
  result.step3 = { token };
  console.log('[3] token =', token);

  /* ---------- ④ jsdom: 生成 ac ---------- */
  let ac = null;
  try {
    const UA = w._dx.UA;
    const inst = UA.init({ token: A.sid || '00000000000000000000000000000000' });
    inst.start();
    await sleep(500);
    if (inst.bindDomEvents) inst.bindDomEvents();
    try { inst.option.isMouseDown = true; } catch (e) {}
    const evt = (t, x, y) => new w.MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: t === 'mouseup' ? 0 : 1, view: w, detail: 1 });
    const fire = (t, x, y) => { try { w.document.dispatchEvent(evt(t, x, y)); } catch (e) {} };
    const bx = 1073, by = 340;
    // 真实用户行为：先悬停 -> 按下 -> 先加速后减速拖动（70~110 个采样点）-> 末端回拉微调 -> 抬起
    fire('mouseover', bx - 40, by);
    fire('mouseenter', bx - 40, by);
    for (let i = 0; i < 6; i++) { fire('mousemove', bx - 40 + i * 7, by + Math.sin(i) * 2); await sleep(14 + Math.random() * 30); }
    fire('mousedown', bx, by);
    await sleep(40 + Math.random() * 90);
    const N = 70 + Math.floor(Math.random() * 40);
    let cur = 0;
    for (let i = 1; i <= N; i++) {
      const p = i / N;
      // 先加速（约占 65% 行程）后减速，末段带轻微回拉
      const ease = p < 0.65 ? Math.pow(p / 0.65, 0.78) * 0.88 : 0.88 + Math.pow((p - 0.65) / 0.35, 1.6) * 0.12;
      cur = DRAG_X * Math.min(ease, 1);
      fire('mousemove', bx + cur, by + Math.sin(p * 9) * 2.2 + (Math.random() - 0.5) * 0.8);
      await sleep(6 + Math.random() * 26);
    }
    // 末端回拉 1~3px 再回到终点
    const back = 1 + Math.random() * 2;
    fire('mousemove', bx + DRAG_X - back, by);
    await sleep(50 + Math.random() * 70);
    fire('mousemove', bx + DRAG_X, by);
    await sleep(60 + Math.random() * 90);
    fire('mouseup', bx + DRAG_X, by);
    await sleep(1200);
    for (const m of ['getMM', 'getMD', 'getTC', 'getTMV', 'getKD', 'getFO']) {
      try { if (typeof inst[m] === 'function') inst[m](evt('mousemove', bx + 10, by)); } catch (e) {}
    }
    ac = inst.getUA();
    result.step4 = { acLen: String(ac).length, prefix: String(ac).slice(0, 6) };
    console.log('[4] ac 长度 =', String(ac).length, '| 前缀 =', String(ac).slice(0, 6));
  } catch (e) { console.log('AC_ERR', e.message); }

  /* ---------- ⑤ POST /api/v1 ---------- */
  if (ac && !token && !process.argv[6]) {
    fs.writeFileSync(path.join(__dirname, 'ac.txt'), String(ac));
    console.log('[5] 仅生成 ac -> ac.txt（token 由编排层补齐后可提交）');
  }
  if (ac && token) {
    const yUp = Math.max(0, Math.round(A.y || 0));
    const xUp = Math.round(DRAG_X + (A.type === 0 ? 10 : 0));
    const body = new URLSearchParams({ ac, ak: AK, aid, sid: A.sid || '', x: String(xUp), y: String(yUp), c: token }).toString();
    const r = await httpPost(`${API}/api/v1`, body);
    try { result.step5 = JSON.parse(r.text); } catch (e) { result.step5 = r.text.slice(0, 300); }
    console.log('[5] 提交结果:', JSON.stringify(result.step5));
  } else {
    console.log('[5] 跳过提交（缺 ac 或 token）');
  }

  result.logs = logs.slice(-12);
  fs.writeFileSync(path.join(__dirname, 'solve_result.json'), JSON.stringify(result, null, 2));
  console.log('\n结果已写入 solve_result.json');
  process.exit(0);
})();
