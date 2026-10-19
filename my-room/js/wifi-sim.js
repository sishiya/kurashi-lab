// わが家の模型 — 電波の計算（WebGL2）。model.js のあとに読む。
//
// まなびラボ「電波の見える部屋」（wifi-wave、同じ作者・MIT）の計算を写したもの。
// 床に垂直な電場 Ez の2次元の波の式 ∂²E/∂t² = (1/με)∇²E − (σ/ε)∂E/∂t を、0.75cm のマス目で解く（FDTD・陽解法）。
// 材料の値は ITU-R P.2040-3。マス目が粗いぶんの補正 eff は wifi-wave で1枚の壁の透過が解析値と合うように決めたもの。
// ちがうところ: 場の大きさを家に合わせて変える／見るのは「強さ」だけ（F×F マスの平均を dBm にして読む）。

const WF = {
  DX: 0.0075, KC: 0.5, C0: 2.998e8, EPS0: 8.854e-12, PTX: 20, BETA: 1 / 256, F: 8, MAX_CELLS: 4.2e6,
  FREQ: { '2.4': { ghz: 2.437, mhz: 2437, name: '2.4GHz' }, '5': { ghz: 5.2, mhz: 5200, name: '5GHz' } },
  gl: null, ok: false, tried: false, err: '', simP: null, redP: null, vao: null, CAL: {}, sim: null, sync: new Float32Array(4),
};
WF.DT = WF.KC * WF.DX / WF.C0;

// 材料（並びはシェーダの id。wifi-wave と同じ）。layers は壁の中心線からの cm
const WMATS = [
  { key: 'air' },
  { key: 'board', name: '石こうボード', note: '12.5mm の板2枚＋空洞', col: '#d9cfae', er: 2.73, c: .0085, d: .9395, layers: [[-5.25, -3.75], [3.75, 5.25]], eff: [[2.729, .03206], [2.729, .0355]] },
  { key: 'wood', name: '木', note: '厚さ3.5cm', col: '#b07a45', er: 1.99, c: .0047, d: 1.0718, layers: [[-1.75, 1.75]], eff: [[1.501, .01223], [1.593, .02441]] },
  { key: 'glass', name: 'ガラス', note: '厚さ1.5cm', col: '#7cc8f0', er: 6.31, c: .0036, d: 1.3394, layers: [[-.75, .75]], eff: [[5.021, .00946], [4.021, .01136]] },
  { key: 'brick', name: 'レンガ', note: '厚さ10cm', col: '#b85540', er: 3.91, c: .0238, d: .16, layers: [[-5, 5]], eff: [[3.42, .02309], [2.462, .01862]] },
  { key: 'conc', name: 'コンクリート', note: '厚さ18cm（中の鉄筋は省略）', col: '#8d929c', er: 5.24, c: .0462, d: .7822, layers: [[-9, 9]], eff: [[4.41, .0782], [4.252, .07784]] },
  { key: 'metal', name: '金属', note: '厚さ2cm（玄関のドアなど）', col: '#c9d3de', pec: true, layers: [[-1, 1]] },
  { key: 'water', name: '水・人の体', col: '#4585ea', water: true },
];
const WMAT = {}; WMATS.forEach((m, i) => { m.id = i; WMAT[m.key] = m; });
const WALL_KEYS = ['board', 'wood', 'glass', 'brick', 'conc', 'metal'];

function wProps(m, f) {
  if (m.water) return { er: 20, sig: f < 3 ? 1.7 : 4.3 };
  return { er: m.er, sig: m.c * Math.pow(f, m.d) };
}
function wSimProps(m, f) { if (m.eff) { const [er, sig] = m.eff[f < 3 ? 0 : 1]; return { er, sig }; } return wProps(m, f); }

// 壁1枚で弱まる量（dB。まっすぐ当たるとき・層ごとに。解析の式）
const cx = (re, im) => ({ re, im });
const cadd = (a, b) => cx(a.re + b.re, a.im + b.im), csub = (a, b) => cx(a.re - b.re, a.im - b.im);
const cmul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cdiv = (a, b) => { const d = b.re * b.re + b.im * b.im; return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); };
const cexp = a => { const e = Math.exp(a.re); return cx(e * Math.cos(a.im), e * Math.sin(a.im)); };
const csqrt = a => { const r = Math.hypot(a.re, a.im); return cx(Math.sqrt((r + a.re) / 2), Math.sign(a.im || 1) * Math.sqrt((r - a.re) / 2)); };
const cabs = a => Math.hypot(a.re, a.im);
function slabDb(m, f) {
  if (m.pec) return Infinity;
  const { er, sig } = wProps(m, f), w = 2 * Math.PI * f * 1e9, k0 = w / WF.C0;
  const n = csqrt(cx(er, -sig / (w * WF.EPS0)));
  const one = cx(1, 0), r = cdiv(csub(one, n), cadd(one, n)), r2 = cmul(r, r);
  let tot = 0;
  for (const [a, b] of m.layers) {
    const d = (b - a) / 100, beta = cmul(cx(k0 * d, 0), n), e1 = cexp(cx(beta.im, -beta.re));
    const t = cdiv(cmul(csub(one, r2), e1), csub(one, cmul(r2, cmul(e1, e1))));
    tot += -20 * Math.log10(cabs(t));
  }
  return tot;
}
const fspl = (dm, key) => 20 * Math.log10(dm) + 20 * Math.log10(WF.FREQ[key].mhz) - 27.55;   // 自由空間の損失（ITU-R P.525）

// ---------- WebGL2 ----------
const VS = `#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`;
// wifi-wave と同じ。外まわり40マスは吸いこむ帯（スポンジ）
const SIM_FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uS; uniform sampler2D uM;
uniform float uK2[8]; uniform float uA[8];
uniform ivec2 uSize; uniform ivec2 uSrc; uniform float uSrcVal; uniform float uBeta;
out vec4 o;
void main(){
  ivec2 p=ivec2(gl_FragCoord.xy); ivec2 mx=uSize-1;
  vec4 c=texelFetch(uS,p,0);
  int id=clamp(int(texelFetch(uM,p,0).r*255.+.5),0,7);
  float k2=uK2[id]; float e=c.b;
  if(k2<0.){ o=vec4(0.,0.,e*(1.-uBeta),0.); return; }
  float u=c.r, up=c.g;
  float l=texelFetch(uS,min(p+ivec2(1,0),mx),0).r+texelFetch(uS,max(p-ivec2(1,0),ivec2(0)),0).r
         +texelFetch(uS,min(p+ivec2(0,1),mx),0).r+texelFetch(uS,max(p-ivec2(0,1),ivec2(0)),0).r-4.*u;
  float d=float(min(min(p.x,mx.x-p.x),min(p.y,mx.y-p.y)));
  float a=uA[id];
  if(d<40.){ float q=(40.-d)/40.; a+=.3*q*q*q; }
  float un=(2.*u-(1.-a)*up+k2*l)/(1.+a);
  if(p==uSrc) un+=uSrcVal;
  e+=uBeta*(un*un-e);
  o=vec4(un,u,e,0.);
}`;
// F×F マスの u² の平均を、波の出どころからの距離で dBm に（wifi-wave の dbmAt と同じ換算）
const RED_FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uS; uniform ivec2 uSize; uniform int uF; uniform vec2 uSrc; uniform float uC; uniform float uFS; uniform float uPTX; uniform float uDX;
out vec4 o;
float lg(float x){ return log(x)*0.4342944819; }
void main(){
  ivec2 b=ivec2(gl_FragCoord.xy), p0=b*uF; float s=0., n=0.;
  for(int j=0;j<16;j++){ if(j>=uF) break;
    for(int i=0;i<16;i++){ if(i>=uF) break;
      ivec2 p=p0+ivec2(i,j); if(p.x<uSize.x && p.y<uSize.y){ s+=texelFetch(uS,p,0).b; n+=1.; } } }
  float e=s/max(n,1.);
  vec2 c=vec2(p0)+float(uF)*.5;
  float r=max(length(c-uSrc),8.);
  o=vec4(uPTX-(20.*lg(r*uDX)+uFS)+10.*lg(max(e,1e-30)*r/uC), e, 0., 1.);
}`;

function wfInit() {             // はじめて WiFi を使うときに1回
  if (WF.tried) return WF.ok;
  WF.tried = true;
  try {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const gl = cv.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false });
    if (!gl) throw new Error('この端末のブラウザは WebGL2 に対応していないため、電波の計算ができません。');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('この端末（GPU）は小数の値を描けないため、電波の計算ができません。');
    WF.gl = gl;
    WF.simP = program(SIM_FS); WF.redP = program(RED_FS); WF.vao = gl.createVertexArray();
    calibrate();
    WF.ok = true;
  } catch (e) { WF.err = String(e.message || e); WF.ok = false; }
  return WF.ok;
}
function program(fs) {
  const gl = WF.gl, mk = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, ''); u[nm] = gl.getUniformLocation(p, nm); }
  return { p, u };
}
function mkTex(w, h, fmt) {
  const gl = WF.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  if (fmt === 'r8') { gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null); }
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  return t;
}
function mkFb(t) { const gl = WF.gl, f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return f; }

class WSim {
  constructor(w, h) {
    const gl = WF.gl;
    this.w = w; this.h = h; this.tex = [mkTex(w, h), mkTex(w, h)]; this.fb = this.tex.map(mkFb); this.cur = 0;
    this.mt = mkTex(w, h, 'r8');
    this.rw = Math.ceil(w / WF.F); this.rh = Math.ceil(h / WF.F);
    this.rt = mkTex(this.rw, this.rh); this.rfb = mkFb(this.rt);
    this.rbuf = new Float32Array(this.rw * this.rh * 4);
    this.idsVer = null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  dispose() { const gl = WF.gl; [...this.tex, this.mt, this.rt].forEach(t => gl.deleteTexture(t)); [...this.fb, this.rfb].forEach(f => gl.deleteFramebuffer(f)); }
  upload(ids) { const gl = WF.gl; gl.bindTexture(gl.TEXTURE_2D, this.mt); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.w, this.h, gl.RED, gl.UNSIGNED_BYTE, ids); }
  clear() { const gl = WF.gl; for (const f of this.fb) { gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); } }
  begin(src, lut) {
    const gl = WF.gl, u = WF.simP.u;
    gl.useProgram(WF.simP.p); gl.bindVertexArray(WF.vao); gl.viewport(0, 0, this.w, this.h);
    gl.uniform2i(u.uSize, this.w, this.h); gl.uniform2i(u.uSrc, src[0], src[1]);
    gl.uniform1f(u.uBeta, WF.BETA); gl.uniform1fv(u.uK2, lut.k2); gl.uniform1fv(u.uA, lut.a);
    gl.uniform1i(u.uS, 0); gl.uniform1i(u.uM, 1);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.mt);
  }
  step(val) {
    const gl = WF.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb[1 - this.cur]);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
    gl.uniform1f(WF.simP.u.uSrcVal, val);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.cur = 1 - this.cur;
  }
  wait() {                     // GPU が追いつくまで待つ（1マスだけ読む）
    const gl = WF.gl; gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fb[this.cur]);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, WF.sync); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  }
  reduce(src, key) {           // → Float32Array（rw×rh、dBm）
    const gl = WF.gl, u = WF.redP.u;
    gl.useProgram(WF.redP.p); gl.bindVertexArray(WF.vao); gl.viewport(0, 0, this.rw, this.rh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rfb);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
    gl.uniform1i(u.uS, 0); gl.uniform2i(u.uSize, this.w, this.h); gl.uniform1i(u.uF, WF.F);
    gl.uniform2f(u.uSrc, src[0] + .5, src[1] + .5); gl.uniform1f(u.uC, WF.CAL[key]);
    gl.uniform1f(u.uFS, 20 * Math.log10(WF.FREQ[key].mhz) - 27.55); gl.uniform1f(u.uPTX, WF.PTX); gl.uniform1f(u.uDX, WF.DX);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, this.rw, this.rh, gl.RGBA, gl.FLOAT, this.rbuf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out = new Float32Array(this.rw * this.rh);
    for (let i = 0; i < out.length; i++) out[i] = this.rbuf[i * 4];
    return out;
  }
}
function makeLut(f) {
  const k2 = new Float32Array(8), a = new Float32Array(8), KC = WF.KC;
  WMATS.forEach((m, i) => {
    if (i === 0) { k2[i] = KC * KC; a[i] = 0; return; }
    if (m.pec) { k2[i] = -1; a[i] = 0; return; }
    const { er, sig } = wSimProps(m, f); k2[i] = KC * KC / er; a[i] = sig * WF.DT / (2 * WF.EPS0 * er);
  });
  return { k2, a };
}
const omegaStep = f => 2 * Math.PI * WF.KC / (WF.C0 / (f * 1e9) / WF.DX);
const srcVal = (om, n) => Math.sin(om * n) * Math.min(1, n * om / (4 * Math.PI));   // 2周期かけて立ち上げる

// dBm の換算の基準: 何もない場で、点の波の出どころからの u²·r（wifi-wave の CAL.C と同じ測り方）
function calibrate() {
  const N = 320, cal = new WSim(N, N), gl = WF.gl, buf = new Float32Array(N * N * 4);
  cal.upload(new Uint8Array(N * N));
  for (const k of Object.keys(WF.FREQ)) {
    const om = omegaStep(WF.FREQ[k].ghz);
    cal.clear(); cal.begin([N / 2, N / 2], makeLut(WF.FREQ[k].ghz));
    for (let i = 0; i < 1300; i++) cal.step(srcVal(om, i));
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, cal.fb[cal.cur]);
    gl.readPixels(0, 0, N, N, gl.RGBA, gl.FLOAT, buf); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    const v = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const r = Math.hypot(x - N / 2, y - N / 2); if (r >= 50 && r <= 95) v.push(buf[(y * N + x) * 4 + 2] * r); }
    v.sort((a, b) => a - b);
    WF.CAL[k] = v[v.length >> 1];
  }
  cal.dispose();
}

// 1回の計算: 点 src（マス）から出した波が落ちつくまで進めて、強さの地図（dBm、F×F マスごと）を返す。
// 少しずつ進めて画面を止めない。token.stop を true にすると途中でやめる（'stop' を投げる）。
async function wfRun(grid, src, key, onProg, token) {
  if (!WF.sim || WF.sim.w !== grid.w || WF.sim.h !== grid.h) { if (WF.sim) WF.sim.dispose(); WF.sim = new WSim(grid.w, grid.h); }
  const sim = WF.sim;
  if (sim.idsVer !== grid.ver) { sim.upload(grid.ids); sim.idsVer = grid.ver; }
  const f = WF.FREQ[key].ghz, om = omegaStep(f);
  const far = Math.max(...[[0, 0], [grid.w, 0], [0, grid.h], [grid.w, grid.h]].map(c => Math.hypot(c[0] - src[0], c[1] - src[1])));
  const total = Math.ceil(far / WF.KC * 1.25) + 800;   // いちばん遠い所に届いて、平均が落ちつくまで
  sim.clear(); sim.begin(src, makeLut(f));
  let n = 0, chunk = 40;
  while (n < total) {
    const t0 = performance.now(), k = Math.min(chunk, total - n);
    for (let i = 0; i < k; i++) sim.step(srcVal(om, n + i));
    n += k; sim.wait();
    const dt = performance.now() - t0;
    chunk = Math.max(10, Math.min(2000, Math.round(chunk * (dt > 0 ? 30 / dt : 2))));   // 1回 30ms くらいに
    if (onProg) onProg(n / total);
    await new Promise(r => setTimeout(r, 0));
    if (token && token.stop) throw 'stop';
    sim.begin(src, makeLut(f));       // ほかの描画で状態が変わっていても大丈夫なように
  }
  return sim.reduce(src, key);
}
