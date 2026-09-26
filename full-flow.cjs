// 全流程闭合实验：放行真实 XHR -> 让 SDK 渲染滑块 -> 派发鼠标事件 -> 抓 ac
const fs = require('fs');
const path = require('path');
let JSDOM, VirtualConsole, ResourceLoader;
try { ({ JSDOM, VirtualConsole, ResourceLoader } = require('jsdom')); }
catch (e) { ({ JSDOM, VirtualConsole, ResourceLoader } = require('C:/Users/34498/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }

// ★ 关键：SDK 的 webpack publicPath 指向 cdn.dingxiang-inc.com/ctu-group/captcha-js/1.4.0/，
//   而站点实际用的是 cdn.gdtspace.com/static/dx-captcha/（chunk hash 相同 => 同一文件）。
//   这里做一次 CDN 重写，让 chunk 能真正加载，滑块才会渲染。
const CDN_REWRITE = [
  ['https://cdn.dingxiang-inc.com/ctu-group/captcha-js/1.4.0/', 'https://cdn.gdtspace.com/static/dx-captcha/'],
  ['https://cdn.dingxiang-inc.com/ctu-group/captcha-js/', 'https://cdn.gdtspace.com/static/dx-captcha/'],
  ['cdn.dingxiang-inc.com/ctu-group/constid-js', 'cdn.gdtspace.com/static/dx-captcha/libs'],
];
function rewriteUrl(u) {
  let out = String(u);
  for (const [a, b] of CDN_REWRITE) out = out.split(a).join(b);
  return out;
}
class RewriteLoader extends (ResourceLoader || class {}) {
  fetch(url, options) { return super.fetch(rewriteUrl(url), options); }
}

process.on('uncaughtException', e => { logs.push('[UNCAUGHT] ' + String(e.message).slice(0, 200)); });
process.on('unhandledRejection', e => { logs.push('[UNHANDLED] ' + String(e && e.message).slice(0, 200)); });

const AK = process.argv[2] || '90762f230adee6af3957d9a029269461';
const CDN = 'https://cdn.gdtspace.com/static/dx-captcha';
const API = 'https://captcha.gdtspace.com';
const OUT = path.join(__dirname, 'full');
fs.mkdirSync(OUT, { recursive: true });

const logs = [];
const net = { param: [], ac: [], resp: [] };

const vc = new VirtualConsole();
vc.on('jsdomError', e => logs.push('[E] ' + String(e.message).slice(0, 200)));
['log', 'warn', 'error'].forEach(k => vc.on(k, (...a) => {
  try { logs.push('[' + k + '] ' + a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ').slice(0, 400)); } catch (e) {}
}));

const sleep = ms => new Promise(r => setTimeout(r, ms));

const html = `<!DOCTYPE html><html><head>
<script src="${CDN}/index.js"></script>
</head><body><div id="demo"></div></body></html>`;

const dom = new JSDOM(html, {
  url: 'https://www.hb56.com/Login.aspx?type=pw',
  referrer: 'https://www.hb56.com/',
  runScripts: 'dangerously',
  resources: new RewriteLoader(),
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(w) {
    // ---- canvas：提供可返回像素的假实现（缺口识别需要读像素） ----
    w.HTMLCanvasElement.prototype.getContext = function () {
      const cv = this;
      return {
        canvas: cv,
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
        getImageData: (x, y, w2, h2) => {
          // 返回带随机纹理的像素，避免 SDK 认为画布全空
          const n = Math.max(4, (w2 || 1) * (h2 || 1) * 4);
          const d = new Uint8ClampedArray(n);
          for (let i = 0; i < n; i++) d[i] = (i * 37) & 0xff;
          return { data: d, width: w2 || 1, height: h2 || 1 };
        },
      };
    };
    w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    // ---- Image：jsdom 不解码 webp，直接让 onload 立刻触发 ----
    const NativeImage = w.Image;
    w.Image = function () {
      const img = new NativeImage();
      const origSet = Object.getOwnPropertyDescriptor(w.HTMLImageElement.prototype, 'src');
      try {
        Object.defineProperty(img, 'src', {
          set(v) {
            origSet.set.call(this, v);
            setTimeout(() => { try { img.onload && img.onload({}); img.dispatchEvent && img.dispatchEvent(new w.Event('load')); } catch (e) {} }, 0);
          },
          get() { return origSet.get.call(this); },
          configurable: true,
        });
      } catch (e) {}
      return img;
    };
    w.Image.prototype = NativeImage.prototype;

    // ---- 只监听不阻断 XHR ----
    const X = w.XMLHttpRequest;
    const oHdr = X.prototype.setRequestHeader, oSend = X.prototype.send, oOpen = X.prototype.open;
    X.prototype.open = function (m, u) { this.__m = m; this.__u = String(u); return oOpen.apply(this, arguments); };
    X.prototype.setRequestHeader = function (k, v) {
      (this.__h = this.__h || {})[k] = String(v);
      if (/^param$/i.test(k)) net.param.push({ url: this.__u, val: String(v) });
      return oHdr.apply(this, arguments);
    };
    X.prototype.send = function (b) {
      const self = this;
      if (b && /ac=/.test(String(b))) net.ac.push({ url: self.__u, body: String(b) });
      this.addEventListener('load', function () {
        try { net.resp.push({ url: self.__u, st: self.status, body: (self.responseText || '').slice(0, 300) }); } catch (e) {}
      });
      return oSend.apply(this, arguments);
    };
  },
});

(async () => {
  const w = dom.window;
  await sleep(9000);

  const el = w.document.getElementById('demo');
  try {
    w._dx.Captcha(el, {
      appId: AK, appKey: AK, server: API, apiServer: API,
      constIDServer: API + '/udid/c1',
      constID_js: CDN + '/libs/const-id.js', ua_js: CDN + '/libs/greenseer.js',
      picCDN: 'https://cdn.gdtspace.com',
      style: 'inline', type: 'basic', https: true,
    });
  } catch (e) { logs.push('[CAP-INIT-ERR] ' + e.message); }

  // 等滑块渲染
  for (let i = 0; i < 10; i++) {
    await sleep(2500);
    const info = (() => {
      try {
        const sl = w.document.querySelector('#demo .dx_captcha_basic_slider');
        const bar = w.document.querySelector('#demo [class*=bar]');
        return { cls: el.className, n: el.querySelectorAll('*').length, slider: !!sl, bar: bar ? bar.id : null };
      } catch (e) { return { err: e.message }; }
    })();
    logs.push('[DOM ' + i + '] ' + JSON.stringify(info));
    if (info.slider) break;
  }

  // 派发拖拽
  const fire = async () => {
    const sl = w.document.querySelector('#demo .dx_captcha_basic_slider');
    if (!sl) { logs.push('[DRAG] no slider element'); return false; }
    const r = sl.getBoundingClientRect();
    const mk = (t, x, y) => new w.MouseEvent(t, {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      button: 0, buttons: t === 'mouseup' ? 0 : 1, view: w, detail: 1,
    });
    const sx = (r.x || r.left || 0) + 30, sy = (r.y || r.top || 0) + 20;
    sl.dispatchEvent(mk('mouseover', sx, sy));
    sl.dispatchEvent(mk('mousedown', sx, sy));
    const N = 40;
    for (let i = 1; i <= N; i++) {
      const p = i / N;
      const ease = p < 0.7 ? p * 1.25 : 0.875 + (p - 0.7) * 0.42;
      sl.dispatchEvent(mk('mousemove', sx + 130 * Math.min(ease, 1), sy + Math.sin(p * 7) * 1.5));
      await sleep(12 + Math.random() * 18);
    }
    sl.dispatchEvent(mk('mouseup', sx + 130, sy));
    logs.push('[DRAG] dispatched 130px');
    return true;
  };
  const dragged = await fire();
  await sleep(7000);

  const out = {
    dragged,
    domClass: el.className,
    domNodes: el.querySelectorAll('*').length,
    acList: net.ac.map(a => ({ len: a.body.length, head: a.body.slice(0, 160) })),
    paramList: net.param.map(p => ({ len: p.val.length, head: p.val.slice(0, 60) })),
    responses: net.resp.slice(-6),
    logs: logs.slice(-30),
    demoHtml: (w.document.getElementById('demo') || {}).outerHTML || '',
  };
  fs.writeFileSync(path.join(OUT, 'full.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2).slice(0, 6000));
  process.exit(0);
})();
