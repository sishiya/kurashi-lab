// わが家の模型 — 模型のデータ・形の計算・縮尺・保存（ほかのファイルより先に読む）
//
// 座標の単位「u」: 間取りの画像があるときは画像のピクセル、ないときは 1u＝1cm の方眼。
// メートルにするときは scaleInfo().s（1u が何 m か）をかける。y は下向き（画像と同じ）。

window.__roomErr = [];
window.addEventListener('error', e => window.__roomErr.push(String(e.message || e)));

const JO_M2 = 1.62;          // 1帖の広さの下限（壁心面積 ÷ 帖数。不動産の表示に関する公正競争規約施行規則）
const NO_IMG_UNIT = 0.01;    // 画像なしの方眼: 1u＝1cm

// ふつうの値（測った値がないときに使い、画面では「推定」と出す）。出どころは index.html の「おもな出どころ」と同じ。
// ドア・引き戸・玄関の w は「通れる幅（有効幅）」、窓の w・h は内のり。壁はこの幅で抜く（枠の厚みは入れない）。
const DEF = {
  ceil: 2.4,                 // 目安（法律の最低は 2.1m: 建築基準法施行令 第21条）
  wallT: 0.12,               // 目安（壁の中心線の両側に半分ずつ）
  open: {
    door:     { w: 0.75, h: 2.00, sill: 0 },     // 幅: 高齢者が居住する住宅の設計に係る指針（国交省告示1301号）の出入口の基本レベル 750mm 以上。高さは目安
    sliding:  { w: 0.75, h: 2.00, sill: 0 },     // 同上（1枚の引き戸）
    entrance: { w: 0.80, h: 2.00, sill: 0 },     // 幅: 同じ指針の推奨レベル 800mm 以上を目安に。高さは目安
    window:   { w: 1.65, h: 1.10, sill: 0.90 },  // 幅・高さ: 日本サッシ協会の標準規格寸法（幅 1650 は関東間の例、高さ 1100 は基準寸法の1つ）。床からの高さは目安（上が 2.0m にそろう）
    tallwin:  { w: 1.65, h: 2.00, sill: 0 },     // 高さ 2000: 同じ規格の基準寸法
  },
};
const OPEN_KINDS = { door: 'ドア', sliding: '引き戸', entrance: '玄関', window: '窓', tallwin: '掃き出し窓' };
const isWindow = k => k === 'window' || k === 'tallwin';

let M = newModel();          // 模型（保存するのはこれ）
let IMG = null;              // 下じきの画像 { el: HTMLImageElement, url: dataURL }（M.img に大きさ）

function newModel() {
  return { v: 1, rooms: [], opens: [], tapes: [], ceil: null, wallT: null, floor: 1, north: 0, img: null, imgRot: 0, nextId: 1, wifi: newWifi(), move: newMove() };
}
// WiFi（段階B）: ルーター・中継機 ext・よく使う場所・もの items（冷蔵庫など。rot は度）は u の点。wallMat は「部屋id:辺」ごとに変えた材料
function newWifi() { return { router: null, freq: '2.4', house: 'rc', spots: [], wallMat: {}, items: [], ext: [] }; }
// 家具の搬入（段階C）: 箱の大きさ（m）・運ぶ先の部屋・ぎりぎりの境目（両側のすき間の合計）
function newMove() { return { preset: 'sofa3', w: 2.0, d: 0.9, h: 0.85, target: null, margin: 0.05 }; }
const newId = p => p + (M.nextId++);
const byId = (list, id) => list.find(o => o.id === id);

// ---------- 形の計算 ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = v => Math.hypot(v[0], v[1]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function polyArea(pts) {     // 符号つき（u²）
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}
function centroid(pts) {
  const A = polyArea(pts);
  if (Math.abs(A) < 1e-9) return pts.reduce((c, p) => [c[0] + p[0] / pts.length, c[1] + p[1] / pts.length], [0, 0]);
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], f = a[0] * b[1] - b[0] * a[1];
    cx += (a[0] + b[0]) * f; cy += (a[1] + b[1]) * f;
  }
  return [cx / (6 * A), cy / (6 * A)];
}
function inPoly(p, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function nearestOnSeg(p, a, b) { // { t: 0..1, q: 点, d: 距離 }
  const ab = sub(b, a), L2 = ab[0] * ab[0] + ab[1] * ab[1];
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / L2)) : 0;
  const q = [a[0] + ab[0] * t, a[1] + ab[1] * t];
  return { t, q, d: dist(p, q) };
}
function roomEdge(room, i) { return [room.pts[i], room.pts[(i + 1) % room.pts.length]]; }

// ---------- 形を変える ----------
// 下じきを回す（画像のまん中を軸に。なぞった角・メジャーもいっしょに回して、画像からずれないように）
function imgCenter() {
  if (M.img) return [M.img.w / 2, M.img.h / 2];
  const pts = M.rooms.flatMap(r => r.pts);
  if (!pts.length) return [0, 0];
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
function rotatePlan(deg) {
  if (!deg) return;
  const c = imgCenter(), a = deg * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
  const rot = p => { const x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * co - y * si, c[1] + x * si + y * co]; };
  for (const r of M.rooms) r.pts = r.pts.map(rot);
  for (const t of M.tapes) { t.a = rot(t.a); t.b = rot(t.b); }
  if (M.wifi.router) M.wifi.router = rot(M.wifi.router);
  for (const sp of M.wifi.spots) sp.p = rot(sp.p);
  for (const e of M.wifi.ext) e.p = rot(e.p);
  for (const it of M.wifi.items) { it.p = rot(it.p); it.rot = ((it.rot || 0) + deg) % 360; }
  let d = (M.imgRot || 0) + deg;
  while (d > 180) d -= 360; while (d <= -180) d += 360;
  M.imgRot = Math.round(d * 1000) / 1000;
}
// 角を足す・消すとき、その部屋のドア・窓は位置（図の上の点）を覚えておき、いちばん近い辺に付けなおす
function keepOpens(room, fn) {
  const ops = M.opens.filter(o => o.room === room.id).map(o => {
    const [a, b] = roomEdge(room, Math.min(o.edge, room.pts.length - 1));
    return { o, c: [a[0] + (b[0] - a[0]) * o.t, a[1] + (b[1] - a[1]) * o.t] };
  });
  fn();
  for (const { o, c } of ops) {
    let best = null;
    for (let i = 0; i < room.pts.length; i++) {
      const [a, b] = roomEdge(room, i), h = nearestOnSeg(c, a, b);
      if (!best || h.d < best.d) best = { i, t: h.t, d: h.d };
    }
    o.edge = best.i; o.t = Math.max(0.02, Math.min(0.98, best.t));
  }
}
function insertVertex(room, edge, p) { keepOpens(room, () => room.pts.splice(edge + 1, 0, p.slice())); return edge + 1; }
function deleteVertex(room, i) {
  if (room.pts.length <= 3) return false;
  keepOpens(room, () => room.pts.splice(i, 1));
  return true;
}

// ---------- 縮尺 ----------
// メジャーの値があればそれ（測った値）。なければ帖から（推定）。どちらもなければ仮の値。
function scaleInfo() {
  const tapes = M.tapes.filter(t => t.m > 0 && dist(t.a, t.b) > 1e-6);
  if (tapes.length) {
    const s = tapes.reduce((acc, t) => acc + t.m / dist(t.a, t.b), 0) / tapes.length;
    return { s, src: 'tape', n: tapes.length };
  }
  let num = 0, den = 0;
  for (const r of M.rooms) {
    const A = Math.abs(polyArea(r.pts));
    if (r.jo > 0 && A > 0) { num += r.jo * JO_M2; den += A; }
  }
  if (den > 0) return { s: Math.sqrt(num / den), src: 'jo' };
  if (!M.img) return { s: NO_IMG_UNIT, src: 'grid' };
  return { s: 10 / Math.max(M.img.w, M.img.h), src: 'none' }; // 画像の長い辺を 10m と仮に置く
}
const ceilH = () => M.ceil || DEF.ceil;
const wallT = () => M.wallT || DEF.wallT;
function openDims(o) { // m。null は推定（ふつうの値）
  const d = DEF.open[o.kind];
  return { w: o.w || d.w, h: o.h || d.h, sill: o.sill != null ? o.sill : d.sill };
}
function roomAreaM2(r) { const s = scaleInfo().s; return Math.abs(polyArea(r.pts)) * s * s; }

// ---------- 壁 ----------
// 部屋の辺を「同じ直線の上にあるもの」でまとめ、重なりを1本にする（となりの部屋との壁が2重にならないように）。
// 開口（ドア・窓）は、その直線の区間から抜く。返すのは m の座標。
function buildWalls() {
  const s = scaleInfo().s, ANG = 0.02, OFF = 0.03;
  const lines = [];
  const lineOf = (a, b) => {   // a,b は m
    const d = sub(b, a), L = len(d);
    if (L < 1e-4) return null;
    let u = [d[0] / L, d[1] / L];
    if (u[0] < -1e-9 || (Math.abs(u[0]) < 1e-9 && u[1] < 0)) u = [-u[0], -u[1]];
    const n = [-u[1], u[0]], off = n[0] * a[0] + n[1] * a[1];
    let ln = lines.find(l => Math.abs(l.u[0] * u[1] - l.u[1] * u[0]) < ANG && l.u[0] * u[0] + l.u[1] * u[1] > 0 && Math.abs(l.off - off) < OFF);
    if (!ln) { ln = { u, n, off, o: [n[0] * off, n[1] * off], iv: [], opens: [], src: [] }; lines.push(ln); }
    return ln;
  };
  const proj = (ln, p) => (p[0] - ln.o[0]) * ln.u[0] + (p[1] - ln.o[1]) * ln.u[1];
  const edgeRef = {};
  for (const r of M.rooms) {
    for (let i = 0; i < r.pts.length; i++) {
      const [a, b] = roomEdge(r, i).map(p => [p[0] * s, p[1] * s]);
      const ln = lineOf(a, b); if (!ln) continue;
      const t0 = proj(ln, a), t1 = proj(ln, b);
      ln.iv.push([Math.min(t0, t1), Math.max(t0, t1)]);
      ln.src.push({ room: r.id, edge: i, t0: Math.min(t0, t1), t1: Math.max(t0, t1) });   // どの部屋のどの辺か（外壁・間仕切りの見分けに）
      edgeRef[r.id + ':' + i] = { ln, t0, t1 };
    }
  }
  for (const ln of lines) { // 区間をまとめる
    ln.iv.sort((p, q) => p[0] - q[0]);
    const out = [];
    for (const v of ln.iv) { const last = out[out.length - 1]; if (last && v[0] <= last[1] + 1e-3) last[1] = Math.max(last[1], v[1]); else out.push(v.slice()); }
    ln.iv = out;
  }
  for (const o of M.opens) {
    const e = edgeRef[o.room + ':' + o.edge]; if (!e) continue;
    const d = openDims(o), tc = e.t0 + (e.t1 - e.t0) * o.t;
    e.ln.opens.push({ id: o.id, kind: o.kind, a: tc - d.w / 2, b: tc + d.w / 2, sill: d.sill, head: Math.min(ceilH(), d.sill + d.h) });
  }
  // 壁のかけら: { a, b（m の点）, z0, z1 }
  const H = ceilH(), pieces = [];
  const at = (ln, t) => [ln.o[0] + ln.u[0] * t, ln.o[1] + ln.u[1] * t];
  for (const ln of lines) {
    const ops = ln.opens.slice().sort((p, q) => p.a - q.a);
    for (const [t0, t1] of ln.iv) {
      let t = t0;
      for (const op of ops) {
        const a = Math.max(op.a, t0), b = Math.min(op.b, t1);
        if (b <= a || b <= t) continue;
        if (a > t) pieces.push({ a: at(ln, t), b: at(ln, a), z0: 0, z1: H });
        const aa = Math.max(a, t);
        if (op.sill > 0) pieces.push({ a: at(ln, aa), b: at(ln, b), z0: 0, z1: op.sill });
        if (op.head < H) pieces.push({ a: at(ln, aa), b: at(ln, b), z0: op.head, z1: H, lintel: true });
        t = b;
      }
      if (t < t1) pieces.push({ a: at(ln, t), b: at(ln, t1), z0: 0, z1: H });
    }
  }
  return { lines, pieces, at };
}

// ---------- 元に戻す ----------
const HIST = [], REDO = [];
function snapshot() { return JSON.stringify(M); }
function commit() {          // 変更の「前」に呼ぶ
  HIST.push(snapshot()); if (HIST.length > 80) HIST.shift();
  REDO.length = 0;
}
function undo() { if (!HIST.length) return false; REDO.push(snapshot()); M = JSON.parse(HIST.pop()); return true; }
function redo() { if (!REDO.length) return false; HIST.push(snapshot()); M = JSON.parse(REDO.pop()); return true; }

// ---------- 保存（この端末と、ファイル。外には送らない） ----------
const STORE_KEY = 'kurashi.my-room.v1';
const STORE_IMG_KEY = 'kurashi.my-room.v1.img';
function saveLocal(withImg) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(M));
    if (withImg && IMG) localStorage.setItem(STORE_IMG_KEY, IMG.url); else localStorage.removeItem(STORE_IMG_KEY);
    return true;
  } catch (e) { return false; }   // 容量がいっぱい・保存できない設定
}
function loadLocal() {
  try {
    const s = localStorage.getItem(STORE_KEY); if (!s) return null;
    return { model: JSON.parse(s), img: localStorage.getItem(STORE_IMG_KEY) };
  } catch (e) { return null; }
}
function clearLocal() { try { localStorage.removeItem(STORE_KEY); localStorage.removeItem(STORE_IMG_KEY); } catch (e) {} }
function fixModel(m) {       // 読みこんだものの形をそろえる（足りない項目はふつうの値）
  const d = newModel();
  if (!m || typeof m !== 'object') return d;
  const out = Object.assign(d, m);
  for (const k of ['rooms', 'opens', 'tapes']) if (!Array.isArray(out[k])) out[k] = [];
  out.rooms = out.rooms.filter(r => Array.isArray(r.pts) && r.pts.length >= 3);
  out.opens = out.opens.filter(o => OPEN_KINDS[o.kind] && out.rooms.some(r => r.id === o.room));
  out.wifi = Object.assign(newWifi(), out.wifi && typeof out.wifi === 'object' ? out.wifi : {});
  for (const k of ['spots', 'items', 'ext']) if (!Array.isArray(out.wifi[k])) out.wifi[k] = [];
  out.move = Object.assign(newMove(), out.move && typeof out.move === 'object' ? out.move : {});
  if (!out.wifi.wallMat || typeof out.wifi.wallMat !== 'object') out.wifi.wallMat = {};
  return out;
}

// 画像を下じきにする形へ（長い辺 2000px まで・JPEG に書きなおす → 撮影情報などは残らない）
function prepImage(src) {
  return new Promise((ok, ng) => {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, 2000 / Math.max(im.naturalWidth, im.naturalHeight));
      const w = Math.round(im.naturalWidth * k), h = Math.round(im.naturalHeight * k);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(im, 0, 0, w, h);
      const url = c.toDataURL('image/jpeg', 0.9);
      const el = new Image(); el.onload = () => ok({ el, url, w, h }); el.onerror = ng; el.src = url;
    };
    im.onerror = ng; im.src = src;
  });
}
function loadImageUrl(url) { // 保存してあった画像（もう書きなおしてある）
  return new Promise((ok, ng) => { const el = new Image(); el.onload = () => ok({ el, url, w: el.naturalWidth, h: el.naturalHeight }); el.onerror = ng; el.src = url; });
}

// 見本の間取り（画像なし・1u＝1cm）。壁の中心線でなぞった 1LDK。
function sampleModel() {
  const m = newModel();
  m.rooms = [
    { id: 'r1', name: 'LDK', jo: null, pts: [[0, 0], [540, 0], [540, 360], [0, 360]] },
    { id: 'r2', name: '洋室', jo: null, pts: [[540, 0], [900, 0], [900, 270], [540, 270]] },
    { id: 'r3', name: '廊下', jo: null, pts: [[540, 270], [900, 270], [900, 360], [540, 360]] },
    { id: 'r4', name: '玄関', jo: null, pts: [[720, 360], [900, 360], [900, 480], [720, 480]] },
    { id: 'r5', name: '水まわり', jo: null, pts: [[540, 360], [720, 360], [720, 480], [540, 480]] },
  ];
  m.opens = [
    { id: 'o1', room: 'r1', edge: 0, t: 0.5, kind: 'tallwin', w: null, h: null, sill: null, flip: false },
    { id: 'o2', room: 'r2', edge: 0, t: 0.5, kind: 'window', w: null, h: null, sill: null, flip: false },
    { id: 'o3', room: 'r3', edge: 0, t: 0.5, kind: 'door', w: null, h: null, sill: null, flip: false },
    { id: 'o4', room: 'r3', edge: 3, t: 0.5, kind: 'door', w: null, h: null, sill: null, flip: true },
    { id: 'o5', room: 'r4', edge: 2, t: 0.5, kind: 'entrance', w: null, h: null, sill: null, flip: false },
    { id: 'o6', room: 'r5', edge: 0, t: 0.5, kind: 'sliding', w: 0.8, h: null, sill: null, flip: false },
    { id: 'o7', room: 'r4', edge: 0, t: 0.5, kind: 'door', w: null, h: null, sill: null, flip: false },
  ];
  m.move.target = 'r2';         // 搬入: 洋室へ
  m.wifi.router = [810, 440];   // 玄関の近く（よくある置き場所）
  m.wifi.spots = [{ id: 's1', name: 'ソファー', p: [160, 250] }, { id: 's2', name: 'ベッド', p: [760, 120] }];
  m.nextId = 10;
  return m;
}
