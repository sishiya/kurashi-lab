// わが家の模型 — 家具は入る？（段階C）。plan.js のあと、ui.js の前に読む。道さがしは move-worker.js。
//
// 家具は箱。どの面を下にするか（3通り）ごとに、床の上で動かす・回すだけで玄関の外から目当ての部屋まで行けるかを調べる。
// 壁は模型の壁（厚さ wallT）。通れるのはドア・引き戸・玄関（箱の高さが開口の高さ以下のとき）。窓は通れない。

const FURN = {   // よくある大きさの例（目安。商品の値ではない）。cm
  sofa3:  { name: '3人掛けソファー', w: 200, d: 90, h: 85 },
  sofa2:  { name: '2人掛けソファー', w: 160, d: 85, h: 80 },
  fridge: { name: '冷蔵庫（大きめ）', w: 68, d: 70, h: 183 },
  washer: { name: '洗濯機（ドラム式）', w: 64, d: 72, h: 106 },
  bed:    { name: 'ダブルのマットレス', w: 140, d: 195, h: 25 },
  shelf:  { name: '本棚', w: 90, d: 30, h: 180 },
  table:  { name: 'ダイニングテーブル', w: 150, d: 85, h: 72 },
  chest:  { name: 'たんす', w: 100, d: 45, h: 120 },
};
const MV = { running: false, res: null, key: '', t: 0, pick: 0, msg: '', prog: '', worker: null };
const moveOn = () => U.tab === 'move';
const doorPass = k => k === 'door' || k === 'sliding' || k === 'entrance';

function moveKey() {
  return JSON.stringify([M.rooms.map(r => r.pts), M.opens.map(o => [o.room, o.edge, o.t, o.kind, o.w, o.h, o.sill]), scaleInfo().s, M.ceil, M.wallT, M.move.w, M.move.d, M.move.h, M.move.target]);
}
function moveStale() { return !MV.res || MV.key !== moveKey(); }

// 壁（m の4つの角）と、通れる開口（m の線分）。箱の高さ hgt が開口より高ければ、その開口はふさがっている
function moveObstacles(hgt) {
  const T = wallT(), W = buildWalls(), obs = [], gaps = [];
  const rect = (ln, t0, t1) => {
    const A = W.at(ln, t0), B = W.at(ln, t1), nx = ln.n[0] * T / 2, ny = ln.n[1] * T / 2;
    obs.push([[A[0] - nx, A[1] - ny], [B[0] - nx, B[1] - ny], [B[0] + nx, B[1] + ny], [A[0] + nx, A[1] + ny]]);
  };
  for (const ln of W.lines) {
    const pass = ln.opens.filter(o => doorPass(o.kind) && o.sill <= 0.001 && hgt <= o.head + 1e-6).sort((p, q) => p.a - q.a);
    for (const op of ln.opens) if (doorPass(op.kind)) gaps.push({ id: op.id, a: W.at(ln, op.a), b: W.at(ln, op.b), pass: pass.includes(op) });
    for (const [t0, t1] of ln.iv) {
      let t = t0 - T / 2;                      // 外の端は厚みの半分のばす（角をふさぐ）
      for (const op of pass) {
        if (op.b <= t0 || op.a >= t1) continue;
        if (op.a > t) rect(ln, t, op.a);
        t = Math.max(t, op.b);
      }
      if (t < t1 + T / 2) rect(ln, t, t1 + T / 2);
    }
  }
  return { obs, gaps };
}
// 玄関の外（はじめの場所）。玄関の開口の外向き
function entranceInfo(a) {
  const o = M.opens.find(x => x.kind === 'entrance'); if (!o) return null;
  const G = openGeom(o); if (!G) return null;
  const s = scaleInfo().s, T = wallT(), out = [-G.n[0], -G.n[1]], c = [G.c[0] * s, G.c[1] * s];
  // 玄関の外の広さ（壁の中心線から外へ。ドアの中も箱のまん中が通れるよう、中心線より少し内がわから）
  const dep = T / 2 + a + 0.6, wid = Math.max(a, 1.5) + 1.0, pc = [c[0] + out[0] * (dep / 2 - 0.05), c[1] + out[1] * (dep / 2 - 0.05)];
  const u = [G.u[0] * wid / 2, G.u[1] * wid / 2], v = [out[0] * dep / 2, out[1] * dep / 2];
  return {
    o, c, out,
    start: [c[0] + out[0] * (T / 2 + a / 2 + 0.12), c[1] + out[1] * (T / 2 + a / 2 + 0.12), ((Math.atan2(out[1], out[0]) % Math.PI) + Math.PI) % Math.PI],
    porch: [[pc[0] - u[0] - v[0], pc[1] - u[1] - v[1]], [pc[0] + u[0] - v[0], pc[1] + u[1] - v[1]], [pc[0] + u[0] + v[0], pc[1] + u[1] + v[1]], [pc[0] - u[0] + v[0], pc[1] - u[1] + v[1]]],
  };
}
// 寝かせ方: どの寸法を縦（高さ）にするか
function orientations() {
  const d = [M.move.w, M.move.d, M.move.h], names = ['幅', '奥行き', '高さ'], out = [];
  for (const v of [2, 0, 1]) {
    const f = d.filter((_, i) => i !== v).sort((p, q) => q - p), hgt = d[v];
    if (out.some(o => Math.abs(o.a - f[0]) < 1e-6 && Math.abs(o.b - f[1]) < 1e-6 && Math.abs(o.hgt - hgt) < 1e-6)) continue;
    out.push({ v, a: f[0], b: f[1], hgt, label: v === 2 ? 'そのまま' : names[v] + 'を縦に' });
  }
  return out;
}
function workerRun(msg) {
  if (!MV.worker) MV.worker = new Worker('js/move-worker.js?v=1');
  return new Promise((ok, ng) => {
    MV.worker.onmessage = e => { if (e.data.progress != null) { MV.pops = e.data.progress; moveProg(); return; } ok(e.data); };
    MV.worker.onerror = e => ng(e.message || 'worker');
    MV.worker.postMessage(msg);
  });
}
function moveStop() { if (MV.worker) { MV.worker.terminate(); MV.worker = null; } MV.running = false; MV.msg = 'やめました。'; moveRender(); }

async function moveRun() {
  if (MV.running) return;
  const s = scaleInfo().s, room = byId(M.rooms, M.move.target);
  if (!M.rooms.length) { MV.msg = '先に「図面」で部屋をなぞってください。'; moveRender(); return; }
  if (!room) { MV.msg = '運ぶ先の部屋を押してください。'; moveRender(); return; }
  const ori = orientations(), ent = entranceInfo(Math.max(...ori.map(o => o.a)));
  if (!ent) { MV.msg = ''; MV.need = 'entrance'; moveRender(); return; }
  MV.need = null;
  const key = moveKey(), polys = M.rooms.map(r => r.pts.map(p => [p[0] * s, p[1] * s]));
  const all = polys.flat().concat(ent.porch);
  const x0 = Math.min(...all.map(p => p[0])) - 0.05, y0 = Math.min(...all.map(p => p[1])) - 0.05;
  const w = Math.max(...all.map(p => p[0])) + 0.05 - x0, h = Math.max(...all.map(p => p[1])) + 0.05 - y0;
  const mstep = 0.05, mw = Math.ceil(w / mstep), mh = Math.ceil(h / mstep), mask = new Uint8Array(mw * mh);
  const inP = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const A = poly[i], B = poly[j]; if ((A[1] > y) !== (B[1] > y) && x < (B[0] - A[0]) * (y - A[1]) / (B[1] - A[1]) + A[0]) c = !c; } return c; };
  for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {   // 箱のまん中が来てよい所: 部屋の中と玄関の外
    const x = x0 + (i + .5) * mstep, y = y0 + (j + .5) * mstep;
    if (inP(x, y, ent.porch) || polys.some(p => inP(x, y, p))) mask[j * mw + i] = 1;
  }
  const gpoly = room.pts.map(p => [p[0] * s, p[1] * s]), gc = centroid(room.pts).map(v => v * s);
  const goal = { poly: gpoly, r: Math.max(...gpoly.map(p => Math.hypot(p[0] - gc[0], p[1] - gc[1]))) };
  MV.running = true; MV.msg = ''; MV.res = null; moveRender();
  const results = [];
  try {
    for (let i = 0; i < ori.length; i++) {
      const o = ori[i];
      MV.prog = `調べています（${o.label}、${i + 1}/${ori.length}）`; MV.pops = 0; moveRender();
      if (o.hgt > ceilH()) { results.push({ ...o, ok: false, why: `高さ ${Math.round(o.hgt * 100)}cm が天井より高い` }); continue; }
      const { obs, gaps } = moveObstacles(o.hgt);
      const r = await workerRun({ obs, a: o.a, b: o.b, x0, y0, w, h, mask, mw, mstep, start: ent.start, goal, goalC: gc, cap: 0.06, limitMs: 30000 });
      if (r.error) throw r.error;
      // すき間は、見つけた道の上の各状態でのすき間のいちばん小さい値（道はマスの間のすり抜けを引いて選んであるので、通れることは確か）
      if (r.ok) r.clear = Math.min(...r.path.map(p => p[3]));
      results.push({ ...o, ...r, gaps });
    }
  } catch (e) { MV.running = false; MV.msg = '調べられませんでした: ' + e; window.__roomErr.push(String(e)); moveRender(); return; }
  MV.running = false;
  const okr = results.filter(r => r.ok).sort((p, q) => q.clear - p.clear);
  MV.res = { results, best: okr[0] || null, ent };
  MV.pick = MV.res.results.indexOf(okr[0] || results.find(r => r.path) || results[0]);
  MV.key = key; MV.t = 0;
  moveRender(); requestDraw(); movePlay(true);   // 結果が出たら、玄関から運ぶようすを1回見せる
}

// ---------- 結果 ----------
function verdict(r) {
  if (!r || !r.ok) return { k: 'ng', text: '入らない' };
  const gap = r.clear * 2, m = M.move.margin;
  return gap >= m ? { k: 'ok', text: '入る' } : { k: 'tight', text: 'ぎりぎり' };
}
function crossedGaps(r) {           // 道が通ったドア（推定の幅が残っているか見るため）
  const out = [];
  if (!r.path) return out;
  const cr = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  for (const g of r.gaps || []) {
    for (let i = 1; i < r.path.length; i++) {
      const A = r.path[i - 1], B = r.path[i];
      if (cr(g.a, g.b, A) * cr(g.a, g.b, B) <= 0 && cr(A, B, g.a) * cr(A, B, g.b) < 0) { out.push(byId(M.opens, g.id)); break; }
    }
  }
  return out.filter(Boolean);
}
// いちばんせまい所の近くの開口の名前（例「廊下と洋室の間のドア」）
function bottleneckName(p) {
  if (!p) return '';
  const s = scaleInfo().s; let best = null;
  for (const o of M.opens) {
    if (!doorPass(o.kind)) continue;
    const G = openGeom(o); if (!G) continue;
    const d = Math.hypot(G.c[0] * s - p[0], G.c[1] * s - p[1]);
    if (!best || d < best.d) best = { d, o, G };
  }
  if (!best || best.d > 1.2) return '';
  const r = byId(M.rooms, best.o.room), far = [best.G.c[0] - best.G.n[0] * 30 / P.z, best.G.c[1] - best.G.n[1] * 30 / P.z];
  const other = M.rooms.find(x => x !== r && inPoly(far, x.pts));
  return best.o.kind === 'entrance' ? '玄関' : other ? `${r.name}と${other.name}の間の${OPEN_KINDS[best.o.kind]}` : `${r.name}の${OPEN_KINDS[best.o.kind]}`;
}
function bottleneck(r) {
  if (!r || !r.path || !r.path.length) return null;
  let m = r.path[0];
  for (const p of r.path) if (p[3] < m[3]) m = p;
  return m;
}
function moveProg() { const el = $('mProgN'); if (el) el.textContent = MV.pops ? `（${(MV.pops / 1e6).toFixed(1)}百万通り）` : ''; }
function moveRender() {
  const box = $('moveBar'); if (!box) return;
  box.hidden = !moveOn(); if (!moveOn()) return;
  const fp = $('fPreset');
  fp.innerHTML = '<option value="">大きさを入れる</option>' + (M.move.mine.length ? '<optgroup label="覚えた家具">' + M.move.mine.map((f, i) => `<option value="mine:${i}">${esc(f.name)}（${Math.round(f.w * 100)}×${Math.round(f.d * 100)}×${Math.round(f.h * 100)}）</option>`).join('') + '</optgroup>' : '') +
    '<optgroup label="よくある大きさ（目安）">' + Object.entries(FURN).map(([k, f]) => `<option value="${k}">${f.name}</option>`).join('') + '</optgroup>';
  fp.value = M.move.preset || '';
  $('mineList').innerHTML = M.move.mine.length ? M.move.mine.map((f, i) => `<button class="chip${M.move.preset === 'mine:' + i ? ' on' : ''}" data-mine="${i}">${esc(f.name)} <span class="x" data-del="${i}" role="button" aria-label="${esc(f.name)}を消す">×</span></button>`).join('') : '<p class="hint small">まだありません。</p>';
  document.querySelectorAll('[data-mine]').forEach(b => b.onclick = e => {
    const i = +b.dataset.mine;
    if (e.target.dataset.del != null) { const nm = M.move.mine[i].name; edit(() => { M.move.mine.splice(i, 1); if (M.move.preset.startsWith('mine:')) M.move.preset = ''; }, `「${nm}」を消しました`); return; }
    const f = M.move.mine[i]; edit(() => { M.move.preset = 'mine:' + i; M.move.w = f.w; M.move.d = f.d; M.move.h = f.h; });
  });
  for (const [id, k] of [['fW', 'w'], ['fD', 'd'], ['fH', 'h']]) { const el = $(id); if (document.activeElement !== el) el.value = Math.round(M.move[k] * 100); }
  const mg = $('fMargin'); if (document.activeElement !== mg) mg.value = Math.round(M.move.margin * 100);
  const tg = $('fTarget');
  tg.innerHTML = '<option value="">運ぶ先をえらぶ</option>' + M.rooms.map(r => `<option value="${r.id}"${r.id === M.move.target ? ' selected' : ''}>${esc(r.name)}</option>`).join('');
  $('mRun').disabled = MV.running;
  let html = '', notes = [];
  const stale = MV.res && MV.key !== moveKey();
  if (MV.running) html = `<div class="wprog"><span>${esc(MV.prog)}…<span id="mProgN"></span></span><button id="mStop">やめる</button></div>`;
  else if (MV.need === 'entrance' && !M.opens.some(o => o.kind === 'entrance')) html = '<p class="wmsg">玄関から運びこむので、先に玄関を置いてください。 <button id="mGoEnt" class="pri">玄関を置く</button></p>';
  else if (MV.msg) html = `<p class="wmsg">${esc(MV.msg)}</p>`;
  else if (!M.move.target) html = '<p class="wmsg">運ぶ先の部屋を、図の上で押してください。</p>';
  else if (!MV.res || stale) html = `<p class="wmsg">${stale ? '家具か模型が変わりました。もう一度「調べる」を押してください。' : '「調べる」を押すと、玄関の外から運びこめるかを調べます。'}</p>`;
  else {
    const R = MV.res, r = R.results[MV.pick], v = verdict(R.best);
    const bn = bottleneck(r);
    html = `<p class="mv mv-${v.k}"><b>${v.text}</b>` +
      (R.best ? `${esc(R.best.label)}（高さ ${Math.round(R.best.hgt * 100)}cm）で、いちばんせまい所${(n => n ? `（${esc(n)}）` : '')(bottleneckName(bottleneck(R.best)))}のすき間は約 ${Math.max(0, Math.floor(R.best.clear * 200))}cm（両側）` +
        (v.k === 'tight' ? `。余裕 ${Math.round(M.move.margin * 100)}cm まであと ${Math.ceil((M.move.margin - R.best.clear * 2) * 100)}cm` : '')
        : `どの寝かせ方でも通れません。赤い × の所${(n => n ? `（${esc(n)}）` : '')(bottleneckName(r.stuck))}でつかえます`) + '</p>';
    html += '<div class="mori">' + R.results.map((x, i) => { const vv = verdict(x); return `<button data-pick="${i}" class="chip${i === MV.pick ? ' on' : ''}">${esc(x.label)}・${vv.text}${x.ok ? ` ${Math.floor(x.clear * 200)}cm` : x.why ? '（天井）' : ''}</button>`; }).join('') + '</div>';
    if (r.path && r.path.length > 1) html += `<div class="mslide"><button id="mPlay" class="play" aria-label="運ぶようすを再生"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${MV.anim ? 'M6 4h4v16H6zM14 4h4v16h-4z' : 'M7 4v16l13-8z'}"/></svg></button><input type="range" id="mT" min="0" max="1000" value="${Math.round(MV.t * 1000)}" aria-label="運ぶようす"></div>`;
    const est = crossedGaps(r).filter(o => !o.w);
    if (r.why) notes.push(r.why + 'ので、この寝かせ方は試していません。');
    if (r.timeout) notes.push('時間がかかりすぎたので、とちゅうでやめました。');
    if (est.length) notes.push(`通るドアのうち ${est.length}か所の幅が推定です。メジャーで測って「図面」で入れると確かになります。`);
    if (scaleEst()) notes.push('縮尺が推定です（帖から）。1か所メジャーで測ると確かになります。');
    if (bn && r.ok) notes.push('黄色い丸がいちばんせまい所です。');
  }
  $('mBody').innerHTML = html;
  $('mNotes').innerHTML = notes.map(n => `<p class="why">${esc(n)}</p>`).join('');   // 注意は右の欄へ
  if ($('mStop')) $('mStop').onclick = moveStop;
  if ($('mGoEnt')) $('mGoEnt').onclick = () => goPlace('entrance', 'move');
  document.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { MV.pick = +b.dataset.pick; MV.t = MV.res.results[MV.pick].ok ? 1 : 0; moveRender(); requestDraw(); });
  if ($('mT')) $('mT').oninput = e => { movePlay(false); MV.t = e.target.value / 1000; requestDraw(); };
  if ($('mPlay')) $('mPlay').onclick = () => movePlay(!MV.anim);
  moveProg();
}
function moveHint() { return ''; }   // 図の下の結果のひとことが、いまやることも言う（同じ意味の文を2つ並べない）
// 運ぶようすを再生（玄関の外 → 運ぶ先。4 秒）
function movePlay(on) {
  if (!on) { if (MV.anim) { cancelAnimationFrame(MV.anim); MV.anim = 0; moveRender(); } return; }
  if (MV.t >= 0.999) MV.t = 0;
  let last = performance.now();
  const tick = now => { MV.t = Math.min(1, MV.t + (now - last) / 4000); last = now; const el = $('mT'); if (el) el.value = Math.round(MV.t * 1000); requestDraw(); MV.anim = MV.t < 1 ? requestAnimationFrame(tick) : 0; if (!MV.anim) moveRender(); };
  MV.anim = requestAnimationFrame(tick); moveRender();
}

// 道の上の位置 t（0〜1）の箱（m）
function pathAt(path, t) {
  const f = t * (path.length - 1), i = Math.min(path.length - 2, Math.floor(f)), k = f - i;
  if (path.length < 2) return path[0];
  const A = path[i], B = path[i + 1];
  let da = B[2] - A[2]; if (da > Math.PI / 2) da -= Math.PI; if (da < -Math.PI / 2) da += Math.PI;
  return [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + da * k, Math.min(A[3], B[3])];
}

// ---------- 図の上 ----------
P.exts.push({
  tools: ['target'],
  active: moveOn,
  fitPts() {                 // 全体に合わせるとき、玄関の外（箱のはじめの場所）も入れる
    const e = entranceInfo(Math.max(M.move.w, M.move.d)); if (!e) return [];
    const s = scaleInfo().s; return e.porch.map(p => [p[0] / s, p[1] / s]);
  },
  down(p) {
    const r = [...M.rooms].reverse().find(x => inPoly(p, x.pts));
    if (r) edit(() => { M.move.target = r.id; });
    return null;
  },
  move() {}, up() {},
  under(g, C) {
    if (!moveOn()) return;
    const r = byId(M.rooms, M.move.target); if (!r) return;
    g.beginPath(); r.pts.forEach((p, i) => { const q = toS(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath();
    g.fillStyle = C.acc; g.globalAlpha = 0.18; g.fill(); g.globalAlpha = 1;
  },
  over(g, C) {
    if (!moveOn()) return;
    const s = scaleInfo().s, U2 = p => toS([p[0] / s, p[1] / s]);
    const tr = byId(M.rooms, M.move.target);
    if (tr) { const c = toS(centroid(tr.pts)); g.textAlign = 'center'; g.textBaseline = 'middle'; label(g, '運ぶ先', c[0], c[1] + 26, 'bold 12px', C.acc, C.bg); }
    const ent = entranceInfo(Math.max(M.move.w, M.move.d));
    if (ent) {                                // 「ここから」の矢印
      const a = U2([ent.c[0] + ent.out[0] * 0.9, ent.c[1] + ent.out[1] * 0.9]), b = U2([ent.c[0] + ent.out[0] * 0.25, ent.c[1] + ent.out[1] * 0.25]);
      g.strokeStyle = C.acc; g.lineWidth = 2.5; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(b[0] - 9 * Math.cos(ang - .5), b[1] - 9 * Math.sin(ang - .5)); g.lineTo(b[0] - 9 * Math.cos(ang + .5), b[1] - 9 * Math.sin(ang + .5)); g.closePath(); g.fillStyle = C.acc; g.fill();
      g.textAlign = 'center'; g.textBaseline = 'middle'; label(g, 'ここから', a[0], a[1] + 12, '11px', C.acc, C.bg);
    }
    if (!MV.res || MV.key !== moveKey()) return;
    const r = MV.res.results[MV.pick]; if (!r || !r.path) return;
    g.strokeStyle = C.muted; g.lineWidth = 1.5; g.setLineDash([3, 4]);   // 箱のまん中の通り道
    g.beginPath(); r.path.forEach((p, i) => { const q = U2(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke(); g.setLineDash([]);
    const bn = bottleneck(r);
    if (bn && r.ok) {                         // いちばんせまい所
      const q = U2(bn);
      g.beginPath(); g.arc(q[0], q[1], 14, 0, Math.PI * 2); g.lineWidth = 3; g.strokeStyle = '#e8b416'; g.stroke();
    }
    const cfg = pathAt(r.path, MV.t);
    if (cfg) {                                // 箱
      const gap = cfg[3] * 2, col = !r.ok && MV.t > 0.98 ? '#d64545' : gap >= M.move.margin ? '#2f9e5a' : gap > 0.001 ? '#e8a416' : '#d64545';
      const c = U2(cfg), A = r.a / s * P.z, B = r.b / s * P.z;
      g.save(); g.translate(c[0], c[1]); g.rotate(cfg[2]);
      g.fillStyle = col; g.globalAlpha = 0.45; g.fillRect(-A / 2, -B / 2, A, B); g.globalAlpha = 1;
      g.lineWidth = 2; g.strokeStyle = col; g.strokeRect(-A / 2, -B / 2, A, B);
      g.restore();
    }
    if (!r.ok && r.stuck) {                   // つかえる所
      const q = U2(r.stuck);
      g.strokeStyle = '#d64545'; g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(q[0] - 9, q[1] - 9); g.lineTo(q[0] + 9, q[1] + 9); g.moveTo(q[0] + 9, q[1] - 9); g.lineTo(q[0] - 9, q[1] + 9); g.stroke(); g.lineCap = 'butt';
      g.textAlign = 'center'; g.textBaseline = 'middle'; label(g, 'ここでつかえます', q[0], q[1] - 20, 'bold 12px', '#d64545', C.bg);
    }
  },
});

function moveInit() {
  $('fPreset').onchange = e => edit(() => {
    const v = e.target.value, f = v.startsWith('mine:') ? M.move.mine[+v.slice(5)] : FURN[v];
    M.move.preset = v;
    if (f) { const k = v.startsWith('mine:') ? 1 : 100; M.move.w = f.w / k; M.move.d = f.d / k; M.move.h = f.h / k; }
  });
  $('mineAdd').onclick = () => {   // いまの大きさを名前つきで覚える
    const nm = $('mineName').value.trim() || (FURN[M.move.preset] ? FURN[M.move.preset].name : '家具' + (M.move.mine.length + 1));
    edit(() => { M.move.mine.push({ name: nm, w: M.move.w, d: M.move.d, h: M.move.h }); M.move.preset = 'mine:' + (M.move.mine.length - 1); });
    $('mineName').value = ''; toast(`「${nm}」を覚えました`);
  };
  for (const [id, k] of [['fW', 'w'], ['fD', 'd'], ['fH', 'h']]) $(id).onchange = e => edit(() => { const v = cmIn(e.target.value); if (v) { M.move[k] = v; M.move.preset = ''; } });
  $('fMargin').onchange = e => edit(() => { const v = parseFloat(e.target.value); M.move.margin = isFinite(v) && v >= 0 ? v / 100 : 0.05; });
  $('fTarget').onchange = e => edit(() => { M.move.target = e.target.value || null; });
  $('mRun').onclick = moveRun;
}
