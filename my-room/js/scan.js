// わが家の模型 — 3D スキャンの読みこみ（段階E）。model.js・plan.js・view3d.js のあと、ui.js の前に読む。
//
// LiDAR のスキャンアプリが書き出した OBJ・glTF（.glb、データを中に持つ .gltf）・PLY を、このブラウザの中だけで読む（外に送らない）。
// 床から決めた高さ（初めは 1m）で切った断面と、それより下の形をうすく、上から見た図にして下じきにする。
// スキャンは m 単位なので、縮尺は「スキャンから（測った値）」に決まる。3D のタブでは、スキャンを模型に重ねて見られる。
// スキャンの形そのものは保存しない（大きいため。断面の画像は下じきとして保存される）。

const SCAN = { tri: null, name: '', up: 'y', unit: 1, slice: 1.0, auto: null, show: true, obj: null, ver: 0 };

// ---------- 読む（三角形の頂点を並べた Float32Array にする） ----------
function parseOBJ(text) {
  const v = [], out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('v ')) { const p = t.split(/\s+/); v.push(+p[1], +p[2], +p[3]); }
    else if (t.startsWith('f ')) {
      const ids = t.split(/\s+/).slice(1).map(s => { const i = parseInt(s, 10); return i < 0 ? v.length / 3 + i : i - 1; });
      for (let k = 1; k + 1 < ids.length; k++) for (const i of [ids[0], ids[k], ids[k + 1]]) out.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
    }
  }
  return new Float32Array(out);
}
function parsePLY(buf) {
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 4096)));
  const end = head.indexOf('end_header'); if (end < 0) throw new Error('PLY の見出しが読めません');
  const lines = head.slice(0, end).split(/\r?\n/), fmt = (lines.find(l => l.startsWith('format')) || '').split(/\s+/)[1];
  const els = []; let cur = null;
  for (const l of lines) {
    const p = l.trim().split(/\s+/);
    if (p[0] === 'element') { cur = { name: p[1], n: +p[2], props: [] }; els.push(cur); }
    else if (p[0] === 'property' && cur) cur.props.push(p[1] === 'list' ? { list: true, ct: p[2], it: p[3], name: p[4] } : { t: p[1], name: p[2] });
  }
  const vEl = els.find(e => e.name === 'vertex'), fEl = els.find(e => e.name === 'face');
  if (!vEl || !fEl) throw new Error('PLY に頂点と面がありません（点だけのファイルは読めません）');
  const V = new Float32Array(vEl.n * 3), tri = [];
  const ix = ['x', 'y', 'z'].map(n => vEl.props.findIndex(p => p.name === n));
  if (fmt === 'ascii') {
    const body = new TextDecoder().decode(new Uint8Array(buf)).slice(head.indexOf('end_header') + 10).trim().split(/\r?\n/);
    let r = 0;
    for (const e of els) for (let i = 0; i < e.n; i++, r++) {
      const p = body[r].trim().split(/\s+/).map(Number);
      if (e === vEl) for (let k = 0; k < 3; k++) V[i * 3 + k] = p[ix[k]];
      else if (e === fEl) { const n = p[0]; for (let k = 1; k + 1 < n; k++) tri.push(p[1], p[1 + k], p[2 + k]); }
    }
  } else if (fmt === 'binary_little_endian') {
    const dv = new DataView(buf), SZ = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
    const read = (t, o) => {
      switch (t) {
        case 'char': case 'int8': return dv.getInt8(o); case 'uchar': case 'uint8': return dv.getUint8(o);
        case 'short': case 'int16': return dv.getInt16(o, true); case 'ushort': case 'uint16': return dv.getUint16(o, true);
        case 'int': case 'int32': return dv.getInt32(o, true); case 'uint': case 'uint32': return dv.getUint32(o, true);
        case 'float': case 'float32': return dv.getFloat32(o, true); default: return dv.getFloat64(o, true);
      }
    };
    let o = new TextEncoder().encode(head.slice(0, end + 10)).length;
    while (dv.getUint8(o) === 0x0d || dv.getUint8(o) === 0x0a) o++;
    for (const e of els) for (let i = 0; i < e.n; i++) {
      const vals = [];
      for (const p of e.props) {
        if (p.list) { const n = read(p.ct, o); o += SZ[p.ct]; const a = []; for (let k = 0; k < n; k++) { a.push(read(p.it, o)); o += SZ[p.it]; } vals.push(a); }
        else { vals.push(read(p.t, o)); o += SZ[p.t]; }
      }
      if (e === vEl) for (let k = 0; k < 3; k++) V[i * 3 + k] = vals[ix[k]];
      else if (e === fEl) { const a = vals.find(Array.isArray) || []; for (let k = 1; k + 1 < a.length; k++) tri.push(a[0], a[k], a[k + 1]); }
    }
  } else throw new Error('この PLY の形式（' + fmt + '）は読めません');
  const out = new Float32Array(tri.length * 3);
  tri.forEach((i, k) => { out[k * 3] = V[i * 3]; out[k * 3 + 1] = V[i * 3 + 1]; out[k * 3 + 2] = V[i * 3 + 2]; });
  return out;
}
function parseGLTF(json, bins) {
  if ((json.extensionsRequired || []).some(x => /draco|meshopt/i.test(x))) throw new Error('圧縮された glTF（Draco など）はまだ読めません。圧縮なしで書き出してください');
  const acc = i => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView], buf = bins[bv.buffer];
    const comp = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType], n = { SCALAR: 1, VEC3: 3, VEC4: 4, VEC2: 2 }[a.type];
    const stride = bv.byteStride || comp * n, base = (bv.byteOffset || 0) + (a.byteOffset || 0), dv = new DataView(buf.buffer, buf.byteOffset);
    const out = new Float64Array(a.count * n);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) {
      const o = base + i * stride + k * comp;
      out[i * n + k] = a.componentType === 5126 ? dv.getFloat32(o, true) : a.componentType === 5125 ? dv.getUint32(o, true) : a.componentType === 5123 ? dv.getUint16(o, true) : a.componentType === 5121 ? dv.getUint8(o) : a.componentType === 5122 ? dv.getInt16(o, true) : dv.getInt8(o);
    }
    return out;
  };
  const out = [], mul = (A, B) => { const C = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) C[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k]; return C; };
  const trs = n => {
    if (n.matrix) return n.matrix;
    const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0, 2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
  };
  const walk = (ni, P) => {
    const n = json.nodes[ni], Mx = mul(P, trs(n));
    if (n.mesh != null) for (const pr of json.meshes[n.mesh].primitives) {
      if (pr.mode != null && pr.mode !== 4) continue;
      const pos = acc(pr.attributes.POSITION), idx = pr.indices != null ? acc(pr.indices) : null, cnt = idx ? idx.length : pos.length / 3;
      for (let i = 0; i < cnt; i++) {
        const j = idx ? idx[i] : i, x = pos[j * 3], y = pos[j * 3 + 1], z = pos[j * 3 + 2];
        out.push(Mx[0] * x + Mx[4] * y + Mx[8] * z + Mx[12], Mx[1] * x + Mx[5] * y + Mx[9] * z + Mx[13], Mx[2] * x + Mx[6] * y + Mx[10] * z + Mx[14]);
      }
    }
    for (const c of n.children || []) walk(c, Mx);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], sc = json.scenes ? json.scenes[json.scene || 0] : { nodes: json.nodes.map((_, i) => i) };
  for (const ni of sc.nodes) walk(ni, I);
  return new Float32Array(out);
}
function parseGLB(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('glb のファイルではありません');
  let o = 12, json = null; const bins = [];
  while (o < buf.byteLength) {
    const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, o + 8, len)));
    else if (type === 0x004e4942) bins.push(new Uint8Array(buf, o + 8, len));
    o += 8 + len;
  }
  return parseGLTF(json, bins);
}
function parseGLTFText(text) {
  const json = JSON.parse(text);
  const bins = (json.buffers || []).map(b => {
    if (!b.uri || !b.uri.startsWith('data:')) throw new Error('.gltf の中にデータがありません（別の .bin ファイル）。.glb で書き出してください');
    const bin = atob(b.uri.split(',')[1]), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a;
  });
  return parseGLTF(json, bins);
}

// ---------- 向き・単位・床をそろえる ----------
function extents(t) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) { const v = t[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  return { lo, hi, d: hi.map((v, k) => v - lo[k]) };
}
function guessScan(t, ext) {          // 単位と上の向きの見当（家は 1〜30m くらい、部屋は横のほうが高さより広い、という前提）
  const e = extents(t), big = Math.max(...e.d);
  const unit = big > 3000 ? 0.001 : big > 60 ? 0.01 : 1;
  const up = ext === 'glb' || ext === 'gltf' ? 'y' : e.d[1] <= e.d[2] ? 'y' : 'z';   // glTF は Y が上と決まっている
  return { up, unit };
}
// m・上が y の座標に（z が上のときは x, z, −y）
function normTri() {
  const t = SCAN.raw, u = SCAN.unit, out = new Float32Array(t.length);
  for (let i = 0; i < t.length; i += 3) {
    if (SCAN.up === 'z') { out[i] = t[i] * u; out[i + 1] = t[i + 2] * u; out[i + 2] = -t[i + 1] * u; }
    else { out[i] = t[i] * u; out[i + 1] = t[i + 1] * u; out[i + 2] = t[i + 2] * u; }
  }
  return out;
}
function floorOf(t) {                 // 床の高さ: 上を向いた面のうち、低いほうで広いもの（なければ低い所の 2%）
  const hs = [];
  for (let i = 0; i < t.length; i += 9) {
    const ax = t[i + 3] - t[i], ay = t[i + 4] - t[i + 1], az = t[i + 5] - t[i + 2], bx = t[i + 6] - t[i], by = t[i + 7] - t[i + 1], bz = t[i + 8] - t[i + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, l = Math.hypot(nx, ny, nz);
    if (l > 0 && Math.abs(ny) / l > 0.95) hs.push((t[i + 1] + t[i + 4] + t[i + 7]) / 3);
  }
  if (hs.length < 10) { const ys = []; for (let i = 1; i < t.length; i += 30) ys.push(t[i]); ys.sort((a, b) => a - b); return ys[Math.floor(ys.length * 0.02)] || 0; }
  hs.sort((a, b) => a - b);
  return hs[Math.floor(hs.length * 0.1)];
}

// ---------- 断面の図を作って下じきに ----------
function scanImage() {
  const t = SCAN.tri, e = extents(t), pad = 0.3, F = SCAN.floor, h = F + SCAN.slice;
  const W = e.d[0] + pad * 2, D = e.d[2] + pad * 2, ppm = Math.max(20, Math.min(100, 2000 / Math.max(W, D)));
  const X0 = e.lo[0] - pad, Z0 = e.lo[2] - pad, cw = Math.ceil(W * ppm), ch = Math.ceil(D * ppm);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch);
  const X = x => (x - X0) * ppm, Z = z => (z - Z0) * ppm, n = t.length / 9;
  if (n <= 400000) {                  // 切る高さより下にあるもの（家具など）をうすく
    g.fillStyle = 'rgba(0,0,0,0.06)'; g.beginPath();
    for (let i = 0; i < t.length; i += 9) {
      if (t[i + 1] > h || t[i + 4] > h || t[i + 7] > h) continue;
      if (t[i + 1] < F + 0.05 && t[i + 4] < F + 0.05 && t[i + 7] < F + 0.05) continue;   // 床そのものはぬらない
      g.moveTo(X(t[i]), Z(t[i + 2])); g.lineTo(X(t[i + 3]), Z(t[i + 5])); g.lineTo(X(t[i + 6]), Z(t[i + 8])); g.closePath();
    }
    g.fill();
  }
  g.strokeStyle = '#111'; g.lineWidth = Math.max(2, ppm * 0.03); g.lineCap = 'round'; g.beginPath();   // 断面（壁など）
  for (let i = 0; i < t.length; i += 9) {
    const P = [];
    for (const [a, b] of [[0, 3], [3, 6], [6, 0]]) {
      const ya = t[i + a + 1] - h, yb = t[i + b + 1] - h;
      if ((ya < 0) !== (yb < 0)) { const k = ya / (ya - yb); P.push([t[i + a] + (t[i + b] - t[i + a]) * k, t[i + a + 2] + (t[i + b + 2] - t[i + a + 2]) * k]); }
    }
    if (P.length === 2) { g.moveTo(X(P[0][0]), Z(P[0][1])); g.lineTo(X(P[1][0]), Z(P[1][1])); }
  }
  g.stroke();
  return { url: c.toDataURL('image/png'), w: cw, h: ch, ppm, X0, Z0 };
}
async function scanApply(first) {
  const im = scanImage();
  const el = await new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = im.url; });
  if (first && M.rooms.length && !confirm('いまの模型を消して、このスキャンで最初から始めますか？\n（キャンセルすると、模型はそのままで下じきだけ入れかえます）')) commit();
  else if (first) { commit(); M = newModel(); P.sel = null; P.trace = []; }
  else commit();
  IMG = { el, url: im.url };
  M.img = { w: im.w, h: im.h }; M.imgRot = first ? 0 : M.imgRot || 0;
  M.scan = { ppm: im.ppm, X0: im.X0, Z0: im.Z0, floor: SCAN.floor, slice: SCAN.slice, name: SCAN.name };
  SCAN.ver++;
  planFit(); changed({ refit: true });
  if (first) { if (U.guideOn) gotoStep(1); toast('スキャンの断面を下じきにしました（外には送っていません）'); }
}
async function scanLoad(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  try {
    if (ext === 'usdz' || ext === 'usd' || ext === 'usda' || ext === 'usdc') throw new Error('USDZ はまだ読めません。スキャンのアプリで OBJ・glTF（.glb）・PLY として書き出してください');
    let raw;
    if (ext === 'obj') raw = parseOBJ(await file.text());
    else if (ext === 'ply') raw = parsePLY(await file.arrayBuffer());
    else if (ext === 'glb') raw = parseGLB(await file.arrayBuffer());
    else if (ext === 'gltf') raw = parseGLTFText(await file.text());
    else throw new Error('読めるのは OBJ・glTF（.glb）・PLY です');
    if (raw.length < 9) throw new Error('面（三角形）が見つかりませんでした');
    const gs = guessScan(raw, ext);
    Object.assign(SCAN, { raw, name: file.name, up: gs.up, unit: gs.unit, slice: 1.0, auto: gs });
    scanPrep();
    await scanApply(true);
  } catch (e) { toast(String(e.message || e)); }
}
function scanPrep() { SCAN.tri = normTri(); SCAN.floor = floorOf(SCAN.tri); SCAN.obj = null; }

// ---------- 3D に重ねる ----------
function scanObject() {
  if (!SCAN.tri || !M.scan || !window.THREE) return null;
  if (!SCAN.obj || SCAN.obj.userData.ver !== SCAN.ver) {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(SCAN.tri, 3)); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8fb3d9, roughness: 0.9, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
    const outer = new THREE.Group(); outer.add(mesh); outer.userData.ver = SCAN.ver; outer.userData.mesh = mesh;
    if (SCAN.obj && SCAN.obj.parent) SCAN.obj.parent.remove(SCAN.obj);
    SCAN.obj = outer;
  }
  // 図の上の m ＝ (x − X0, z − Z0)。下じきを回したぶん（画像のまん中を軸に）も回す
  const s = M.scan, cx = M.img.w / 2 / s.ppm, cz = M.img.h / 2 / s.ppm;
  SCAN.obj.position.set(cx, 0, cz); SCAN.obj.rotation.y = -(M.imgRot || 0) * Math.PI / 180;
  SCAN.obj.userData.mesh.position.set(-s.X0 - cx, -s.floor, -s.Z0 - cz);
  const k = scaleInfo().s * s.ppm; SCAN.obj.scale.set(k, 1, k);   // 縮尺がスキャンのままなら 1
  return SCAN.obj;
}

function scanRender() {
  const row = $('scanRow'); if (!row) return;
  row.hidden = !SCAN.tri || !M.scan;
  $('scan3d').parentElement.hidden = !SCAN.tri || !M.scan;
  if (row.hidden) return;
  $('scanUp').value = SCAN.up; $('scanUnit').value = String(SCAN.unit);
  const sl = $('scanSlice'); if (document.activeElement !== sl) sl.value = Math.round(SCAN.slice * 100);
  $('scanSliceOut').textContent = Math.round(SCAN.slice * 100) + ' cm';
  const e = extents(SCAN.tri);
  $('scanInfo').textContent = `${SCAN.name}・三角形 ${(SCAN.tri.length / 9).toLocaleString()}・大きさ ${e.d[0].toFixed(1)}×${e.d[2].toFixed(1)}m・高さ ${e.d[1].toFixed(1)}m`;
}
function scanInit() {
  $('scanFile').onchange = e => { const f = e.target.files[0]; if (f) scanLoad(f); e.target.value = ''; };
  $('scanUp').onchange = e => { SCAN.up = e.target.value; scanPrep(); scanApply(false); };
  $('scanUnit').onchange = e => { SCAN.unit = +e.target.value; scanPrep(); scanApply(false); };
  $('scanSlice').oninput = e => { $('scanSliceOut').textContent = e.target.value + ' cm'; };
  $('scanSlice').onchange = e => { SCAN.slice = +e.target.value / 100; scanApply(false); };
  $('scan3d').onchange = e => { SCAN.show = e.target.checked; viewBuild(); };
}
