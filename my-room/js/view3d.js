// わが家の模型 — 3D の模型（Three.js r128）。model.js・plan.js のあとに読む。
//
// m の座標で x＝図の右、z＝図の下、y＝上。カメラは自前の回し方（ドラッグで回す・ホイールと2本指で寄る・右ドラッグで動かす）。

const V = {
  ok: false, el: null, R: null, scene: null, cam: null, group: null, sun: null, ground: null,
  mode: 'tilt', yaw: -0.35, pitch: 0.9, dist: 12, target: null, cut: true,
  pointers: new Map(), drag: null, pinch: null, dirty: false, built: false,
};

function viewInit(el) {
  V.el = el;
  if (!window.THREE) { el.innerHTML = '<p class="v3-msg">3D の部品を読みこめませんでした。</p>'; return; }
  try {
    V.R = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  } catch (e) { el.innerHTML = '<p class="v3-msg">この端末では 3D を表示できません（WebGL が使えません）。上から見た図は使えます。</p>'; return; }
  V.R.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  V.R.outputEncoding = THREE.sRGBEncoding;
  V.R.shadowMap.enabled = true; V.R.shadowMap.type = THREE.PCFSoftShadowMap;
  el.appendChild(V.R.domElement);
  V.scene = new THREE.Scene();
  V.cam = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
  V.target = new THREE.Vector3();
  V.scene.add(new THREE.HemisphereLight(0xffffff, lin(0xb9a88f), 0.62));
  V.sun = new THREE.DirectionalLight(0xffffff, 0.75);    // ※ 見やすさのための光（本物の太陽の向きではない）
  V.sun.castShadow = true; V.sun.shadow.mapSize.set(2048, 2048); V.sun.shadow.bias = -0.0004; V.sun.shadow.radius = 3;
  V.scene.add(V.sun, V.sun.target);
  V.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: lin(0xffffff), roughness: 1 }));
  V.ground.rotation.x = -Math.PI / 2; V.ground.position.y = -0.005; V.ground.receiveShadow = true;
  V.scene.add(V.ground);
  V.group = new THREE.Group(); V.scene.add(V.group);
  const c = V.R.domElement;
  c.addEventListener('pointerdown', vDown); c.addEventListener('pointermove', vMove);
  c.addEventListener('pointerup', vUp); c.addEventListener('pointercancel', vUp);
  c.addEventListener('wheel', vWheel, { passive: false });
  c.addEventListener('contextmenu', e => e.preventDefault());
  new ResizeObserver(viewResize).observe(el);
  V.ok = true;
  viewTheme();
}
function viewTheme() {
  if (!V.ok) return;
  const bg = lin(css('--v3-bg')), gr = lin(css('--v3-ground'));
  V.scene.background = bg; V.ground.material.color = gr;
  viewRender();
}
function viewResize() {
  if (!V.ok) return;
  const r = V.el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  V.R.setSize(r.width, r.height, false);
  V.R.domElement.style.width = r.width + 'px'; V.R.domElement.style.height = r.height + 'px';
  V.cam.aspect = r.width / r.height; V.cam.updateProjectionMatrix();
  viewRender();
}
function viewRender() {
  if (!V.ok || V.dirty) return;
  V.dirty = true;
  requestAnimationFrame(() => { V.dirty = false; placeCam(); V.R.render(V.scene, V.cam); });
}

const MAT = {};
const lin = c => new THREE.Color(c).convertSRGBToLinear();   // 色は sRGB で書き、計算用に直す
function mats() {
  if (MAT.wall) return MAT;
  MAT.wall = new THREE.MeshStandardMaterial({ color: lin(0xf4f1eb), roughness: 0.92 });
  MAT.cap = new THREE.MeshStandardMaterial({ color: lin(0x5b5f5c), roughness: 0.8 });
  MAT.floor = new THREE.MeshStandardMaterial({ color: lin(0xcfae84), roughness: 0.75, side: THREE.DoubleSide });
  MAT.floorSel = new THREE.MeshStandardMaterial({ color: lin(0xe2c497), roughness: 0.75, side: THREE.DoubleSide });
  MAT.glass = new THREE.MeshStandardMaterial({ color: lin(0x9fd0ee), roughness: 0.1, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false });
  MAT.ceil = new THREE.MeshStandardMaterial({ color: lin(0xfafaf7), emissive: lin(0x9a9893), roughness: 0.95, side: THREE.DoubleSide });   // 下からの光が弱いので少し明るく
  return MAT;
}
function clearGroup() {
  while (V.group.children.length) {
    const o = V.group.children.pop();
    o.geometry && o.geometry.dispose();
  }
}

// 模型を作りなおす（図を変えるたびに呼ぶ）
function viewBuild(refit) {
  if (!V.ok) return;
  clearGroup(); mats();
  const s = scaleInfo().s, H = ceilH(), T = wallT(), inside = V.mode === 'inside';
  const cutH = V.cut && !inside ? Math.min(H, 1.1) : H;
  const selRoom = P.sel && P.sel.type === 'room' ? P.sel.id : null;
  for (const r of M.rooms) {
    const sh = new THREE.Shape(r.pts.map(p => new THREE.Vector2(p[0] * s, p[1] * s)));
    const geo = new THREE.ShapeGeometry(sh); geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, r.id === selRoom ? MAT.floorSel : MAT.floor);
    m.receiveShadow = true; V.group.add(m);
    if (inside) {                            // 部屋の中から見るときだけ天井
      const cg = new THREE.ShapeGeometry(sh); cg.rotateX(Math.PI / 2);
      const ce = new THREE.Mesh(cg, MAT.ceil); ce.position.y = H; ce.castShadow = true; V.group.add(ce);   // 天井も影を作る（窓からだけ日が入るように）
    }
  }
  const W = buildWalls();
  for (const pc of W.pieces) {
    let z0 = pc.z0, z1 = Math.min(pc.z1, cutH);
    if (z1 - z0 < 0.005) continue;
    const dx = pc.b[0] - pc.a[0], dz = pc.b[1] - pc.a[1], L = Math.hypot(dx, dz);
    if (L < 0.005) continue;
    const ext = pc.z0 === 0 && pc.z1 >= H && !pc.lintel ? T / 2 : 0;   // 角がすき間にならないよう、全高の壁は厚みの半分のばす
    const box = new THREE.Mesh(new THREE.BoxGeometry(L + ext * 2, z1 - z0, T), MAT.wall);
    box.position.set((pc.a[0] + pc.b[0]) / 2, (z0 + z1) / 2, (pc.a[1] + pc.b[1]) / 2);
    box.rotation.y = -Math.atan2(dz, dx);
    box.castShadow = box.receiveShadow = true;
    V.group.add(box);
    if (z1 < H - 1e-3 || V.cut) {        // 切り口（上から見て壁の線がわかるように濃い色）
      const cap = new THREE.Mesh(new THREE.PlaneGeometry(L + ext * 2, T), MAT.cap);
      cap.rotation.order = 'YXZ'; cap.rotation.y = -Math.atan2(dz, dx); cap.rotation.x = -Math.PI / 2;
      cap.position.set(box.position.x, z1 + 0.002, box.position.z);
      V.group.add(cap);
    }
  }
  for (const ln of W.lines) for (const op of ln.opens) {   // 窓ガラス
    if (!isWindow(op.kind)) continue;
    const a = W.at(ln, op.a), b = W.at(ln, op.b), L = op.b - op.a, top = Math.min(op.head, cutH);
    if (top - op.sill < 0.01) continue;
    const gl = new THREE.Mesh(new THREE.BoxGeometry(L, top - op.sill, 0.02), MAT.glass);
    gl.position.set((a[0] + b[0]) / 2, (op.sill + top) / 2, (a[1] + b[1]) / 2);
    gl.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    V.group.add(gl);
  }
  if (refit || !V.built) viewFit(); else placeSun();
  V.built = true;
  viewRender();
}
function bbox() {
  const s = scaleInfo().s; let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  M.rooms.forEach(r => r.pts.forEach(p => { x0 = Math.min(x0, p[0] * s); x1 = Math.max(x1, p[0] * s); z0 = Math.min(z0, p[1] * s); z1 = Math.max(z1, p[1] * s); }));
  if (!isFinite(x0)) return { x0: 0, z0: 0, x1: 6, z1: 4 };
  return { x0, z0, x1, z1 };
}
function viewFit() {
  const b = bbox(), w = b.x1 - b.x0, d = b.z1 - b.z0, R = Math.max(w, d, 2);
  V.target.set((b.x0 + b.x1) / 2, V.mode === 'inside' ? 1.4 : 0, (b.z0 + b.z1) / 2);
  if (V.mode === 'top') { V.yaw = 0; V.pitch = Math.PI / 2 - 1e-3; V.dist = R * 1.9; V.cam.fov = 40; }
  else if (V.mode === 'tilt') { V.yaw = -0.35; V.pitch = 0.85; V.dist = R * 1.75; V.cam.fov = 40; }
  else {                                     // 部屋の中から: えらんだ部屋（なければいちばん広い部屋）の真ん中、目の高さ
    const sel = P.sel && P.sel.type === 'room' && byId(M.rooms, P.sel.id);
    const r = sel || M.rooms.slice().sort((p, q) => Math.abs(polyArea(q.pts)) - Math.abs(polyArea(p.pts)))[0];
    const s = scaleInfo().s;
    V.yaw = Math.PI / 2;
    if (r) {                                  // 部屋の長い向きを見わたせるよう、真ん中から少し下がって立つ
      const c = centroid(r.pts), xs = r.pts.map(p => p[0] * s), zs = r.pts.map(p => p[1] * s);
      const w = Math.max(...xs) - Math.min(...xs), d = Math.max(...zs) - Math.min(...zs);
      V.yaw = w >= d ? -Math.PI / 2 : 0;      // 見る向きは -dir（x の正の向き か z の負の向き）
      const back = (w >= d ? w : d) * 0.3;
      V.target.set(c[0] * s - (w >= d ? back : 0), 1.45, c[1] * s + (w >= d ? 0 : back));
    }
    V.dist = 0.02; V.pitch = 0.18; V.cam.fov = 70;
  }
  V.cam.updateProjectionMatrix();
  placeSun();
  viewRender();
}
// 影を作る光。日差しのタブを使ったあとは、その日付・時刻の本物の太陽の向き（sun.js）。それまでは模型の左上の高い所から（目印）
function placeSun() {
  const b = bbox(), R = Math.max(b.x1 - b.x0, b.z1 - b.z0, 2), L = R * 1.2, c = [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2];
  const sv = typeof sun3dDir === 'function' ? sun3dDir() : null;
  if (sv) { V.sun.position.set(c[0] + sv[0] * L * 2, sv[1] * L * 2, c[1] + sv[2] * L * 2); V.sun.intensity = 1.0; }
  else { V.sun.position.set(c[0] - L * 0.6, L * 1.4, c[1] - L * 0.4); V.sun.intensity = 0.75; }
  V.sun.target.position.set(c[0], 0, c[1]);
  const sc = V.sun.shadow.camera; sc.left = sc.bottom = -R; sc.right = sc.top = R; sc.near = 0.5; sc.far = L * 5; sc.updateProjectionMatrix();
}
function viewSetMode(m) { V.mode = m; viewBuild(true); }
function placeCam() {
  const cp = Math.cos(V.pitch), dir = new THREE.Vector3(cp * Math.sin(V.yaw), Math.sin(V.pitch), cp * Math.cos(V.yaw));
  if (V.mode === 'inside') { V.cam.position.copy(V.target); V.cam.lookAt(V.target.clone().sub(dir)); return; }
  V.cam.position.copy(V.target).addScaledVector(dir, V.dist);
  V.cam.up.set(0, 1, 0);
  if (V.pitch > Math.PI / 2 - 0.01) V.cam.up.set(-Math.sin(V.yaw), 0, -Math.cos(V.yaw));   // 真上から: 図と同じ向き
  V.cam.lookAt(V.target);
}

// ---------- 回す・寄る ----------
function vPos(e) { const r = V.R.domElement.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function vDown(e) {
  try { V.R.domElement.setPointerCapture(e.pointerId); } catch (err) {}
  const p = vPos(e); V.pointers.set(e.pointerId, p);
  if (V.pointers.size === 2) {
    const [a, b] = [...V.pointers.values()];
    V.pinch = { d: dist(a, b), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dist: V.dist, fov: V.cam.fov };
    V.drag = null; return;
  }
  V.drag = { p, pan: e.button === 2 || e.button === 1 || e.shiftKey, yaw: V.yaw, pitch: V.pitch, t: V.target.clone() };
}
function vMove(e) {
  if (!V.pointers.has(e.pointerId)) return;
  const p = vPos(e); V.pointers.set(e.pointerId, p);
  if (V.pinch && V.pointers.size === 2) {
    const [a, b] = [...V.pointers.values()], k = V.pinch.d / Math.max(dist(a, b), 1);
    if (V.mode === 'inside') { V.cam.fov = Math.max(35, Math.min(90, V.pinch.fov * k)); V.cam.updateProjectionMatrix(); }
    else V.dist = Math.max(1, Math.min(200, V.pinch.dist * k));
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];   // 2本指をそろえて動かすと移動
    if (V.mode !== 'inside') panBy(m[0] - V.pinch.m[0], m[1] - V.pinch.m[1]);
    V.pinch.m = m;
    viewRender(); return;
  }
  const d = V.drag; if (!d) return;
  const dx = p[0] - d.p[0], dy = p[1] - d.p[1], h = V.R.domElement.clientHeight || 1;
  if (d.pan && V.mode !== 'inside') { V.target.copy(d.t); panBy(dx, dy); }
  else {
    const k = V.mode === 'inside' ? -1 : 1;
    V.yaw = d.yaw - dx / h * 3 * k;
    V.pitch = Math.max(V.mode === 'inside' ? -1.2 : 0.08, Math.min(V.mode === 'inside' ? 1.2 : Math.PI / 2 - 1e-3, d.pitch + dy / h * 2.5 * k));
  }
  viewRender();
}
function panBy(dx, dy) {
  const h = V.R.domElement.clientHeight || 1, k = 2 * V.dist * Math.tan(V.cam.fov * Math.PI / 360) / h;
  const right = new THREE.Vector3(Math.cos(V.yaw), 0, -Math.sin(V.yaw)), fwd = new THREE.Vector3(-Math.sin(V.yaw), 0, -Math.cos(V.yaw));
  V.target.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k);
}
function vUp(e) { V.pointers.delete(e.pointerId); if (V.pointers.size < 2) V.pinch = null; if (!V.pointers.size) V.drag = null; }
function vWheel(e) {
  e.preventDefault();
  if (V.mode === 'inside') { V.cam.fov = Math.max(35, Math.min(90, V.cam.fov * Math.exp(e.deltaY * 0.001))); V.cam.updateProjectionMatrix(); }
  else V.dist = Math.max(1, Math.min(200, V.dist * Math.exp(e.deltaY * 0.0012)));
  viewRender();
}
