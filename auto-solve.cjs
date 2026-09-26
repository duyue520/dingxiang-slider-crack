/**
 * 全自动求解（浏览器端执行还原+缺口检测，CDP 自动拖动）
 * ---------------------------------------------------------------
 * 1) 打开页面，等滑块渲染
 * 2) 页内 JS：读背景图 canvas -> 按源码算法还原 -> 暗色连通域定位缺口
 * 3) CDP 派发真人化拖动到该位置
 * 4) 捕获提交结果；失败则重试（服务端 retry:1）
 *
 * 用法: node auto-solve.cjs [最大尝试次数，默认3]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('C:/Users/34498/.workbuddy/binaries/node/workspace/node_modules/ws');

const PORT = 9444;
const MAX_TRY = parseInt(process.argv[2] || '3', 10);
const OUT = path.join(__dirname, 'auto_result.json');
const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 注入到页面的：还原 + 缺口检测
const PAGE_FN = `
window.__dxTool = {
  buildOrder: function(o, pieces){
    var order = [];
    for (var i = 0; i < Math.min(o.length, pieces); i++) {
      var v = o.charCodeAt(i);
      var guard = 0;
      while (guard++ < 200) {
        var idx = v % pieces;
        if (order.indexOf(idx) < 0) { order.push(idx); break; }
        v++;
      }
    }
    return order;
  },
  restore: function(cv, o){
    var w = cv.width, h = cv.height, pieces = 32;
    var c = Math.floor(w / pieces);
    var order = this.buildOrder(o, pieces);
    var tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    var t = tmp.getContext('2d');
    t.drawImage(cv, 0, 0);
    for (var r = 0; r < order.length; r++) {
      var sx = order[r] * c, tx = r * c;
      if (sx + c > w || tx + c > w) continue;
      t.drawImage(cv, sx, 0, c, h, tx, 0, c, h);
    }
    return tmp;
  },
  detect: function(cv, yHint){
    var w = cv.width, h = cv.height;
    var ctx = cv.getContext('2d');
    var half = 34;
    var y0 = Math.max(0, (yHint|0) - half), y1 = Math.min(h, (yHint|0) + half);
    var bh = y1 - y0, bw = w;
    var d = ctx.getImageData(0, y0, bw, bh).data;
    var gray = new Float32Array(bw * bh), sum = 0, sum2 = 0;
    for (var i = 0; i < bw * bh; i++) {
      var g = 0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2];
      gray[i] = g; sum += g; sum2 += g*g;
    }
    var mean = sum / (bw*bh);
    var std = Math.sqrt(Math.max(0, sum2/(bw*bh) - mean*mean));
    var thr = mean - 1.05 * std;
    var seen = new Uint8Array(bw*bh);
    var best = null;
    var stack = [];
    for (var s0 = 0; s0 < bw*bh; s0++) {
      if (gray[s0] >= thr || seen[s0]) continue;
      var cnt = 0, minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
      stack.length = 0; stack.push(s0); seen[s0] = 1;
      while (stack.length) {
        var p = stack.pop(); cnt++;
        var py = (p / bw) | 0, px = p % bw;
        if (px < minx) minx = px; if (px > maxx) maxx = px;
        if (py < miny) miny = py; if (py > maxy) maxy = py;
        if (px > 0 && gray[p-1] < thr && !seen[p-1]) { seen[p-1]=1; stack.push(p-1); }
        if (px < bw-1 && gray[p+1] < thr && !seen[p+1]) { seen[p+1]=1; stack.push(p+1); }
        if (py > 0 && gray[p-bw] < thr && !seen[p-bw]) { seen[p-bw]=1; stack.push(p-bw); }
        if (py < bh-1 && gray[p+bw] < thr && !seen[p+bw]) { seen[p+bw]=1; stack.push(p+bw); }
      }
      if (cnt < 150) continue;
      var ww = maxx - minx + 1, hh = maxy - miny + 1;
      if (ww < 20 || hh < 18) continue;
      var ratio = hh / ww;
      if (ratio > 2.2 || ratio < 0.35) continue;
      if (!best || cnt > best.area) best = { x0: minx, x1: maxx, y0: miny + y0, y1: maxy + y0, area: cnt };
    }
    return best;
  }
};
'ok';
`;

(async () => {
  try { await get('http://127.0.0.1:' + PORT + '/json/version'); } catch (e) {
    const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + path.join(__dirname, '.cp-auto' + Date.now()),
      '--no-first-run', '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1400,900', '--window-position=60,40', 'about:blank',
    ], { detached: true, stdio: 'ignore' });
    c.unref();
    for (let i = 0; i < 40; i++) { try { await get('http://127.0.0.1:' + PORT + '/json/version'); break; } catch (e) { await sleep(500); } }
  }
  const list = JSON.parse(await get('http://127.0.0.1:' + PORT + '/json/list'));
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 1 << 28 });
  let id = 0; const pend = new Map();
  const posts = [];
  const send = (m, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
    const p = m.params || {};
    if (m.method === 'Network.requestWillBeSent' && /\/api\/v\d/.test(p.request.url || '')) {
      posts.push({ url: p.request.url, post: p.request.postData });
    }
    if (m.method === 'Network.responseReceived' && /\/api\/v\d/.test(p.response.url || '')) {
      posts.push({ kind: 'resp', reqId: p.requestId });
    }
    if (m.method === 'Network.loadingFinished') {
      const e = posts.find(x => x.reqId === p.requestId && x.kind === 'resp');
      if (e) send('Network.getResponseBody', { requestId: p.requestId }).then(r => {
        e.body = (r && r.body ? r.body : '').slice(0, 400);
        console.log('   >>> 响应:', e.body.replace(/\s+/g, ' ').slice(0, 180));
      }).catch(() => {});
    }
  });
  await new Promise(r => ws.on('open', r));
  await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return 'EXC:' + JSON.stringify(r.exceptionDetails).slice(0, 150); return r && r.result ? r.result.value : null; };

  // ★ 加载前注入：捕获 /api/a 响应，取出本次对应的 o(还原序) 与 y(缺口纵向位置)
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){
      window.__dxO = ''; window.__dxY = 0; window.__dxA = null;
      var oS = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function(){
        var self = this;
        this.addEventListener('load', function(){
          try {
            if (/\\/api\\/a\\?/.test(self.__u || '')) {
              var j = JSON.parse(self.responseText);
              window.__dxO = j.o || ''; window.__dxY = j.y || 0; window.__dxA = j;
            }
          } catch(e){}
        });
        return oS.apply(this, arguments);
      };
      var oO = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(m, u){ this.__u = String(u); return oO.apply(this, arguments); };
    })();`,
  });

  console.log('打开页面（瑞数防护下需 40~50 秒）...');
  await send('Page.navigate', { url: 'https://www.hb56.com/Login.aspx?type=pw' });
  let ready = false;
  for (let i = 0; i < 26; i++) {
    await sleep(2500);
    const s = JSON.parse((await ev('JSON.stringify({s:!!document.querySelector("#demo .dx_captcha_basic_slider"),l:document.documentElement.outerHTML.length})')) || '{}');
    if (s.s) { ready = true; break; }
  }
  if (!ready) { console.log('页面未就绪'); process.exit(1); }
  console.log('页面就绪，注入工具函数');
  await ev(PAGE_FN);
  await sleep(1500);

  const mouse = (t, x, y) => send('Input.dispatchMouseEvent', { type: t, x: Math.round(x), y: Math.round(y), button: 'left', buttons: t === 'mouseReleased' ? 0 : 1, clickCount: 1 });

  const results = [];
  for (let attempt = 1; attempt <= MAX_TRY; attempt++) {
    console.log('\n===== 尝试 %d/%d =====' , attempt, MAX_TRY);
    const geo = JSON.parse((await ev(`JSON.stringify((function(){
        function q(sel){ return document.querySelector(sel); }
        var s = q('#demo .dx_captcha_basic_slider') || q('[class*=dx_captcha_basic_slider]');
        var b = q('#demo .dx_captcha_basic_bar') || q('[class*=dx_captcha_basic_bar]');
        var cvs = [].slice.call(document.querySelectorAll('canvas')).filter(function(c){ return c.width >= 250; });
        var cv = cvs[0] || null;
        if (!s || !b || !cv) {
          var all = [].slice.call(document.querySelectorAll('canvas')).map(function(c){ return c.width + 'x' + c.height; });
          return {err:'missing', sliders: !!s, bars: !!b, canvases: all, demo: (q('#demo')||{}).className || null};
        }
        var rs = s.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return {sx:rs.x, sy:rs.y, sw:rs.width, sh:rs.height, bx:rb.x, by:rb.y, bw:rb.width, cvw:cv.width, cvh:cv.height};
      })())`)) || '{}');
    if (geo.err) { console.log('  元素缺失:', geo.err); break; }

    const yHint = await ev(`(function(){ try { return Number(window.__dxY||0); } catch(e){ return 0; } })()`);
    const det = JSON.parse((await ev(`JSON.stringify((function(){
        var cvs = [].slice.call(document.querySelectorAll('canvas')).filter(function(c){ return c.width >= 250; });
        var cv = cvs[0];
        if (!cv) return {err:'no canvas'};
        var rc = window.__dxTool.restore(cv, window.__dxO || '');
        return window.__dxTool.detect(rc, window.__dxY || 0);
      })())`)) || 'null');
    const oInfo = await ev('JSON.stringify({o:(window.__dxO||"").slice(0,12), y:window.__dxY, hasA:!!window.__dxA})');
    console.log('   页面会话:', oInfo);
    console.log('   缺口检测:', JSON.stringify(det));
    if (!det || det.x0 == null) { console.log('   未检出缺口'); break; }

    const scale = geo.bw / geo.cvw;
    const gapPx = det.x0 * scale;
    const sliderOffset = geo.sx - geo.bx;
    const needDrag = gapPx - sliderOffset;
    console.log('   缺口x=%s -> 拖动条内 %s px -> 需拖动 %s px', det.x0, gapPx.toFixed(1), needDrag.toFixed(1));
    if (needDrag < 8 || needDrag > 290) { console.log('   距离异常，跳过'); break; }

    // 真人化拖动
    const sx = geo.sx + geo.sw / 2, sy = geo.sy + geo.sh / 2;
    await mouse('mouseMoved', sx - 60, sy); await sleep(120);
    await mouse('mouseMoved', sx, sy); await sleep(90);
    await mouse('mousePressed', sx, sy); await sleep(60 + Math.random() * 60);
    const N = 45 + Math.floor(Math.random() * 20);
    for (let i = 1; i <= N; i++) {
      const p = i / N;
      const ease = p < 0.65 ? Math.pow(p / 0.65, 0.8) * 0.9 : 0.9 + Math.pow((p - 0.65) / 0.35, 1.5) * 0.1;
      await mouse('mouseMoved', sx + needDrag * Math.min(ease, 1), sy + Math.sin(p * 8) * 1.6);
      await sleep(9 + Math.random() * 16);
    }
    await sleep(60 + Math.random() * 70);
    await mouse('mouseReleased', sx + needDrag, sy);
    await sleep(5000);

    const last = posts.filter(x => x.body).slice(-1)[0];
    results.push({ attempt, needDrag: Math.round(needDrag), gap: det, resp: last ? last.body : null });
    if (last && /"success":true/.test(last.body)) { console.log('   ✅ 通过！'); break; }
    console.log('   未通过，重试...');
    await sleep(2500);
  }

  fs.writeFileSync(OUT, JSON.stringify({ results, posts: posts.filter(p => p.post) }, null, 2));
  console.log('\n=== 汇总 ===');
  results.forEach(r => console.log('  尝试%d  拖动%s px  ->  %s', r.attempt, r.needDrag, (r.resp || '').replace(/\s+/g, ' ').slice(0, 120)));
  ws.close(); process.exit(0);
})();
