// 在真实浏览器里拦截 UA.prototype.ua 的首次写入，抓调用栈，定位 s_v3 前缀来源
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('C:/Users/34498/.workbuddy/binaries/node/workspace/node_modules/ws');

const PORT = 9400;
const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ensureChrome() {
  try { await get(`http://127.0.0.1:${PORT}/json/version`); return; } catch (e) {}
  const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(__dirname, '.cp-trace')}`,
    '--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled',
    '--window-size=1440,900', 'about:blank'], { detached: true, stdio: 'ignore' });
  c.unref();
  for (let i = 0; i < 40; i++) { try { await get(`http://127.0.0.1:${PORT}/json/version`); return; } catch (e) { await sleep(500); } }
  throw new Error('chrome fail');
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

  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){
      window.__trace = { writes: [], dx: null };
      var tick = setInterval(function(){
        if (window._dx && window._dx.UA && window._dx.UA.init && !window._dx.UA.__traced) {
          var UAC = window._dx.UA;
          var realProto = null;
          // init 返回实例；给返回值的原型挂 ua 的 accessor 以捕获首次写入
          var origInit = UAC.init;
          UAC.init = function(o){
            var inst = origInit.apply(this, arguments);
            try {
              var proto = Object.getPrototypeOf(inst);
              var desc = Object.getOwnPropertyDescriptor(inst, 'ua');
              var cur = inst.ua;
              // 若 ua 是 own property，删除它让 prototype accessor 接管
              if (desc) { try { delete inst.ua; } catch(e){} }
              var store = cur;
              Object.defineProperty(proto, 'ua', {
                configurable: true,
                get: function(){ return store; },
                set: function(v){
                  if (!window.__trace.writes.length) {
                    var st = new Error('UA_UA_WRITE').stack || '';
                    window.__trace.writes.push({ value: String(v).slice(0, 80), stack: st.slice(0, 3000) });
                  }
                  store = v;
                },
              });
              inst.ua = store;   // 触发一次，捕获栈
            } catch(e){ window.__trace.err = String(e.message); }
            return inst;
          };
          UAC.__traced = true;
          window.__trace.dx = (function(){ try{ var o={}; for (var k in window._dx){ try{ o[k]= String(window._dx[k]).slice(0,90); }catch(e){o[k]='[err]';} } return o; }catch(e){ return null; } })();
          clearInterval(tick);
        }
      }, 30);
    })();`,
  });
  await send('Page.navigate', { url: 'https://www.hb56.com/Login.aspx?type=pw' });

  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); return r && r.result ? r.result.value : null; };
  const CHK = 'JSON.stringify({u:location.href,l:document.documentElement.outerHTML.length})';
  let ready = false;
  for (let a = 0; a < 6 && !ready; a++) {
    for (let i = 0; i < 12; i++) { await sleep(2000); const s = JSON.parse((await ev(CHK)) || '{}'); if (s.u && /Login\.aspx/.test(s.u) && s.l > 40000) { ready = true; break; } }
    if (!ready) await send('Page.navigate', { url: 'https://www.hb56.com/Login.aspx?type=pw' });
  }
  console.log('READY', ready);
  await sleep(16000);

  const trace = await ev('JSON.stringify(window.__trace||{})');
  const t = JSON.parse(String(trace || '{}'));
  console.log('=== _dx 快照 ===');
  console.log(JSON.stringify(t.dx, null, 1));
  console.log('=== ua 首次写入 ===');
  (t.writes || []).forEach((w, i) => { console.log('#' + i, 'value=', w.value); console.log(w.stack); });
  if (t.err) console.log('ERR', t.err);
  fs.writeFileSync(path.join(__dirname, 'docs', 'trace_ua.json'), JSON.stringify(t, null, 2));
  ws.close(); process.exit(0);
})();
