// わが家の模型 — WiFi の置き場所（段階B）。wifi-sim.js・plan.js のあと、ui.js の前に読む。
//
// 模型の壁・ドア・窓を、高さ 1m で切った材料のマス目にして（wGrid）、ルーターからの電波の強さを計算する。
// おすすめ: 電波は「ルーター→場所」と「場所→ルーター」で同じ強さ（相反性）なので、よく使う場所の印から
// 1回ずつ波を出し、マスごとに「いちばん弱い印の強さ」をとれば、そこにルーターを置いたときの結果になる。

const WS = {
  maps: {}, comb: null, combKey: '', itemKind: 'fridge', good: null, goodKey: '', best: null,
  view: 'signal', running: false, prog: 0, progText: '', token: null, timer: 0, msg: '',
  canvas: document.createElement('canvas'), canvasKey: '',
};
const SLICE_Z = 1.0;                         // 高さ 1m で切った面で計算する
const HEAT = [[-95, [8, 10, 23]], [-85, [31, 41, 107]], [-75, [56, 92, 199]], [-67, [41, 173, 158]], [-55, [148, 222, 94]], [-45, [255, 214, 77]], [-35, [255, 140, 64]], [-25, [255, 242, 224]]];
// 受信の強さの目安（wifi-wave と同じ。規格の値ではない）
function judge(db) {
  if (db >= -55) return [4, 'とても強い', '動画も余裕'];
  if (db >= -67) return [3, '強い', '動画も快適'];
  if (db >= -75) return [2, 'ふつう', 'ウェブは大丈夫'];
  if (db >= -85) return [1, '弱い', '途切れやすい'];
  return [0, 'ほぼ届かない', 'つながらないことも'];
}
function heatRGB(d) {
  if (d <= HEAT[0][0]) return HEAT[0][1];
  for (let i = 0; i < HEAT.length - 1; i++) {
    const [x0, c0] = HEAT[i], [x1, c1] = HEAT[i + 1];
    if (d < x1) { const t = (d - x0) / (x1 - x0); return c0.map((v, k) => v + (c1[k] - v) * t); }
  }
  return HEAT[HEAT.length - 1][1];
}

// ---------- 壁の材料 ----------
const HOUSES = { rc: { name: 'マンション', outer: 'conc' }, wood: { name: '木造の一戸建て', outer: 'wood' } };
const INNER = 'board';
// 壁の直線 ln の位置 t の材料。変えたものがあればそれ、なければ2つの部屋にはさまれていれば間仕切り、1つだけなら外壁
function wallMatAt(ln, t) {
  const cov = ln.src.filter(e => t >= e.t0 - 1e-3 && t <= e.t1 + 1e-3);
  for (const e of cov) { const k = M.wifi.wallMat[e.room + ':' + e.edge]; if (k && WMAT[k]) return k; }
  return new Set(cov.map(e => e.room)).size >= 2 ? INNER : HOUSES[M.wifi.house].outer;
}
function autoMatOf(room, edge) {      // 「自動」のときに何になるか（辺のまん中で）
  const W = buildWalls();
  for (const ln of W.lines) for (const e of ln.src) if (e.room === room && e.edge === edge) {
    const t = (e.t0 + e.t1) / 2, cov = ln.src.filter(x => t >= x.t0 - 1e-3 && t <= x.t1 + 1e-3);
    return new Set(cov.map(x => x.room)).size >= 2 ? INNER : HOUSES[M.wifi.house].outer;
  }
  return HOUSES[M.wifi.house].outer;
}
// 電波に効くもの（大きさは目安。上から見た幅 w × 奥行き d、m）
const ITEMS = {
  fridge: { name: '冷蔵庫', mat: 'metal', w: 0.65, d: 0.65 },
  bath:   { name: '浴槽のお湯', mat: 'water', w: 1.10, d: 0.65 },
  person: { name: '人', mat: 'water', w: 0.46, d: 0.26, round: true },
  tv:     { name: 'テレビ', mat: 'metal', w: 1.20, d: 0.04 },
};
// もののかたち（u の点 p が中にあるか）
function inItem(it, p) {
  const d = ITEMS[it.kind], s = scaleInfo().s, a = -(it.rot || 0) * Math.PI / 180;
  const x = (p[0] - it.p[0]) * s, y = (p[1] - it.p[1]) * s, lx = x * Math.cos(a) - y * Math.sin(a), ly = x * Math.sin(a) + y * Math.cos(a);
  return d.round ? (lx / (d.w / 2)) ** 2 + (ly / (d.d / 2)) ** 2 <= 1 : Math.abs(lx) <= d.w / 2 && Math.abs(ly) <= d.d / 2;
}
const openMat = k => k === 'entrance' ? 'metal' : isWindow(k) ? 'glass' : 'wood';   // ドア・引き戸は閉めた木、玄関は金属

// 壁のかけら（m）: { a, b, mat, wall: true|false（開口） }
function wallSegs() {
  const W = buildWalls(), out = [];
  for (const ln of W.lines) for (const [t0, t1] of ln.iv) {
    const cuts = new Set([t0, t1]);
    for (const e of ln.src) for (const t of [e.t0, e.t1]) if (t > t0 && t < t1) cuts.add(t);
    for (const op of ln.opens) for (const t of [op.a, op.b]) if (t > t0 && t < t1) cuts.add(t);
    const ts = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < ts.length - 1; i++) {
      const a = ts[i], b = ts[i + 1]; if (b - a < 1e-4) continue;
      const mid = (a + b) / 2, op = ln.opens.find(o => mid >= o.a && mid <= o.b);
      const isOpen = op && SLICE_Z >= op.sill && SLICE_Z <= op.head;
      out.push({ a: W.at(ln, a), b: W.at(ln, b), u: ln.u, n: ln.n, mat: isOpen ? openMat(op.kind) : wallMatAt(ln, mid), wall: !isOpen, endA: a === t0, endB: b === t1 });
    }
  }
  return out;
}

// ---------- 材料のマス目 ----------
function gridKey() {
  return JSON.stringify([M.rooms.map(r => r.pts), M.opens.map(o => [o.room, o.edge, o.t, o.kind, o.w, o.h, o.sill]), scaleInfo().s, M.ceil, M.wifi.house, M.wifi.wallMat, M.wifi.items.map(i => [i.kind, i.p, i.rot])]);
}
let GRID = null;
function wGrid() {
  const key = gridKey();
  if (GRID && GRID.key === key) return GRID;
  const s = scaleInfo().s, DX = WF.DX, pad = 0.6;
  const pts = M.rooms.flatMap(r => r.pts.map(p => [p[0] * s, p[1] * s]));
  if (!pts.length) return null;
  const x0 = Math.min(...pts.map(p => p[0])) - pad, y0 = Math.min(...pts.map(p => p[1])) - pad;
  const x1 = Math.max(...pts.map(p => p[0])) + pad, y1 = Math.max(...pts.map(p => p[1])) + pad;
  const w = Math.ceil((x1 - x0) / DX), h = Math.ceil((y1 - y0) / DX);
  if (w * h > WF.MAX_CELLS) return { tooBig: true, wm: x1 - x0, hm: y1 - y0, key };
  const ids = new Uint8Array(w * h), segs = wallSegs();
  for (const sg of segs) {
    const m = WMAT[sg.mat], half = Math.max(...m.layers.map(l => Math.max(Math.abs(l[0]), Math.abs(l[1])))) / 100;
    const L = dist(sg.a, sg.b), ea = sg.wall && sg.endA ? half : 0, eb = sg.wall && sg.endB ? half : 0;   // 角がすき間にならないよう、壁の端は厚みの半分のばす
    const xs = [sg.a[0], sg.b[0]], ys = [sg.a[1], sg.b[1]], R = half + Math.max(ea, eb) + DX;
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - R - x0) / DX)), i1 = Math.min(w - 1, Math.ceil((Math.max(...xs) + R - x0) / DX));
    const j0 = Math.max(0, Math.floor((Math.min(...ys) - R - y0) / DX)), j1 = Math.min(h - 1, Math.ceil((Math.max(...ys) + R - y0) / DX));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const qx = x0 + (i + .5) * DX - sg.a[0], qy = y0 + (j + .5) * DX - sg.a[1];
      const al = qx * sg.u[0] + qy * sg.u[1];
      if (al < -ea || al > L + eb) continue;
      const ac = (qx * sg.n[0] + qy * sg.n[1]) * 100;
      for (const [l0, l1] of m.layers) if (ac >= l0 && ac <= l1) { ids[j * w + i] = m.id; break; }
    }
  }
  for (const it of M.wifi.items) {          // 冷蔵庫・浴槽など
    const d = ITEMS[it.kind]; if (!d) continue;
    const c = [it.p[0] * s, it.p[1] * s], R = Math.hypot(d.w, d.d) / 2 + DX, id = WMAT[d.mat].id;
    const i0 = Math.max(0, Math.floor((c[0] - R - x0) / DX)), i1 = Math.min(w - 1, Math.ceil((c[0] + R - x0) / DX));
    const j0 = Math.max(0, Math.floor((c[1] - R - y0) / DX)), j1 = Math.min(h - 1, Math.ceil((c[1] + R - y0) / DX));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (inItem(it, [(x0 + (i + .5) * DX) / s, (y0 + (j + .5) * DX) / s])) ids[j * w + i] = id;
    }
  }
  GRID = { key, ver: key, w, h, ids, x0, y0, s, segs };
  return GRID;
}
const toCell = (g, p) => [Math.round((p[0] * g.s - g.x0) / WF.DX - .5), Math.round((p[1] * g.s - g.y0) / WF.DX - .5)];
// 地図（F×F マスごと）の値を u の点で読む（となりの4つで内挿）
function mapAt(g, map, p) {
  const F = WF.F, rw = Math.ceil(g.w / F), rh = Math.ceil(g.h / F);
  const fx = ((p[0] * g.s - g.x0) / WF.DX) / F - .5, fy = ((p[1] * g.s - g.y0) / WF.DX) / F - .5;
  const ix = Math.max(0, Math.min(rw - 2, Math.floor(fx))), iy = Math.max(0, Math.min(rh - 2, Math.floor(fy)));
  const tx = Math.max(0, Math.min(1, fx - ix)), ty = Math.max(0, Math.min(1, fy - iy));
  const v = (x, y) => map[y * rw + x];
  return (v(ix, iy) * (1 - tx) + v(ix + 1, iy) * tx) * (1 - ty) + (v(ix, iy + 1) * (1 - tx) + v(ix + 1, iy + 1) * tx) * ty;
}
// ルーターから印までのまっすぐな線が通る壁（なぜ弱いかの説明）
function wallsBetween(a, b) {
  const g = GRID; if (!g) return [];
  const s = g.s, A = [a[0] * s, a[1] * s], B = [b[0] * s, b[1] * s], out = [];
  const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  for (const sg of g.segs) {
    const d1 = cross(sg.a, sg.b, A), d2 = cross(sg.a, sg.b, B), d3 = cross(A, B, sg.a), d4 = cross(A, B, sg.b);
    if (d1 * d2 < 0 && d3 * d4 < 0) out.push(sg.mat);
  }
  return out;
}
function wallsText(mats) {
  if (!mats.length) return '間に壁なし';
  const f = WF.FREQ[M.wifi.freq].ghz, cnt = {};
  mats.forEach(k => { cnt[k] = (cnt[k] || 0) + 1; });
  const loss = mats.reduce((t, k) => t + slabDb(WMAT[k], f), 0);
  return `間に ${Object.entries(cnt).map(([k, n]) => WMAT[k].name + (n > 1 ? '×' + n : '')).join('・')}` + (isFinite(loss) ? `（壁だけで約 −${loss.toFixed(0)} dB）` : '（金属はほぼ通さない）');
}

// ---------- 計算をまわす ----------
// 電波を出すもの: ルーターと中継機。地図は1台ずつ計算して覚えておき、場所ごとに強いほうをとる（中継機は別のチャンネルで出す）
function sources() {
  if (!M.wifi.router) return [];
  return [{ id: 'router', name: 'ルーター', p: M.wifi.router }, ...M.wifi.ext.map((e, i) => ({ id: e.id, name: '中継機' + (M.wifi.ext.length > 1 ? i + 1 : ''), p: e.p }))];
}
const srcKey = p => gridKey() + JSON.stringify([p, M.wifi.freq]);
function routerKey() { return sources().map(x => srcKey(x.p)).join('|'); }
function combinedMap() {
  const srcs = sources(); if (!srcs.length) return null;
  const key = routerKey();
  if (WS.comb && WS.combKey === key) return WS.comb;
  const ms = srcs.map(x => WS.maps[srcKey(x.p)]);
  if (ms.some(m => !m)) return null;
  const out = Float32Array.from(ms[0]);
  for (const m of ms.slice(1)) for (let i = 0; i < out.length; i++) out[i] = Math.max(out[i], m[i]);
  WS.comb = out; WS.combKey = key; WS.canvasKey = '';
  return out;
}
// 中継機の場所でのルーターの強さ（中継機とルーターのつながり）
function extLink(e) { const m = M.wifi.router && WS.maps[srcKey(M.wifi.router)]; return m && GRID ? mapAt(GRID, m, e.p) : null; }
function goodKey() { return gridKey() + JSON.stringify([M.wifi.spots.map(p => p.p), M.wifi.freq]); }
function wifiStale() { return !M.wifi.router || !combinedMap(); }
function wifiSchedule(ms = 250) {            // 変わったら少し待ってから計算（ドラッグの途中では呼ばない）
  clearTimeout(WS.timer);
  WS.timer = setTimeout(() => { if (U.tab === 'wifi' && wifiStale() && M.wifi.router) wifiRouter(); }, ms);
}
function wifiStop() { if (WS.token) WS.token.stop = true; }
async function wifiRouter() {
  if (!wfInit()) { WS.msg = WF.err; wifiRender(); return; }
  const g = wGrid();
  if (!g) { WS.msg = '先に「図面」で部屋をなぞってください。'; wifiRender(); return; }
  if (g.tooBig) { WS.msg = `家が大きすぎて計算できません（${g.wm.toFixed(0)}×${g.hm.toFixed(0)}m。いまは面積 ${(WF.MAX_CELLS * WF.DX * WF.DX).toFixed(0)}㎡ まで）。`; wifiRender(); return; }
  wifiStop();
  const tok = WS.token = { stop: false }, srcs = sources();
  const keep = new Set(srcs.map(x => srcKey(x.p)));
  for (const k of Object.keys(WS.maps)) if (!keep.has(k)) delete WS.maps[k];   // もう使わない地図は捨てる
  const todo = srcs.filter(x => !WS.maps[srcKey(x.p)]);
  WS.running = true; WS.msg = ''; WS.prog = 0;
  try {
    for (let k = 0; k < todo.length; k++) {
      const x = todo[k], key = srcKey(x.p);
      WS.progText = '電波を計算しています' + (srcs.length > 1 ? `（${x.name}）` : ''); wifiRender();
      WS.maps[key] = await wfRun(g, toCell(g, x.p), M.wifi.freq, p => { WS.prog = (k + p) / todo.length; wifiProg(); }, tok);
    }
    WS.view = 'signal'; WS.canvasKey = '';
  } catch (e) { if (e !== 'stop') { WS.msg = '計算できませんでした: ' + e; window.__roomErr.push(String(e)); } }
  if (WS.token === tok) { WS.running = false; WS.token = null; }
  wifiRender(); requestDraw();
}
async function wifiFindBest() {
  if (!M.wifi.spots.length) { toast('先に「よく使う場所」に印を置いてください'); setTool('spot'); return; }
  if (!wfInit()) { WS.msg = WF.err; wifiRender(); return; }
  const g = wGrid();
  if (!g || g.tooBig) { wifiRouter(); return; }
  wifiStop();
  const tok = WS.token = { stop: false }, key = goodKey(), K = M.wifi.spots.length;
  WS.running = true; WS.msg = ''; WS.prog = 0;
  let worst = null;
  try {
    for (let k = 0; k < K; k++) {
      WS.progText = `置き場所を探しています（${k + 1}/${K}: ${M.wifi.spots[k].name}から）`; wifiRender();
      const m = await wfRun(g, toCell(g, M.wifi.spots[k].p), M.wifi.freq, p => { WS.prog = (k + p) / K; wifiProg(); }, tok);
      if (!worst) worst = m; else for (let i = 0; i < m.length; i++) worst[i] = Math.min(worst[i], m[i]);
    }
    WS.good = worst; WS.goodKey = key; WS.best = pickBest(g, worst); WS.view = 'good'; WS.canvasKey = '';
  } catch (e) { if (e !== 'stop') { WS.msg = '計算できませんでした: ' + e; window.__roomErr.push(String(e)); } }
  if (WS.token === tok) { WS.running = false; WS.token = null; }
  wifiRender(); requestDraw();
}
// 置ける所（部屋の中で、壁から 30cm 以上はなれた所）のうち、いちばん弱い印がいちばん強くなる所
function pickBest(g, worst) {
  const F = WF.F, rw = Math.ceil(g.w / F), rh = Math.ceil(g.h / F), s = g.s;
  const ok = new Uint8Array(rw * rh), cen = (i, j) => [(g.x0 + (i + .5) * F * WF.DX) / s, (g.y0 + (j + .5) * F * WF.DX) / s];
  const clear = 0.3;
  for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
    const p = cen(i, j);
    if (!M.rooms.some(r => inPoly(p, r.pts))) continue;
    const pm = [p[0] * s, p[1] * s];
    if (g.segs.some(sg => nearestOnSeg(pm, sg.a, sg.b).d < clear)) continue;
    ok[j * rw + i] = 1;
  }
  let best = null;
  for (let j = 1; j < rh - 1; j++) for (let i = 1; i < rw - 1; i++) {
    if (!ok[j * rw + i]) continue;
    let v = Infinity;                // まわり 3×3（約18cm 四方）でいちばん低い値。少しずれても下がらない所を選ぶ
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) v = Math.min(v, worst[(j + y) * rw + i + x]);
    if (!best || v > best.v) best = { v, p: cen(i, j) };
  }
  return best;
}

// ---------- 画面 ----------
function wifiCanvas(map) {        // 地図を色の画像に（F×F マスで1画素）
  const g = GRID, F = WF.F, rw = Math.ceil(g.w / F), rh = Math.ceil(g.h / F), c = WS.canvas;
  c.width = rw; c.height = rh;
  const x = c.getContext('2d'), im = x.createImageData(rw, rh);
  for (let i = 0; i < rw * rh; i++) { const [r, gg, b] = heatRGB(map[i]); im.data[i * 4] = r; im.data[i * 4 + 1] = gg; im.data[i * 4 + 2] = b; im.data[i * 4 + 3] = 255; }
  x.putImageData(im, 0, 0);
}
const wifiOn = () => U.tab === 'wifi';
function spotValues() {
  if (!combinedMap()) return null;
  const srcs = sources();
  return M.wifi.spots.map(sp => {
    let best = null;
    for (const x of srcs) { const v = mapAt(GRID, WS.maps[srcKey(x.p)], sp.p); if (!best || v > best.db) best = { db: v, src: x }; }
    return { sp, db: best.db, src: best.src, walls: wallsBetween(best.src.p, sp.p) };
  });
}
function wifiProg() { const b = $('wProg'); if (b) b.style.width = Math.round(WS.prog * 100) + '%'; }
function wifiRender() {
  const box = $('wifiBar'); if (!box) return;
  box.hidden = !wifiOn();
  if (!wifiOn()) return;
  document.querySelectorAll('[data-freq]').forEach(b => b.classList.toggle('on', b.dataset.freq === M.wifi.freq));
  $('wHouse').value = M.wifi.house;
  document.querySelectorAll('[data-wview]').forEach(b => { b.classList.toggle('on', b.dataset.wview === WS.view); b.disabled = b.dataset.wview === 'good' && !WS.good; });
  let html = '';
  if (WS.running) html = `<div class="wprog"><span>${esc(WS.progText)}…</span><button id="wStop">やめる</button><div class="bar"><i id="wProg"></i></div></div>`;
  else if (WS.msg) html = `<p class="wmsg">${esc(WS.msg)}</p>`;
  else if (!M.rooms.length) html = '<p class="wmsg">先に「図面」で部屋をなぞってください。</p>';
  else if (!M.wifi.router) html = '<p class="wmsg">ルーターを置きたい所を押してください。</p>';
  else {
    const vals = spotValues();
    if (WS.view === 'good' && WS.best) {
      const cur = vals && vals.length ? Math.min(...vals.map(v => v.db)) : null;
      html = `<p class="wsum">おすすめの置き場所（★）: いちばん弱い場所でも <b>約 ${WS.best.v.toFixed(0)} dBm</b>（${judge(WS.best.v)[1]}）` +
        (cur != null ? `。いまは ${cur.toFixed(0)} dBm（${WS.best.v - cur >= 0 ? '+' : '−'}${Math.abs(WS.best.v - cur).toFixed(0)} dB）` : '') +
        (M.wifi.ext.length ? '。★はルーター1台だけのときの場所です' : '') +
        ` <button id="wMove" class="pri">ここに置く</button></p>`;
    } else if (vals && vals.length) {
      const many = sources().length > 1;
      html = '<ul class="wlist">' + vals.map(v => { const j = judge(v.db); return `<li><span class="lv lv${j[0]}">${'▮'.repeat(j[0])}${'▯'.repeat(4 - j[0])}</span><b>${esc(v.sp.name)}</b> ${v.db.toFixed(0)} dBm ${j[1]}${many ? `（${esc(v.src.name)}から）` : ''}<span class="why">${esc(wallsText(v.walls))}</span></li>`; }).join('') +
        sources().slice(1).map(x => { const l = extLink(x); return l == null ? '' : `<li class="ext"><b>${esc(x.name)}</b>とルーターのつながり ${l.toFixed(0)} dBm ${judge(l)[1]}${l < -67 ? '<span class="why">−67 dBm より弱いと、中継の速さが落ちやすい（目安）</span>' : ''}</li>`; }).join('') + '</ul>';
    } else if (vals) html = '<p class="wmsg">「よく使う場所」に印を置くと、そこでの強さと、おすすめの置き場所がわかります。</p>';
    else html = '<p class="wmsg">計算を待っています。</p>';
  }
  $('wBody').innerHTML = html;
  if ($('wStop')) $('wStop').onclick = wifiStop;
  if ($('wMove')) $('wMove').onclick = () => edit(() => { M.wifi.router = WS.best.p.slice(); });
  $('wFind').disabled = WS.running || !M.wifi.spots.length;
  wifiProg();
  renderWifiTable();
}
function renderWifiTable() {       // 下の説明: 壁1枚で弱まる量
  const el = $('wMatTable'); if (!el) return;
  const rows = WALL_KEYS.map(k => { const m = WMAT[k]; return `<tr><td><span class="sw" style="background:${m.col}"></span>${m.name}</td><td>${esc(m.note)}</td>` +
    Object.keys(WF.FREQ).map(f => { const d = slabDb(m, WF.FREQ[f].ghz); return `<td class="num">${isFinite(d) ? '−' + d.toFixed(1) + ' dB' : 'ほぼ通さない'}</td>`; }).join('') + '</tr>'; });
  el.innerHTML = '<tr><th>材料</th><th>厚さ</th><th>2.4GHz</th><th>5GHz</th></tr>' + rows.join('');
}
function wifiHint() {
  return { router: 'ルーターをドラッグして、はなすと計算します。', ext: '中継機を置きたい所を押します（2台まで）。ルーターとのつながりも出します。', spot: 'よく使う場所（ソファー・机・ベッドなど）を押して印を置きます。',
    item: `押した所に「${ITEMS[WS.itemKind].name}」を置きます。電波をさえぎる・吸うものです。`, wall: '壁を押すと、材料を変えられます。' }[P.tool] || '';
}

// えらんだもの（図のすぐ下の1行）
function wifiSel(bar, s) {
  if (s.type === 'spot') {
    const sp = byId(M.wifi.spots, s.id); if (!sp) return false;
    const v = (spotValues() || []).find(x => x.sp === sp);
    bar.innerHTML = `<span class="k">よく使う場所</span><label>名前 <input type="text" id="sName" value="${esc(sp.name)}" maxlength="12"></label>
      ${v ? `<span class="note">${v.db.toFixed(0)} dBm（${judge(v.db)[1]}）・${esc(wallsText(v.walls))}</span>` : ''}<button id="sDel" class="danger">消す</button>`;
    $('sName').onchange = e => edit(() => { sp.name = e.target.value.trim() || sp.name; });
    $('sDel').onclick = () => edit(() => { M.wifi.spots = M.wifi.spots.filter(x => x !== sp); P.sel = null; });
    return true;
  }
  if (s.type === 'wall') {
    const r = byId(M.rooms, s.id); if (!r) return false;
    const k = s.id + ':' + s.edge, cur = M.wifi.wallMat[k] || '', auto = autoMatOf(s.id, s.edge);
    bar.innerHTML = `<span class="k">壁</span><select id="sMat" aria-label="壁の材料"><option value="">自動（${WMAT[auto].name}）</option>${WALL_KEYS.map(m => `<option value="${m}"${m === cur ? ' selected' : ''}>${WMAT[m].name}</option>`).join('')}</select>
      <span class="note">2.4GHz で1枚 ${(() => { const d = slabDb(WMAT[cur || auto], 2.437); return isFinite(d) ? '−' + d.toFixed(1) + ' dB' : 'ほぼ通さない'; })()}・${esc(r.name)}の辺</span>`;
    $('sMat').onchange = e => edit(() => {
      const v = e.target.value;
      // となりの部屋の同じ壁もそろえる（重なっている辺）
      const [a, b] = roomEdge(r, s.edge), tol = 0.03 / scaleInfo().s, on = (p, x, y) => nearestOnSeg(p, x, y).d < tol;
      for (const rr of M.rooms) for (let i = 0; i < rr.pts.length; i++) {
        const [c, d] = roomEdge(rr, i);
        const same = rr === r && i === s.edge, over = on(c, a, b) && on(d, a, b) || on(a, c, d) && on(b, c, d);
        if (same || over) { if (v) M.wifi.wallMat[rr.id + ':' + i] = v; else delete M.wifi.wallMat[rr.id + ':' + i]; }
      }
    });
    return true;
  }
  if (s.type === 'ext') {
    const e = byId(M.wifi.ext, s.id); if (!e) return false;
    const l = extLink(e);
    bar.innerHTML = `<span class="k">中継機</span><span class="note">${l == null ? 'ルーターとのつながりは計算のあとに出ます' : `ルーターとのつながり ${l.toFixed(0)} dBm（${judge(l)[1]}）。−67 dBm より弱いと中継の速さが落ちやすい（目安）`}</span><button id="sDel" class="danger">外す</button>`;
    $('sDel').onclick = () => edit(() => { M.wifi.ext = M.wifi.ext.filter(x => x !== e); P.sel = null; });
    return true;
  }
  if (s.type === 'item') {
    const it = byId(M.wifi.items, s.id); if (!it) return false;
    const d = ITEMS[it.kind];
    bar.innerHTML = `<span class="k">もの</span><select id="sItem" aria-label="種類">${Object.entries(ITEMS).map(([k, v]) => `<option value="${k}"${k === it.kind ? ' selected' : ''}>${v.name}</option>`).join('')}</select>
      <button id="sRot">90°回す</button><button id="sDel" class="danger">消す</button>
      <span class="note">${WMAT[d.mat].name}として計算・${Math.round(d.w * 100)}×${Math.round(d.d * 100)}cm（目安）</span>`;
    $('sItem').onchange = e => edit(() => { it.kind = e.target.value; });
    $('sRot').onclick = () => edit(() => { it.rot = ((it.rot || 0) + 90) % 360; });
    $('sDel').onclick = () => edit(() => { M.wifi.items = M.wifi.items.filter(x => x !== it); P.sel = null; });
    return true;
  }
  if (s.type === 'router') {
    bar.innerHTML = `<span class="k">ルーター</span><span class="note">ドラッグで動かせます。出力は 20dBm（目安）・${WF.FREQ[M.wifi.freq].name}</span><button id="sDel" class="danger">外す</button>`;
    $('sDel').onclick = () => edit(() => { M.wifi.router = null; P.sel = null; });
    return true;
  }
  return false;
}

// ---------- 図の上の操作と描画（plan.js から呼ばれる） ----------
const nearPx = (a, b, px) => dist(a, b) * P.z < px;
P.ext = {
  tools: ['router', 'ext', 'spot', 'item', 'wall'],
  active: wifiOn,
  down(p, sp, touch) {
    if (M.wifi.router && nearPx(p, M.wifi.router, 22)) { select({ type: 'router' }); return { ext: 'router', touch, moved: false }; }
    const ex = M.wifi.ext.find(x => nearPx(p, x.p, 20));
    if (ex) { select({ type: 'ext', id: ex.id }); return { ext: 'pt', s: ex, touch, moved: false }; }
    const hit = M.wifi.spots.find(x => nearPx(p, x.p, 18));
    if (hit) { select({ type: 'spot', id: hit.id }); return { ext: 'spot', s: hit, touch, moved: false }; }
    const ih = [...M.wifi.items].reverse().find(x => inItem(x, p) || nearPx(p, x.p, 14));
    if (ih) { select({ type: 'item', id: ih.id }); return { ext: 'pt', s: ih, touch, moved: false }; }
    if (P.tool === 'ext') {
      if (!M.wifi.router) { toast('先にルーターを置いてください'); return null; }
      if (M.wifi.ext.length >= 2) { toast('中継機は2台までです'); return null; }
      commit(); const e2 = { id: newId('e'), p: p.slice() }; M.wifi.ext.push(e2); select({ type: 'ext', id: e2.id });
      return { ext: 'pt', s: e2, touch, moved: true };
    }
    if (P.tool === 'item') {
      commit(); const it = { id: newId('i'), kind: WS.itemKind, p: p.slice(), rot: 0 }; M.wifi.items.push(it); select({ type: 'item', id: it.id });
      return { ext: 'pt', s: it, touch, moved: true };
    }
    if (P.tool === 'router') {
      commit(); M.wifi.router = p.slice(); select({ type: 'router' });
      return { ext: 'router', touch, moved: true };
    }
    if (P.tool === 'spot') {
      if (!M.rooms.some(r => inPoly(p, r.pts))) { toast('部屋の中に置いてください'); return null; }
      commit();
      const names = ['ソファー', '机', 'ベッド', 'テレビ', 'キッチン'], used = new Set(M.wifi.spots.map(x => x.name));
      const s2 = { id: newId('s'), name: names.find(n => !used.has(n)) || '場所' + (M.wifi.spots.length + 1), p: p.slice() };
      M.wifi.spots.push(s2); select({ type: 'spot', id: s2.id });
      return { ext: 'spot', s: s2, touch, moved: true };
    }
    if (P.tool === 'wall') {
      const h = hitEdge(p);
      select(h ? { type: 'wall', id: h.room.id, edge: h.edge } : null);
      return null;
    }
    return null;
  },
  move(d, p) {
    if (!d.moved) { commit(); d.moved = true; }
    if (d.ext === 'router') M.wifi.router = p.slice();
    else d.s.p = p.slice();
  },
  up(d) { if (d.moved) changed(); },
  under(g) {                       // 強さの地図（部屋の形で切りぬく）
    if (!wifiOn() || !GRID || GRID.tooBig) return;
    const good = WS.view === 'good' && WS.good && WS.goodKey === goodKey();
    const map = good ? WS.good : combinedMap();
    if (!map) return;
    const ck = good ? 'g' + WS.goodKey : 'r' + WS.combKey;
    if (WS.canvasKey !== ck) { wifiCanvas(map); WS.canvasKey = ck; }
    const s = GRID.s, F = WF.F, k = F * WF.DX / s * P.z;
    g.save();
    g.beginPath();
    for (const r of M.rooms) r.pts.forEach((p, i) => { const q = toS(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); });
    g.clip();
    g.globalAlpha = 0.85; g.imageSmoothingEnabled = true;
    g.drawImage(WS.canvas, GRID.x0 / s * P.z + P.ox, GRID.y0 / s * P.z + P.oy, WS.canvas.width * k, WS.canvas.height * k);
    g.restore();
  },
  over(g, C) {
    if (!wifiOn()) return;
    if (P.tool === 'wall') {                   // 壁の材料を色で
      const s = scaleInfo().s;
      for (const sg of wallSegs()) {
        const a = toS([sg.a[0] / s, sg.a[1] / s]), b = toS([sg.b[0] / s, sg.b[1] / s]);
        g.strokeStyle = WMAT[sg.mat].col; g.lineWidth = Math.max(3, 0.08 / s * P.z);
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      }
      if (P.sel && P.sel.type === 'wall') {
        const r = byId(M.rooms, P.sel.id);
        if (r) { const [a, b] = roomEdge(r, P.sel.edge).map(toS); g.strokeStyle = C.acc; g.lineWidth = 2; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.setLineDash([]); }
      }
    }
    const sc = scaleInfo().s;
    for (const it of M.wifi.items) {           // 冷蔵庫・浴槽など
      const d = ITEMS[it.kind]; if (!d) continue;
      const q = toS(it.p), isSel = P.sel && P.sel.type === 'item' && P.sel.id === it.id, w = d.w / sc * P.z, h = d.d / sc * P.z;
      g.save(); g.translate(q[0], q[1]); g.rotate((it.rot || 0) * Math.PI / 180);
      g.beginPath(); if (d.round) g.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); else g.rect(-w / 2, -h / 2, w, Math.max(h, 2));
      g.fillStyle = WMAT[d.mat].col; g.globalAlpha = 0.9; g.fill(); g.globalAlpha = 1;
      g.lineWidth = isSel ? 2.5 : 1.2; g.strokeStyle = isSel ? C.acc : C.ink; g.stroke();
      g.restore();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      label(g, d.name, q[0], q[1] + Math.max(w, h) / 2 + 10, '11px', C.ink, C.bg);
    }
    if (M.wifi.router) for (const e of M.wifi.ext) {   // 中継機とルーターをつなぐ点線
      const a = toS(M.wifi.router), b = toS(e.p), l = extLink(e);
      g.strokeStyle = C.muted; g.lineWidth = 1.5; g.setLineDash([4, 5]);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.setLineDash([]);
      if (l != null) { g.textAlign = 'center'; g.textBaseline = 'middle'; label(g, l.toFixed(0) + ' dBm', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 10, '11px', l < -67 ? C.est : C.muted, C.bg); }
    }
    const vals = spotValues();
    for (const sp of M.wifi.spots) {          // よく使う場所
      const q = toS(sp.p), v = vals && vals.find(x => x.sp === sp), isSel = P.sel && P.sel.type === 'spot' && P.sel.id === sp.id;
      g.beginPath(); g.arc(q[0], q[1], isSel ? 9 : 7, 0, Math.PI * 2); g.fillStyle = C.bg; g.fill();
      g.lineWidth = 3; g.strokeStyle = isSel ? C.acc : C.ink; g.stroke();
      g.beginPath(); g.arc(q[0], q[1], 2.5, 0, Math.PI * 2); g.fillStyle = isSel ? C.acc : C.ink; g.fill();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      label(g, sp.name + (v && WS.view === 'signal' ? ' ' + v.db.toFixed(0) : ''), q[0], q[1] - 18, 'bold 12px', C.ink, C.bg);
    }
    M.wifi.ext.forEach(e => {                  // 中継機（丸い箱）
      const q = toS(e.p), isSel = P.sel && P.sel.type === 'ext' && P.sel.id === e.id;
      g.beginPath(); g.arc(q[0], q[1], 10, 0, Math.PI * 2); g.fillStyle = isSel ? C.acc : C.ink; g.fill(); g.lineWidth = 2; g.strokeStyle = C.bg; g.stroke();
      g.fillStyle = C.bg; g.font = 'bold 11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('中', q[0], q[1] + 0.5);
    });
    if (M.wifi.router) {                       // ルーター（箱とアンテナ）
      const q = toS(M.wifi.router), isSel = P.sel && P.sel.type === 'router';
      g.save(); g.translate(q[0], q[1]);
      g.fillStyle = isSel ? C.acc : C.ink; g.strokeStyle = C.bg; g.lineWidth = 2;
      g.beginPath(); g.roundRect(-11, -6, 22, 12, 3); g.fill(); g.stroke();
      g.strokeStyle = isSel ? C.acc : C.ink; g.lineWidth = 2.5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-6, -6); g.lineTo(-9, -16); g.moveTo(6, -6); g.lineTo(9, -16); g.stroke();
      g.fillStyle = '#7ee08a'; g.beginPath(); g.arc(-4, 0, 1.8, 0, Math.PI * 2); g.arc(1, 0, 1.8, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    if (WS.view === 'good' && WS.best) {       // おすすめ ★
      const q = toS(WS.best.p);
      g.save(); g.translate(q[0], q[1]); g.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 6 : 14, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath(); g.fillStyle = '#ffd34d'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#3a2a00'; g.stroke(); g.restore();
    }
  },
};

function wifiInit() {
  document.querySelectorAll('[data-freq]').forEach(b => b.onclick = () => { if (M.wifi.freq !== b.dataset.freq) edit(() => { M.wifi.freq = b.dataset.freq; }); });
  document.querySelectorAll('[data-wview]').forEach(b => b.onclick = () => { WS.view = b.dataset.wview; wifiRender(); requestDraw(); });
  $('wHouse').onchange = e => edit(() => { M.wifi.house = e.target.value; });
  $('wFind').onclick = wifiFindBest;
  $('itemKind').innerHTML = Object.entries(ITEMS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  $('itemKind').onchange = e => { WS.itemKind = e.target.value; renderGuide(); };
}
