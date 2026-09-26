/**
 * 诊断：dump 页面里滑块相关 DOM 的真实结构与位置
 * 用法: node dump-dom.cjs
 */
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('C:/Users/34498/.workbuddy/binaries/node/workspace/node_modules/ws');

const PORT = 9466;
const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  try { await get('http://127.0.0.1:' + PORT + '/json/version'); } catch (e) {
    const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + path.join(__dirname, '.cp-dom' + Date.now()),
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
  await send('Page.navigate', { url: 'https://www.hb56.com/Login.aspx?type=pw' });

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EXC:' + JSON.stringify(r.exceptionDetails).slice(0, 200);
    return r && r.result ? r.result.value : null;
  };

  let ready = false;
  for (let i = 0; i < 26; i++) {
    await sleep(2500);
    const s = await ev('!!document.querySelector("#demo")');
    if (s) { ready = true; break; }
  }
  console.log('页面就绪:', ready);
  await sleep(6000);   // 等滑块完全渲染

  const info = await ev(`JSON.stringify((function(){
    var out = { all: [], canvases: [], demo: null };
    var demo = document.querySelector('#demo');
    out.demo = demo ? { cls: demo.className, childCount: demo.querySelectorAll('*').length } : null;
    // 所有 canvas
    var cvs = [].slice.call(document.querySelectorAll('canvas'));
    out.canvases = cvs.map(function(c){
      var r = c.getBoundingClientRect();
      return { w: c.width, h: c.height, x: Math.round(r.x), y: Math.round(r.y),
               vis: r.width > 0 && r.height > 0,
               id: c.parentNode ? c.parentNode.id : '', cls: c.className };
    });
    // demo 内所有元素（含 class 与位置）
    if (demo) {
      out.all = [].slice.call(demo.querySelectorAll('*')).map(function(e){
        var r = e.getBoundingClientRect();
        return { tag: e.tagName, id: (e.id||'').slice(0,40), cls: String(e.className||'').slice(0,50),
                 x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      }).filter(function(o){ return o.w > 0 || o.tag === 'CANVAS'; });
    }
    return out;
  })())`);
  console.log(info);
  ws.close(); process.exit(0);
})();
