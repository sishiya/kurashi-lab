// わが家の模型 — 3D スキャンから壁を自動で見つけて部屋の形にする（段階E）。scan.js のあと、ui.js の前に読む。
//
// 1. 断面の線の向きから、いちばん多い壁の向き θ0 を見つけ、壁が縦横にそろうように回して考える。
// 2. 床の面（上を向いた低い面）をマス目に塗って「床がある所」。穴（家具の下）はうめる。
// 3. 天井近く（ドアより上）の断面を壁として、床がある所を部屋ごとに分ける（ドアは天井近くでは壁がつながっている）。
// 4. 部屋ごとの外まわりを、縦横の辺だけの形にして（小さい段はならす）、壁の中心線まで外へ広げる。
// 5. 5cm ごとの高さの断面で、壁の開いた所（幅・腰の高さ・上の端）を測り、ドア・窓・掃き出し窓にする。
// 壁の厚さ（となりの部屋との間）と天井の高さもスキャンから測る。

const AW = { G: 0.025, DIL: 2 };   // マス 2.5cm、天井近くの壁を 2 マス太らせる

function sectionSegs(t, h) {        // 高さ h で切った線分 [x1, z1, x2, z2]
  const out = [];
  for (let i = 0; i < t.length; i += 9) {
    const P = [];
    for (const [a, b] of [[0, 3], [3, 6], [6, 0]]) {
      const ya = t[i + a + 1] - h, yb = t[i + b + 1] - h;
      if ((ya < 0) !== (yb < 0)) { const k = ya / (ya - yb); P.push(t[i + a] + (t[i + b] - t[i + a]) * k, t[i + a + 2] + (t[i + b + 2] - t[i + a + 2]) * k); }
    }
    if (P.length === 4) out.push(P);
  }
  return out;
}
function domAngle(segs) {           // 壁の向き（0〜90° の中で、長さの重みでいちばん多い向き。ラジアン）
  const bins = new Float64Array(180), list = [];
  for (const s of segs) {
    const dx = s[2] - s[0], dz = s[3] - s[1], L = Math.hypot(dx, dz); if (L < 1e-4) continue;
    let a = Math.atan2(dz, dx) * 180 / Math.PI; a = ((a % 90) + 90) % 90;
    bins[Math.floor(a * 2) % 180] += L; list.push([a, L]);
  }
  let bi = 0; for (let i = 1; i < 180; i++) if (bins[i] > bins[bi]) bi = i;
  const c = (bi + 0.5) / 2;          // いちばん多いきざみのまわり ±2° の線の、本当の角度の重みつき平均（0° と 90° のつなぎ目もまたぐ）
  let sw = 0, sa = 0;
  for (const [a, L] of list) { let d = a - c; if (d > 45) d -= 90; if (d < -45) d += 90; if (Math.abs(d) <= 2) { sw += L; sa += L * d; } }
  let a = c + sa / sw; if (a > 45) a -= 90;
  return a * Math.PI / 180;
}
function ceilingOf(t, F) {          // 天井: 下を向いた面（床から 1.5m より上）の高さを、面の広さの重みでならした真ん中
  const hs = [];                     // ドアや窓の上の小さな面に引っぱられないよう、数ではなく広さで
  for (let i = 0; i < t.length; i += 9) {
    const ax = t[i + 3] - t[i], ay = t[i + 4] - t[i + 1], az = t[i + 5] - t[i + 2], bx = t[i + 6] - t[i], by = t[i + 7] - t[i + 1], bz = t[i + 8] - t[i + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, l = Math.hypot(nx, ny, nz);
    const y = (t[i + 1] + t[i + 4] + t[i + 7]) / 3;
    if (l > 0 && ny / l < -0.95 && y > F + 1.5) hs.push([y, l / 2]);
  }
  if (!hs.length) { let m = -Infinity; for (let i = 1; i < t.length; i += 3) m = Math.max(m, t[i]); return m; }
  return wPct(hs, 0.5);
}
function wPct(hs, q) {              // [値, 重み] の重みつきの q 分位
  hs.sort((a, b) => a[0] - b[0]);
  const tot = hs.reduce((s, h) => s + h[1], 0); let c = 0;
  for (const h of hs) { c += h[1]; if (c >= tot * q) return h[0]; }
  return hs[hs.length - 1][0];
}

// マス目に塗る
function gridOf(x0, z0, W, H) { return { x0, z0, W, H, a: new Uint8Array(W * H) }; }
function fillTri(g, ax, az, bx, bz, cx, cz) {
  const G = AW.G, X = x => (x - g.x0) / G, Z = z => (z - g.z0) / G;
  const p = [[X(ax), Z(az)], [X(bx), Z(bz)], [X(cx), Z(cz)]].sort((u, v) => u[1] - v[1]);
  const j0 = Math.max(0, Math.ceil(p[0][1] - .5)), j1 = Math.min(g.H - 1, Math.floor(p[2][1] - .5));
  const xAt = (P, Q, y) => P[1] === Q[1] ? P[0] : P[0] + (Q[0] - P[0]) * (y - P[1]) / (Q[1] - P[1]);
  for (let j = j0; j <= j1; j++) {
    const y = j + .5, xa = xAt(p[0], p[2], y), xb = y < p[1][1] ? xAt(p[0], p[1], y) : xAt(p[1], p[2], y);
    const i0 = Math.max(0, Math.ceil(Math.min(xa, xb) - .5)), i1 = Math.min(g.W - 1, Math.floor(Math.max(xa, xb) - .5));
    for (let i = i0; i <= i1; i++) g.a[j * g.W + i] = 1;
  }
}
function drawSeg(g, x1, z1, x2, z2) {
  const G = AW.G, n = Math.ceil(Math.hypot(x2 - x1, z2 - z1) / (G / 2)) + 1;
  for (let k = 0; k <= n; k++) {
    const i = Math.floor((x1 + (x2 - x1) * k / n - g.x0) / G), j = Math.floor((z1 + (z2 - z1) * k / n - g.z0) / G);
    if (i >= 0 && j >= 0 && i < g.W && j < g.H) g.a[j * g.W + i] = 1;
  }
}
function dilate(g, r) {
  let a = g.a;
  for (let s = 0; s < r; s++) {
    const b = new Uint8Array(a);
    for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) if (!a[j * g.W + i] && ((i > 0 && a[j * g.W + i - 1]) || (i < g.W - 1 && a[j * g.W + i + 1]) || (j > 0 && a[(j - 1) * g.W + i]) || (j < g.H - 1 && a[(j + 1) * g.W + i]))) b[j * g.W + i] = 1;
    a = b;
  }
  g.a = a; return g;
}
function erode(g, r) { for (let k = 0; k < g.a.length; k++) g.a[k] ^= 1; dilate(g, r); for (let k = 0; k < g.a.length; k++) g.a[k] ^= 1; return g; }
function fillHoles(g) {             // まわりからつながっていない「床でない所」は床に
  const seen = new Uint8Array(g.a.length), st = [];
  for (let i = 0; i < g.W; i++) st.push(i, (g.H - 1) * g.W + i);
  for (let j = 0; j < g.H; j++) st.push(j * g.W, j * g.W + g.W - 1);
  while (st.length) {
    const k = st.pop(); if (seen[k] || g.a[k]) continue; seen[k] = 1;
    const i = k % g.W, j = (k / g.W) | 0;
    if (i > 0) st.push(k - 1); if (i < g.W - 1) st.push(k + 1); if (j > 0) st.push(k - g.W); if (j < g.H - 1) st.push(k + g.W);
  }
  for (let k = 0; k < g.a.length; k++) if (!g.a[k] && !seen[k]) g.a[k] = 1;
}
function components(free, W, H, minCells) {
  const lab = new Int32Array(W * H).fill(-1), comps = [];
  for (let s = 0; s < W * H; s++) {
    if (!free[s] || lab[s] >= 0) continue;
    const id = comps.length, st = [s], cells = []; lab[s] = id;
    while (st.length) {
      const k = st.pop(); cells.push(k);
      const i = k % W, j = (k / W) | 0;
      for (const n of [i > 0 ? k - 1 : -1, i < W - 1 ? k + 1 : -1, j > 0 ? k - W : -1, j < H - 1 ? k + W : -1]) if (n >= 0 && free[n] && lab[n] < 0) { lab[n] = id; st.push(n); }
    }
    comps.push(cells);
  }
  return comps.filter(c => c.length >= minCells);
}
// マスの集まりの外まわり（縦横の辺だけ）。いちばん大きな輪を、マスの角の座標 [i, j] の並びで返す
function outline(cells, W, H) {
  const inC = new Uint8Array(W * H); for (const k of cells) inC[k] = 1;
  const at = (i, j) => i >= 0 && j >= 0 && i < W && j < H && inC[j * W + i];
  const next = new Map(), key = (i, j) => j * (W + 1) + i;
  for (const k of cells) {           // 時計回り（y 下向きの画面で）に境目の辺をつなぐ
    const i = k % W, j = (k / W) | 0;
    if (!at(i, j - 1)) next.set(key(i, j), [i + 1, j]);
    if (!at(i + 1, j)) next.set(key(i + 1, j), [i + 1, j + 1]);
    if (!at(i, j + 1)) next.set(key(i + 1, j + 1), [i, j + 1]);
    if (!at(i - 1, j)) next.set(key(i, j + 1), [i, j]);
  }
  let best = [];
  const used = new Set();
  for (const [k0] of next) {
    if (used.has(k0)) continue;
    const loop = []; let k = k0, guard = 0;
    while (!used.has(k) && guard++ < 1e6) { used.add(k); const i = k % (W + 1), j = Math.floor(k / (W + 1)); loop.push([i, j]); const n = next.get(k); if (!n) break; k = key(n[0], n[1]); }
    if (loop.length > best.length) best = loop;
  }
  return best;
}
// 縦横の辺の並びにして、短い段（minLen マスより短い辺）をならす
function orthoSimplify(loop, minLen) {
  let E = [];                        // 辺: { v: 縦か, c: 座標（縦なら x）, a, b: 端（反対の座標） }
  for (let k = 0; k < loop.length; k++) {
    const p = loop[k], q = loop[(k + 1) % loop.length], v = p[0] === q[0];
    const e = v ? { v, c: p[0], a: p[1], b: q[1] } : { v, c: p[1], a: p[0], b: q[0] };
    const last = E[E.length - 1];
    if (last && last.v === v && last.c === e.c) last.b = e.b; else E.push(e);
  }
  if (E.length > 1 && E[0].v === E[E.length - 1].v && E[0].c === E[E.length - 1].c) { E[0].a = E[E.length - 1].a; E.pop(); }
  const len = e => Math.abs(e.b - e.a);
  for (let guard = 0; guard < 10000 && E.length > 4; guard++) {
    let ki = -1, kl = minLen;
    for (let k = 0; k < E.length; k++) if (len(E[k]) < kl) { kl = len(E[k]); ki = k; }
    if (ki < 0) break;
    const n = E.length, P = E[(ki - 1 + n) % n], N = E[(ki + 1) % n];
    // 短い辺をはさむ2辺（平行）を、長さの重みで1本に
    const lp = len(P), ln = len(N), c = (P.c * lp + N.c * ln) / (lp + ln);
    const merged = { v: P.v, c, a: P.a, b: N.b };
    const idx = [(ki - 1 + n) % n, ki, (ki + 1) % n].sort((x, y) => y - x);
    for (const i of idx) E.splice(i, 1);
    E.splice(Math.min((ki - 1 + n) % n, E.length), 0, merged);
    // となりの辺の端を合わせなおす
    for (let k = 0; k < E.length; k++) { const A = E[k], B = E[(k + 1) % E.length]; if (A.v !== B.v) { A.b = B.c; B.a = A.c; } }
    // 同じ向きで続いた辺はまとめる
    for (let k = 0; k < E.length && E.length > 4; k++) { const A = E[k], B = E[(k + 1) % E.length]; if (A.v === B.v) { A.b = B.b; A.c = (A.c * len(A) + B.c * len(B)) / Math.max(1e-9, len(A) + len(B)); E.splice((k + 1) % E.length, 1); k--; } }
  }
  return E;
}
// 辺を外向きに d だけずらして、角を作りなおす（マスの座標 → m は呼ぶ側で）
function offsetEdges(E, d) {
  let area = 0; const pts = E.map((e, k) => { const B = E[(k + 1) % E.length]; return e.v ? [e.c, B.c] : [B.c, e.c]; });
  for (let k = 0; k < pts.length; k++) { const a = pts[k], b = pts[(k + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const s = area > 0 ? 1 : -1;       // 回りの向きで「外」を決める
  const F = E.map(e => { const dir = Math.sign(e.b - e.a) || 1; const out = e.v ? dir * s : -dir * s; return { ...e, c: e.c + out * d }; });
  return F.map((e, k) => { const B = F[(k + 1) % F.length]; return e.v ? [e.c, B.c] : [B.c, e.c]; });
}

function autoWalls() {
  const t = SCAN.tri, Fl = SCAN.floor, G = AW.G;
  const top = ceilingOf(t, Fl), hTop = Math.min(top - 0.15, Fl + 2.25), hMid = Fl + 1.0;
  if (top - Fl < 1.8) throw new Error('天井の高さがわかりませんでした（天井までスキャンしてあるか見てください）');
  const th = domAngle(sectionSegs(t, hMid)), co = Math.cos(-th), si = Math.sin(-th);
  const R = new Float32Array(t.length);  // 壁が縦横にそろうように回した三角形
  for (let i = 0; i < t.length; i += 3) { R[i] = t[i] * co - t[i + 2] * si; R[i + 1] = t[i + 1]; R[i + 2] = t[i] * si + t[i + 2] * co; }
  const e = extents(R), x0 = e.lo[0] - 0.3, z0 = e.lo[2] - 0.3;
  const W = Math.ceil((e.d[0] + 0.6) / G), H = Math.ceil((e.d[2] + 0.6) / G);
  if (W * H > 6e6) throw new Error('スキャンが大きすぎます');
  // 床
  const floor = gridOf(x0, z0, W, H);
  for (let i = 0; i < R.length; i += 9) {
    const ax = R[i + 3] - R[i], ay = R[i + 4] - R[i + 1], az = R[i + 5] - R[i + 2], bx = R[i + 6] - R[i], by = R[i + 7] - R[i + 1], bz = R[i + 8] - R[i + 2];
    const ny = az * bx - ax * bz, l = Math.hypot(ay * bz - az * by, ny, ax * by - ay * bx);
    if (l > 0 && Math.abs(ny) / l > 0.9 && (R[i + 1] + R[i + 4] + R[i + 7]) / 3 < Fl + 0.1) fillTri(floor, R[i], R[i + 2], R[i + 3], R[i + 5], R[i + 6], R[i + 8]);
  }
  dilate(floor, 6); erode(floor, 6); fillHoles(floor);
  // 天井近くの壁で部屋を分ける
  const wallTop = gridOf(x0, z0, W, H);
  for (const s of sectionSegs(R, hTop)) drawSeg(wallTop, ...s);
  dilate(wallTop, AW.DIL);
  const free = new Uint8Array(W * H); for (let k = 0; k < free.length; k++) free[k] = floor.a[k] && !wallTop.a[k] ? 1 : 0;
  const comps = components(free, W, H, Math.round(0.7 / (G * G)));
  if (!comps.length) throw new Error('部屋が見つかりませんでした');
  const rooms = comps.map(c => orthoSimplify(outline(c, W, H), Math.round(0.15 / G)));
  // 壁の厚さ: となりの部屋どうしの向かい合う辺の間（マス）から
  const gaps = [];
  for (let a = 0; a < rooms.length; a++) for (let b = a + 1; b < rooms.length; b++) for (const A of rooms[a]) for (const B of rooms[b]) {
    if (A.v !== B.v) continue;
    const ov = Math.min(Math.max(A.a, A.b), Math.max(B.a, B.b)) - Math.max(Math.min(A.a, A.b), Math.min(B.a, B.b));
    const d = Math.abs(A.c - B.c);
    if (ov > 0.3 / G && d * G > 0.05 && d * G < 0.6) gaps.push(d * G);
  }
  gaps.sort((p, q) => p - q);
  const face = (AW.DIL + 0.5) * G;   // 部屋の境目から壁の面まで（太らせたぶん）
  const thick = gaps.length ? Math.max(0.06, Math.min(0.35, gaps[gaps.length >> 1] - 2 * face)) : null;
  const T = thick || wallT();
  const polys = rooms.map(E => offsetEdges(E, (face + T / 2) / G).map(([i, j]) => [x0 + i * G, z0 + j * G]));   // 壁の中心線（回した座標の m）
  // 開口: 5cm ごとの高さの断面で、壁の面にそって開いている所
  const levels = [];
  for (let h = 0.05; h <= top - Fl - 0.03; h += 0.05) { const g = gridOf(x0, z0, W, H); for (const s of sectionSegs(R, Fl + h)) drawSeg(g, ...s); levels.push({ h, g }); }
  const wallNear = (g, x, z, nx, nz) => {   // 壁の面のまわり（面から内へ 4cm〜外へ 4cm）に線があるか
    for (let k = -2; k <= 2; k++) { const i = Math.floor((x + nx * k * G - x0) / G), j = Math.floor((z + nz * k * G - z0) / G); if (i >= 0 && j >= 0 && i < W && j < H && g.a[j * W + i]) return true; }
    return false;
  };
  const midL = levels.reduce((b, l) => Math.abs(l.h - 1.0) < Math.abs(b.h - 1.0) ? l : b, levels[0]);
  const topL = levels.reduce((b, l) => Math.abs(l.h - (hTop - Fl)) < Math.abs(b.h - (hTop - Fl)) ? l : b, levels[0]);
  const opens = [];
  polys.forEach((poly, ri) => {
    const n = poly.length; let area = 0;
    for (let k = 0; k < n; k++) { const a = poly[k], b = poly[(k + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    for (let k = 0; k < n; k++) {
      const A = poly[k], B = poly[(k + 1) % n], L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < 0.5) continue;
      const ux = (B[0] - A[0]) / L, uz = (B[1] - A[1]) / L;
      let nx = uz, nz = -ux; if (area > 0) { nx = -nx; nz = -nz; }     // 部屋の内向き（y が下向きの座標で、時計回りなら右手が内）
      const fd = T / 2;                  // 中心線から壁の面へ
      const samp = [];
      for (let s = 0.1; s <= L - 0.1; s += G) {
        const x = A[0] + ux * s + nx * fd, z = A[1] + uz * s + nz * fd;
        samp.push({ s, gap: !wallNear(midL.g, x, z, nx, nz) && wallNear(topL.g, x, z, nx, nz), x, z });
      }
      let i = 0;
      while (i < samp.length) {
        if (!samp[i].gap) { i++; continue; }
        let j = i; while (j + 1 < samp.length && samp[j + 1].gap) j++;
        const w = samp[j].s - samp[i].s + 2 * G;   // 開口の両わきの面（壁の切り口）に 1 マスずつ食われるぶんを足す
        if (w >= 0.45) {
          const c = samp[(i + j) >> 1];
          let lo = midL.h, hi = midL.h;     // 開いている高さをのばす
          for (let q = levels.indexOf(midL) - 1; q >= 0; q--) { if (wallNear(levels[q].g, c.x, c.z, nx, nz)) { lo = levels[q + 1].h; break; } if (q === 0) lo = levels[0].h; }
          for (let q = levels.indexOf(midL) + 1; q < levels.length; q++) { if (wallNear(levels[q].g, c.x, c.z, nx, nz)) break; hi = levels[q].h; }
          const sill = lo <= 0.1 ? 0 : Math.round((lo - 0.025) * 100) / 100, head = Math.round((hi + 0.025) * 100) / 100;
          const mid = [A[0] + ux * (samp[i].s + samp[j].s) / 2, A[1] + uz * (samp[i].s + samp[j].s) / 2];
          // ほかの部屋が向こうにあれば、部屋の間のドア
          const far = [mid[0] - nx * (T + 0.2), mid[1] - nz * (T + 0.2)];
          const inner = polys.some((p, pi) => pi !== ri && inPolyM(far, p));
          const kind = sill === 0 ? (inner ? 'door' : 'tallwin') : 'window';
          if (!opens.some(o => Math.hypot(o.mid[0] - mid[0], o.mid[1] - mid[1]) < 0.4)) opens.push({ room: ri, edge: k, mid, kind, w: Math.round(w * 100) / 100, sill, h: Math.round((head - sill) * 100) / 100 });
        }
        i = j + 1;
      }
    }
  });
  return { th, polys, opens, T: thick, ceil: Math.round((top - Fl) * 100) / 100, n: comps.length };
}
function inPolyM(p, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; }
  return c;
}

// 見つけた部屋を模型に入れる（いまの部屋・ドア・窓はおきかえる）
function autoWallsApply() {
  if (!SCAN.tri || !M.scan) return;
  let r;
  try { r = autoWalls(); } catch (e) { toast(String(e.message || e)); return; }
  if (M.rooms.length && !confirm('いまの部屋・ドア・窓を消して、スキャンから見つけた形にしますか？')) return;
  commit();
  M.rooms = []; M.opens = []; P.sel = null; P.trace = [];
  // 壁が縦横になるよう下じきを回す（回した座標 → スキャンの座標 → 画像 → 回した図）
  rotatePlan(-r.th * 180 / Math.PI - (M.imgRot || 0));
  const s = M.scan, a = (M.imgRot || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), cx = M.img.w / 2, cz = M.img.h / 2;
  const toU = ([x, z]) => {
    const X = x * Math.cos(r.th) - z * Math.sin(r.th), Z = x * Math.sin(r.th) + z * Math.cos(r.th);   // スキャンの座標へもどす
    const px = (X - s.X0) * s.ppm - cx, pz = (Z - s.Z0) * s.ppm - cz;
    return [cx + px * ca - pz * sa, cz + px * sa + pz * ca];
  };
  r.polys.forEach((poly, i) => M.rooms.push({ id: newId('r'), name: '部屋' + (i + 1), jo: null, pts: poly.map(toU) }));
  for (const o of r.opens) {
    const room = M.rooms[o.room], c = toU(o.mid);
    let best = null;
    for (let k = 0; k < room.pts.length; k++) { const [A, B] = roomEdge(room, k), h = nearestOnSeg(c, A, B); if (!best || h.d < best.d) best = { k, t: h.t, d: h.d }; }
    M.opens.push({ id: newId('o'), room: room.id, edge: best.k, t: best.t, kind: o.kind, w: o.w, h: Math.min(o.h, r.ceil), sill: isWindow(o.kind) ? o.sill : null, flip: false });
  }
  if (r.T) M.wallT = Math.round(r.T * 100) / 100;
  M.ceil = r.ceil;
  planFit(); changed({ refit: true });
  const cnt = k => r.opens.filter(o => o.kind === k).length;
  toast(`部屋 ${r.polys.length}・ドア ${cnt('door')}・窓 ${cnt('window')}・掃き出し窓 ${cnt('tallwin')} を見つけました`);
  $('autoNote').textContent = `見つけた形: 部屋 ${r.polys.length}つ・ドア ${cnt('door')}・窓 ${cnt('window')}・掃き出し窓 ${cnt('tallwin')}。天井の高さ ${Math.round(r.ceil * 100)}cm` + (r.T ? `・壁の厚さ ${Math.round(r.T * 100)}cm` : '') + '（スキャンから測った値）。部屋の名前と、ドア・窓の種類（玄関・引き戸など）を確かめてください。';
}
