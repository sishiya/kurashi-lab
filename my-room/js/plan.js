// わが家の模型 — 上から見た図（なぞる・動かす・ドアと窓・メジャー）。model.js のあとに読む。
//
// 画面の座標 = u × z + o（CSS ピクセル）。描くのは requestDraw() でまとめて1コマに1回。

const P = {
  cv: null, g: null, dpr: 1, W: 0, H: 0,
  z: 1, ox: 0, oy: 0,
  tool: 'trace', openKind: 'door',
  trace: [], hover: null, pending: null, guide: null,
  tapeA: null, tapeB: null,
  sel: null,                   // { type: 'room'|'open'|'tape', id }
  drag: null, pointers: new Map(), pinch: null, loupe: null,
  imgAlpha: 0.55, shift: false, dirty: false,
  straight: true,              // 線を水平・垂直にそろえる（タッチでは Shift が押せないので切りかえで）
  userView: false,             // 自分で拡大・移動したか（していなければ、大きさが変わったら全体に合わせなおす）
  exts: [],                    // ほかのタブが足す道具と描画（wifi.js・move.js）
  onChange: () => {}, onNorth: () => {}, onSelect: () => {}, onRoomClosed: () => {}, onTapeDone: () => {}, onTraceChange: () => {}, onAlign: () => {},
};

const fmtM = (m, est) => (est ? '約 ' : '') + m.toFixed(2) + ' m';
const toU = (sx, sy) => [(sx - P.ox) / P.z, (sy - P.oy) / P.z];
const toS = p => [p[0] * P.z + P.ox, p[1] * P.z + P.oy];

function planInit(cv) {
  P.cv = cv; P.g = cv.getContext('2d');
  new ResizeObserver(planResize).observe(cv);
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onCancel);
  cv.addEventListener('pointerleave', () => { if (!P.pointers.size) { P.hover = null; requestDraw(); } });
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('dblclick', () => { if (P.tool === 'trace') planCloseTrace(); });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  planResize();
}
function planResize() {
  const r = P.cv.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;   // 隠れているとき
  const first = !P.W, dw = r.width - P.W, dh = r.height - P.H;
  P.dpr = Math.min(window.devicePixelRatio || 1, 2);
  P.W = r.width; P.H = r.height;
  P.cv.width = Math.round(P.W * P.dpr); P.cv.height = Math.round(P.H * P.dpr);
  if (first || !P.userView) planFit();       // 自分で動かしていなければ、いつも全体が見えるように
  else { P.ox += dw / 2; P.oy += dh / 2; }   // 動かしていれば、まん中を保つ
  requestDraw();
}
function requestDraw() {
  if (P.dirty) return;
  P.dirty = true;
  requestAnimationFrame(() => { P.dirty = false; planDraw(); });
}

// 回した下じきの4つの角（u）
function imgCorners() {
  const w = M.img.w, h = M.img.h, a = (M.imgRot || 0) * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
  return [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => [w / 2 + (x - w / 2) * co - (y - h / 2) * si, h / 2 + (x - w / 2) * si + (y - h / 2) * co]);
}
// 全体が入るように
function planFit() {
  if (!P.W) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); };
  M.rooms.forEach(r => r.pts.forEach(add));
  M.tapes.forEach(t => { add(t.a); add(t.b); });
  P.trace.forEach(add);
  if (M.img) imgCorners().forEach(add);
  for (const x of P.exts) if (x.active() && x.fitPts) x.fitPts().forEach(add);   // タブが足したい所（搬入の玄関の外など）
  if (!isFinite(x0)) { const s = scaleInfo().s; x0 = 0; y0 = 0; x1 = 8 / s; y1 = 6 / s; }
  // 上は状態の札・北の矢印、下は拡大ボタン・縮尺の棒にかからないよう、上下を広めにあける
  const px = 28, pt = 44, pb = 56, w = Math.max(x1 - x0, 1e-3), h = Math.max(y1 - y0, 1e-3);
  P.z = Math.min((P.W - px * 2) / w, (P.H - pt - pb) / h);
  P.ox = (P.W - w * P.z) / 2 - x0 * P.z; P.oy = pt + (P.H - pt - pb - h * P.z) / 2 - y0 * P.z;
  P.userView = false;
  requestDraw();
}
function planZoom(k, sx = P.W / 2, sy = P.H / 2) {
  P.userView = true;
  const z = Math.max(1e-3, Math.min(P.z * k, 400));
  P.ox = sx - (sx - P.ox) * z / P.z; P.oy = sy - (sy - P.oy) * z / P.z; P.z = z;
  requestDraw();
}

// ---------- 吸いつき ----------
function allVerts(skip) {
  const out = [];
  for (const r of M.rooms) r.pts.forEach((p, i) => { if (!skip || !skip.some(s => s[0] === r && s[1] === i)) out.push(p); });
  return out;
}
// 角に吸いつく → 前の点から水平・垂直にそろえる → ほかの角と x・y をそろえる（Shift で全部はずす）
function snapPoint(p, from, skip, extra = []) {
  const R = (P.touch ? 22 : 12) / P.z, verts = allVerts(skip).concat(extra);   // 指は太いので、角への吸いつきを広く
  let best = null, bd = R;
  for (const v of verts) { const d = dist(p, v); if (d < bd) { bd = d; best = v; } }
  if (best) return { p: best.slice(), guide: null, vertex: true };
  if (P.shift || !P.straight) return { p: p.slice(), guide: null };
  const q = p.slice(); let lockX = false, lockY = false;
  if (from) {
    const ang = Math.atan2(Math.abs(q[1] - from[1]), Math.abs(q[0] - from[0]));
    if (ang < 0.21) { q[1] = from[1]; lockY = true; } else if (ang > Math.PI / 2 - 0.21) { q[0] = from[0]; lockX = true; }
  }
  const A = 8 / P.z, guide = {};
  for (const v of verts) {
    if (!lockX && guide.x == null && Math.abs(q[0] - v[0]) < A) { q[0] = v[0]; guide.x = v[0]; }
    if (!lockY && guide.y == null && Math.abs(q[1] - v[1]) < A) { q[1] = v[1]; guide.y = v[1]; }
  }
  if (!M.img) {                        // 画像なしの方眼: 5cm きざみ
    if (!lockX && guide.x == null) q[0] = Math.round(q[0] / 5) * 5;
    if (!lockY && guide.y == null) q[1] = Math.round(q[1] / 5) * 5;
  }
  return { p: q, guide };
}

// ---------- 当たり判定（画面の距離で） ----------
function hitVertex(p) {
  const R = 14 / P.z; let best = null, bd = R;
  for (const r of M.rooms) r.pts.forEach((v, i) => { const d = dist(p, v); if (d < bd) { bd = d; best = v; } });
  if (!best) return null;
  const refs = [];                     // 同じ所にある角（となりの部屋）はいっしょに動かす
  for (const r of M.rooms) r.pts.forEach((v, i) => { if (dist(v, best) < 1e-6) refs.push([r, i]); });
  return refs;
}
function openGeom(o) {                 // u の座標で: 中心・向き・幅・部屋の内側の向き
  const r = byId(M.rooms, o.room); if (!r || o.edge >= r.pts.length) return null;
  const [a, b] = roomEdge(r, o.edge), d = sub(b, a), L = len(d);
  if (L < 1e-9) return null;
  const u = [d[0] / L, d[1] / L], s = scaleInfo().s;
  const c = [a[0] + d[0] * o.t, a[1] + d[1] * o.t];
  let n = [-u[1], u[0]];
  if (!inPoly([c[0] + n[0] * 2 / P.z, c[1] + n[1] * 2 / P.z], r.pts)) n = [-n[0], -n[1]];
  return { c, u, n, w: openDims(o).w / s, room: r, a, b, L };
}
function hitOpen(p) {
  for (const o of M.opens) {
    const g = openGeom(o); if (!g) continue;
    const rel = sub(p, g.c), along = rel[0] * g.u[0] + rel[1] * g.u[1], across = rel[0] * g.n[0] + rel[1] * g.n[1];
    if (Math.abs(along) <= g.w / 2 + 6 / P.z && Math.abs(across) <= 12 / P.z) return o;
  }
  return null;
}
function hitTape(p) {
  for (const t of M.tapes) {
    if (dist(p, t.a) < 14 / P.z) return { t, end: 'a' };
    if (dist(p, t.b) < 14 / P.z) return { t, end: 'b' };
    if (nearestOnSeg(p, t.a, t.b).d < 8 / P.z) return { t, end: null };
  }
  return null;
}
function hitEdge(p) {
  let best = null, bd = 18 / P.z;
  for (const r of M.rooms) for (let i = 0; i < r.pts.length; i++) {
    const [a, b] = roomEdge(r, i), h = nearestOnSeg(p, a, b);
    if (h.d < bd) { bd = h.d; best = { room: r, edge: i, t: h.t }; }
  }
  return best;
}
// えらんだ部屋の辺のまん中（角を足す所）。辺が画面で短いときは出さない
function selRoomMids() {
  const r = P.sel && (P.sel.type === 'room' || P.sel.type === 'vert') && byId(M.rooms, P.sel.id);
  if (!r || P.tool !== 'select') return [];
  const out = [];
  for (let i = 0; i < r.pts.length; i++) {
    const [a, b] = roomEdge(r, i);
    const q = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (dist(a, b) * P.z < 44 || hitOpen(q)) continue;   // ドア・窓と重なる所には出さない（ドアをつかめるように）
    out.push({ room: r, edge: i, q });
  }
  return out;
}
const hitMid = p => selRoomMids().find(m => dist(p, m.q) < 12 / P.z) || null;
const hitRoom = p => [...M.rooms].reverse().find(r => inPoly(p, r.pts)) || null;

// ---------- 操作 ----------
function evPos(e) { const r = P.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function select(s) { P.sel = s; P.onSelect(s); requestDraw(); }

function onDown(e) {
  try { P.cv.setPointerCapture(e.pointerId); } catch (err) {}   // 合成のイベントなどでは失敗する
  P.shift = e.shiftKey; P.touch = e.pointerType !== 'mouse';
  const sp = evPos(e);
  P.pointers.set(e.pointerId, sp);
  if (P.space && e.button === 0) { P.drag = { type: 'pan', s: sp, ox: P.ox, oy: P.oy }; return; }   // Space を押しながらドラッグで図を動かす
  if (P.pointers.size === 2) {         // 2本指: 拡大・移動（していた操作はやめる）
    P.pending = null; P.loupe = null; P.drag = null;
    const [a, b] = [...P.pointers.values()];
    P.pinch = { d: dist(a, b), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], z: P.z, ox: P.ox, oy: P.oy }; P.userView = true;
    requestDraw(); return;
  }
  if (P.pointers.size > 2) return;
  if (e.button === 1 || e.button === 2) { P.drag = { type: 'pan', s: sp, ox: P.ox, oy: P.oy }; return; }
  if (dist(sp, [P.W - 30, 30]) < 26) { commit(); P.drag = { type: 'north' }; return; }   // 右上の北の矢印はドラッグで回せる
  const p = toU(...sp), touch = e.pointerType !== 'mouse';
  const ext = P.exts.find(x => x.active() && x.tools.includes(P.tool));
  if (ext) {                           // WiFi・搬入の道具（wifi.js・move.js）
    const d = ext.down(p, sp, touch);
    if (d) d.owner = ext;
    P.drag = d || { type: 'pan', s: sp, ox: P.ox, oy: P.oy };
    updateLoupe(sp); requestDraw(); return;
  }
  if (P.tool === 'trace') {
    const sn = snapPoint(p, P.trace[P.trace.length - 1], null, P.trace.length >= 3 ? [P.trace[0]] : []);
    P.pending = sn.p; P.guide = sn.guide;
    P.drag = { type: 'trace', touch };
  } else if (P.tool === 'tape' || P.tool === 'align') {
    if (P.tapeA) { P.tapeB = tapeSnap(p, P.tapeA); P.drag = { type: 'tapeB', touch }; }
    else { P.tapeA = tapeSnap(p, null); P.tapeB = null; P.drag = { type: 'tapeA', touch, s: sp }; }
  } else if (P.tool === 'open') {
    const o = hitOpen(p);
    if (o) { select({ type: 'open', id: o.id }); P.drag = { type: 'open', o, moved: false }; }
    else {
      const h = hitEdge(p);
      if (h) {
        commit();
        const o2 = { id: newId('o'), room: h.room.id, edge: h.edge, t: h.t, kind: P.openKind, w: null, h: null, sill: null, flip: false };
        M.opens.push(o2); select({ type: 'open', id: o2.id }); P.onChange();
        P.drag = { type: 'open', o: o2, moved: true };
      } else P.drag = { type: 'pan', s: sp, ox: P.ox, oy: P.oy, click: true };
    }
  } else {                             // 動かす
    const mid = hitMid(p);
    if (mid) {                         // 辺のまん中の「＋」: 角を足して、そのままドラッグ
      commit();
      const i = insertVertex(mid.room, mid.edge, mid.q);
      P.sel = { type: 'vert', id: mid.room.id, i };
      P.drag = { type: 'vert', refs: [[mid.room, i]], moved: true, touch };
      P.onChange(); updateLoupe(sp); requestDraw(); return;
    }
    const v = hitVertex(p), o = !v && hitOpen(p), t = !v && !o && hitTape(p);
    if (v) P.drag = { type: 'vert', refs: v, moved: false, touch, s: sp };
    else if (o) { select({ type: 'open', id: o.id }); P.drag = { type: 'open', o, moved: false }; }
    else if (t && t.end) { select({ type: 'tape', id: t.t.id }); P.drag = { type: 'tapeEnd', t: t.t, end: t.end, moved: false, touch }; }
    else P.drag = { type: 'pan', s: sp, ox: P.ox, oy: P.oy, click: true, pick: t ? { type: 'tape', id: t.t.id } : null };
  }
  updateLoupe(sp);
  requestDraw();
}
function onMove(e) {
  P.shift = e.shiftKey;
  const sp = evPos(e);
  if (P.pointers.has(e.pointerId)) P.pointers.set(e.pointerId, sp);
  if (P.pinch && P.pointers.size === 2) {
    const [a, b] = [...P.pointers.values()], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const k = dist(a, b) / Math.max(P.pinch.d, 1), z = Math.max(1e-3, Math.min(P.pinch.z * k, 400));
    P.z = z;
    P.ox = m[0] - (P.pinch.m[0] - P.pinch.ox) * z / P.pinch.z;
    P.oy = m[1] - (P.pinch.m[1] - P.pinch.oy) * z / P.pinch.z;
    requestDraw(); return;
  }
  const p = toU(...sp), d = P.drag;
  if (d && d.owner) { d.owner.move(d, p); updateLoupe(sp); requestDraw(); return; }
  if (!d) {                            // マウスをのせているだけ
    if (e.pointerType === 'mouse') {    // つかめる物の上では手の形（北の矢印・角・ドア・窓・メジャーの端）
      const grab = dist(sp, [P.W - 30, 30]) < 26 || P.space || (P.tool === 'select' || P.tool === 'open') && (hitVertex(p) && P.tool === 'select' || hitOpen(p) || P.tool === 'select' && hitTape(p));
      P.cv.style.cursor = grab ? 'grab' : '';
    }
    if (P.tool === 'trace' && e.pointerType === 'mouse') {
      const sn = snapPoint(p, P.trace[P.trace.length - 1], null, P.trace.length >= 3 ? [P.trace[0]] : []);
      P.hover = sn.p; P.guide = sn.guide; requestDraw();
    } else if ((P.tool === 'tape' || P.tool === 'align') && P.tapeA) { P.tapeB = tapeSnap(p, P.tapeA); requestDraw(); }
    return;
  }
  if (d.type === 'north') {           // 北の矢印を回す（矢印の先を指の向きに）
    M.north = Math.round(Math.atan2(sp[0] - (P.W - 30), -(sp[1] - 30)) * 180 / Math.PI);
    P.onNorth(); requestDraw(); return;
  }
  if (d.type === 'pan') {
    if (d.click && dist(sp, d.s) < 5) return;
    d.click = false;
    P.ox = d.ox + sp[0] - d.s[0]; P.oy = d.oy + sp[1] - d.s[1]; P.userView = true;
  } else if (d.type === 'trace') {
    const sn = snapPoint(p, P.trace[P.trace.length - 1], null, P.trace.length >= 3 ? [P.trace[0]] : []);
    P.pending = sn.p; P.guide = sn.guide;
  } else if (d.type === 'tapeA' || d.type === 'tapeB') {
    P.tapeB = tapeSnap(p, P.tapeA);
  } else if (d.type === 'vert') {
    if (!d.moved) { if (d.s && dist(sp, d.s) < 4) return; commit(); d.moved = true; }   // 4px 動くまでは動かさない（押しただけでずれない）
    // となりの角と水平・垂直にそろうのは、snapPoint の x・y そろえで
    const sn = snapPoint(p, null, d.refs, []);
    d.refs.forEach(([r, i]) => { r.pts[i] = sn.p.slice(); });
    P.guide = sn.guide;
  } else if (d.type === 'open') {
    let g = openGeom(d.o); if (!g) return;
    if (!d.moved) { commit(); d.moved = true; }
    const he = hitEdge(p);              // 指が別の壁の近くへ行ったら、その壁へうつす
    if (he && (he.room.id !== d.o.room || he.edge !== d.o.edge) && nearestOnSeg(p, g.a, g.b).d * P.z > 14) { d.o.room = he.room.id; d.o.edge = he.edge; g = openGeom(d.o); if (!g) return; }
    const h = nearestOnSeg(p, g.a, g.b), half = g.w / 2 / g.L;
    d.o.t = Math.max(Math.min(half, 0.5), Math.min(Math.max(1 - half, 0.5), h.t));
  } else if (d.type === 'tapeEnd') {
    if (!d.moved) { commit(); d.moved = true; }
    const other = d.end === 'a' ? d.t.b : d.t.a;
    d.t[d.end] = snapPoint(p, other).p;
  }
  updateLoupe(sp);
  requestDraw();
}
function onUp(e) {
  const sp = evPos(e);
  P.pointers.delete(e.pointerId);
  if (P.pinch) { if (P.pointers.size < 2) P.pinch = null; return; }
  const d = P.drag; P.drag = null; P.loupe = null; P.guide = null;
  if (!d) return;
  if (d.owner) { d.owner.up(d); requestDraw(); return; }
  if (d.type === 'north') { P.onChange(); return; }
  if (d.type === 'trace' && P.pending) {
    const q = P.pending; P.pending = null;
    if (P.trace.length >= 3 && dist(q, P.trace[0]) < 1e-6) { planCloseTrace(); return; }
    const last = P.trace[P.trace.length - 1];
    if (!last || dist(q, last) * P.z > 2) P.trace.push(q);
    P.onTraceChange();
  } else if (d.type === 'tapeA') {
    if (dist(sp, d.s) > 10 && P.tapeB) finishTape();          // ドラッグで2点
    // そうでなければ1点目だけ決まった。次のクリック・タップが2点目
    P.onTraceChange();
  } else if (d.type === 'tapeB') {
    if (P.tapeB) finishTape();
  } else if (d.type === 'pan' && d.click) {
    const p = toU(...sp);
    if (d.pick) select(d.pick);
    else { const r = hitRoom(p); select(r ? { type: 'room', id: r.id } : null); }
  } else if (d.type === 'vert' && !d.moved) {   // 角を押しただけ: えらぶ（消せるように）
    const [r, i] = d.refs[0]; select({ type: 'vert', id: r.id, i });
  } else if (d.moved) P.onChange();
  requestDraw();
}
function onCancel(e) { P.pointers.delete(e.pointerId); P.pinch = null; P.drag = null; P.pending = null; P.loupe = null; requestDraw(); }
function onWheel(e) {
  e.preventDefault();
  const sp = evPos(e);
  if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) planZoom(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), sp[0], sp[1]);
  else { P.ox -= e.deltaX; P.userView = true; requestDraw(); }
}
function updateLoupe(sp) {
  const d = P.drag;
  P.loupe = d && d.touch && (d.owner || ['trace', 'tapeA', 'tapeB', 'vert', 'tapeEnd'].includes(d.type)) ? sp : null;
}

// 壁の線で合わせるときは吸いつかせない（ななめの線をそのまま測る）
const tapeSnap = (p, from) => P.tool === 'align' ? p.slice() : snapPoint(p, from).p;
function finishTape() {
  if (!P.tapeA || !P.tapeB || dist(P.tapeA, P.tapeB) < 1e-6) { P.tapeA = P.tapeB = null; return; }
  if (P.tool === 'align') { const a = P.tapeA, b = P.tapeB; P.tapeA = P.tapeB = null; P.onAlign(a, b); return; }
  commit();
  const t = { id: newId('t'), a: P.tapeA, b: P.tapeB, m: null };
  M.tapes.push(t); P.tapeA = P.tapeB = null;
  select({ type: 'tape', id: t.id });
  P.onTapeDone(t); P.onChange();
}
function planCloseTrace() {
  if (P.trace.length < 3 || Math.abs(polyArea(P.trace)) * P.z * P.z < 100) return false;
  commit();
  const r = { id: newId('r'), name: '部屋' + (M.rooms.length + 1), jo: null, pts: P.trace.map(p => p.slice()) };
  M.rooms.push(r); P.trace = []; P.hover = null;
  select({ type: 'room', id: r.id });
  P.onRoomClosed(r); P.onChange(); P.onTraceChange();
  return true;
}
function planUndoPoint() { if (P.trace.length) { P.trace.pop(); P.onTraceChange(); requestDraw(); return true; } return false; }
// 線を水平か垂直（近いほう）にするのに回す角度（度）
function alignDelta(a, b) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  return Math.round(ang / 90) * 90 - ang;
}
function planCancel() { P.trace = []; P.pending = null; P.tapeA = P.tapeB = null; P.onTraceChange(); requestDraw(); }
function planSetTool(t) { P.tool = t; if (t !== 'trace') P.trace = []; P.tapeA = P.tapeB = null; P.hover = null; P.onTraceChange(); requestDraw(); }

// ---------- 描く ----------
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function planDraw() {
  const g = P.g; if (!g || !P.W) return;
  const C = { bg: css('--plan-bg'), grid: css('--plan-grid'), ink: css('--ink'), muted: css('--muted'), acc: css('--accent'),
    room: css('--plan-room'), sel: css('--plan-sel'), est: css('--est'), meas: css('--meas'), win: css('--plan-win') };
  g.setTransform(P.dpr, 0, 0, P.dpr, 0, 0);
  g.fillStyle = C.bg; g.fillRect(0, 0, P.W, P.H);
  const s = scaleInfo().s, est = scaleEst();   // 方眼・スキャンは描いたとおりの長さ

  // 1m の方眼（5m ごとに少し濃く）
  const step = 1 / s;
  if (step * P.z >= 10) {
    const [ux0, uy0] = toU(0, 0), [ux1, uy1] = toU(P.W, P.H);
    g.lineWidth = 1;
    for (let k = Math.floor(ux0 / step); k <= ux1 / step; k++) {
      const x = Math.round(k * step * P.z + P.ox) + 0.5;
      g.strokeStyle = C.grid; g.globalAlpha = k % 5 ? 0.5 : 1;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, P.H); g.stroke();
    }
    for (let k = Math.floor(uy0 / step); k <= uy1 / step; k++) {
      const y = Math.round(k * step * P.z + P.oy) + 0.5;
      g.globalAlpha = k % 5 ? 0.5 : 1;
      g.beginPath(); g.moveTo(0, y); g.lineTo(P.W, y); g.stroke();
    }
    g.globalAlpha = 1;
  }
  // 下じき
  if (IMG && M.img) {
    g.globalAlpha = P.imgAlpha;
    g.save();
    g.translate(P.ox + M.img.w / 2 * P.z, P.oy + M.img.h / 2 * P.z); g.rotate((M.imgRot || 0) * Math.PI / 180);
    g.drawImage(IMG.el, -M.img.w / 2 * P.z, -M.img.h / 2 * P.z, M.img.w * P.z, M.img.h * P.z);
    g.restore();
    g.globalAlpha = 1;
  }
  // 部屋の床
  for (const r of M.rooms) {
    const isSel = P.sel && P.sel.type === 'room' && P.sel.id === r.id;
    g.beginPath(); r.pts.forEach((p, i) => { const q = toS(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath();
    g.fillStyle = isSel ? C.sel : C.room; g.globalAlpha = IMG ? 0.45 : 0.8; g.fill(); g.globalAlpha = 1;
  }
  for (const x of P.exts) x.under(g, C);   // WiFi の強さの地図・搬入の目当ての部屋
  // 壁（同じ直線の辺は1本にまとめ、開口を抜いたもの）
  const W = buildWalls(), wt = Math.max(2, wallT() / s * P.z);
  g.strokeStyle = C.ink; g.lineWidth = wt; g.lineCap = 'square';
  for (const ln of W.lines) {
    const ops = ln.opens.slice().sort((a, b) => a.a - b.a);
    for (const [t0, t1] of ln.iv) {
      let t = t0;
      const seg = (u0, u1) => { if (u1 - u0 < 1e-4) return; const a = toS(W.at(ln, u0).map(v => v / s)), b = toS(W.at(ln, u1).map(v => v / s)); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); };
      for (const op of ops) { const a = Math.max(op.a, t0), b = Math.min(op.b, t1); if (b <= a || b <= t) continue; seg(t, a); t = b; }
      seg(t, t1);
    }
  }
  g.lineCap = 'butt';
  // 開口の記号
  for (const o of M.opens) drawOpen(g, o, C, wt);
  // 部屋の名前・広さ
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const r of M.rooms) {
    const c = toS(centroid(r.pts)), A = roomAreaM2(r);
    const big = Math.abs(polyArea(r.pts)) * P.z * P.z > 3000;
    if (!big) continue;
    label(g, r.name, c[0], c[1] - 9, 'bold 13px', C.ink, C.bg);
    const jo = r.jo ? r.jo + '帖・' : '';
    label(g, jo + (est ? '約' : '') + A.toFixed(1) + '㎡', c[0], c[1] + 9, '11px', est ? C.est : C.meas, C.bg);
  }
  // 角（動かす道具のとき・えらんだ部屋）
  if (P.tool === 'select') {
    for (const r of M.rooms) for (const p of r.pts) { const q = toS(p); dot(g, q, 4.5, C.bg, C.acc); }
    if (P.sel && P.sel.type === 'vert') { const r = byId(M.rooms, P.sel.id); if (r && r.pts[P.sel.i]) dot(g, toS(r.pts[P.sel.i]), 7, C.acc, C.bg); }
    for (const m of selRoomMids()) {   // 角を足す「＋」
      const q = toS(m.q); dot(g, q, 7, C.bg, C.acc);
      g.strokeStyle = C.acc; g.lineWidth = 1.8; g.beginPath(); g.moveTo(q[0] - 3.5, q[1]); g.lineTo(q[0] + 3.5, q[1]); g.moveTo(q[0], q[1] - 3.5); g.lineTo(q[0], q[1] + 3.5); g.stroke();
    }
  }
  // メジャー
  for (const t of M.tapes) {
    const isSel = P.sel && P.sel.type === 'tape' && P.sel.id === t.id;
    drawTape(g, t.a, t.b, t.m ? t.m.toFixed(2) + ' m（測った値）' : '長さを入れてください', isSel ? C.acc : C.meas, C.bg, isSel);
  }
  if (P.tapeA) {
    const b = P.tapeB || P.tapeA;
    const txt = !P.tapeB ? '' : P.tool === 'align' ? alignDelta(P.tapeA, b).toFixed(1) + '° 回します' : fmtM(dist(P.tapeA, b) * s, est);
    drawTape(g, P.tapeA, b, txt, C.acc, C.bg, true);
  }
  // なぞっている途中
  const tip = P.pending || P.hover;
  if (P.trace.length || P.pending) {
    const pts = P.trace.concat(tip ? [tip] : []);
    g.strokeStyle = C.acc; g.lineWidth = 2.5; g.setLineDash([]);
    g.beginPath(); pts.forEach((p, i) => { const q = toS(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke();
    P.trace.forEach((p, i) => dot(g, toS(p), i === 0 ? 6 : 4, i === 0 ? C.acc : C.bg, C.acc));
    if (tip && P.trace.length) {
      const a = P.trace[P.trace.length - 1], m = toS([(a[0] + tip[0]) / 2, (a[1] + tip[1]) / 2]);
      label(g, fmtM(dist(a, tip) * s, est), m[0], m[1] - 14, '12px', C.acc, C.bg);
    }
  }
  if (tip && P.tool === 'trace') dot(g, toS(tip), 4, C.acc, C.acc);
  // そろえの線
  if (P.guide && (P.guide.x != null || P.guide.y != null)) {
    g.strokeStyle = C.acc; g.lineWidth = 1; g.setLineDash([4, 4]); g.globalAlpha = 0.7;
    if (P.guide.x != null) { const x = toS([P.guide.x, 0])[0]; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, P.H); g.stroke(); }
    if (P.guide.y != null) { const y = toS([0, P.guide.y])[1]; g.beginPath(); g.moveTo(0, y); g.lineTo(P.W, y); g.stroke(); }
    g.setLineDash([]); g.globalAlpha = 1;
  }
  for (const x of P.exts) x.over(g, C);    // ルーター・よく使う場所・壁の材料・搬入の道
  drawCompass(g, C); drawScaleBar(g, C, s, est);
  if (P.loupe) drawLoupe(g, C);
}

function dot(g, q, r, fill, stroke) { g.beginPath(); g.arc(q[0], q[1], r, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); g.lineWidth = 2; g.strokeStyle = stroke; g.stroke(); }
function label(g, text, x, y, font, color, bg) {
  g.font = font + ' system-ui, sans-serif';
  g.lineWidth = 4; g.strokeStyle = bg; g.lineJoin = 'round'; g.strokeText(text, x, y);
  g.fillStyle = color; g.fillText(text, x, y);
}
function drawOpen(g, o, C, wt) {
  const G = openGeom(o); if (!G) return;
  const isSel = P.sel && P.sel.type === 'open' && P.sel.id === o.id;
  const col = isSel ? C.acc : C.ink, hw = G.w / 2;
  const A = toS([G.c[0] - G.u[0] * hw, G.c[1] - G.u[1] * hw]), B = toS([G.c[0] + G.u[0] * hw, G.c[1] + G.u[1] * hw]);
  const n = o.flip ? [-G.n[0], -G.n[1]] : G.n, wpx = G.w * P.z;
  g.strokeStyle = col; g.lineWidth = isSel ? 2.5 : 1.5;
  if (o.kind === 'door' || o.kind === 'entrance') {   // 開き戸: とびら（線）と開く弧
    const tip = [A[0] + n[0] * wpx, A[1] + n[1] * wpx];
    g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(tip[0], tip[1]); g.stroke();
    const a0 = Math.atan2(n[1], n[0]), a1 = Math.atan2(B[1] - A[1], B[0] - A[0]);
    let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    g.setLineDash([3, 3]); g.beginPath(); g.arc(A[0], A[1], wpx, a0, a0 + da, da < 0); g.stroke(); g.setLineDash([]);
    if (o.kind === 'entrance') { g.lineWidth = 3; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke(); }
  } else if (o.kind === 'sliding') {                   // 引き戸: 2枚の板をずらして
    const off = Math.max(2, wt * 0.25), m = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(A[0] + G.n[0] * off, A[1] + G.n[1] * off); g.lineTo(m[0] + G.u[0] * 4 + G.n[0] * off, m[1] + G.u[1] * 4 + G.n[1] * off); g.stroke();
    g.beginPath(); g.moveTo(m[0] - G.u[0] * 4 - G.n[0] * off, m[1] - G.u[1] * 4 - G.n[1] * off); g.lineTo(B[0] - G.n[0] * off, B[1] - G.n[1] * off); g.stroke();
  } else {                                             // 窓・掃き出し窓: 壁の中の細い2本線
    const off = Math.max(1.5, wt * 0.3);
    g.strokeStyle = isSel ? C.acc : C.win; g.lineWidth = o.kind === 'tallwin' ? 2.5 : 1.5;
    for (const k of [-1, 1]) { g.beginPath(); g.moveTo(A[0] + G.n[0] * off * k, A[1] + G.n[1] * off * k); g.lineTo(B[0] + G.n[0] * off * k, B[1] + G.n[1] * off * k); g.stroke(); }
    g.lineWidth = 1; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke();
  }
}
function drawTape(g, a, b, text, col, bg, bold) {
  const A = toS(a), B = toS(b), d = sub(B, A), L = len(d);
  g.strokeStyle = col; g.lineWidth = bold ? 2.5 : 1.5;
  g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke();
  if (L > 1) {
    const n = [-d[1] / L * 6, d[0] / L * 6];
    for (const q of [A, B]) { g.beginPath(); g.moveTo(q[0] - n[0], q[1] - n[1]); g.lineTo(q[0] + n[0], q[1] + n[1]); g.stroke(); }
  }
  if (text) label(g, text, (A[0] + B[0]) / 2, (A[1] + B[1]) / 2 - 12, (bold ? 'bold ' : '') + '12px', col, bg);
}
function drawCompass(g, C) {     // 北の向き（間取り図の方位マークに合わせて回す）
  const x = P.W - 30, y = 30, r = 16, a = M.north * Math.PI / 180;
  g.save(); g.translate(x, y);
  g.beginPath(); g.arc(0, 0, r + 6, 0, Math.PI * 2); g.fillStyle = C.bg; g.globalAlpha = 0.9; g.fill(); g.globalAlpha = 1;
  g.strokeStyle = C.muted; g.lineWidth = 1; g.setLineDash([2, 3]); g.stroke(); g.setLineDash([]);   // 点線の輪＝つかんで回せる
  g.rotate(a);
  g.beginPath(); g.moveTo(0, -r); g.lineTo(6, 6); g.lineTo(0, 2); g.lineTo(-6, 6); g.closePath();
  g.fillStyle = C.ink; g.fill();
  g.font = 'bold 10px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'bottom';
  g.fillText('北', 0, -r + 1 - 2);
  g.restore();
}
function drawScaleBar(g, C, s, est) {
  const target = 90 / P.z * s, steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
  const m = steps.find(v => v >= target * 0.6) || 50, w = m / s * P.z;
  const x = 12, y = P.H - 14;
  g.strokeStyle = C.ink; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w, y - 5); g.stroke();
  g.textAlign = 'left'; g.textBaseline = 'bottom';
  label(g, (est ? '約 ' : '') + (m < 1 ? m * 100 + ' cm' : m + ' m'), x + 4, y - 4, '11px', C.ink, C.bg);
}
function drawLoupe(g, C) {      // 指の下が見えないので、なぞる場所を2倍で上に出す
  const [sx, sy] = P.loupe, R = 48, Z = 2;
  let cx = sx, cy = sy - 92;
  if (cy < R + 4) cy = sy + 92;
  cx = Math.max(R + 4, Math.min(P.W - R - 4, cx));
  const src = R / Z;
  g.save();
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(P.cv, (sx - src) * P.dpr, (sy - src) * P.dpr, src * 2 * P.dpr, src * 2 * P.dpr, (cx - R) * P.dpr, (cy - R) * P.dpr, R * 2 * P.dpr, R * 2 * P.dpr);
  g.restore();
  g.setTransform(P.dpr, 0, 0, P.dpr, 0, 0);
  g.strokeStyle = C.acc; g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 1; g.beginPath(); g.moveTo(cx - 10, cy); g.lineTo(cx + 10, cy); g.moveTo(cx, cy - 10); g.lineTo(cx, cy + 10); g.stroke();
}
