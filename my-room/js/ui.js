// わが家の模型 — 操作パネル・案内・寸法の表・保存の画面。plan.js・view3d.js のあとに読む。

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const U = { tab: '2d', step: 0, guideOn: true, stale3d: true, prefs: { autosave: true, saveImg: true } };
const PREF_KEY = 'kurashi.my-room.prefs';
const touchy = matchMedia('(pointer: coarse)').matches;

function toast(t) {
  const el = $('toast'); el.textContent = t; el.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('show'), 2200);
}
const cmIn = v => { const x = parseFloat(v); return isFinite(x) && x > 0 ? x / 100 : null; };   // 入力（cm）→ m。空は null（推定）
const cmOut = m => m == null ? '' : String(Math.round(m * 1000) / 10);
const badge = meas => meas ? '<span class="b b-meas">測った値</span>' : '<span class="b b-est">推定</span>';

// ---------- 案内（1段＝やること1つ） ----------
const STEPS = [
  { t: '間取りの画像を読みこみます。画像はこの端末の中だけで使い、外へは送りません。',
    btns: () => [['画像をえらぶ', pickImage, 'pri'], ['画像なしで描く', () => gotoStep(1)], ['見本で試す', loadSample]] },
  { t: () => touchy ? '部屋の角を順に押します。指をはなした所に点が置かれ、最初の角をもう一度押すと1部屋できます。'
                    : '部屋の角を順にクリックします。最初の角をもう一度押すと1部屋できます（Shift で斜めの線）。', tool: 'trace' },
  { t: '縮尺を決めます。部屋を押して「帖」を入れるか、「メジャー」でわかる長さを測ってください。', tool: 'select' },
  { t: 'ドアや窓を置きます。種類をえらんで、壁を押してください。', tool: 'open' },
  { t: '3D で見てみましょう。ドラッグで回せます。「部屋の中」で中に立てます。', tab: '3d' },
];
function gotoStep(i) {
  U.step = Math.max(0, Math.min(STEPS.length - 1, i)); U.guideOn = true;
  const st = STEPS[U.step];
  if (st.tool) { setTab('2d'); setTool(st.tool); }
  if (st.tab) setTab(st.tab);
  renderGuide();
}
function renderGuide() {
  const st = STEPS[U.step];
  let text, btns = [];
  if (U.tab === 'wifi' || U.tab === 'move' || U.tab === 'sun') {   // WiFi・搬入・日差しのタブは道具の説明だけ
    $('gStep').textContent = ''; $('gText').textContent = U.tab === 'wifi' ? wifiHint() : U.tab === 'move' ? moveHint() : sunHint(); $('gBtns').innerHTML = '';
    return;
  }
  if (U.guideOn) {
    $('gStep').textContent = `${U.step + 1}/${STEPS.length}`;
    text = st.tool && st.tool !== P.tool && U.tab === '2d' ? toolHint() : typeof st.t === 'function' ? st.t() : st.t;   // 自分で道具を変えたら、その道具の説明
    if (st.btns) btns = st.btns();
    if (U.step > 0) btns.push(['もどる', () => gotoStep(U.step - 1)]);
    if (U.step < STEPS.length - 1) { if (U.step > 0) btns.push(['つぎへ', () => gotoStep(U.step + 1), 'pri']); }
    else btns.push(['案内を閉じる', () => { U.guideOn = false; renderGuide(); }, 'pri']);
  } else {
    $('gStep').textContent = '';
    text = toolHint();
    btns.push(['案内', () => gotoStep(M.rooms.length ? 2 : 0)]);
  }
  if (P.tool === 'trace' && P.trace.length && U.tab === '2d') text = `${P.trace.length}点。` + (P.trace.length >= 3 ? '最初の角を押すか「部屋にする」で1部屋になります。' : 'つづけて角を押してください。');
  if ((P.tool === 'tape' || P.tool === 'align') && P.tapeA && U.tab === '2d') text = 'もう1点を押してください。';
  $('gText').textContent = text;
  const box = $('gBtns'); box.innerHTML = '';
  for (const [label, fn, cls] of btns) { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; box.appendChild(b); }
}
function toolHint() {
  if (U.tab === '3d') return touchy ? 'ドラッグで回す・2本指で寄る／動かす。' : 'ドラッグで回す・ホイールで寄る・右ドラッグで動かす。';
  return {
    trace: '部屋の角を順に押して、最初の角でとじます。',
    select: '角・ドア・メジャーの端はドラッグで動かせます。部屋を押すとえらべます。',
    open: `壁を押すと「${OPEN_KINDS[P.openKind]}」を置きます。`,
    tape: '長さのわかる所を2点で測ります（ドラッグ、または2回押す）。',
    align: '下じきの壁の線にそって2点を押すと、その線が水平か垂直になるように回します。',
  }[P.tool];
}

// ---------- 道具・タブ ----------
function setTool(t) {
  if (t === 'align' && P.tool !== 'align') U.prevTool = P.tool;
  planSetTool(t);
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  $('openKind').hidden = t !== 'open'; $('itemKind').hidden = t !== 'item';
  $('plan').className = 't-' + t;
  renderTrace(); renderGuide();
}
function renderTrace() { $('traceBtns').hidden = !(P.tool === 'trace' && P.trace.length); $('tClose').disabled = P.trace.length < 3; }
function setTab(t) {
  const was = U.tab; U.tab = t; document.body.dataset.tab = t;
  for (const [id, k] of [['tab2d', '2d'], ['tab3d', '3d'], ['tabWifi', 'wifi'], ['tabMove', 'move'], ['tabSun', 'sun']]) { $(id).classList.toggle('on', t === k); $(id).setAttribute('aria-selected', t === k); }
  const flat = t !== '3d', own = k => k === 'wifi' || k === 'move' || k === 'sun';   // 上から見た図を使うタブ／自分の道具を持つタブ
  $('plan').hidden = !flat; $('v3').hidden = t !== '3d';
  $('tools').hidden = t !== '2d'; $('wtools').hidden = t !== 'wifi'; $('mtools').hidden = t !== 'move'; $('stools').hidden = t !== 'sun'; $('v3opts').hidden = t !== '3d';
  $('zoom').hidden = !flat;
  if (own(was) && !own(t)) setTool(U.planTool || 'select');
  if (!own(was) && own(t)) U.planTool = P.tool;
  if (t === 'wifi' && was !== 'wifi') setTool(M.wifi.router ? 'spot' : 'router');
  if (t === 'move' && was !== 'move') setTool('target');
  if (t === 'sun' && was !== 'sun') { setTool('sunview'); if (!M.sun.used) { M.sun.used = true; U.stale3d = true; } }
  if (t === '3d') { viewResize(); if (U.stale3d || !V.built) { viewBuild(!V.built); U.stale3d = false; } }
  else { planResize(); }
  renderSel(); renderGuide(); wifiRender(); moveRender(); sunRender(); requestDraw();
  if (t === 'wifi' && wifiStale() && M.wifi.router) wifiSchedule(50);
}

// ---------- えらんだもの（図のすぐ下の1行） ----------
function renderSel() {
  const bar = $('selbar'), s = P.sel;
  const o = s && (s.type === 'room' || s.type === 'vert' ? byId(M.rooms, s.id) : s.type === 'open' ? byId(M.opens, s.id) : byId(M.tapes, s.id));
  if (U.tab === 'wifi') { bar.hidden = !(s && wifiSel(bar, s)); if (bar.hidden) bar.innerHTML = ''; return; }
  if (U.tab === 'move') { bar.hidden = true; bar.innerHTML = ''; return; }
  if (U.tab === 'sun') { bar.hidden = !(s && sunSel(bar, s)); if (bar.hidden) bar.innerHTML = ''; return; }
  if (!o || U.tab !== '2d') { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  if (s.type === 'vert') {
    const p = o.pts[s.i];
    if (!p) { bar.hidden = true; return; }
    bar.innerHTML = `<span class="k">角</span><span class="note">${esc(o.name)}の角。ドラッグで動かせます。</span>
      <button id="sDel" class="danger"${o.pts.length <= 3 ? ' disabled' : ''}>この角を消す</button>
      <span class="note">${o.pts.length <= 3 ? '三角より少なくはできません' : '同じ場所の角（となりの部屋）もいっしょに消します'}</span>`;
    $('sDel').onclick = () => edit(() => {
      for (const r of M.rooms) { const i = r.pts.findIndex(q => dist(q, p) < 1e-6); if (i >= 0) deleteVertex(r, i); }
      P.sel = { type: 'room', id: o.id };
    });
  } else if (s.type === 'room') {
    const si = scaleInfo();
    bar.innerHTML = `<span class="k">部屋</span>
      <label>名前 <input type="text" id="sName" value="${esc(o.name)}" maxlength="20"></label>
      <label><input type="number" id="sJo" value="${o.jo || ''}" min="0.5" max="100" step="0.1" inputmode="decimal" placeholder="—"> 帖</label>
      <span class="note">${scaleEst() ? '約' : ''}${roomAreaM2(o).toFixed(1)}㎡</span>
      <button id="sIn">中から見る</button><button id="sDel" class="danger">消す</button>`;
    $('sName').onchange = e => edit(() => { o.name = e.target.value.trim() || o.name; });
    $('sJo').onchange = e => edit(() => { const v = parseFloat(e.target.value); o.jo = isFinite(v) && v > 0 ? v : null; });
    $('sIn').onclick = () => { setTab('3d'); setMode('inside'); };
    $('sDel').onclick = () => edit(() => { M.rooms = M.rooms.filter(r => r !== o); M.opens = M.opens.filter(p => p.room !== o.id); P.sel = null; });
  } else if (s.type === 'open') {
    const d = DEF.open[o.kind], win = isWindow(o.kind), swing = o.kind === 'door' || o.kind === 'entrance';
    bar.innerHTML = `<span class="k">${OPEN_KINDS[o.kind]}</span>
      <select id="sKind" aria-label="種類">${Object.entries(OPEN_KINDS).map(([k, n]) => `<option value="${k}"${k === o.kind ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <label>${win ? '幅' : '通れる幅'} <input type="number" id="sW" value="${cmOut(o.w)}" placeholder="${cmOut(d.w)}" min="10" max="600" inputmode="decimal"> cm</label>
      <label>高さ <input type="number" id="sH" value="${cmOut(o.h)}" placeholder="${cmOut(d.h)}" min="10" max="400" inputmode="decimal"> cm</label>
      ${win ? `<label>床から <input type="number" id="sS" value="${cmOut(o.sill)}" placeholder="${cmOut(d.sill)}" min="0" max="300" inputmode="decimal"> cm</label>` : ''}
      ${swing ? '<button id="sFlip">開く向きを反対に</button>' : ''}
      <button id="sDel" class="danger">消す</button>
      <span class="note">空らんは推定（ふつうの値）。${win ? '幅・高さは内のり' : '幅は枠の内がわ（通れる幅）'}</span>`;
    $('sKind').onchange = e => edit(() => { o.kind = e.target.value; });
    $('sW').onchange = e => edit(() => { o.w = cmIn(e.target.value); });
    $('sH').onchange = e => edit(() => { o.h = cmIn(e.target.value); });
    if (win) $('sS').onchange = e => edit(() => { const v = parseFloat(e.target.value); o.sill = isFinite(v) && v >= 0 ? v / 100 : null; });
    if (swing) $('sFlip').onclick = () => edit(() => { o.flip = !o.flip; });
    $('sDel').onclick = () => edit(() => { M.opens = M.opens.filter(p => p !== o); P.sel = null; });
  } else {
    bar.innerHTML = `<span class="k">メジャー</span>
      <label>測った長さ <input type="number" id="sM" value="${cmOut(o.m)}" min="1" max="10000" inputmode="decimal" placeholder="例 80"> cm</label>
      <button id="sDel" class="danger">消す</button>
      <span class="note">図の上の長さ: ${o.m ? '' : '約'}${(dist(o.a, o.b) * scaleInfo().s).toFixed(2)} m</span>`;
    $('sM').onchange = e => edit(() => { o.m = cmIn(e.target.value); });
    $('sDel').onclick = () => edit(() => { M.tapes = M.tapes.filter(t => t !== o); P.sel = null; });
  }
}
function edit(fn) { commit(); fn(); changed(); }

// ---------- 縮尺・家ぜんたい・寸法の表 ----------
function renderScale() {
  const si = scaleInfo(), el = $('scaleState');
  el.innerHTML = {
    scan: `3D スキャンから決めています ${badge(true)}（スキャンは m で測ってあります）`,
    tape: `メジャーの値から決めています ${badge(true)}（${si.n}か所の平均）`,
    jo: `帖から決めています ${badge(false)}`,
    grid: '画像なしの方眼です（1マス＝1m）',
    none: `まだ決まっていません ${badge(false)}（画像の長い辺を 10m と仮に置いています）`,
  }[si.src];
}
function renderHouse() {
  const set = (id, v, ph) => { const el = $(id); if (document.activeElement !== el) el.value = v; if (ph != null) el.placeholder = ph; };
  set('ceil', cmOut(M.ceil), cmOut(DEF.ceil)); set('wallT', cmOut(M.wallT), cmOut(DEF.wallT)); set('floor', M.floor || 1);
  set('north', M.north || 0); $('northOut').textContent = (M.north || 0) + '°';
  set('imgRot', M.imgRot || 0); $('rotOut').textContent = (Math.round((M.imgRot || 0) * 10) / 10) + '°';
}
function renderTable() {
  const si = scaleInfo(), est = scaleEst(), rows = [];
  rows.push(['縮尺', si.src === 'scan' ? '3D スキャンから' : si.src === 'tape' ? 'メジャーから' : si.src === 'jo' ? '帖から' : si.src === 'grid' ? '方眼（1マス＝1m）' : '未設定', !est]);
  rows.push(['天井の高さ', (ceilH() * 100).toFixed(0) + ' cm', !!M.ceil]);
  rows.push(['壁の厚さ', (wallT() * 100).toFixed(0) + ' cm', !!M.wallT]);
  for (const r of M.rooms) rows.push([esc(r.name) + ' の広さ', (est ? '約 ' : '') + roomAreaM2(r).toFixed(1) + ' ㎡' + (r.jo ? `（図面 ${r.jo}帖）` : ''), !est]);
  for (const o of M.opens) {
    const r = byId(M.rooms, o.room), d = openDims(o);
    rows.push([`${OPEN_KINDS[o.kind]}（${esc(r ? r.name : '')}）`, `幅 ${(d.w * 100).toFixed(0)} × 高さ ${(d.h * 100).toFixed(0)} cm` + (isWindow(o.kind) ? `・床から ${(d.sill * 100).toFixed(0)}` : ''), !!o.w && !!o.h]);
  }
  for (const t of M.tapes) rows.push(['メジャー', t.m ? (t.m * 100).toFixed(1) + ' cm' : '（長さを入れてください）', !!t.m]);
  $('dimTable').innerHTML = '<tr><th>もの</th><th>値</th></tr>' + rows.map(([a, b, m]) => `<tr><td>${a}</td><td class="num">${b} ${badge(m)}</td></tr>`).join('');
}
function renderHist() { $('undo').disabled = !HIST.length; $('redo').disabled = !REDO.length; }

// ---------- 変わったとき ----------
function changed(opts = {}) {
  if (U.prefs.autosave) {
    const ok = saveLocal(U.prefs.saveImg);
    $('saveState').textContent = ok ? 'この端末に保存しています。' : '保存できませんでした（容量がいっぱいか、保存できない設定です）。「画像もいっしょに保存する」をはずすと入ることがあります。';
  } else $('saveState').textContent = 'この端末には保存していません。閉じると消えます。';
  $('imgRow').hidden = $('rotRow').hidden = !IMG;
  renderSel(); renderScale(); renderHouse(); renderTable(); renderHist(); renderTrace(); renderGuide(); wifiRender(); moveRender(); sunRender(); scanRender();
  requestDraw();
  if (U.tab === 'wifi' && wifiStale() && M.wifi.router) wifiSchedule();
  if (U.tab === '3d') viewBuild(opts.refit); else U.stale3d = true;
}

// ---------- 画像 ----------
function pickImage() { $('imgFile').click(); }
async function useImage(src) {
  let im;
  try { im = await prepImage(src); } catch (e) { toast('画像を読みこめませんでした'); return; }
  if (M.rooms.length && !confirm('いまの模型を消して、この画像で最初から始めますか？\n（キャンセルすると、模型はそのままで下じきだけ入れかえます）')) {
    commit();
  } else { commit(); M = newModel(); P.sel = null; P.trace = []; }
  IMG = { el: im.el, url: im.url }; M.img = { w: im.w, h: im.h }; M.scan = null;
  planFit(); changed({ refit: true });
  if (U.guideOn && U.step === 0) gotoStep(1);
  toast('下じきにしました（外には送っていません）');
}
function loadSample() {
  commit(); M = sampleModel(); IMG = null; P.sel = null; P.trace = [];
  planFit(); changed({ refit: true });
  if (U.guideOn) gotoStep(4); else toast('見本の間取りを出しました');
}

// ---------- 保存・書き出し ----------
function exportFile() {
  const data = { app: 'kurashi-lab/my-room', v: 1, model: M, img: U.prefs.saveImg && IMG ? IMG.url : null };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a'), d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `わが家の模型-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importText(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { toast('読みこめないファイルです'); return; }
  const m = fixModel(data && data.model ? data.model : data);
  let im = null;
  if (data && typeof data.img === 'string' && data.img.startsWith('data:image/')) {   // 画像はファイルの中のものだけ（外の URL は読まない）
    try { im = await loadImageUrl(data.img); } catch (e) { im = null; }
  }
  commit(); M = m; IMG = im ? { el: im.el, url: im.url } : null;
  if (IMG) M.img = { w: im.w, h: im.h };
  P.sel = null; P.trace = [];
  planFit(); changed({ refit: true });
  toast('読みこみました');
}

// ---------- つなぐ ----------
function setMode(m) {
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  viewSetMode(m);
}
function uiInit() {
  try { Object.assign(U.prefs, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch (e) {}
  const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(U.prefs)); } catch (e) {} };
  $('autosave').checked = U.prefs.autosave; $('saveImg').checked = U.prefs.saveImg;

  $('openKind').innerHTML = Object.entries(OPEN_KINDS).map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
  $('openKind').onchange = e => { P.openKind = e.target.value; renderGuide(); };
  document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  $('cut').onchange = e => { V.cut = e.target.checked; viewBuild(); };
  $('tab2d').onclick = () => setTab('2d'); $('tab3d').onclick = () => setTab('3d'); $('tabWifi').onclick = () => setTab('wifi'); $('tabMove').onclick = () => setTab('move'); $('tabSun').onclick = () => setTab('sun');
  wifiInit(); moveInit(); sunInit(); scanInit();
  $('zIn').onclick = () => planZoom(1.3); $('zOut').onclick = () => planZoom(1 / 1.3); $('zFit').onclick = planFit;
  $('tBack').onclick = planUndoPoint; $('tClose').onclick = planCloseTrace;
  $('undo').onclick = () => { if (undo()) { P.sel = null; changed(); } };
  $('redo').onclick = () => { if (redo()) { P.sel = null; changed(); } };

  P.onChange = () => changed();
  P.onSelect = () => renderSel();
  P.onTraceChange = () => { renderTrace(); renderGuide(); };
  P.onRoomClosed = r => {
    toast(`「${r.name}」ができました`);
    if (U.guideOn && U.step === 1 && M.rooms.length === 1) toast('つづけて部屋をなぞるか、「つぎへ」で縮尺へ');
  };
  P.onAlign = (a, b) => {
    const d = alignDelta(a, b);
    if (Math.abs(d) < 0.05) toast('もうまっすぐです');
    else { edit(() => rotatePlan(d)); toast(`${d > 0 ? '右' : '左'}に ${Math.abs(d).toFixed(1)}° 回しました`); }
    setTool(U.prevTool || 'trace');
  };
  P.onTapeDone = () => setTimeout(() => { const el = $('sM'); if (el) el.focus(); }, 0);

  $('imgFile').onchange = e => { const f = e.target.files[0]; if (f) useImage(URL.createObjectURL(f)); e.target.value = ''; };
  $('sample').onclick = loadSample;
  $('imgAlpha').oninput = e => { P.imgAlpha = +e.target.value; requestDraw(); };
  $('imgDel').onclick = () => { IMG = null; changed(); };
  $('rotL').onclick = () => edit(() => rotatePlan(-90));
  $('rotR').onclick = () => edit(() => rotatePlan(90));
  $('rotAlign').onclick = () => { setTab('2d'); setTool('align'); };
  $('imgRot').onpointerdown = () => commit();
  $('imgRot').oninput = e => { rotatePlan(+e.target.value - (M.imgRot || 0)); $('rotOut').textContent = M.imgRot + '°'; requestDraw(); };
  $('imgRot').onchange = () => changed();
  document.addEventListener('paste', e => {
    const it = [...(e.clipboardData || {}).items || []].find(i => i.type.startsWith('image/'));
    if (it) { e.preventDefault(); useImage(URL.createObjectURL(it.getAsFile())); }
  });
  const view = $('view');
  view.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); $('drop').hidden = false; } });
  view.addEventListener('dragleave', () => { $('drop').hidden = true; });
  view.addEventListener('drop', e => {
    e.preventDefault(); $('drop').hidden = true;
    const f = [...e.dataTransfer.files][0]; if (!f) return;
    if (/\.(obj|glb|gltf|ply|usdz)$/i.test(f.name)) scanLoad(f);
    else if (f.type.startsWith('image/')) useImage(URL.createObjectURL(f));
    else if (/json$/i.test(f.type) || /\.json$/i.test(f.name)) f.text().then(importText);
  });

  const house = (id, fn) => { $(id).onchange = e => edit(() => fn(e.target.value)); };
  house('ceil', v => { M.ceil = cmIn(v); }); house('wallT', v => { M.wallT = cmIn(v); });
  house('floor', v => { const n = parseInt(v, 10); M.floor = n > 0 ? n : 1; });
  $('north').oninput = e => { M.north = +e.target.value; $('northOut').textContent = M.north + '°'; requestDraw(); };
  $('north').onchange = () => { changed(); };
  $('north').onpointerdown = () => commit();

  $('autosave').onchange = e => { U.prefs.autosave = e.target.checked; savePrefs(); if (!U.prefs.autosave) clearLocal(); changed(); };
  $('saveImg').onchange = e => { U.prefs.saveImg = e.target.checked; savePrefs(); changed(); };
  $('export').onclick = exportFile;
  $('importFile').onchange = e => { const f = e.target.files[0]; if (f) f.text().then(importText); e.target.value = ''; };
  $('reset').onclick = () => {
    if (!confirm('模型と下じきを消して、最初から始めますか？（この端末の保存も消えます）')) return;
    commit(); M = newModel(); IMG = null; P.sel = null; P.trace = []; clearLocal();
    planFit(); changed({ refit: true }); gotoStep(0);
  };

  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName);
    if (e.key === 'Shift') P.shift = true;
    if (typing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); $(e.shiftKey ? 'redo' : 'undo').click(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); $('redo').click(); return; }
    if (U.tab === 'move') return;
    if (U.tab === 'sun') { if ((e.key === 'Backspace' || e.key === 'Delete') && P.sel && $('sDel')) { e.preventDefault(); $('sDel').click(); } return; }
    if (U.tab === 'wifi') { if ((e.key === 'Backspace' || e.key === 'Delete') && P.sel && $('sDel')) { e.preventDefault(); $('sDel').click(); } return; }
    if (U.tab !== '2d') return;
    if (e.key === 'Enter' && P.tool === 'trace') { planCloseTrace(); }
    else if (e.key === 'Escape') { planCancel(); P.sel = null; renderSel(); }
    else if (e.key === 'Backspace' || e.key === 'Delete') {
      if (P.tool === 'trace' && P.trace.length) { e.preventDefault(); planUndoPoint(); }
      else if (P.sel) { e.preventDefault(); const b = $('sDel'); if (b) b.click(); }
    }
  });
  document.addEventListener('keyup', e => { if (e.key === 'Shift') P.shift = false; });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { requestDraw(); viewTheme(); });
}
