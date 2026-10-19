// わが家の模型 — 画面のつなぎ（タブ・道具・案内・えらんだものの編集・右の欄・保存）。ほかの js のあと、main.js の前に読む。
//
// 区割り（UX-REVIEW.md）: 上の帯＝タブと元に戻す／まん中＝図・3D／図のすぐ下＝そのタブの道具→えらんだもの→一言／右の欄（スマホは下）＝そのタブの結果と設定。

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const U = { tab: '2d', step: 0, guideOn: true, stale3d: true, gridMode: false, prefs: { autosave: true, saveImg: true, invX: false, invY: false } };
const PREF_KEY = 'kurashi.my-room.prefs';
const touchy = matchMedia('(pointer: coarse)').matches;
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(U.prefs)); } catch (e) {} };

// 知らせ（下に出てすぐ消える）。消した・置きかえたときは「元に戻す」をつける（まちがえてもすぐ戻せるように）
function toast(t, withUndo) {
  const el = $('toast'), ub = $('toastUndo');
  $('toastText').textContent = t; ub.hidden = !withUndo; el.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('show'), withUndo ? 5000 : 2200);
}
const cmIn = v => { const x = parseFloat(v); return isFinite(x) && x > 0 ? x / 100 : null; };   // 入力（cm）→ m。空は null（推定）
const cmOut = m => m == null ? '' : String(Math.round(m * 1000) / 10);
const badge = meas => meas ? '<span class="b b-meas">測った値</span>' : '<span class="b b-est">推定</span>';
function edit(fn, msg) { commit(); fn(); changed(); if (msg) toast(msg, true); }   // msg があれば「元に戻す」つきの知らせ
function doUndo() { if (undo()) { P.sel = null; changed({ refit: true }); toast('元に戻しました'); } }

// ---------- 案内（図面の作り方。1段＝やること1つ） ----------
const STEPS = [
  { t: '図のまん中から、始め方をえらんでください。' },
  { t: () => touchy ? '部屋の角を順に押します（指をはなした所に点）。最初の角をもう一度押すと1部屋。'
                    : '部屋の角を順にクリック。最初の角をもう一度押すと1部屋（Shift で斜め）。', tool: 'trace' },
  { t: '縮尺を決めます。部屋を押して「帖」を入れるか、「メジャー」でわかる長さを測ってください。', tool: 'select' },
  { t: 'ドアや窓を置きます。種類をえらんで、壁を押してください。', tool: 'open' },
  { t: '3D で見てみましょう。ドラッグで回せます。', tab: '3d' },
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
  if (U.tab === 'wifi' || U.tab === 'move' || U.tab === 'sun') {   // WiFi・搬入・日差しのタブは道具の一言だけ
    $('gStep').textContent = ''; $('gText').textContent = U.tab === 'wifi' ? wifiHint() : U.tab === 'move' ? moveHint() : sunHint(); $('gBtns').innerHTML = '';
    return;
  }
  if (U.guideOn && M.rooms.length + P.trace.length + (IMG ? 1 : 0) + (U.gridMode ? 1 : 0) > 0) {
    $('gStep').textContent = `${U.step + 1}/${STEPS.length}`;
    text = st.tool && st.tool !== P.tool && U.tab === '2d' ? toolHint() : typeof st.t === 'function' ? st.t() : st.t;   // 自分で道具を変えたら、その道具の説明
    if (U.step > 1) btns.push(['もどる', () => gotoStep(U.step - 1)]);
    if (U.step < STEPS.length - 1) { if (U.step > 0) btns.push(['つぎへ', () => gotoStep(U.step + 1), 'pri']); }
    else btns.push(['閉じる', () => { U.guideOn = false; renderGuide(); }]);
  } else {
    $('gStep').textContent = '';
    text = M.rooms.length || U.tab !== '2d' ? toolHint() : '';
    if (M.rooms.length && U.tab === '2d') btns.push(['案内', () => gotoStep(2)]);
  }
  if (P.tool === 'trace' && P.trace.length && U.tab === '2d') text = `${P.trace.length}点。` + (P.trace.length >= 3 ? '最初の角を押すか「部屋にする」で1部屋になります。' : 'つづけて角を押してください。');
  if ((P.tool === 'tape' || P.tool === 'align') && P.tapeA && U.tab === '2d') text = 'もう1点を押してください。';
  $('gText').textContent = text || '';
  const box = $('gBtns'); box.innerHTML = '';
  for (const [label, fn, cls] of btns) { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; box.appendChild(b); }
}
function toolHint() {
  if (U.tab === '3d') return touchy ? 'ドラッグで回す・2本指で寄る／動かす。' : 'ドラッグで回す・ホイールで寄る・右ドラッグで動かす。';
  return {
    trace: '部屋の角を順に押して、最初の角でとじます。',
    select: '角・ドア・メジャーの端はドラッグで動かせます。部屋を押すとえらべます。辺のまん中の＋で角を足せます。',
    open: `壁を押すと「${OPEN_KINDS[P.openKind]}」を置きます。置いたあとはドラッグで動かせます。`,
    tape: '長さのわかる所（ドアの幅など）を2点で測ります。',
    align: '下じきの壁の線にそって2点を押すと、その線がまっすぐになるように回します。',
  }[P.tool];
}

// ---------- 道具・タブ ----------
function setTool(t) {
  if (t === 'align' && P.tool !== 'align') U.prevTool = P.tool;
  planSetTool(t);
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  $('openKind').hidden = t !== 'open'; $('itemKind').hidden = t !== 'item';
  $('straight').hidden = !['trace', 'select', 'tape'].includes(t);
  $('plan').className = 't-' + t;
  renderTrace(); renderGuide();
}
function renderTrace() { $('traceBtns').hidden = !(P.tool === 'trace' && P.trace.length); $('tClose').disabled = P.trace.length < 3; }
const TAB_IDS = [['tab2d', '2d'], ['tab3d', '3d'], ['tabWifi', 'wifi'], ['tabMove', 'move'], ['tabSun', 'sun']];
function setTab(t) {
  if (t !== '2d' && !M.rooms.length) { toast('先に「図面」で部屋を作ってください（見本で試すこともできます）'); return; }
  const was = U.tab; U.tab = t; document.body.dataset.tab = t;
  for (const [id, k] of TAB_IDS) { $(id).classList.toggle('on', t === k); $(id).setAttribute('aria-selected', t === k); }
  const flat = t !== '3d' && !(t === 'sun' && SN.view === '3d'), own = k => k === 'wifi' || k === 'move' || k === 'sun';
  $('plan').hidden = !flat; $('v3').hidden = flat;
  $('tools').hidden = t !== '2d'; $('wtools').hidden = t !== 'wifi'; $('mtools').hidden = t !== 'move'; $('stools').hidden = t !== 'sun'; $('v3opts').hidden = t !== '3d';
  $('zoom').hidden = !flat;
  if (own(was) && !own(t)) setTool(U.planTool || 'select');
  if (!own(was) && own(t)) U.planTool = P.tool;
  if (t === 'wifi' && was !== 'wifi') setTool(M.wifi.router ? 'spot' : 'router');
  if (t === 'move' && was !== 'move') setTool('target');
  if (t === 'sun' && was !== 'sun') { setTool('sunview'); if (!M.sun.used) { M.sun.used = true; U.stale3d = true; } }
  if (was === 'sun' && t !== 'sun') sunStop();
  if (!flat) { viewResize(); viewBuild(U.stale3d && !V.built || !V.built); U.stale3d = false; viewNow(); }
  else { planResize(); if (!P.userView) planFit(); }   // タブで見せたい範囲がちがうので、合わせなおす
  renderPanel(); renderTabs(); renderEmpty(); renderSel(); renderGuide(); renderChip(); wifiRender(); moveRender(); sunRender(); requestDraw();
  if (t === 'wifi' && wifiStale() && M.wifi.router) wifiSchedule(50);
}
function renderPanel() { document.querySelectorAll('.panel [data-tabs]').forEach(s => { s.hidden = !s.dataset.tabs.split(' ').includes(U.tab); }); }   // 右の欄はそのタブのものだけ
function renderTabs() {   // 部屋がないうちは図面のほかはうすく（押すと理由）
  for (const [id, k] of TAB_IDS) if (k !== '2d') { $(id).classList.toggle('off', !M.rooms.length); $(id).title = M.rooms.length ? '' : '先に図面で部屋を作ります'; }
}
// 図のまん中の「はじめ方」（何もないとき）
function renderEmpty() {
  const blank = U.tab === '2d' && !M.rooms.length && !IMG && !P.trace.length && !U.gridMode;
  $('empty').hidden = !blank;
  document.body.classList.toggle('blank', blank);   // 始めるまでは、道具と右の欄の設定を見せない（えらぶのは始め方だけ）
}
// 図の左上の小さな状態（図面: 縮尺の確かさ。押すと右の欄の縮尺へ）
function renderChip() {
  const c = $('vchip'), si = scaleInfo();
  if (U.tab !== '2d' || !M.rooms.length) { c.hidden = true; return; }
  c.hidden = false;
  const t = { scan: ['縮尺 3D スキャン', 'm'], tape: ['縮尺 メジャー', 'm'], jo: ['縮尺 帖から（推定）', 'e'], grid: ['方眼 1マス＝1m', 'm'], none: ['縮尺 まだ（帖かメジャーで）', 'e'] }[si.src];
  c.textContent = t[0]; c.className = 'vchip ' + (t[1] === 'm' ? 'is-meas' : 'is-est');
}

// ---------- えらんだもの（図のすぐ下の1行） ----------
function renderSel() {
  const bar = $('selbar'), s = P.sel;
  const o = s && (s.type === 'room' || s.type === 'vert' ? byId(M.rooms, s.id) : s.type === 'open' ? byId(M.opens, s.id) : byId(M.tapes, s.id));
  if (U.tab === 'wifi') { bar.hidden = !(s && wifiSel(bar, s)); if (bar.hidden) bar.innerHTML = ''; return; }
  if (U.tab === 'move' || U.tab === '3d') { bar.hidden = true; bar.innerHTML = ''; return; }
  if (U.tab === 'sun') { bar.hidden = !(s && sunSel(bar, s)); if (bar.hidden) bar.innerHTML = ''; return; }
  if (!o) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  if (s.type === 'vert') {
    const p = o.pts[s.i];
    if (!p) { bar.hidden = true; return; }
    bar.innerHTML = `<span class="k">角</span><span class="note">ドラッグで動かせます</span>
      <button id="sDel" class="danger"${o.pts.length <= 3 ? ' disabled title="三角より少なくはできません"' : ''}>この角を消す</button>`;
    $('sDel').onclick = () => edit(() => {
      for (const r of M.rooms) { const i = r.pts.findIndex(q => dist(q, p) < 1e-6); if (i >= 0) deleteVertex(r, i); }
      P.sel = { type: 'room', id: o.id };
    }, '角を消しました');
  } else if (s.type === 'room') {
    bar.innerHTML = `<span class="k">部屋</span>
      <input type="text" id="sName" value="${esc(o.name)}" maxlength="20" aria-label="部屋の名前" list="roomNames">
      <label><input type="number" id="sJo" value="${o.jo || ''}" min="0.5" max="100" step="0.1" inputmode="decimal" placeholder="—"> 帖</label>
      <span class="note">${scaleEst() ? '約' : ''}${roomAreaM2(o).toFixed(1)}㎡</span>
      <button id="sIn">中から見る</button><button id="sDel" class="danger" aria-label="この部屋を消す">消す</button>`;
    $('sName').onchange = e => edit(() => { o.name = e.target.value.trim() || o.name; });
    $('sJo').onchange = e => edit(() => { const v = parseFloat(e.target.value); o.jo = isFinite(v) && v > 0 ? v : null; });
    $('sIn').onclick = () => { setTab('3d'); setMode('inside'); };
    $('sDel').onclick = () => edit(() => { M.rooms = M.rooms.filter(r => r !== o); M.opens = M.opens.filter(p => p.room !== o.id); P.sel = null; }, `「${o.name}」を消しました`);
  } else if (s.type === 'open') {
    const d = DEF.open[o.kind], win = isWindow(o.kind), swing = o.kind === 'door' || o.kind === 'entrance';
    bar.innerHTML = `<select id="sKind" aria-label="種類">${Object.entries(OPEN_KINDS).map(([k, n]) => `<option value="${k}"${k === o.kind ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <label>${win ? '幅' : '通れる幅'} <input type="number" id="sW" value="${cmOut(o.w)}" placeholder="${cmOut(d.w)}" min="10" max="600" inputmode="decimal"></label>
      <label>高さ <input type="number" id="sH" value="${cmOut(o.h)}" placeholder="${cmOut(d.h)}" min="10" max="400" inputmode="decimal"></label>
      ${win ? `<label>床から <input type="number" id="sS" value="${cmOut(o.sill)}" placeholder="${cmOut(d.sill)}" min="0" max="300" inputmode="decimal"></label>` : ''}<span class="note">cm（空らんは推定）</span>
      ${swing ? '<button id="sFlip" title="開く向きを反対に">⇄ 向き</button>' : ''}
      <button id="sDel" class="danger" aria-label="消す">消す</button>`;
    $('sKind').onchange = e => edit(() => { o.kind = e.target.value; });
    $('sW').onchange = e => edit(() => { o.w = cmIn(e.target.value); });
    $('sH').onchange = e => edit(() => { o.h = cmIn(e.target.value); });
    if (win) $('sS').onchange = e => edit(() => { const v = parseFloat(e.target.value); o.sill = isFinite(v) && v >= 0 ? v / 100 : null; });
    if (swing) $('sFlip').onclick = () => edit(() => { o.flip = !o.flip; });
    $('sDel').onclick = () => edit(() => { M.opens = M.opens.filter(p => p !== o); P.sel = null; }, `${OPEN_KINDS[o.kind]}を消しました`);
  } else {
    bar.innerHTML = `<span class="k">メジャー</span>
      <label>測った長さ <input type="number" id="sM" value="${cmOut(o.m)}" min="1" max="10000" inputmode="decimal" placeholder="例 80"> cm</label>
      <span class="note">図の上では ${o.m ? '' : '約'}${(dist(o.a, o.b) * scaleInfo().s * 100).toFixed(0)} cm</span>
      <button id="sDel" class="danger">消す</button>`;
    $('sM').onchange = e => edit(() => { o.m = cmIn(e.target.value); });
    $('sDel').onclick = () => edit(() => { M.tapes = M.tapes.filter(t => t !== o); P.sel = null; }, 'メジャーを消しました');
  }
}

// ---------- 右の欄（図面: 下じき・縮尺・家ぜんたい・寸法の表） ----------
function renderImg() {
  const sc = M.scan && SCAN.tri;
  $('imgState').textContent = IMG ? (M.scan ? `3D スキャンの断面（${M.scan.name || ''}）` : '間取りの画像') : M.rooms.length ? 'なし（方眼の上に描いています）' : 'まだありません';
  $('imgDel').hidden = !IMG; $('imgRow').hidden = $('rotRow').hidden = !IMG;
  void sc;
}
function renderScale() {
  const si = scaleInfo(), el = $('scaleState');
  el.innerHTML = {
    scan: `3D スキャンから ${badge(true)}`,
    tape: `メジャーから ${badge(true)}（${si.n}か所の平均）`,
    jo: `帖から ${badge(false)}`,
    grid: '方眼（1マス＝1m）',
    none: `まだ決まっていません ${badge(false)}`,
  }[si.src];
}
function renderHouse() {
  const set = (id, v, ph) => { const el = $(id); if (document.activeElement !== el) el.value = v; if (ph != null) el.placeholder = ph; };
  set('ceil', cmOut(M.ceil), cmOut(DEF.ceil)); set('wallT', cmOut(M.wallT), cmOut(DEF.wallT)); set('floor', M.floor || 1);
  set('north', M.north || 0); $('northOut').textContent = Math.round(M.north || 0) + '°';
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
  if (!M.rooms.length && U.tab !== '2d') setTab('2d');
  renderImg(); renderSel(); renderScale(); renderHouse(); renderTable(); renderHist(); renderTrace(); renderGuide();
  renderPanel(); renderTabs(); renderEmpty(); renderChip(); wifiRender(); moveRender(); sunRender(); scanRender();
  if (opts.refit) planFit();
  requestDraw();
  if (U.tab === 'wifi' && wifiStale() && M.wifi.router) wifiSchedule();
  if (U.tab === '3d' || (U.tab === 'sun' && SN.view === '3d')) viewBuild(opts.refit); else U.stale3d = true;
}

// ---------- 下じき・見本 ----------
function pickImage() { $('imgFile').click(); }
async function useImage(src) {
  let im;
  try { im = await prepImage(src); } catch (e) { toast('画像を読みこめませんでした'); return; }
  const keep = M.rooms.length && !confirm('いまの模型を消して、この画像で最初から始めますか？\n（キャンセルすると、模型はそのままで下じきだけ入れかえます）');
  commit();
  if (!keep) { M = newModel(); P.sel = null; P.trace = []; }
  IMG = { el: im.el, url: im.url }; M.img = { w: im.w, h: im.h }; M.scan = null;
  changed({ refit: true });
  setTab('2d'); if (!M.rooms.length) gotoStep(1);
  toast('下じきにしました（外には送っていません）');
}
function loadSample() {
  const had = M.rooms.length || IMG;
  commit(); M = sampleModel(); IMG = null; P.sel = null; P.trace = [];
  U.guideOn = false;   // 見本はもうできあがっているので、作り方の案内は閉じる
  changed({ refit: true }); setTab('2d'); setTool('select');
  toast('見本の間取りを開きました。上のタブで 3D・WiFi・搬入・日差しを見られます', !!had);
}
function startGrid() { U.gridMode = true; setTool('trace'); gotoStep(1); renderEmpty(); toast('方眼の上で、部屋の角を順に押してください'); }

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
  changed({ refit: true });
  toast('読みこみました', true);
}

// ---------- つなぐ ----------
function setMode(m) {
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  viewSetMode(m);
}
function uiInit() {
  try { Object.assign(U.prefs, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch (e) {}
  $('autosave').checked = U.prefs.autosave; $('saveImg').checked = U.prefs.saveImg;
  $('invX').value = U.prefs.invX ? '1' : '0'; $('invY').value = U.prefs.invY ? '1' : '0';
  $('invX').onchange = e => { U.prefs.invX = e.target.value === '1'; savePrefs(); };
  $('invY').onchange = e => { U.prefs.invY = e.target.value === '1'; savePrefs(); };

  $('openKind').innerHTML = Object.entries(OPEN_KINDS).map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
  $('openKind').onchange = e => { P.openKind = e.target.value; renderGuide(); };
  document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  $('straight').onclick = () => { P.straight = !P.straight; $('straight').classList.toggle('on', P.straight); toast(P.straight ? '線を水平・垂直にそろえます' : '線を自由な向きに引けます'); };
  $('cut').onchange = e => { V.cut = e.target.checked; viewBuild(); };
  for (const [id, k] of TAB_IDS) $(id).onclick = () => setTab(k);
  wifiInit(); moveInit(); sunInit(); scanInit();
  $('zIn').onclick = () => planZoom(1.3); $('zOut').onclick = () => planZoom(1 / 1.3); $('zFit').onclick = planFit;
  $('tBack').onclick = planUndoPoint; $('tClose').onclick = planCloseTrace;
  $('undo').onclick = doUndo;
  $('redo').onclick = () => { if (redo()) { P.sel = null; changed({ refit: true }); } };
  $('toastUndo').onclick = () => { $('toast').classList.remove('show'); doUndo(); };

  P.onChange = () => changed();
  P.onSelect = () => renderSel();
  P.onTraceChange = () => { renderTrace(); renderGuide(); renderEmpty(); };
  P.onRoomClosed = r => {
    toast(`「${r.name}」ができました。下で名前と帖を入れられます。つづけて次の部屋もなぞれます`);
    if (U.guideOn && U.step === 1 && M.rooms.length === 1) renderGuide();
  };
  P.onAlign = (a, b) => {
    const d = alignDelta(a, b);
    if (Math.abs(d) < 0.05) toast('もうまっすぐです');
    else edit(() => rotatePlan(d), `${d > 0 ? '右' : '左'}に ${Math.abs(d).toFixed(1)}° 回しました`);
    setTool(U.prevTool || 'trace');
  };
  P.onTapeDone = () => setTimeout(() => { const el = $('sM'); if (el) el.focus(); }, 0);
  P.onNorth = () => { renderHouse(); };

  const onImg = e => { const f = e.target.files[0]; if (f) useImage(URL.createObjectURL(f)); e.target.value = ''; };
  $('imgFile').onchange = onImg; $('imgFile2').onchange = onImg;
  $('sample').onclick = loadSample;
  $('gridStart').onclick = startGrid;
  $('imgAlpha').oninput = e => { P.imgAlpha = +e.target.value; requestDraw(); };
  $('imgDel').onclick = () => { commit(); IMG = null; M.scan = null; changed(); toast('下じきを外しました', true); };
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
  $('reset').onclick = () => {   // たしかめのダイアログは出さず、知らせの「元に戻す」で戻せるように
    commit(); M = newModel(); IMG = null; P.sel = null; P.trace = []; U.gridMode = false;
    changed({ refit: true }); setTab('2d'); gotoStep(0);
    toast('最初からにしました', true);
  };

  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName);
    if (e.key === 'Shift') P.shift = true;
    if (typing) return;
    if (e.key === ' ' && U.tab !== 'sun') { P.space = true; e.preventDefault(); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); $(e.shiftKey ? 'redo' : 'undo').click(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); $('redo').click(); return; }
    if (e.key === 'Escape') { planCancel(); P.sel = null; renderSel(); requestDraw(); return; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && U.tab === '2d' && P.tool === 'trace' && P.trace.length) { e.preventDefault(); planUndoPoint(); return; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && P.sel && $('sDel') && !$('selbar').hidden) { e.preventDefault(); $('sDel').click(); return; }
    if (U.tab === '2d' && e.key === 'Enter' && P.tool === 'trace') planCloseTrace();
    if (U.tab === 'sun' && e.key === ' ') { e.preventDefault(); $('sPlay').click(); }
  });
  document.addEventListener('keyup', e => { if (e.key === 'Shift') P.shift = false; if (e.key === ' ') P.space = false; });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { requestDraw(); viewTheme(); });
}
