// わが家の模型 — 起動とデバッグ用の窓口（いちばん最後に読む）

(async function start() {
  uiInit();
  planInit($('plan'));
  viewInit($('v3'));
  const saved = U.prefs.autosave ? loadLocal() : null;
  if (saved) {
    M = fixModel(saved.model);
    if (saved.img && saved.img.startsWith('data:image/')) {
      try { const im = await loadImageUrl(saved.img); IMG = { el: im.el, url: im.url }; M.img = { w: im.w, h: im.h }; } catch (e) { IMG = null; }
    }
  }
  planFit();
  changed({ refit: true });
  if (saved && M.rooms.length) { U.guideOn = false; setTool('select'); renderGuide(); toast('この端末に保存してあった模型を開きました'); }
  else gotoStep(0);
})();

// コンソールから: __room.M（模型）・__room.scale()・__room.walls()・__room.sample()・__room.shot()（3D の画像）
window.__room = {
  get M() { return M; }, P, V, U,
  scale: scaleInfo, walls: buildWalls,
  sample: loadSample,
  draw: () => { planDraw(); if (V.ok) { placeCam(); V.R.render(V.scene, V.cam); } },
  shot: () => V.ok && V.R.domElement.toDataURL('image/png').length,
};
