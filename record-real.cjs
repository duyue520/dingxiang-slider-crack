/**
 * 真人轨迹录制器
 * ---------------------------------------------------------------
 * 会在屏幕上弹出一个真实 Chrome 窗口打开目标页。
 * 你只需在窗口里用鼠标把滑块拖到缺口处（正常拖，别刻意放慢）。
 * 本脚本会录制：
 *   - 每一次 mousemove / mousedown / mouseup（clientX, clientY, timeStamp）
 *   - 拖动条相对位移
 *   - POST /api/v1 的完整 body 与响应
 * 结果写入 real_track.json
 *
 * 用法: node record-real.cjs
 * 结束后按 Ctrl+C 或等它自动退出（捕获到提交后 8 秒）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('C:/Users/34498/.workbuddy/binaries/node/workspace/node_modules/ws');

const PORT = 9422;
const OUT = path.join(__dirname, 'real_track.json');
const MAX_WAIT_MS = 6 * 60 * 1000;   // 最多等 6 分钟

const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  try { await get('http://127.0.0.1:' + PORT + '/json/version'); } catch (e) {
    const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + path.join(__dirname, '.cp-real'),
      '--no-first-run', '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1400,900', '--window-position=60,40',
      'about:blank',
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
      apiPosts.push({ url: p.request.url, method: p.request.method, post: p.request.postData });
      console.log('\n>>> 捕获到提交请求！');
    }
    if (m.method === 'Network.responseReceived' && /\/api\/v\d/.test(p.response.url || '')) {
      apiPosts.push({ kind: 'resp', url: p.response.url, status: p.response.status, reqId: p.requestId });
    }
    if (m.method === 'Network.loadingFinished') {
      const e = apiPosts.find(x => x.reqId === p.requestId && x.kind === 'resp');
      if (e) send('Network.getResponseBody', { requestId: p.requestId }).then(r => {
        e.body = (r && r.body ? r.body : '').slice(0, 1000);
        console.log('>>> 提交响应:', e.body.replace(/\s+/g, ' '));
      }).catch(() => {});
    }
  });
  await new Promise(r => ws.on('open', r));
  await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');

  // 注入事件录制器（在任何页面脚本之前）
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){
      window.__track = { events: [], sliderRects: [], startAt: Date.now() };
      var rec = function(e){
        try {
          var t = e.target || {};
          window.__track.events.push({
            type: e.type,
            x: Math.round((e.clientX||0)*100)/100,
            y: Math.round((e.clientY||0)*100)/100,
            t: Math.round(performance.now()*100)/100,
            ts: e.timeStamp,
            buttons: e.buttons,
            cls: String(t.className||'').slice(0,60),
            id: t.id || ''
          });
        } catch(err){}
      };
      ['mousemove','mousedown','mouseup','mouseover','mouseout','mouseenter','pointerdown','pointermove','pointerup','touchstart','touchmove','touchend']
        .forEach(function(t){ document.addEventListener(t, rec, true); });
      // 记录滑块拖动条的初始位置
      var tick = setInterval(function(){
        var s = document.querySelector('#demo .dx_captcha_basic_slider');
        var b = document.querySelector('#demo .dx_captcha_basic_bar');
        if (s && b) {
          var rs = s.getBoundingClientRect(), rb = b.getBoundingClientRect();
          window.__track.sliderRects = {
            slider: { x: rs.x, y: rs.y, w: rs.width, h: rs.height },
            bar:    { x: rb.x, y: rb.y, w: rb.width, h: rb.height }
          };
          clearInterval(tick);
        }
      }, 200);
    })();`,
  });

  console.log('正在打开页面，请稍候（瑞数防护下页面需要 40~50 秒才加载完）...');
  await send('Page.navigate', { url: 'https://www.hb56.com/Login.aspx?type=pw' });

  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); return r && r.result ? r.result.value : null; };
  const CHK = 'JSON.stringify({u:location.href,l:document.documentElement.outerHTML.length,s:!!document.querySelector("#demo .dx_captcha_basic_slider")})';

  let ready = false;
  for (let i = 0; i < 30; i++) {
    await sleep(2500);
    const s = JSON.parse((await ev(CHK)) || '{}');
    if (s.s) { ready = true; break; }
    if (i % 4 === 0) console.log('  等待中... 页面长度=' + s.l);
  }

  if (ready) {
    console.log('\n========================================');
    console.log('  窗口已就绪，请在弹出的 Chrome 里');
    console.log('  用鼠标把滑块拖到缺口处（正常速度即可）');
    console.log('  拖动完成后我会自动停止录制');
    console.log('========================================\n');
  } else {
    console.log('窗口未检测到滑块，但你仍可尝试手动操作。');
  }

  // 等待用户操作（最多 6 分钟）
  const t0 = Date.now();
  while (Date.now() - t0 < MAX_WAIT_MS) {
    await sleep(1500);
    const done = apiPosts.some(x => x.kind === 'resp' && x.body);
    if (done) { await sleep(4000); break; }
  }

  const track = await ev('JSON.stringify(window.__track||{})');
  const out = {
    capturedAt: new Date().toISOString(),
    ready,
    track: JSON.parse(track || '{}'),
    posts: apiPosts,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  const tk = out.track || {};
  console.log('\n事件总数:', (tk.events || []).length);
  console.log('滑块位置:', JSON.stringify(tk.sliderRects));
  console.log('提交次数:', apiPosts.filter(x => x.post).length);
  console.log('结果已写入 real_track.json');
  ws.close(); process.exit(0);
})();
