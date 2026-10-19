// わが家の模型 — 日差し（段階D）。plan.js・view3d.js のあと、ui.js の前に読む。
//
// 太陽の位置: NOAA の太陽の計算（Meeus『Astronomical Algorithms』にもとづく式。大気の屈折の補正つき）。時刻は日本時間。
// 床に日が当たるか: 床の点から太陽の向きへ光をさかのぼり、外壁の窓（腰の高さ〜上の端）を通って外へ出られるか。
// 天井・窓のない壁・自分の家のほかの壁・ひさし（バルコニーの出）・まわりの建物にさえぎられたら当たらない。

// 都道府県庁の位置（国土地理院「都道府県の庁舎及び東西南北端点の経緯度（世界測地系）」。度:分:秒 → 度）
const PREFS = [
  ['北海道', '43:03:51', '141:20:48'], ['青森県', '40:49:27', '140:44:24'], ['岩手県', '39:42:12', '141:09:09'], ['宮城県', '38:16:08', '140:52:19'],
  ['秋田県', '39:43:07', '140:06:08'], ['山形県', '38:14:25', '140:21:48'], ['福島県', '37:45:00', '140:28:03'], ['茨城県', '36:20:30', '140:26:48'],
  ['栃木県', '36:33:56', '139:53:01'], ['群馬県', '36:23:28', '139:03:39'], ['埼玉県', '35:51:25', '139:38:56'], ['千葉県', '35:36:16', '140:07:23'],
  ['東京都', '35:41:21', '139:41:30'], ['神奈川県', '35:26:52', '139:38:33'], ['新潟県', '37:54:08', '139:01:23'], ['富山県', '36:41:42', '137:12:40'],
  ['石川県', '36:35:40', '136:37:32'], ['福井県', '36:03:54', '136:13:18'], ['山梨県', '35:39:50', '138:34:06'], ['長野県', '36:39:04', '138:10:51'],
  ['岐阜県', '35:23:27', '136:43:19'], ['静岡県', '34:58:36', '138:22:59'], ['愛知県', '35:10:49', '136:54:24'], ['三重県', '34:43:49', '136:30:30'],
  ['滋賀県', '35:00:15', '135:52:05'], ['京都府', '35:01:16', '135:45:20'], ['大阪府', '34:41:11', '135:31:12'], ['兵庫県', '34:41:28', '135:10:59'],
  ['奈良県', '34:41:07', '135:49:58'], ['和歌山県', '34:13:33', '135:10:02'], ['鳥取県', '35:30:12', '134:14:17'], ['島根県', '35:28:20', '133:03:01'],
  ['岡山県', '34:39:42', '133:56:06'], ['広島県', '34:23:47', '132:27:34'], ['山口県', '34:11:08', '131:28:17'], ['徳島県', '34:03:56', '134:33:33'],
  ['香川県', '34:20:24', '134:02:35'], ['愛媛県', '33:50:30', '132:45:57'], ['高知県', '33:33:34', '133:31:51'], ['福岡県', '33:36:23', '130:25:05'],
  ['佐賀県', '33:14:57', '130:17:55'], ['長崎県', '32:45:00', '129:52:02'], ['熊本県', '32:47:22', '130:44:30'], ['大分県', '33:14:17', '131:36:45'],
  ['宮崎県', '31:54:39', '131:25:26'], ['鹿児島県', '31:33:37', '130:33:29'], ['沖縄県', '26:12:44', '127:40:51'],
].map(([name, la, lo]) => { const d = s => { const [a, b, c] = s.split(':').map(Number); return a + b / 60 + c / 3600; }; return { name, lat: d(la), lon: d(lo) }; });
const FLOOR_H = 2.9;          // 1階分の高さ（目安）。何階かから床の高さを出す
const SN = { view: 'now', anim: 0, map: null, mapKey: '', daily: null, dailyKey: '', canvas: document.createElement('canvas'), canvasKey: '' };
const sunOn = () => U.tab === 'sun';

// ---------- 太陽の位置（NOAA） ----------
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
function sunPos(ms, lat, lon) {             // ms: UTC のミリ秒 → { alt: 高さ（度、屈折補正つき）, az: 方位（北から東回り、度）, geo: 屈折なしの高さ }
  const jd = ms / 864e5 + 2440587.5, T = (jd - 2451545) / 36525;
  const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360;
  const Ma = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(rad(Ma)) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(rad(2 * Ma)) * (0.019993 - 0.000101 * T) + Math.sin(rad(3 * Ma)) * 0.000289;
  const om = 125.04 - 1934.136 * T, lam = L0 + C - 0.00569 - 0.00478 * Math.sin(rad(om));
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(rad(om));
  const dec = Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lam)));
  const y = Math.tan(rad(eps / 2)) ** 2;
  const eot = 4 * deg(y * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(Ma)) + 4 * e * y * Math.sin(rad(Ma)) * Math.cos(2 * rad(L0)) - 0.5 * y * y * Math.sin(4 * rad(L0)) - 1.25 * e * e * Math.sin(2 * rad(Ma)));
  const utcMin = ((ms / 6e4) % 1440 + 1440) % 1440;
  const tst = ((utcMin + eot + 4 * lon) % 1440 + 1440) % 1440;
  const ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
  const la = rad(lat), cz = Math.min(1, Math.max(-1, Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(rad(ha))));
  const zen = Math.acos(cz), el = 90 - deg(zen);
  let az;
  const d = Math.cos(la) * Math.sin(zen);
  if (Math.abs(d) < 1e-9) az = lat > deg(dec) ? 180 : 0;
  else { const a = deg(Math.acos(Math.min(1, Math.max(-1, (Math.sin(la) * cz - Math.sin(dec)) / d)))); az = ha > 0 ? (a + 180) % 360 : (540 - a) % 360; }
  let ref = 0;                                 // 大気の屈折（度）
  if (el <= 85) {
    const te = Math.tan(rad(el));
    ref = el > 5 ? 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5 : el > -0.575 ? 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711))) : -20.772 / te;
    ref /= 3600;
  }
  return { alt: el + ref, az, geo: el };
}
const year = () => new Date().getFullYear();
const jstMs = (doy, min) => Date.UTC(year(), 0, doy, 0, min) - 9 * 3600e3;   // 日本時間 → UTC ミリ秒
const loc = () => ({ lat: M.sun.lat, lon: M.sun.lon });
function sunAt(doy, min) { const l = loc(); return sunPos(jstMs(doy, min), l.lat, l.lon); }
function riseSet(doy) {                       // 日の出・日の入り（屈折を入れない高さが −0.833° をこえる時刻、分。NOAA と同じ決め方）
  const l = loc(), g = m => sunPos(jstMs(doy, m), l.lat, l.lon).geo + 0.833, out = [];
  for (let m = 0; m < 1440; m += 10) {
    if ((g(m) < 0) === (g(m + 10) < 0)) continue;
    let lo = m, hi = m + 10;
    for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if ((g(lo) < 0) === (g(mid) < 0)) lo = mid; else hi = mid; }
    out.push((lo + hi) / 2);
  }
  return out.length >= 2 ? { rise: out[0], set: out[out.length - 1] } : null;
}
const DIRS = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
const dirName = az => DIRS[Math.round(az / 22.5) % 16];
const hm = m => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;
function dateName(doy) { const d = new Date(Date.UTC(year(), 0, doy)); return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`; }
function doyOf(m, d) { return Math.round((Date.UTC(year(), m - 1, d) - Date.UTC(year(), 0, 1)) / 864e5) + 1; }

// ---------- 光をさかのぼる ----------
// 図の上の向き: 北＝図の上を M.north 度 時計回りに回した向き
function sunVecPlan(p) {
  const a = rad(M.north || 0), N = [Math.sin(a), -Math.cos(a)], E = [Math.cos(a), Math.sin(a)], A = rad(p.az);
  return [N[0] * Math.cos(A) + E[0] * Math.sin(A), N[1] * Math.cos(A) + E[1] * Math.sin(A)];
}
function sunScene() {                         // 壁のかけら（m）と窓・建物をまとめる
  const W = buildWalls(), segs = [], H = ceilH(), eave = M.sun.eave || 0;
  const outward = {};
  for (const o of M.opens) { const G = openGeom(o); if (G) outward[o.id] = [-G.n[0], -G.n[1]]; }
  for (const ln of W.lines) for (const [t0, t1] of ln.iv) {
    const wins = ln.opens.filter(o => isWindow(o.kind) && o.b > t0 && o.a < t1).map(o => ({ a: o.a, b: o.b, sill: o.sill, head: o.head, out: outward[o.id] || ln.n }));
    segs.push({ A: W.at(ln, t0), B: W.at(ln, t1), u: ln.u, o: ln.o, t0, wins });
  }
  const s = scaleInfo().s;
  const bl = (M.sun.bldgs || []).map(b => ({ x0: Math.min(b.a[0], b.b[0]) * s, x1: Math.max(b.a[0], b.b[0]) * s, y0: Math.min(b.a[1], b.b[1]) * s, y1: Math.max(b.a[1], b.b[1]) * s, h: b.h }));
  return { segs, H, eave, bl, zf: Math.max(0, (M.floor || 1) - 1) * FLOOR_H };
}
// 床の点 P（m）に、向き d（図の上、単位）・高さの傾き th（tan 高さ）の光が届くか
function litAt(sc, P, d, th) {
  const hits = [];
  for (const sg of sc.segs) {
    const ex = sg.B[0] - sg.A[0], ey = sg.B[1] - sg.A[1], den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const qx = sg.A[0] - P[0], qy = sg.A[1] - P[1];
    const t = (qx * ey - qy * ex) / den, v = (qx * d[1] - qy * d[0]) / den;
    if (t > 1e-6 && v >= 0 && v <= 1) hits.push([t, sg, v]);
  }
  hits.sort((p, q) => p[0] - q[0]);
  let inside = true;
  for (const [t, sg, v] of hits) {
    const z = t * th;
    if (inside) {
      if (z >= sc.H) return false;            // 天井
      const tl = sg.t0 + v * Math.hypot(sg.B[0] - sg.A[0], sg.B[1] - sg.A[1]);
      const w = sg.wins.find(o => tl >= o.a && tl <= o.b);
      if (!w) return false;                   // 窓のない壁
      const cph = d[0] * w.out[0] + d[1] * w.out[1];
      if (cph <= 0) return false;
      const top = sc.eave > 0 ? Math.min(w.head, w.head - sc.eave * th / cph) : w.head;   // ひさし・上の階のバルコニー
      if (z < w.sill || z > top) return false;
      inside = false;
    } else if (z < sc.H) return false;        // 自分の家のほかの壁
  }
  if (inside) return false;
  for (const b of sc.bl) {                    // まわりの建物（入る所の高さで比べる）
    let t0 = 0, t1 = Infinity;
    for (const [p, dd, lo, hi] of [[P[0], d[0], b.x0, b.x1], [P[1], d[1], b.y0, b.y1]]) {
      if (Math.abs(dd) < 1e-12) { if (p < lo || p > hi) { t0 = Infinity; break; } continue; }
      let a = (lo - p) / dd, c = (hi - p) / dd; if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    }
    if (t0 <= t1 && t1 > 0 && sc.zf + Math.max(t0, 0) * th < b.h) return false;
  }
  return true;
}
// 部屋の床のマス（m）
function floorGrid(step) {
  const s = scaleInfo().s, pts = M.rooms.flatMap(r => r.pts);
  if (!pts.length) return null;
  const x0 = Math.min(...pts.map(p => p[0])) * s, y0 = Math.min(...pts.map(p => p[1])) * s;
  const w = Math.ceil((Math.max(...pts.map(p => p[0])) * s - x0) / step), h = Math.ceil((Math.max(...pts.map(p => p[1])) * s - y0) / step);
  const room = new Int16Array(w * h).fill(-1);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const p = [(x0 + (i + .5) * step) / s, (y0 + (j + .5) * step) / s];
    const k = M.rooms.findIndex(r => inPoly(p, r.pts)); room[j * w + i] = k;
  }
  return { x0, y0, w, h, step, room, s };
}
function sceneKey() { return JSON.stringify([M.rooms.map(r => r.pts), M.opens.map(o => [o.room, o.edge, o.t, o.kind, o.w, o.h, o.sill]), scaleInfo().s, M.ceil, M.north, M.floor, M.sun.lat, M.sun.lon, M.sun.eave, M.sun.bldgs]); }
let FG = null;
function sunMap() {                           // この時刻に日が当たるマス
  const key = sceneKey() + M.sun.doy + ':' + M.sun.min;
  if (SN.map && SN.mapKey === key) return SN.map;
  const sp = sunAt(M.sun.doy, M.sun.min);
  FG = FG && FG.key === sceneKey() ? FG : Object.assign(floorGrid(0.05) || {}, { key: sceneKey() });
  if (!FG.w) return null;
  const out = new Uint8Array(FG.w * FG.h);
  if (sp.alt > 0) {
    const sc = sunScene(), d = sunVecPlan(sp), th = Math.tan(rad(sp.alt));
    for (let j = 0; j < FG.h; j++) for (let i = 0; i < FG.w; i++) if (FG.room[j * FG.w + i] >= 0 && litAt(sc, [FG.x0 + (i + .5) * FG.step, FG.y0 + (j + .5) * FG.step], d, th)) out[j * FG.w + i] = 1;
  }
  SN.map = out; SN.mapKey = key; SN.canvasKey = '';
  return out;
}
function sunDaily() {                         // 1日に日が当たる時間（分）。10cm マス・10分ごと
  const key = sceneKey() + M.sun.doy;
  if (SN.daily && SN.dailyKey === key) return SN.daily;
  const g = floorGrid(0.1); if (!g) return null;
  const sc = sunScene(), mins = new Float32Array(g.w * g.h), roomAny = new Float32Array(M.rooms.length), roomAvg = new Float32Array(M.rooms.length), cnt = new Float32Array(M.rooms.length);
  for (let k = 0; k < g.room.length; k++) if (g.room[k] >= 0) cnt[g.room[k]]++;
  for (let m = 5; m < 1440; m += 10) {
    const sp = sunAt(M.sun.doy, m); if (sp.alt <= 0) continue;
    const d = sunVecPlan(sp), th = Math.tan(rad(sp.alt)), any = new Uint8Array(M.rooms.length);
    for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
      const k = j * g.w + i, r = g.room[k]; if (r < 0) continue;
      if (litAt(sc, [g.x0 + (i + .5) * g.step, g.y0 + (j + .5) * g.step], d, th)) { mins[k] += 10; any[r] = 1; roomAvg[r] += 10 / cnt[r]; }
    }
    for (let r = 0; r < any.length; r++) if (any[r]) roomAny[r] += 10;
  }
  SN.daily = { g, mins, roomAny, roomAvg }; SN.dailyKey = key; SN.canvasKey = '';
  return SN.daily;
}

// ---------- 画面 ----------
function sunCanvas() {                        // この時刻（黄色）／1日の日あたり（時間で色）を画像に
  const daily = SN.view === 'daily' ? sunDaily() : null, now = SN.view === 'now' ? sunMap() : null;
  const g = daily ? daily.g : FG; if (!g || !g.w) return null;
  const ck = SN.view + (daily ? SN.dailyKey : SN.mapKey);
  if (SN.canvasKey !== ck) {
    const c = SN.canvas; c.width = g.w; c.height = g.h;
    const x = c.getContext('2d'), im = x.createImageData(g.w, g.h);
    for (let k = 0; k < g.w * g.h; k++) {
      if (g.room[k] < 0) continue;
      let r = 0, gg = 0, b = 0, a = 0;
      if (now && now[k]) { r = 255; gg = 205; b = 70; a = 200; }
      if (daily) { const h = daily.mins[k] / 60; if (h > 0) { const t = Math.min(1, h / 6); r = 255; gg = Math.round(235 - 120 * t); b = Math.round(150 - 130 * t); a = Math.round(90 + 140 * Math.min(1, h / 2)); } }
      im.data[k * 4] = r; im.data[k * 4 + 1] = gg; im.data[k * 4 + 2] = b; im.data[k * 4 + 3] = a;
    }
    x.putImageData(im, 0, 0); SN.canvasKey = ck;
  }
  return g;
}
const minTxt = m => m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? Math.round(m % 60) + '分' : ''}` : `${Math.round(m)}分`;
function sunRender() {
  const box = $('sunBar'); if (!box) return;
  box.hidden = !sunOn(); if (!sunOn()) return;
  const S = M.sun, sp = sunAt(S.doy, S.min), rs = riseSet(S.doy);
  const pr = $('sPref'); if (document.activeElement !== pr) pr.value = String(S.pref);
  $('sLatLon').hidden = S.pref !== -1;
  for (const [id, v] of [['sLat', S.lat.toFixed(3)], ['sLon', S.lon.toFixed(3)], ['sDoy', S.doy], ['sMin', S.min], ['sEave', Math.round((S.eave || 0) * 100)]]) { const el = $(id); if (document.activeElement !== el) el.value = v; }
  $('sDoyOut').textContent = dateName(S.doy); $('sMinOut').textContent = hm(S.min);
  document.querySelectorAll('[data-sview]').forEach(b => b.classList.toggle('on', b.dataset.sview === SN.view));
  $('sBldg').classList.toggle('on', P.tool === 'bldg');
  $('sPlay').classList.toggle('on', !!SN.anim);
  $('sPlay').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${SN.anim ? 'M6 4h4v16H6zM14 4h4v16h-4z' : 'M7 4v16l13-8z'}"/></svg>`;
  // 図の下: 太陽のひとこと
  let html = `<p class="sinfo">${sp.alt > 0 ? `☀ 高さ <b>${sp.alt.toFixed(0)}°</b>・<b>${dirName(sp.az)}</b>` : '太陽は沈んでいます'}` + (rs ? `<span class="why">日の出 ${hm(rs.rise)}・日の入り ${hm(rs.set)}</span>` : '');
  if (!M.opens.some(o => isWindow(o.kind))) html += '<span class="why">「図面」で窓を置くと、日の入り方がわかります</span>';
  else if (SN.view === 'now' && sp.alt > 0) { const m = sunMap(), lit = m ? m.reduce((n, v) => n + v, 0) * 0.05 * 0.05 : 0; html += `<span class="why">${lit > 0 ? `床に日 約 ${lit.toFixed(1)}㎡` : '床に日は当たっていません'}</span>`; }
  else if (SN.view === 'daily') html += '<span class="why">色が濃いほど長く日が当たる（6時間以上でいちばん濃い）</span>';
  html += '</p>';
  if (Math.abs(M.north || 0) < 0.01) html += '<p class="why warn">北の向きが 0°（図の上が北）のままです。図の右上の矢印をドラッグして、間取り図の方位マークに合わせてください。</p>';
  $('sBody').innerHTML = html;
  // 右の欄: 部屋ごとの1日の日あたり
  const d = M.opens.some(o => isWindow(o.kind)) && !SN.anim ? sunDaily() : null;
  $('sList').innerHTML = d ? `<p class="hint small">${dateName(S.doy)}・${esc(S.pref >= 0 ? PREFS[S.pref].name + '庁のあたり' : '緯度 ' + S.lat.toFixed(2) + '°')}</p><ul class="wlist">` + M.rooms.map((r, i) => `<li><b>${esc(r.name)}</b> 床のどこかに日が当たる ${minTxt(d.roomAny[i])}<span class="why">床の広さでならすと ${minTxt(d.roomAvg[i])}</span></li>`).join('') + '</ul>'
    : SN.anim ? '<p class="hint small">再生中…</p>' : '<p class="hint small">窓を置くと、部屋ごとの日あたりの時間が出ます。</p>';
}
// 1日を再生（日の出から日の入りまで 12 秒）。3D でも 2D でも
function sunPlay(on) {
  if (!on) { if (SN.anim) { cancelAnimationFrame(SN.anim); SN.anim = 0; sunRender(); } return; }
  const rs = riseSet(M.sun.doy), a = rs ? Math.max(240, Math.floor(rs.rise / 5) * 5) : 300, b = rs ? Math.min(1200, Math.ceil(rs.set / 5) * 5) : 1140;
  if (M.sun.min >= b - 5 || M.sun.min < a) M.sun.min = a;
  if (SN.view === 'daily') SN.view = 'now';
  let last = performance.now();
  const tick = now => {
    M.sun.min = Math.min(b, M.sun.min + (now - last) / 12000 * (b - a)); last = now;
    $('sMin').value = M.sun.min; $('sMinOut').textContent = hm(M.sun.min);
    sunLive();
    SN.anim = M.sun.min < b ? requestAnimationFrame(tick) : 0;
    if (!SN.anim) { M.sun.min = Math.round(M.sun.min / 5) * 5; changed(); }
  };
  SN.anim = requestAnimationFrame(tick); sunRender();
}
function sunStop() { sunPlay(false); }
function sunLive() {   // 時刻・日付だけ変わったとき（再生中・つまみを動かしている間）: 2D は描きなおし、3D は光を動かす
  if (SN.view === '3d') { placeSun(); viewRender(); } else requestDraw();
  sunRender();
}
function sunHint() { return P.tool === 'bldg' ? '家の外でドラッグすると、まわりの建物（四角）を置けます。押してえらぶと高さを変えられます。' : ''; }
function sunSel(bar, s) {
  if (s.type !== 'bldg') return false;
  const b = byId(M.sun.bldgs, s.id); if (!b) return false;
  bar.innerHTML = `<span class="k">まわりの建物</span><label>高さ <input type="number" id="sBH" value="${b.h}" min="1" max="300" step="0.5" inputmode="decimal"> m</label><span class="note">地面からの高さ（目安で）</span><button id="sDel" class="danger">消す</button>`;
  $('sBH').onchange = e => edit(() => { const v = parseFloat(e.target.value); if (v > 0) b.h = v; });
  $('sDel').onclick = () => edit(() => { M.sun.bldgs = M.sun.bldgs.filter(x => x !== b); P.sel = null; }, '建物を消しました');
  return true;
}
// 3D の光を本物の太陽に（日差しのタブを使ったあと。沈んでいれば null）
function sun3dDir() {
  if (!M.sun.used) return null;
  const sp = sunAt(M.sun.doy, M.sun.min); if (sp.alt <= 0) return null;
  const d = sunVecPlan(sp), c = Math.cos(rad(sp.alt));
  return [d[0] * c, Math.sin(rad(sp.alt)), d[1] * c];
}

P.exts.push({
  tools: ['sunview', 'bldg'],
  active: sunOn,
  down(p) {
    const hit = [...M.sun.bldgs].reverse().find(b => p[0] >= Math.min(b.a[0], b.b[0]) && p[0] <= Math.max(b.a[0], b.b[0]) && p[1] >= Math.min(b.a[1], b.b[1]) && p[1] <= Math.max(b.a[1], b.b[1]));
    if (hit) { select({ type: 'bldg', id: hit.id }); return null; }
    if (P.tool !== 'bldg') return null;
    if (M.rooms.some(r => inPoly(p, r.pts))) { toast('建物は家の外に置いてください'); return null; }
    commit();
    const b = { id: newId('b'), a: p.slice(), b: p.slice(), h: 10 };
    M.sun.bldgs.push(b); select({ type: 'bldg', id: b.id });
    return { b, moved: true };
  },
  move(d, p) { d.b.b = p.slice(); },
  up(d) {
    const b = d.b, s = scaleInfo().s;
    if (Math.abs(b.a[0] - b.b[0]) * s < 0.3 || Math.abs(b.a[1] - b.b[1]) * s < 0.3) { M.sun.bldgs = M.sun.bldgs.filter(x => x !== b); P.sel = null; toast('ドラッグして四角をかいてください'); }
    changed();
  },
  under(g) {
    if (!sunOn() || !M.rooms.length) return;
    const gr = sunCanvas(); if (!gr) return;
    const k = gr.step / gr.s * P.z;
    g.save(); g.beginPath();
    for (const r of M.rooms) r.pts.forEach((p, i) => { const q = toS(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); });
    g.clip(); g.imageSmoothingEnabled = SN.view === 'daily';
    g.drawImage(SN.canvas, gr.x0 / gr.s * P.z + P.ox, gr.y0 / gr.s * P.z + P.oy, gr.w * k, gr.h * k);
    g.restore();
  },
  over(g, C) {
    if (!sunOn()) return;
    for (const b of M.sun.bldgs) {            // まわりの建物
      const A = toS([Math.min(b.a[0], b.b[0]), Math.min(b.a[1], b.b[1])]), B = toS([Math.max(b.a[0], b.b[0]), Math.max(b.a[1], b.b[1])]);
      const isSel = P.sel && P.sel.type === 'bldg' && P.sel.id === b.id;
      g.fillStyle = C.muted; g.globalAlpha = 0.35; g.fillRect(A[0], A[1], B[0] - A[0], B[1] - A[1]); g.globalAlpha = 1;
      g.lineWidth = isSel ? 2.5 : 1.5; g.strokeStyle = isSel ? C.acc : C.ink; g.strokeRect(A[0], A[1], B[0] - A[0], B[1] - A[1]);
      g.textAlign = 'center'; g.textBaseline = 'middle'; label(g, `建物 ${b.h}m`, (A[0] + B[0]) / 2, (A[1] + B[1]) / 2, '12px', C.ink, C.bg);
    }
    const sp = sunAt(M.sun.doy, M.sun.min);   // 太陽の向き（家のまん中から）
    if (sp.alt > 0 && M.rooms.length) {
      const pts = M.rooms.flatMap(r => r.pts), c = toS([(Math.min(...pts.map(p => p[0])) + Math.max(...pts.map(p => p[0]))) / 2, (Math.min(...pts.map(p => p[1])) + Math.max(...pts.map(p => p[1]))) / 2]);
      const d = sunVecPlan(sp), R = Math.min(P.W, P.H) * 0.42, q = [Math.max(24, Math.min(P.W - 24, c[0] + d[0] * R)), Math.max(24, Math.min(P.H - 24, c[1] + d[1] * R))];
      g.strokeStyle = '#e8a416'; g.lineWidth = 2; g.setLineDash([2, 5]); g.beginPath(); g.moveTo(c[0], c[1]); g.lineTo(q[0], q[1]); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.arc(q[0], q[1], 11, 0, Math.PI * 2); g.fillStyle = '#ffc43d'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#b7791f'; g.stroke();
      g.textAlign = 'center'; g.textBaseline = 'middle'; label(g, `${sp.alt.toFixed(0)}°`, q[0], q[1] + 22, 'bold 11px', '#b7791f', C.bg);
    }
  },
});

function sunInit() {
  $('sPref').innerHTML = PREFS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('') + '<option value="-1">緯度・経度を入れる</option>';
  $('sPref').onchange = e => edit(() => { const i = +e.target.value; M.sun.pref = i; if (i >= 0) { M.sun.lat = PREFS[i].lat; M.sun.lon = PREFS[i].lon; } });
  $('sLat').onchange = e => edit(() => { const v = parseFloat(e.target.value); if (v >= -66 && v <= 66) M.sun.lat = v; });
  $('sLon').onchange = e => edit(() => { const v = parseFloat(e.target.value); if (v >= -180 && v <= 180) M.sun.lon = v; });
  const live = (id, k) => {                     // つまみを動かしている間は「この時刻」だけ描きなおす（1日の地図は、はなしてから）
    $(id).oninput = e => { sunPlay(false); M.sun[k] = +e.target.value; $('sDoyOut').textContent = dateName(M.sun.doy); $('sMinOut').textContent = hm(M.sun.min); if (SN.view !== 'daily') sunLive(); };
    $(id).onchange = () => changed();
  };
  live('sDoy', 'doy'); live('sMin', 'min');
  document.querySelectorAll('[data-season]').forEach(b => b.onclick = () => {
    const [m, d] = b.dataset.season.split('-').map(Number), t = new Date();
    sunPlay(false); M.sun.doy = m ? doyOf(m, d) : doyOf(t.getMonth() + 1, t.getDate()); changed();
  });
  document.querySelectorAll('[data-sview]').forEach(b => b.onclick = () => { SN.view = b.dataset.sview; setTab('sun'); if (SN.view === '3d') { viewBuild(true); } });
  $('sPlay').onclick = () => sunPlay(!SN.anim);
  $('sBldg').onclick = () => { setTool(P.tool === 'bldg' ? 'sunview' : 'bldg'); sunRender(); };
  $('sEave').onchange = e => edit(() => { const v = parseFloat(e.target.value); M.sun.eave = isFinite(v) && v > 0 ? v / 100 : 0; });
}
