// 对比：浏览器实际执行的 greenseer 与本地下载的是否同一份
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('C:/Users/34498/.workbuddy/binaries/node/workspace/node_modules/ws');
const PORT = 9400;
const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  try { await get('http://127.0.0.1:' + PORT + '/json/version'); } catch (e) {
    const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
      '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(__dirname, '.cp-cmp'),
      '--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled', 'about:blank',
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
  await sleep(20000);
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return 'EXC:' + JSON.stringify(r.exceptionDetails).slice(0, 200); return r && r.result ? r.result.value : null; };

  const js = [
    '(async function(){',
    '  var out = {};',
    '  var urls = ["https://cdn.gdtspace.com/static/dx-captcha/libs/greenseer.js?_t=497342",',
    '              "https://cdn.gdtspace.com/static/dx-captcha/libs/greenseer.js"];',
    '  for (var i=0;i<urls.length;i++){',
    '    try { var t = await (await fetch(urls[i])).text(); out[urls[i]] = { len: t.length, head: t.slice(0,110) }; }',
    '    catch(e){ out[urls[i]] = "ERR " + e.message; }',
    '  }',
    '  try {',
    '    var caps = performance.getEntriesByType("resource").filter(function(e){return /greenseer/.test(e.name);}).map(function(e){return {name:e.name, size:e.transferSize, dur:Math.round(e.duration)};});',
    '    out.perf = caps;',
    '  } catch(e) { out.perf = "ERR"; }',
    '  try { var inst = window._dx.UA.init({token:"11111111111111111111111111111111"}); out.ctor = String(inst.constructor).slice(0,700); out.head = String(inst.ua).slice(0,34); }',
    '  catch(e) { out.ctor = "ERR " + e.message; }',
    '  return JSON.stringify(out);',
    '})()',
  ].join('\n');
  const r = await ev(js);
  console.log(String(r).slice(0, 3000));
  ws.close(); process.exit(0);
})();
