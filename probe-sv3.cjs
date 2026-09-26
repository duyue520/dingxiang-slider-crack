// 关键对照：浏览器里手动调 _dx.UA.init({token}) 看产出哪种前缀
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('C:/Users/34498/.workbuddy/binaries/node/workspace/node_modules/ws');
const PORT = 9400;
const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ensureChrome() {
  try { await get(`http://127.0.0.1:${PORT}/json/version`); return; } catch (e) {}
  const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(__dirname, '.cp-probe')}`,
    '--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled',
    '--window-size=1440,900', 'about:blank'], { detached: true, stdio: 'ignore' });
  c.unref();
  for (let i = 0; i < 40; i++) { try { await get(`http://127.0.0.1:${PORT}/json/version`); return; } catch (e) { await sleep(500); } }
  throw new Error('fail');
}

(async () => {
  await ensureChrome();
  const list = JSON.parse(await get(`http://127.0.0.1:${PORT}/json/list`));
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 1 << 28 });
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'https://www.hb56.com/Login.aspx?type=pw' });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return 'EXC:' + JSON.stringify(r.exceptionDetails).slice(0, 200); return r && r.result ? r.result.value : null; };
  const CHK = 'JSON.stringify({u:location.href,l:document.documentElement.outerHTML.length})';
  let ready = false;
  for (let a = 0; a < 6 && !ready; a++) {
    for (let i = 0; i < 12; i++) { await sleep(2000); const s = JSON.parse((await ev(CHK)) || '{}'); if (s.u && /Login\.aspx/.test(s.u) && s.l > 40000) { ready = true; break; } }
    if (!ready) await send('Page.navigate', { url: 'https://www.hb56.com/Login.aspx?type=pw' });
  }
  console.log('READY', ready);
  await sleep(16000);

  const r = await ev(`(function(){
    try{
      var out = {};
      out.uaStatics = Object.getOwnPropertyNames(window._dx.UA);
      // 1) 浏览器自动创建的那个实例
      var auto = null;
      var wrap = document.querySelector('#demo');
      for (var k in window) { }
      // 2) 手动创建
      var sid = null;
      try { sid = (window._dx._constID_params||'').slice(0,0) || null; } catch(e){}
      var inst = window._dx.UA.init({ token: sid || 'a270e9e8e2094342644d785e7874f386' });
      out.manualHead = String(inst.ua||'').slice(0, 40);
      out.manualLen  = String(inst.ua||'').length;
      out.instProps  = Object.getOwnPropertyNames(inst);
      out.optionKeys = Object.keys(inst.option||{});
      out.optionDump = JSON.stringify(inst.option||{}).slice(0,500);
      return JSON.stringify(out);
    }catch(e){ return 'ERR '+e.message; }
  })()`);
  console.log('PROBE:', String(r).slice(0, 3000));

  // 3) 直接读自动实例（通过 hook 保存）
  const r2 = await ev(`(function(){
    try{
      var out={};
      // 重新 init 一次并对比多次
      var a = window._dx.UA.init({token:'11111111111111111111111111111111'});
      var b = window._dx.UA.init({token:'22222222222222222222222222222222'});
      out.a = String(a.ua||'').slice(0,26);
      out.b = String(b.ua||'').slice(0,26);
      out.same = (String(a.ua||'').slice(0,26) === String(b.ua||'').slice(0,26));
      return JSON.stringify(out);
    }catch(e){ return 'ERR '+e.message; }
  })()`);
  console.log('MULTI:', String(r2).slice(0, 1200));
  ws.close(); process.exit(0);
})();
