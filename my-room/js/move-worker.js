// わが家の模型 — 家具の搬入の道さがし（Web Worker。move.js から呼ばれる）
//
// 上から見た床の上で、箱（長い辺 a × 短い辺 b、m）を動かす・回すだけで、玄関の外から目当ての部屋まで行けるかを調べる。
// 状態は (x, y, 向き θ) のマス目。各状態の「すき間」＝箱とまわりの壁のいちばん近い距離（上限 cap）。
// すき間の大きい状態から先に広げる（いちばんせまい所が最大になる道を探す。ボトルネック最短路）。
// 同じすき間の中では目当ての部屋に近い順（A* のように早く着く）。
// マスとマスの間で箱が動くぶん（平行に step/2、回すと半対角線×Δθ/2）は、すき間から引いておく（すり抜けないように。小さめに出る）。

self.onmessage = e => {
  try { self.postMessage(run(e.data)); }
  catch (err) { self.postMessage({ error: String(err && err.message || err) }); }
};

function run(q) {
  const { obs, a, b, x0, y0, w, h, mask, mw, mstep, start, goal, goalC, cap, limitMs } = q;
  const t0 = Date.now();
  // マス目の細かさ: 位置 step（2cm から。状態が多すぎれば粗く）、向き Δθ は箱の端の動きが step くらいになるように
  const half = Math.hypot(a, b) / 2;
  let step = 0.02, nx, ny, nt, N;
  for (;;) {
    nx = Math.ceil(w / step); ny = Math.ceil(h / step);
    nt = Math.max(12, Math.ceil(Math.PI / Math.min(0.26, 2 * step / half)));
    N = nx * ny * nt;
    if (N <= 16e6) break;               // 配列 4 本 × N バイト
    step *= 1.2;
  }
  const dth = Math.PI / nt, Q = 0.005, L = Math.round(cap / Q);   // すき間は 0.5cm きざみの段（0〜L）
  const penT = step / 2, penR = half * dth / 2;
  const COS = new Float64Array(nt), SIN = new Float64Array(nt);
  for (let k = 0; k < nt; k++) { COS[k] = Math.cos(k * dth); SIN[k] = Math.sin(k * dth); }

  // 障害物（壁のかけら。4つの角）を 0.5m のかごに分ける
  const HC = 0.5, hx = Math.ceil(w / HC) + 1, hy = Math.ceil(h / HC) + 1, hash = Array.from({ length: hx * hy }, () => []);
  const O = obs.map((p, i) => {
    const xs = p.map(v => v[0]), ys = p.map(v => v[1]);
    const o = { p, bx0: Math.min(...xs), bx1: Math.max(...xs), by0: Math.min(...ys), by1: Math.max(...ys), ax: [] };
    for (let k = 0; k < 2; k++) { const dx = p[k + 1][0] - p[k][0], dy = p[k + 1][1] - p[k][1], l = Math.hypot(dx, dy) || 1; o.ax.push([-dy / l, dx / l]); }
    const i0 = Math.max(0, Math.floor((o.bx0 - x0 - cap) / HC)), i1 = Math.min(hx - 1, Math.floor((o.bx1 - x0 + cap) / HC));
    const j0 = Math.max(0, Math.floor((o.by0 - y0 - cap) / HC)), j1 = Math.min(hy - 1, Math.floor((o.by1 - y0 + cap) / HC));
    for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) hash[j * hx + ii].push(i);
    return o;
  });
  const stamp = new Int32Array(O.length); let st = 0;
  const R = [[0, 0], [0, 0], [0, 0], [0, 0]];
  function corners(x, y, k) {
    const ux = COS[k] * a / 2, uy = SIN[k] * a / 2, vx = -SIN[k] * b / 2, vy = COS[k] * b / 2;
    R[0][0] = x - ux - vx; R[0][1] = y - uy - vy; R[1][0] = x + ux - vx; R[1][1] = y + uy - vy;
    R[2][0] = x + ux + vx; R[2][1] = y + uy + vy; R[3][0] = x - ux + vx; R[3][1] = y - uy + vy;
  }
  function overlap(o, k) {          // 分離軸（箱の2軸と壁の2軸）
    const axes = [[COS[k], SIN[k]], [-SIN[k], COS[k]], o.ax[0], o.ax[1]];
    for (const [ax, ay] of axes) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const v of R) { const d = v[0] * ax + v[1] * ay; if (d < a0) a0 = d; if (d > a1) a1 = d; }
      for (const v of o.p) { const d = v[0] * ax + v[1] * ay; if (d < b0) b0 = d; if (d > b1) b1 = d; }
      if (a1 < b0 || b1 < a0) return false;
    }
    return true;
  }
  function segD(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + dx * t - px, ey = ay + dy * t - py; return Math.sqrt(ex * ex + ey * ey);
  }
  function polyDist(P1, P2) {
    let m = Infinity;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const p = P1[i], q0 = P2[j], q1 = P2[(j + 1) & 3];
      const d1 = segD(p[0], p[1], q0[0], q0[1], q1[0], q1[1]); if (d1 < m) m = d1;
      const r = P2[i], s0 = P1[j], s1 = P1[(j + 1) & 3];
      const d2 = segD(r[0], r[1], s0[0], s0[1], s1[0], s1[1]); if (d2 < m) m = d2;
    }
    return m;
  }
  function clearAt(x, y, k) {       // すき間（m。重なっていれば −1）
    corners(x, y, k);
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const v of R) { if (v[0] < bx0) bx0 = v[0]; if (v[0] > bx1) bx1 = v[0]; if (v[1] < by0) by0 = v[1]; if (v[1] > by1) by1 = v[1]; }
    const i0 = Math.max(0, Math.floor((bx0 - x0) / HC)), i1 = Math.min(hx - 1, Math.floor((bx1 - x0) / HC));
    const j0 = Math.max(0, Math.floor((by0 - y0) / HC)), j1 = Math.min(hy - 1, Math.floor((by1 - y0) / HC));
    st++; let m = cap;
    for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) for (const oi of hash[j * hx + ii]) {
      if (stamp[oi] === st) continue; stamp[oi] = st;
      const o = O[oi];
      if (o.bx0 > bx1 + m || o.bx1 < bx0 - m || o.by0 > by1 + m || o.by1 < by0 - m) continue;
      if (overlap(o, k)) return -1;
      const d = polyDist(R, o.p); if (d < m) m = d;
    }
    return m;
  }
  const inPoly = (px, py, poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const A = poly[i], B = poly[j];
      if ((A[1] > py) !== (B[1] > py) && px < (B[0] - A[0]) * (py - A[1]) / (B[1] - A[1]) + A[0]) c = !c;
    }
    return c;
  };
  const okCenter = (x, y) => { const i = Math.floor((x - x0) / mstep), j = Math.floor((y - y0) / mstep); return i >= 0 && j >= 0 && i < mw && mask[j * mw + i] === 1; };

  const cl = new Int8Array(N).fill(-2);      // その状態のすき間の段（−2 まだ、−1 ぶつかる・外）
  const best = new Int8Array(N).fill(-1);    // そこまでの道のいちばんせまい所（段）
  const par = new Uint8Array(N);             // どの動きで来たか
  const done = new Uint8Array(N);
  const X = i => x0 + (i + .5) * step, Y = j => y0 + (j + .5) * step;
  function clev(s) {
    if (cl[s] !== -2) return cl[s];
    const i = s % nx, j = ((s / nx) | 0) % ny, k = (s / (nx * ny)) | 0;
    let v = -1;
    if (okCenter(X(i), Y(j))) { const c = clearAt(X(i), Y(j), k); if (c >= 0) v = Math.min(L, Math.floor(c / Q)); }
    cl[s] = v; return v;
  }
  // 段ごとの山（目当てに近い順）
  const heaps = Array.from({ length: L + 1 }, () => ({ s: [], d: [] }));
  const push = (lv, s, d) => {
    const H = heaps[lv]; let i = H.s.length; H.s.push(s); H.d.push(d);
    while (i > 0) { const p = (i - 1) >> 1; if (H.d[p] <= d) break; H.s[i] = H.s[p]; H.d[i] = H.d[p]; i = p; }
    H.s[i] = s; H.d[i] = d;
  };
  const pop = H => {
    const top = H.s[0], ls = H.s.pop(), ld = H.d.pop(), n = H.s.length;
    if (n) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && H.d[c + 1] < H.d[c]) c++; if (H.d[c] >= ld) break; H.s[i] = H.s[c]; H.d[i] = H.d[c]; i = c; }
      H.s[i] = ls; H.d[i] = ld;
    }
    return top;
  };
  const hDist = (i, j) => Math.hypot(X(i) - goalC[0], Y(j) - goalC[1]);

  // はじめの状態: 玄関の外の箱（向きは start.k のまわりから、ぶつからないものを）
  const si = Math.floor((start[0] - x0) / step), sj = Math.floor((start[1] - y0) / step);
  let s0 = -1;
  for (let r = 0; r < 8 && s0 < 0; r++) for (let dk = 0; dk < nt && s0 < 0; dk++) {
    const k = (Math.round(start[2] / dth) + (dk % 2 ? -1 : 1) * ((dk + 1) >> 1) + nt * 4) % nt;
    for (const [di, dj] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const i = si + di, j = sj + dj; if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      const s = (k * ny + j) * nx + i; if (clev(s) >= 0) { s0 = s; break; }
    }
  }
  if (s0 < 0) return { ok: false, noStart: true, step, nt };
  best[s0] = cl[s0]; push(cl[s0], s0, hDist(si, sj));
  const DI = [1, -1, 0, 0, 0, 0], DJ = [0, 0, 1, -1, 0, 0], DK = [0, 0, 0, 0, 1, -1];
  let pops = 0, near = { d: Infinity, s: s0 }, goalS = -1, lvTop = L;
  while (lvTop >= 0) {
    if (!heaps[lvTop].s.length) { lvTop--; continue; }
    const s = pop(heaps[lvTop]);
    if (done[s]) continue;
    done[s] = 1; pops++;
    const i = s % nx, j = ((s / nx) | 0) % ny, k = (s / (nx * ny)) | 0;
    const hd = hDist(i, j);
    if (hd < near.d) near = { d: hd, s };
    if (hd < goal.r) {                       // 目当ての部屋の中に箱がまるごと入ったら着いた
      corners(X(i), Y(j), k);
      if (R.every(v => inPoly(v[0], v[1], goal.poly))) { goalS = s; break; }
    }
    if ((pops & 0x3ffff) === 0) {
      if (Date.now() - t0 > limitMs) return { ok: false, timeout: true, step, nt, pops };
      self.postMessage({ progress: pops });
    }
    const cur = best[s], c0 = cl[s];
    for (let m = 0; m < 6; m++) {
      let ii = i + DI[m], jj = j + DJ[m], kk = k + DK[m];
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      if (kk < 0) kk += nt; else if (kk >= nt) kk -= nt;   // 半回り（π）で同じ向き
      const t = (kk * ny + jj) * nx + ii;
      if (done[t]) continue;
      const c1 = clev(t); if (c1 < 0) continue;
      const e = Math.floor((Math.min(c0, c1) * Q - (m < 4 ? penT : penR)) / Q);
      if (e < 0) continue;
      const v = Math.min(cur, e, L);
      if (v > best[t]) { best[t] = v; par[t] = m; push(v, t, hDist(ii, jj)); }
    }
  }
  const back = s => {                        // 道をもどる
    const path = [];
    for (let n = 0; n < N; n++) {
      const i = s % nx, j = ((s / nx) | 0) % ny, k = (s / (nx * ny)) | 0;
      path.push([X(i), Y(j), k * dth, cl[s] * Q]);
      if (s === s0) break;
      const m = par[s];
      let pi = i - DI[m], pj = j - DJ[m], pk = k - DK[m];
      if (pk < 0) pk += nt; else if (pk >= nt) pk -= nt;
      s = (pk * ny + pj) * nx + pi;
    }
    return path.reverse();
  };
  if (goalS < 0) {
    const ni = near.s % nx, nj = ((near.s / nx) | 0) % ny;
    return { ok: false, stuck: [X(ni), Y(nj)], path: back(near.s), step, nt, pops };
  }
  return { ok: true, clear: best[goalS] * Q, path: back(goalS), step, nt, pops };
}
