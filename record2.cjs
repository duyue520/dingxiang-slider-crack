/**
 * 真人轨迹录制器 v2 —— 自动定位缺口并在页面上标出，方便你拖准
 * ---------------------------------------------------------------
 * 1) 弹出真实 Chrome 打开目标页
 * 2) 页面就绪后读取背景图 canvas 像素，做列边缘检测定位缺口
 * 3) 在缺口位置画一条红色竖线（并提示需拖动的距离）
 * 4) 你照着红线拖滑块（可以拖多次）
 * 5) 录下全部事件与提交请求/响应 -> real_track2.json
 *
 * 用法: node record2.cjs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('C:/Users/34498/.workbuddy/binaries/node/workspace/node_modules/ws');

const PORT = 9433;
const OUT = path.join(__dirname, 'real_track2.json');
const MAX_WAIT_MS = 8 * 60 * 1000;

const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  try { await get('http://127.0.0.1:' + PORT + '/json/version'); } catch (e) {
    const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + path.join(__dirname, '.cp-real2'),
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

  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){
      window.__track = { events: [], sliderRects: null, gap: null, startAt: Date.now() };
      var rec = function(e){
        try {
          window.__track.events.push({
            type: e.type,
            x: Math.round((e.clientX||0)*100)/100,
            y: Math.round((e.clientY||0)*100)/100,
            t: Math.round(performance.now()*100)/100,
            buttons: e.buttons
          });
        } catch(err){}
      };
      ['mousemove','mousedown','mouseup','pointerdown','pointermove','pointerup']
        .forEach(function(t){ document.addEventListener(t, rec, true); });

      // 缺口定位 + 页面标注
      window.__markGap = function(){
        try {
          var cv = document.querySelector('#demo .dx_captcha_basic_bg canvas');
          var bar = document.querySelector('#demo .dx_captcha_basic_bar');
          var sl  = document.querySelector('#demo .dx_captcha_basic_slider');
          if (!cv || !bar || !sl) return 'NO_ELEM';
          var ctx = cv.getContext('2d');
          var W = cv.width, H = cv.height;
          var d = ctx.getImageData(0,0,W,H).data;
          // 每列平均亮度
          var colMean = new Float32Array(W);
          for (var x=0;x<W;x++){
            var s=0;
            for (var y=0;y<H;y++){ var i=(y*W+x)*4; s+=(d[i]+d[i+1]+d[i+2])/3; }
            colMean[x]=s/H;
          }
          // 每列边缘强度（与相邻列差）
          var edge = new Float32Array(W);
          for (var x2=1;x2<W;x2++){
            var s2=0;
            for (var y2=0;y2<H;y2++){ var i2=(y2*W+x2)*4, j2=(y2*W+x2-1)*4;
              s2+=Math.abs(d[i2]-d[j2])+Math.abs(d[i2+1]-d[j2+1])+Math.abs(d[i2+2]-d[j2+2]); }
            edge[x2]=s2/H;
          }
          // 找最强的两个边缘，间距 40~70
          var best=null, order=[];
          for (var k=0;k<W;k++) order.push(k);
          order.sort(function(a,b){return edge[b]-edge[a];});
          for (var m=0;m<order.length && !best;m++){
            for (var n=0;n<order.length;n++){
              var L=Math.min(order[m],order[n]), R=Math.max(order[m],order[n]);
              if (R-L>=40 && R-L<=70 && edge[order[m]]>8){ best={x:L, x2:R}; break; }
            }
          }
          // 兜底：最暗列附近
          if (!best){
            var mi=0; for (var q=0;q<W;q++) if (colMean[q]<colMean[mi]) mi=q;
            best={x:Math.max(0,mi-25), x2:mi+25};
          }
          var rsl = sl.getBoundingClientRect(), rbar = bar.getBoundingClientRect();
          var scale = rbar.width / W;
          var gapPxInBar = best.x * scale;                    // 缺口在拖动条内的像素位置
          var sliderStart = rsl.x - rbar.x;                    // 滑块起点相对拖动条
          var needDrag = gapPxInBar - sliderStart;             // 需要拖动的距离
          window.__track.gap = { gapX: best.x, gapX2: best.x2, needDrag: Math.round(needDrag), barW: W };

          // 画标记
          var old = document.getElementById('__gapMark'); if (old) old.remove();
          var mk = document.createElement('div');
          mk.id = '__gapMark';
          mk.style.cssText = 'position:fixed;left:'+(rbar.x + gapPxInBar)+'px;top:'+(rbar.y-46)+'px;width:3px;height:'+(rbar.height+52)+'px;background:#ff2d2d;z-index:2147483647;pointer-events:none;box-shadow:0 0 6px #ff2d2d;';
          document.body.appendChild(mk);
          var tip = document.createElement('div');
          tip.style.cssText = 'position:fixed;left:'+(rbar.x + gapPxInBar - 70)+'px;top:'+(rbar.y-72)+'px;color:#fff;background:#ff2d2d;font:12px/18px sans-serif;padding:2px 8px;border-radius:4px;z-index:2147483647;pointer-events:none;white-space:nowrap;';
          tip.textContent = '把滑块拖到这里（约 '+Math.round(needDrag)+'px）';
          document.body.appendChild(tip);
          return JSON.stringify({gapX:best.x, needDrag:Math.round(needDrag), barW:W});
        } catch(e){ return 'ERR '+e.message; }
      };
    })();`,
  });

  console.log('正在打开页面，请稍候（瑞数防护下需要 40~50 秒）...');
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
    await sleep(2500);
    const mark = await ev('window.__markGap ? window.__markGap() : "NO_FN"');
    console.log('缺口定位结果:', mark);
    console.log('\n=================================================');
    console.log('  窗口里有一根【红色竖线】，那就是缺口位置');
    console.log('  请把滑块从左边拖到红线处');
    console.log('  拖不准可以多拖几次');
    console.log('=================================================\n');
  } else {
    console.log('未检测到滑块，但你仍可手动操作。');
  }

  const t0 = Date.now();
  let lastCount = 0;
  while (Date.now() - t0 < MAX_WAIT_MS) {
    await sleep(1500);
    const c = apiPosts.filter(x => x.post).length;
    if (c > lastCount) { lastCount = c; }
    if (c >= 3) { await sleep(3000); break; }     // 拖满 3 次就收工
    // 每次提交后重新标注（缺口会换）
    if (c > 0 && c === lastCount) {
      const mark2 = await ev('window.__markGap ? window.__markGap() : ""');
      if (mark2 && mark2.indexOf('gapX') >= 0) console.log('  (已刷新缺口标记: ' + mark2 + ')');
      await sleep(6000);
    }
  }

  const track = await ev('JSON.stringify(window.__track||{})');
  const out = { capturedAt: new Date().toISOString(), ready, track: JSON.parse(track || '{}'), posts: apiPosts };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  const tk = out.track || {};
  console.log('\n事件总数:', (tk.events || []).length);
  console.log('缺口信息:', JSON.stringify(tk.gap));
  console.log('提交次数:', apiPosts.filter(x => x.post).length);
  for (const p of apiPosts) {
    if (p.body) console.log('  响应:', p.body.replace(/\s+/g, ' ').slice(0, 200));
  }
  console.log('结果已写入 real_track2.json');
  ws.close(); process.exit(0);
})();
