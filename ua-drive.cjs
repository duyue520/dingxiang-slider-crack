// 直接驱动 _dx.UA 实例：start() 采集 -> recordSA() 喂轨迹 -> app() 拼接 -> 得到完整 ua
const fs = require('fs');
const path = require('path');
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
catch (e) { ({ JSDOM, VirtualConsole } = require('C:/Users/34498/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }

const AK = process.argv[2] || '90762f230adee6af3957d9a029269461';
const CDN = 'https://cdn.gdtspace.com/static/dx-captcha';
const API = 'https://captcha.gdtspace.com';
const logs = [];

const vc = new VirtualConsole();
vc.on('jsdomError', e => logs.push('[E] ' + String(e.message).slice(0, 160)));
['log', 'warn', 'error'].forEach(k => vc.on(k, (...a) => {
  try { logs.push('[' + k + '] ' + a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ').slice(0, 300)); } catch (e) {}
}));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dom = new JSDOM(`<!DOCTYPE html><html><head><script src="${CDN}/index.js"></script></head><body><div id="demo"></div></body></html>`, {
  url: 'https://www.hb56.com/Login.aspx?type=pw',
  referrer: 'https://www.hb56.com/',
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    // ★ 环境伪装：jsdom 默认 UA 含 "jsdom"，且插件/WebGL 全空，会被判定为高危环境
    const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
    Object.defineProperty(w.navigator, 'userAgent', { get: () => CHROME_UA, configurable: true });
    Object.defineProperty(w.navigator, 'appVersion', { get: () => CHROME_UA.replace('Mozilla/', ''), configurable: true });
    Object.defineProperty(w.navigator, 'platform', { get: () => 'Win32', configurable: true });
    Object.defineProperty(w.navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
    Object.defineProperty(w.navigator, 'deviceMemory', { get: () => 8, configurable: true });
    Object.defineProperty(w.navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'], configurable: true });
    Object.defineProperty(w.navigator, 'language', { get: () => 'zh-CN', configurable: true });
    Object.defineProperty(w.navigator, 'doNotTrack', { get: () => null, configurable: true });
    Object.defineProperty(w.navigator, 'webdriver', { get: () => undefined, configurable: true });
    Object.defineProperty(w.navigator, 'vendor', { get: () => 'Google Inc.', configurable: true });
    Object.defineProperty(w.navigator, 'deviceScaleFactor', { get: () => 1, configurable: true });
    // 插件 + mimeTypes（非空，避免 md5("") 这种可疑值）
    const mkPlugin = (name, fn, desc) => ({ name, filename: fn, description: desc, length: 1 });
    const plugins = [mkPlugin('PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
                     mkPlugin('Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
                     mkPlugin('Chromium PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format')];
    Object.defineProperty(w.navigator, 'plugins', { get: () => plugins, configurable: true });
    Object.defineProperty(w.navigator, 'mimeTypes', {
      get: () => [{ type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' }],
      configurable: true,
    });
    // screen
    Object.defineProperty(w.screen, 'width', { get: () => 1920, configurable: true });
    Object.defineProperty(w.screen, 'height', { get: () => 1080, configurable: true });
    Object.defineProperty(w.screen, 'availWidth', { get: () => 1920, configurable: true });
    Object.defineProperty(w.screen, 'availHeight', { get: () => 1040, configurable: true });
    Object.defineProperty(w.screen, 'colorDepth', { get: () => 24, configurable: true });
    Object.defineProperty(w.screen, 'pixelDepth', { get: () => 24, configurable: true });
    Object.defineProperty(w, 'devicePixelRatio', { get: () => 1, configurable: true });
    Object.defineProperty(w, 'outerWidth', { get: () => 1920, configurable: true });
    Object.defineProperty(w, 'outerHeight', { get: () => 1080, configurable: true });
    Object.defineProperty(w, 'innerWidth', { get: () => 1920, configurable: true });
    Object.defineProperty(w, 'innerHeight', { get: () => 947, configurable: true });
    w.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}), app: { isInstalled: false } };

    w.HTMLCanvasElement.prototype.getContext = function (kind) {
      if (kind === 'webgl' || kind === 'experimental-webgl') {
        return {
          canvas: this, getExtension: () => null,
          getParameter: (p) => (p === 0x1F01 ? 'WebKit' : p === 0x1F00 ? 'WebKit WebGL' : 4096),
          getShaderPrecisionFormat: () => ({ rangeMin: 127, rangeMax: 127, precision: 23 }),
          getSupportedExtensions: () => ['WEBGL_debug_renderer_info'],
          getContextAttributes: () => ({ alpha: true, depth: true, stencil: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default' }),
          createBuffer: () => ({}), bindBuffer() {}, bufferData() {}, createProgram: () => ({}),
          createShader: () => ({}), shaderSource() {}, compileShader() {}, getShaderParameter: () => true,
          attachShader() {}, linkProgram() {}, useProgram() {}, getProgramParameter: () => true,
          enableVertexAttribArray() {}, vertexAttribPointer() {}, drawArrays() {}, clear() {}, clearColor() {},
        };
      }
      return __ctx(this);
    };
    // ★ 补齐 Node 缺失的 Web 加密 API —— 缺失时 greenseer 会降级为 5930# 模式
    try {
      const nodeCrypto = require('crypto');
      if (!w.crypto || !w.crypto.subtle) {
        Object.defineProperty(w, 'crypto', { value: nodeCrypto.webcrypto, configurable: true });
      } else if (!w.crypto.subtle && nodeCrypto.webcrypto) {
        Object.defineProperty(w.crypto, 'subtle', { value: nodeCrypto.webcrypto.subtle, configurable: true });
      }
    } catch (e) {}
    try {
      const util = require('util');
      if (!w.TextEncoder) w.TextEncoder = util.TextEncoder;
      if (!w.TextDecoder) w.TextDecoder = util.TextDecoder;
    } catch (e) {}
    try {
      if (!w.msCrypto && w.crypto) w.msCrypto = w.crypto;
      if (!w.performance || !w.performance.now) {
        Object.defineProperty(w, 'performance', { value: { now: () => Date.now() - 0, timeOrigin: Date.now() }, configurable: true });
      }
      if (!w.btoa) w.btoa = (s) => Buffer.from(String(s), 'binary').toString('base64');
      if (!w.atob) w.atob = (s) => Buffer.from(String(s), 'base64').toString('binary');
    } catch (e) {}
    out_env = { crypto: !!(w.crypto), subtle: !!(w.crypto && w.crypto.subtle), TE: !!w.TextEncoder };

    function __ctx(self) {
      const cv = self;
      return {
        canvas: cv, fillRect() {}, fillText() {}, strokeText() {}, beginPath() {}, arc() {}, stroke() {},
        closePath() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, drawImage() {},
        clearRect() {}, putImageData() {}, setTransform() {}, transform() {}, lineTo() {}, moveTo() {},
        fill() {}, bezierCurveTo() {}, quadraticCurveTo() {}, clip() {}, isPointInPath: () => false,
        setLineDash() {}, getLineDash: () => [], createLinearGradient: () => ({ addColorStop() {} }),
        createRadialGradient: () => ({ addColorStop() {} }), createPattern: () => ({}),
        getContextAttributes: () => ({}), measureText: () => ({ width: 10 }),
        getImageData: (x, y, w2, h2) => ({ data: new Uint8ClampedArray(Math.max(4, (w2 || 1) * (h2 || 1) * 4)), width: w2 || 1, height: h2 || 1 }),
      };
    }
    w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    // ★ 放行真实 XHR（不再阻断）：只有让 constID / UA 流程真正跑完，
    //    UA 实例才会进入与浏览器一致的加密模式（s_v3#），否则走降级标记（5930#）。
    const X = w.XMLHttpRequest;
    const oHdr = X.prototype.setRequestHeader;
    X.prototype.setRequestHeader = function (k, v) {
      (this.__h = this.__h || {})[k] = String(v);
      if (/^param$/i.test(k)) (w.__params = w.__params || []).push({ url: this.__u, val: String(v) });
      return oHdr.apply(this, arguments);
    };
  },
});

(async () => {
  const w = dom.window;
  await sleep(11000);
  const AKv = AK;
  try {
    w._dx.Captcha(w.document.getElementById('demo'), {
      appId: AKv, appKey: AKv, server: API, apiServer: API,
      constIDServer: API + '/udid/c1', picCDN: 'https://cdn.gdtspace.com',
      // ★★ 关键：SDK 默认 ua_js/constID_js 指向 cdn.dingxiang-inc.com 下的另一份文件，
      //    必须显式指向站点实际使用的 gdtspace CDN，否则 UA 会走降级模式（5930# 而非 s_v3#）
      ua_js: CDN + '/libs/greenseer.js',
      constID_js: CDN + '/libs/const-id.js',
      style: 'inline', type: 'basic', https: true,
    });
  } catch (e) { logs.push('[INIT-ERR] ' + e.message); }
  await sleep(14000);

  const out = { steps: {}, env: (typeof out_env!=='undefined'?out_env:null) };
  const UAClass = w._dx.UA;
  out.hasUA = !!UAClass;
  out.dxKeys = (()=>{ try{ return Object.keys(w._dx); }catch(e){ return null; } })();
  out.constIDParams = (()=>{ try{ return String(w._dx._constID_params||'').slice(0,60); }catch(e){ return null; } })();
  out.dxDt = (()=>{ try{ return String(w._dx.dt); }catch(e){ return null; } })();
  out.dxInSDK = (()=>{ try{ return String(w._dx.inSDK); }catch(e){ return null; } })();

  // ---- 构造 UA 实例（模拟真实 sid） ----
  // 真实站点 option（从浏览器 hook 取得）：token 即 sid
  const SID = (process.argv[3] && process.argv[3].length === 32) ? process.argv[3] : '8761a389b1d011f35ce1bfffc749e3e7';
  const inst = UAClass.init({
    token: SID, sid: SID, ak: AKv, appKey: AKv, server: API,
    form: '', inputName: 'ua',
    maxMDLog: '10', maxMMLog: '20', maxSALog: '250', maxKDLog: '10',
    maxFocusLog: '6', maxTCLog: '10', maxTMVLog: '20',
    MMInterval: '50', TMVInterval: '50',
  });
  const snap = (u) => ({ len: String(u).length, head: String(u).slice(0, 80), tail: String(u).slice(-60) });

  out.before = snap(inst.ua);
  out.props0 = Object.getOwnPropertyNames(inst);

  // ---- start()：按内部顺序采集全部设备字段 ----
  try { inst.start(); out.start = 'ok'; } catch (e) { out.start = 'ERR ' + e.message; }
  await sleep(1500);
  out.afterStart = snap(inst.ua);
  out.afterStartProps = { _sa: Array.isArray(inst._sa) ? inst._sa.length : typeof inst._sa, _ca: Array.isArray(inst._ca) ? inst._ca.length : typeof inst._ca, counters: inst.counters };

  // ---- recordSA：喂拖动轨迹 ----
  const mkEvt = (x, y, t) => ({
    clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y,
    type: 'mousemove', button: 0, buttons: 1, timeStamp: t, detail: 1,
    target: w.document.body, toElement: w.document.body,
  });
  const rec = [];
  try {
    for (let i = 0; i < 30; i++) {
      inst.recordSA(mkEvt(1073 + i * 4, 340 + Math.sin(i / 3), 1000 + i * 16));
    }
    rec.push('recordSA x30 ok');
  } catch (e) { rec.push('recordSA ERR ' + e.message); }
  try { inst.reloadSA && inst.reloadSA(); rec.push('reloadSA ok'); } catch (e) { rec.push('reloadSA ' + e.message); }
  out.record = rec;
  out.afterRecord = snap(inst.ua);

  // ---- app()：拼接 ----
  const appTry = [];
  for (const args of [[], [1, {}], [5, {}], ['getTM']]) {
    try {
      const r = inst.app(...args);
      appTry.push({ args: JSON.stringify(args).slice(0, 40), ok: true, ret: String(r).slice(0, 60) });
    } catch (e) { appTry.push({ args: JSON.stringify(args).slice(0, 40), err: e.message.slice(0, 100) }); }
  }
  out.app = appTry;

  // ---- 方案B: bindDomEvents + 真实事件派发 ----
  const tryB = [];
  try { inst.bindDomEvents(); tryB.push('bindDomEvents ok'); } catch (e) { tryB.push('bindDomEvents ERR ' + e.message.slice(0,80)); }
  try {
    inst.option && (inst.option.isMouseDown = true);
  } catch (e) {}
  const evt = (t, x, y) => new w.MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: t === 'mouseup' ? 0 : 1, view: w, detail: 1 });
  const fire = (t, x, y) => { try { w.document.dispatchEvent(evt(t, x, y)); return 'ok'; } catch (e) { return 'ERR ' + e.message.slice(0,60); } };
  out.bAfterBind = snap(inst.ua);
  tryB.push('mousedown ' + fire('mousedown', 1073, 340));
  for (let i = 1; i <= 35; i++) fire('mousemove', 1073 + i * 4, 340 + Math.sin(i / 3) * 1.5);
  tryB.push('mouseup ' + fire('mouseup', 1073 + 140, 340));
  await sleep(1200);
  out.countersAfter = JSON.parse(JSON.stringify(inst.counters || {}));
  out.saAfter = Array.isArray(inst._sa) ? inst._sa.length : typeof inst._sa;
  out.caAfter = Array.isArray(inst._ca) ? inst._ca.length : typeof inst._ca;
  out.bAfterFire = snap(inst.ua);
  out.tryB = tryB;

  // ---- 方案C: 直接调 getMM/getMD ----
  const tryC = [];
  for (const m of ['getMM', 'getMD', 'getTC', 'getTMV', 'getKD', 'getFO']) {
    try {
      const r = inst[m](mkEvt(1100, 340, Date.now()));
      tryC.push(m + ' -> ret=' + String(r).slice(0, 40));
    } catch (e) { tryC.push(m + ' ERR ' + e.message.slice(0, 70)); }
  }
  out.tryC = tryC;
  out.cAfter = snap(inst.ua);

  out.final = snap(inst.ua);
  out.ctorSrc = (()=>{ try{ return String(inst.constructor).slice(0, 5000); }catch(e){ return 'ERR '+e.message; } })();
  out.initSrc = (()=>{ try{ return String(UAClass.init).slice(0, 800); }catch(e){ return 'ERR '+e.message; } })();
  out.getUA = (() => { try { return String(inst.getUA()).slice(0, 100); } catch (e) { return 'ERR ' + e.message; } })();
  out.logs = logs.slice(-12);

  fs.writeFileSync(path.join(__dirname, 'ua-drive.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2).slice(0, 5000));
  process.exit(0);
})();
