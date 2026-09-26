// 抓真实浏览器拖拽后 POST /api/v1 的完整 body 参数表
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('C:/Users/34498/.workbuddy/binaries/node/workspace/node_modules/ws');
const PORT = 9411;
const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  try { await get('http://127.0.0.1:' + PORT + '/json/version'); } catch (e) {
    const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
      '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(__dirname, '.cp-post' + Date.now()),
      '--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled', 'about:blank',
    ], { detached: true, stdio: 'ignore' });
    c.unref();
    for (let i = 0; i < 40; i++) { try { await get('http://127.0.0.1:' + PORT + '/json/version'); break; } catch (e) { await sleep(500); } }
  }
  const list = JSON.parse(await get('http://127.0.0.1:' + PORT + '/json/list'));
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 1 << 28 });
  let id = 0; const pend = new Map();
  const apiPosts = [];
  const send = (m, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
    const p = m.params || {};
    if (m.method === 'Network.requestWillBeSent' && /\/api\/v\d/.test(p.request.url || '')) {
      apiPosts.push({ url: p.request.url, method: p.request.method, headers: p.request.headers, post: p.request.postData });
    }
  });
  await new Promise(r => ws.on('open', r));
  await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); return r && r.result ? r.result.value : null; };
  const CHK = 'JSON.stringify({u:location.href,l:document.documentElement.outerHTML.length})';
  let ready = false;
  for (let a = 0; a < 1 && !ready; a++) {
    await send('Page.navigate', { url: 'https://www.hb56.com/Login.aspx?type=pw' });
    for (let i = 0; i < 26; i++) { await sleep(2500); const s = JSON.parse((await ev(CHK)) || "{}"); if (s.u && /Login\.aspx/.test(s.u) && s.l > 40000) { ready = true; break; } }
  }
  console.log('READY', ready);
  await sleep(14000);

  // 用 CDP 真实输入事件拖动滑块
  const geo = JSON.parse((await ev(`(function(){var s=document.querySelector('#demo .dx_captcha_basic_slider');if(!s)return '{}';var r=s.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height});})()`)) || '{}');
  console.log('slider geo:', JSON.stringify(geo));
  if (geo.x != null) {
    const sx = geo.x + geo.w / 2, sy = geo.y + geo.h / 2;
    const mouse = (t, x, y) => send('Input.dispatchMouseEvent', { type: t, x: Math.round(x), y: Math.round(y), button: 'left', buttons: t === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    await mouse('mouseMoved', sx - 150, sy); await sleep(150);
    await mouse('mouseMoved', sx, sy); await sleep(120);
    await mouse('mousePressed', sx, sy); await sleep(80);
    const DIST = 120, N = 30;
    for (let i = 1; i <= N; i++) {
      const p = i / N, ease = p < 0.7 ? p * 1.25 : 0.875 + (p - 0.7) * 0.42;
      await mouse('mouseMoved', sx + DIST * Math.min(ease, 1), sy + Math.sin(p * 7) * 1.5);
      await sleep(10 + Math.random() * 18);
    }
    await mouse('mouseReleased', sx + DIST, sy);
  }
  await sleep(8000);

  console.log('=== POST /api/v1 次数:', apiPosts.length, '===');
  apiPosts.forEach((p, i) => {
    console.log('--- #' + i, p.url.slice(0, 120));
    if (p.post) {
      const parts = String(p.post).split('&');
      console.log('参数个数:', parts.length);
      parts.forEach(x => {
        const k = x.split('=')[0];
        const v = x.slice(k.length + 1);
        console.log('   ' + k + ' = ' + (k === 'ac' ? v.slice(0, 60) + '... (len ' + v.length + ')' : decodeURIComponent(v).slice(0, 80)));
      });
    } else console.log('   (no postData)');
  });
  fs.writeFileSync(path.join(__dirname, 'flow_post.json'), JSON.stringify(apiPosts, null, 2));
  ws.close(); process.exit(0);
})();
