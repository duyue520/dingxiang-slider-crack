// 在真实浏览器里 hook _dx.UA.init / Captcha，抓真实初始化 option 与 ac 生成参数
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('C:/Users/34498/.workbuddy/binaries/node/workspace/node_modules/ws');

const PORT = 9400;
const OUT = path.join(__dirname, 'flow');
fs.mkdirSync(OUT, { recursive: true });
const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ensureChrome() {
  try { await get(`http://127.0.0.1:${PORT}/json/version`); return; } catch (e) {}
  const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(__dirname, '.cp-opt')}`,
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
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');

  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){
      window.__cap = { uaOpt: [], uaInit: [], urlA: [], acs: [] };
      var tick = setInterval(function(){
        if (window._dx && window._dx.UA && window._dx.UA.init && !window._dx.UA.__hooked) {
          var orig = window._dx.UA.init;
          window._dx.UA.init = function(o){ try{ window.__cap.uaOpt.push(JSON.parse(JSON.stringify(o||{}))); }catch(e){} ; var r = orig.apply(this, arguments); window.__ua = r; return r; };
          window._dx.UA.__hooked = true;
          clearInterval(tick);
        }
      }, 50);
      var oH = XMLHttpRequest.prototype.setRequestHeader;
      XMLHttpRequest.prototype.setRequestHeader = function(k,v){
        if(/^param$/i.test(k)) window.__cap.uaInit.push({k:k,len:String(v).length});
        return oH.apply(this, arguments);
      };
      var oS = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function(b){
        if(b && /ac=/.test(String(b))) window.__cap.acs.push(String(b).slice(0, 400));
        return oS.apply(this, arguments);
      };
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
  await sleep(14000);

  const cap = await ev('JSON.stringify(window.__cap||{})');
  console.log('CAP:', String(cap).slice(0, 4000));

  // 有 UA 实例则 dump option
  const opt = await ev(`(function(){ try{ var u=window.__ua; if(!u) return 'no __ua'; var o=u.option||{}; var out={}; for(var k in o){ try{ out[k]= (typeof o[k]==='object'&&o[k]!==null)?('[obj]'+Object.keys(o[k]).slice(0,12).join(',')):String(o[k]).slice(0,80);}catch(e){out[k]='[err]';} } return JSON.stringify({props:Object.getOwnPropertyNames(u), option:out, uaHead:String(u.ua||'').slice(0,60)}); }catch(e){ return 'ERR '+e.message; } })()`);
  console.log('UA_OPT:', String(opt).slice(0, 3000));
  fs.writeFileSync(path.join(OUT, 'browser_opt.json'), JSON.stringify({ cap, opt }, null, 2));
  ws.close(); process.exit(0);
})();
