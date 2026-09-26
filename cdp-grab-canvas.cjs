/**
 * 抓取权威基准：浏览器 SDK 自己还原后的 canvas 像素 + 原始背景图 + o 参数
 * 输出一行 JSON 到 stdout：
 *   { ok, o, bgB64, canvasB64, cw, ch }
 * 供 verify_pixel.py 与 Python 还原结果做像素级比对。
 */
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('C:/Users/34498/.workbuddy/binaries/node/workspace/node_modules/ws');

const PORT = 9455;
const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  try { await get('http://127.0.0.1:' + PORT + '/json/version'); } catch (e) {
    const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + path.join(__dirname, '.cp-canvas' + Date.now()),
      '--no-first-run', '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1400,900', 'about:blank',
    ], { detached: true, stdio: 'ignore' });
    c.unref();
    for (let i = 0; i < 40; i++) { try { await get('http://127.0.0.1:' + PORT + '/json/version'); break; } catch (e) { await sleep(500); } }
  }
  const list = JSON.parse(await get('http://127.0.0.1:' + PORT + '/json/list'));
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 1 << 28 });
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable'); await send('Page.enable');

  // 加载前注入：捕获 /api/a 的 o 与 p1 路径
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){
      window.__cap = { o:'', y:0, p1:'' };
      var oO = XMLHttpRequest.prototype.open, oS = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(m,u){ this.__u = String(u); return oO.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function(){
        var self = this;
        this.addEventListener('load', function(){
          try {
            if (/\\/api\\/a\\?/.test(self.__u || '')) {
              var j = JSON.parse(self.responseText);
              window.__cap.o = j.o || ''; window.__cap.y = j.y || 0; window.__cap.p1 = j.p1 || '';
            }
          } catch(e){}
        });
        return oS.apply(this, arguments);
      };
    })();`,
  });

  await send('Page.navigate', { url: 'https://www.hb56.com/Login.aspx?type=pw' });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EXC:' + JSON.stringify(r.exceptionDetails).slice(0, 200);
    return r && r.result ? r.result.value : null;
  };

  let ready = false;
  for (let i = 0; i < 26; i++) {
    await sleep(2500);
    const s = await ev('!!document.querySelector("canvas")');
    if (s) { ready = true; break; }
  }
  if (!ready) { console.log(JSON.stringify({ ok: false, err: 'page/canvas not ready' })); process.exit(1); }

  // 等 SDK 完成还原绘制
  await sleep(4000);

  const js = `(async function(){
    try {
      var cap = window.__cap || {};
      if (!cap.p1) return JSON.stringify({ok:false, err:'no p1 captured'});
      // 1) 原始背景图（自己按同一路径取，保证与页面一致）
      var r = await fetch('https://captcha.gdtspace.com' + cap.p1);
      var buf = await r.arrayBuffer();
      var bs = ''; var u8 = new Uint8Array(buf);
      for (var i = 0; i < u8.length; i++) bs += String.fromCharCode(u8[i]);
      var bgB64 = btoa(bs);
      // 2) 浏览器 SDK 还原后的 canvas
      var cvs = [].slice.call(document.querySelectorAll('canvas')).filter(function(c){ return c.width >= 250; });
      if (!cvs.length) return JSON.stringify({ok:false, err:'no big canvas'});
      var cv = cvs[0];
      var canvasB64 = cv.toDataURL('image/png').split(',')[1];
      return JSON.stringify({ ok:true, o:cap.o, y:cap.y, p1:cap.p1, bgB64:bgB64, canvasB64:canvasB64, cw:cv.width, ch:cv.height });
    } catch(e) { return JSON.stringify({ok:false, err:String(e.message)}); }
  })()`;
  const out = await ev(js);
  console.log(typeof out === 'string' ? out : JSON.stringify({ ok: false, err: 'unexpected: ' + String(out).slice(0, 150) }));
  ws.close(); process.exit(0);
})();
