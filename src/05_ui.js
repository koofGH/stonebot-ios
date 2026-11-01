// ==========================================================================
// ui.js - Stonebot for iOS (lite): themes, piece drawing, board, play screen, sheets, settings.
// ==========================================================================
const VERSION = "0.4-ios-lite";
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// ---------- colours ----------
function shade(hex, a) {
  const h = hex.replace("#", ""), t = a > 0 ? 255 : 0, k = Math.abs(a), c = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16));
  return "#" + c.map(v => Math.round(v + (t - v) * k).toString(16).padStart(2, "0")).join("");
}
function mix(c1, c2, t) {
  const a = c1.replace("#", ""), b = c2.replace("#", "");
  return "#" + [0, 2, 4].map(i => Math.round(parseInt(a.substr(i, 2), 16) * (1 - t) + parseInt(b.substr(i, 2), 16) * t).toString(16).padStart(2, "0")).join("");
}
const lum = (c) => { const h = c.replace("#", ""); return (parseInt(h.substr(0, 2), 16) + parseInt(h.substr(2, 2), 16) + parseInt(h.substr(4, 2), 16)) / 765; };

// ---------- themes (the lite build ships three) ----------
const PIECE_STYLES = { outline: "Classic outline", flat: "Flat", glow: "Neon glow" };
const mkTheme = (name, light, dark, ll, ld, sel, style, wf, wl, bf, bl, ui) => ({
  name, board: { light, dark, last_light: ll, last_dark: ld, select: sel, check: "#e8504a" },
  pieces: { style, white: wf, white_line: wl, black: bf, black_line: bl }, ui });
const THEMES = {
  Classic: mkTheme("Classic", "#ebecd0", "#739552", "#f5f682", "#b9ca43", "#f6f669", "outline", "#f7f7f2", "#262626", "#3b3b3b", "#0a0a0a",
    { bg: "#262522", panel: "#312e2b", card: "#3d3a37", fg: "#e8e6e3", muted: "#a09d98", accent: "#81b64c", btn: "#4a4743", btnfg: "#ffffff" }),
  Walnut: mkTheme("Walnut", "#ecd3a6", "#a8703f", "#f2e27a", "#c9a444", "#f4e47c", "flat", "#f8efd9", "#3b2a1c", "#4a362a", "#150d08",
    { bg: "#241912", panel: "#30221a", card: "#3d2d22", fg: "#f1e4d3", muted: "#b09a85", accent: "#e0a458", btn: "#533d2e", btnfg: "#ffffff" }),
  Midnight: mkTheme("Midnight", "#7e83b8", "#34396b", "#b3b7e8", "#5b62a8", "#c5c9ff", "glow", "#e9eeff", "#a9b8ff", "#1a1d3d", "#7f8cff",
    { bg: "#11132b", panel: "#191c3a", card: "#232749", fg: "#e4e8ff", muted: "#8f95c9", accent: "#8c9bff", btn: "#2c3160", btnfg: "#ffffff" }),
};
const DEFAULTS = { theme: "Classic", piece_style: "theme", coords: true, last_move: true, dots: true, animations: true, shadows: true, eval_bar: true, autosave: true, clock: "off", level: 5 };
const cfg = Object.assign({}, DEFAULTS);
try { const s = JSON.parse(Store.get("sb.settings") || "{}"); for (const k in s) if (k in DEFAULTS && typeof s[k] === typeof DEFAULTS[k]) cfg[k] = s[k]; } catch (e) { }
const saveCfg = () => Store.set("sb.settings", JSON.stringify(cfg));
function theme() {
  const t = THEMES[cfg.theme] || THEMES.Classic;
  const o = { name: t.name, board: t.board, ui: t.ui, pieces: Object.assign({}, t.pieces) };
  if (PIECE_STYLES[cfg.piece_style]) o.pieces.style = cfg.piece_style;
  return o;
}
function applyThemeVars() {
  const u = theme().ui;
  for (const k of ["bg", "panel", "card", "fg", "muted", "accent", "btn", "btnfg"]) document.documentElement.style.setProperty("--" + k, u[k]);
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = u.bg;
}

// ---------- piece drawing (simple shapes, so they always sit exactly in their square) ----------
const BASE = [["poly", [27, 74, 73, 74, 77, 83, 23, 83]], ["poly", [20, 83, 80, 83, 80, 91, 20, 91]]];
const SHAPES = {
  1: [["poly", [41, 48, 59, 48, 66, 74, 34, 74]], ["poly", [36, 44, 64, 44, 64, 51, 36, 51]], ["oval", 38, 14, 62, 46]].concat(BASE),
  4: [["poly", [32, 30, 68, 30, 72, 74, 28, 74]], ["poly", [28, 12, 40, 12, 40, 19, 44, 19, 44, 12, 56, 12, 56, 19, 60, 19, 60, 12, 72, 12, 72, 32, 28, 32]]].concat(BASE),
  3: [["poly", [43, 44, 57, 44, 67, 74, 33, 74]], ["poly", [35, 43, 65, 43, 65, 50, 35, 50]], ["oval", 37, 14, 63, 47], ["oval", 45, 7, 55, 17], ["line", [48, 36, 58, 24]]].concat(BASE),
  2: [["poly", [28, 74, 31, 58, 40, 46, 41, 40, 30, 43, 22, 48, 20, 42, 34, 24, 40, 12, 44, 18, 50, 11, 54, 20, 68, 28, 76, 46, 74, 74]], ["oval", 44, 25, 51, 32], ["line", [60, 34, 66, 40]]].concat(BASE),
  5: [["poly", [38, 46, 62, 46, 70, 74, 30, 74]], ["poly", [28, 20, 39, 40, 43, 15, 50, 38, 57, 15, 61, 40, 72, 20, 74, 48, 26, 48]], ["oval", 21, 14, 33, 26], ["oval", 37, 8, 49, 20], ["oval", 51, 8, 63, 20], ["oval", 67, 14, 79, 26]].concat(BASE),
  6: [["poly", [38, 46, 62, 46, 70, 74, 30, 74]], ["poly", [28, 32, 72, 32, 74, 50, 26, 50]], ["oval", 30, 28, 70, 46], ["poly", [46, 5, 54, 5, 54, 12, 61, 12, 61, 19, 54, 19, 54, 30, 46, 30, 46, 19, 39, 19, 39, 12, 46, 12]]].concat(BASE),
};
function drawPiece(ctx, piece, x, y, size, pal, shadow) {
  const white = piece > 0, fill = white ? pal.white : pal.black, line = white ? pal.white_line : pal.black_line, style = pal.style;
  const SC = 0.9, k = size / 100 * SC, o = size * (1 - SC) / 2, width = Math.max(2, Math.floor(size / 34));
  const path = (sh, dx, dy) => {
    ctx.beginPath();
    if (sh[0] === "poly") { const v = sh[1]; for (let i = 0; i < v.length; i += 2) { const px = x + o + dx + v[i] * k, py = y + o + dy + v[i + 1] * k; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); }
    else if (sh[0] === "oval") { const x0 = x + o + dx + sh[1] * k, y0 = y + o + dy + sh[2] * k, x1 = x + o + dx + sh[3] * k, y1 = y + o + dy + sh[4] * k; ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0, 0, 7); }
  };
  const solid = (sh, f, ol, w, dx, dy) => { path(sh, dx || 0, dy || 0); ctx.fillStyle = f; ctx.fill(); ctx.lineWidth = w; ctx.strokeStyle = ol; ctx.lineJoin = "round"; ctx.stroke(); };
  const shapes = SHAPES[Math.abs(piece)];
  if (shadow) { const d = size * 0.035; for (const sh of shapes) if (sh[0] !== "line") solid(sh, shadow, shadow, 1, d, d * 1.2); }
  if (style === "glow") { const halo = shade(line, -0.55); for (const sh of shapes) if (sh[0] !== "line") solid(sh, fill, halo, width * 3); }
  for (const sh of shapes) if (sh[0] !== "line") solid(sh, fill, line, style === "flat" ? 1 : width);
  for (const sh of shapes) if (sh[0] === "line") {
    ctx.beginPath(); const v = sh[1]; for (let i = 0; i < v.length; i += 2) { const px = x + o + v[i] * k, py = y + o + v[i + 1] * k; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.strokeStyle = line; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.stroke();
  }
}

// ---------- the board ----------
const BADGE = { brilliant: "!!", great: "!", best: "★", excellent: "✓", good: "✓", book: "≡", inaccuracy: "?!", mistake: "?", blunder: "??" };
const DESCRIPTION = {
  brilliant: "A sacrifice that really works. Impressive!", great: "The key move - most others were clearly worse.",
  best: "The strongest move Stonebot could find.", excellent: "Almost as good as the best move.", good: "A solid move.",
  book: "A known opening move.", inaccuracy: "Not the best - you let some of your advantage slip.",
  mistake: "This gives your opponent a real chance.", blunder: "A serious error that changes the game.",
};
const ORDER = ["brilliant", "great", "best", "excellent", "good", "book", "inaccuracy", "mistake", "blunder"];

class BoardView {
  constructor(canvas) {
    this.c = canvas; this.ctx = canvas.getContext("2d");
    this.bd = null; this.flipped = false; this.selected = null; this.targets = {}; this.last = null; this.checkSq = null;
    this.badge = null; this.anim = null; this.hideSq = null; this.animating = false; this.size = 0;
    this.drawQueued = false;
  }
  resize() {
    const w = Math.floor(this.c.parentElement.clientWidth - ($("evalbar").offsetParent && cfg.eval_bar ? 22 : 0));
    const dpr = window.devicePixelRatio || 1;
    this.size = Math.max(160, Math.min(w, 680));
    this.c.style.width = this.size + "px"; this.c.style.height = this.size + "px"; this.c.style.flex = "none";
    this.c.width = Math.round(this.size * dpr); this.c.height = Math.round(this.size * dpr);
    this.dpr = dpr; this.sq = this.size / 8;
    $("evalbar").style.height = this.size + "px";
    this.draw();
  }
  xy(s) { const f = s & 7, r = s >> 3; return this.flipped ? [(7 - f) * this.sq, r * this.sq] : [f * this.sq, (7 - r) * this.sq]; }
  sqAt(px, py) {
    const cx = Math.floor(px / this.sq), cy = Math.floor(py / this.sq);
    if (cx < 0 || cx > 7 || cy < 0 || cy > 7) return null;
    return this.flipped ? cy * 8 + (7 - cx) : (7 - cy) * 8 + cx;
  }
  draw() {
    if (!this.sq) return;
    const ctx = this.ctx, th = theme(), b = th.board, sq = this.sq;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (let s = 0; s < 64; s++) {
      const [x, y] = this.xy(s), light = ((s >> 3) + (s & 7)) % 2 === 1;
      let col = light ? b.light : b.dark;
      if (cfg.last_move && this.last && (s === this.last[0] || s === this.last[1])) col = light ? b.last_light : b.last_dark;
      if (s === this.selected) col = b.select;
      if (s === this.checkSq) col = b.check;
      ctx.fillStyle = col; ctx.fillRect(x, y, sq + 0.5, sq + 0.5);
    }
    if (cfg.coords) {
      ctx.font = "600 " + Math.round(sq * 0.2) + "px -apple-system,sans-serif"; ctx.textBaseline = "top";
      for (let i = 0; i < 8; i++) {
        const f = this.flipped ? 7 - i : i, r = this.flipped ? i : 7 - i;
        const lf = ((r) + f) % 2 === 1;   // light square under the label
        ctx.fillStyle = (i === 7 ? (((0 + (this.flipped ? 7 - i : i)) % 2 === 1)) : false) ? b.dark : b.dark;
        const bot = this.flipped ? 7 : 0;
        ctx.fillStyle = (((bot + f) % 2 === 1) ? b.dark : b.light);
        ctx.textAlign = "right"; ctx.fillText("abcdefgh"[f], (i + 1) * sq - 3, 8 * sq - sq * 0.24);
        const colf = this.flipped ? 7 : 0;
        ctx.fillStyle = (((r + colf) % 2 === 1) ? b.dark : b.light);
        ctx.textAlign = "left"; ctx.fillText(String(r + 1), 3, i * sq + 2);
      }
    }
    if (cfg.dots && this.selected !== null) {
      for (const t in this.targets) {
        const [x, y] = this.xy(+t), light = ((t >> 3) + (t & 7)) % 2 === 1, base = light ? b.light : b.dark;
        ctx.fillStyle = ctx.strokeStyle = lum(base) < 0.3 ? mix(base, th.ui.accent, 0.7) : shade(base, -0.3);
        ctx.beginPath();
        if (this.targets[t]) { ctx.lineWidth = Math.max(3, sq * 0.07); ctx.arc(x + sq / 2, y + sq / 2, sq / 2 - 4, 0, 7); ctx.stroke(); }
        else { ctx.arc(x + sq / 2, y + sq / 2, Math.max(4, sq / 8), 0, 7); ctx.fill(); }
      }
    }
    for (let s = 0; s < 64; s++) {
      const p = this.bd ? this.bd.b[s] : 0;
      if (!p || s === this.hideSq) continue;
      const [x, y] = this.xy(s), light = ((s >> 3) + (s & 7)) % 2 === 1;
      drawPiece(ctx, p, x, y, sq, th.pieces, cfg.shadows ? shade(light ? b.light : b.dark, -0.3) : null);
    }
    if (this.badge) {
      const [x, y] = this.xy(this.badge[0]), r = Math.max(10, sq * 0.2), bx = x + sq - r - 1, by = y + r + 1;
      ctx.beginPath(); ctx.arc(bx, by, r, 0, 7); ctx.fillStyle = this.badge[2]; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "800 " + Math.round(r * 1.0) + "px -apple-system,sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(BADGE[this.badge[1]], bx, by + 1);
    }
    if (this.anim) drawPiece(ctx, this.anim.p, this.anim.x, this.anim.y, sq, th.pieces, null);
  }
  animate(f, t, piece, ms) {
    if (!cfg.animations) return Promise.resolve();
    const [x0, y0] = this.xy(f), [x1, y1] = this.xy(t), t0 = performance.now();
    this.animating = true; this.hideSq = t;
    return new Promise(res => {
      const step = (now) => {
        const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
        this.anim = { p: piece, x: x0 + (x1 - x0) * e, y: y0 + (y1 - y0) * e }; this.draw();
        if (k < 1) requestAnimationFrame(step);
        else { this.anim = null; this.hideSq = null; this.animating = false; this.draw(); res(); }
      };
      requestAnimationFrame(step);
    });
  }
}

// ---------- engine client: a Web Worker built from an embedded copy of the engine; synchronous fallback ----------
class EngineClient {
  constructor() { this.n = 0; this.pending = {}; this.sync = false; this.spawn(); }
  fallback() {   // Web Workers unavailable or blocked: run the engine on the page itself (slower UI while it thinks)
    if (this.sync) return;
    this.sync = true; this.w = null; this.host = new EngineHost();
    const old = this.pending; this.pending = {};
    for (const id in old) this.run(old[id].req, old[id].res, old[id].rej);
  }
  spawn() {
    if (this.sync) return;
    const mine = this.w = null; let alive = false;
    try {
      const url = URL.createObjectURL(new Blob([ENGINE_SRC], { type: "text/javascript" }));
      const w = this.w = new Worker(url);
      w.onmessage = (e) => {
        alive = true;
        const p = this.pending[e.data.id]; if (!p) return; delete this.pending[e.data.id];
        e.data.err ? p.rej(new Error(e.data.err)) : p.res(e.data.res);
      };
      w.onerror = () => { if (this.w === w) this.fallback(); };
      this.call({ op: "reset" }).catch(() => { });   // doubles as a liveness check
      setTimeout(() => { if (!alive && this.w === w) this.fallback(); }, 3500);
    } catch (e) { this.fallback(); }
  }
  run(req, res, rej) { setTimeout(() => { try { res(this.host.handle(req)); } catch (e) { rej(e); } }, 20); }
  call(req) {
    return new Promise((res, rej) => {
      if (this.sync) return this.run(req, res, rej);
      const id = ++this.n; this.pending[id] = { req, res, rej };
      this.w.postMessage({ id, req });
    });
  }
  abort() {   // cancel everything in flight: pending calls never resolve, the worker restarts fresh
    this.pending = {};
    if (this.w) { this.w.terminate(); this.spawn(); }
  }
}

// ---------- small helpers ----------
const CLOCKS = [["No clock", "off"], ["1 min", "60+0"], ["3 min + 2 s", "180+2"], ["5 min", "300+0"], ["10 min", "600+0"], ["15 min + 10 s", "900+10"], ["30 min", "1800+0"]];
function parseTc(t) { const m = /^(\d+)\+(\d+)$/.exec(String(t)); return m && +m[1] > 0 ? [+m[1], +m[2]] : null; }
function tcLabel(t) { const c = parseTc(t); if (!c) return "No clock"; const a = c[0] % 60 === 0 ? (c[0] / 60) + " min" : c[0] + " s"; return a + (c[1] ? " + " + c[1] + " s" : ""); }
function fmtClock(s) { if (s < 20) return s.toFixed(1); s = Math.floor(s + 0.999); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
let toastTimer = null;
function toast(text) { const t = $("toast"); t.textContent = text; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 1800); }
function sheet(build) {   // opens a bottom sheet; build(content, close)
  const back = el("div", "back"), box = el("div", "sheet");
  back.appendChild(box); $("sheets").appendChild(back);
  const close = () => back.remove();
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
  build(box, close);
  return close;
}
function pieceCanvas(piece, size, light) {
  const c = document.createElement("canvas"), d = window.devicePixelRatio || 1; c.width = c.height = size * d; c.style.width = c.style.height = size + "px";
  const x = c.getContext("2d"); x.scale(d, d); x.fillStyle = light; x.fillRect(0, 0, size, size); drawPiece(x, piece, 0, 0, size, theme().pieces, null); return c;
}

// ==========================================================================
// the app
// ==========================================================================
class App {
  constructor() {
    this.client = new EngineClient();
    this.game = new Game("stonebot", Math.max(1, Math.min(15, cfg.level)), 1, WHITE);
    this.view = new BoardView($("board"));
    this.gen = 0; this.busy = false; this.selected = null; this.flipped = false; this.eval = 0; this.dots = 0;
    this.byFrom = {}; this.drag = null; this.saveTimer = null; this.lastRating = null;
    $("ver").textContent = "v" + VERSION;
    this.bind();
    applyThemeVars();
    this.newGame(WHITE);
    setInterval(() => this.tick(), 100);
    window.addEventListener("resize", () => this.view.resize());
    window.addEventListener("orientationchange", () => setTimeout(() => this.view.resize(), 200));
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.flushSave(); });
    window.addEventListener("pagehide", () => this.flushSave());
  }
  bind() {
    $("b-new").onclick = () => this.openNew();
    $("b-set").onclick = () => this.openSettings();
    $("b-undo").onclick = () => this.undo();
    $("b-flip").onclick = () => { this.flipped = !this.flipped; this.refresh(); };
    $("b-resign").onclick = () => this.resign();
    $("opp-card").onclick = () => this.openLevels();
    const c = $("board"), pt = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    c.addEventListener("pointerdown", (e) => { c.setPointerCapture(e.pointerId); const [x, y] = pt(e); this.down(this.view.sqAt(x, y), x, y); });
    c.addEventListener("pointermove", (e) => { const [x, y] = pt(e); this.move(x, y); });
    c.addEventListener("pointerup", (e) => { const [x, y] = pt(e); this.up(this.view.sqAt(x, y)); });
    c.addEventListener("pointercancel", () => { this.drag = null; this.view.anim = null; this.view.hideSq = null; this.view.draw(); });
  }

  // ----- game flow -----
  newGame(color, fen) {
    if (color === null) color = Math.random() < 0.5 ? WHITE : BLACK;
    this.flushSave(); this.gen++; this.client.abort();
    this.game.new(color, null, null, fen || null, parseTc(cfg.clock));
    this.busy = false; this.selected = null; this.flipped = color === BLACK; this.eval = 0; this.lastRating = null;
    this.view.badge = null; this.view.last = null; this.setRating(null);
    this.refresh(); this.view.resize();
    if (!this.game.playerTurn()) this.botFirst();
  }
  refresh() {
    const g = this.game, v = this.view;
    this.byFrom = {};
    const moves = g.over ? [] : g.bd.legal();
    for (const m of moves) { const f = m & 63, t = (m >> 6) & 63; ((this.byFrom[f] = this.byFrom[f] || {})[t] = this.byFrom[f][t] || []).push(m); }
    if (this.selected !== null && (!this.byFrom[this.selected] || this.busy || !g.playerTurn())) this.selected = null;
    v.bd = g.bd; v.flipped = this.flipped; v.selected = this.selected; v.targets = {};
    if (this.selected !== null) for (const t in this.byFrom[this.selected]) v.targets[t] = g.bd.isCapture(this.byFrom[this.selected][t][0]);
    const last = g.log[g.log.length - 1]; v.last = last ? [last.from, last.to] : null;
    v.checkSq = (g.bd.inCheck() && (!g.over || g.over.text === "Checkmate")) ? g.bd.king[g.bd.turn] : null;
    if (!v.animating) v.draw();
    this.plates(); this.movesList(); this.summary(); this.drawEval(); this.oppCard(); this.statusLine();
    $("b-undo").disabled = this.busy || v.animating || !!g.clock || !g.log.some(e => e.mine);
    $("b-resign").disabled = this.busy || !!g.over;
    $("evalbar").style.display = cfg.eval_bar ? "" : "none";
  }
  statusLine() {
    const g = this.game;
    $("status").textContent = g.over ? g.over.text + (g.over.winner === 0 ? "" : (g.over.winner === g.player ? " - you win!" : " - Stonebot wins"))
      : this.busy ? "Stonebot is thinking" + ".".repeat(this.dots % 4) : "Your move (" + (g.player === WHITE ? "White" : "Black") + ")";
  }
  oppCard() {
    const g = this.game;
    $("opp-card").innerHTML = '<h4>Opponent · tap to change level</h4><div class="opp"><b>Stonebot</b> <span class="muted">Level ' + g.level + " · " + LEVEL_NAMES[g.level] + "</span></div>";
  }
  plates() {
    const g = this.game, bottom = this.flipped ? BLACK : WHITE, th = theme();
    const [wl, bl] = g.captured(), VALP = { 1: 1, 2: 3, 3: 3, 4: 5, 5: 9 };
    const sum = (o) => Object.keys(o).reduce((a, t) => a + VALP[t] * o[t], 0);
    for (const [id, color] of [["plate-top", -bottom], ["plate-bot", bottom]]) {
      const you = color === g.player, taken = color === WHITE ? bl : wl, mine = sum(taken), theirs = sum(color === WHITE ? wl : bl);
      const box = $(id);
      box.innerHTML = '<div class="grow"><span class="nm">' + (you ? "You" : "Stonebot") + '</span> <span class="sub">' + (you ? (color === WHITE ? "White" : "Black") : "Level " + g.level + " · " + LEVEL_NAMES[g.level]) + '</span></div>';
      const tray = document.createElement("canvas"), d = window.devicePixelRatio || 1; tray.width = 120 * d; tray.height = 22 * d; tray.style.width = "120px";
      const x = tray.getContext("2d"); x.scale(d, d); let px = 0;
      for (const t of [5, 4, 3, 2, 1]) { for (let i = 0; i < taken[t]; i++) { drawPiece(x, t * -color, px, -1, 24, th.pieces, null); px += 11; } px += 4; }
      box.appendChild(tray);
      if (mine > theirs) box.appendChild(el("span", "diff", "+" + (mine - theirs)));
      if (g.clock) { const c = el("span", "clock", ""); c.dataset.color = color; box.appendChild(c); }
    }
    this.clocks();
  }
  clocks() {
    const g = this.game;
    if (!g.clock) return;
    document.querySelectorAll(".clock").forEach(c => {
      const col = +c.dataset.color, left = g.clock.left(col), run = !g.over && !g.clock.stopped && g.clock.turn === col;
      c.textContent = fmtClock(left); c.className = "clock" + (run ? " run" : "") + (left < 10 && !run ? " low" : "");
    });
  }
  movesList() {
    const g = this.game, box = $("moves"); let h = "";
    g.log.forEach((e, i) => {
      if (e.color === WHITE) h += '<span class="n">' + (Math.floor(i / 2) + 1) + ".</span> ";
      else if (i === 0) h += '<span class="n">1...</span> ';
      h += e.san;
      if (e.rating) h += '<b style="color:' + e.rating.color + '">' + BADGE[e.rating.label] + "</b>";
      h += e.color === BLACK ? "<br>" : "&nbsp; ";
    });
    box.innerHTML = h || '<span class="muted">No moves yet.</span>'; box.scrollTop = box.scrollHeight;
  }
  summary() {
    const g = this.game, acc = g.accuracy(), counts = g.tally();
    $("acc").textContent = "Accuracy  " + (acc === null ? "-" : Math.round(acc) + "%");
    $("chips").innerHTML = ORDER.filter(k => counts[k]).map(k => '<span class="chip" style="background:' + LABELS[k][1] + '">' + counts[k] + " " + LABELS[k][0].replace(/!+$/, "") + "</span>").join("");
  }
  setRating(r) {
    const b = $("rbadge");
    if (!r) { b.textContent = "Make a move!"; b.style.background = ""; b.style.color = ""; $("rdesc").textContent = "Every move you play gets rated here."; return; }
    b.textContent = r.san + "   " + r.text; b.style.background = r.color; b.style.color = "#fff";
    let d = DESCRIPTION[r.label];
    if (["inaccuracy", "mistake", "blunder"].includes(r.label) && r.best_san) d += "  Better was " + r.best_san + ".";
    $("rdesc").textContent = d;
  }
  drawEval() {
    const cp = this.eval, share = winPct(cp) / 100, f = this.flipped ? share : 1 - share;
    $("evalfill").style.height = (f * 100) + "%";
    $("evalfill").style.background = this.flipped ? "#f2f2f2" : "#1b1b1b"; $("evalbar").style.background = this.flipped ? "#1b1b1b" : "#f2f2f2";
    $("evaltxt").textContent = ""; 
  }
  tick() {
    this.dots++;
    const g = this.game;
    if (this.busy && !g.over && !this.view.animating) this.statusLine();
    if (g.clock) { this.clocks(); if (g.flagCheck()) { this.gen++; this.client.abort(); this.busy = false; this.selected = null; this.refresh(); this.showEnd(); } }
  }

  // ----- input (tap or drag) -----
  down(sq, x, y) {
    const g = this.game;
    if (sq === null || this.busy || g.over || !g.playerTurn() || this.view.animating) return;
    if (this.selected !== null && this.byFrom[this.selected] && this.byFrom[this.selected][sq]) { this.commit(this.selected, sq); return; }
    if (this.byFrom[sq]) {
      const was = this.selected === sq;
      this.selected = sq; this.drag = { sq, was, x0: x, y0: y, on: false, piece: g.bd.b[sq] }; this.refresh();
    } else { this.selected = null; this.refresh(); }
  }
  move(x, y) {
    const d = this.drag; if (!d) return;
    if (!d.on && Math.hypot(x - d.x0, y - d.y0) > 7) { d.on = true; this.view.hideSq = d.sq; }
    if (d.on) { this.view.anim = { p: d.piece, x: x - this.view.sq / 2, y: y - this.view.sq / 2 }; this.view.draw(); }
  }
  up(sq) {
    const d = this.drag; this.drag = null; if (!d) return;
    this.view.anim = null; this.view.hideSq = null;
    if (d.on) {
      if (sq !== null && this.byFrom[d.sq] && this.byFrom[d.sq][sq]) { this.commit(d.sq, sq, true); return; }
      this.view.draw(); return;
    }
    if (d.was) { this.selected = null; this.refresh(); }
  }
  async commit(from, to, dropped) {
    const ms = this.byFrom[from][to]; let m = ms[0];
    if (ms.length > 1) { const p = await this.askPromotion(); m = ms.find(x => (x >> 12) === p) || ms[0]; }
    this.play(m, dropped);
  }
  askPromotion() {
    return new Promise(res => {
      let done = false;
      const close = sheet((box, close) => {
        box.innerHTML = "<h3>Promote to</h3>"; const row = el("div", "promo"), sign = this.game.player;
        [[Q, "Queen"], [R, "Rook"], [B, "Bishop"], [N, "Knight"]].forEach(([p], i) => {
          const c = pieceCanvas(p * sign, 72, theme().board[i % 2 ? "dark" : "light"]); c.onclick = () => { done = true; close(); res(p); }; row.appendChild(c);
        });
        box.appendChild(row);
      });
      const obs = new MutationObserver(() => { if (!done && !$("sheets").children.length) { done = true; res(Q); obs.disconnect(); } });
      obs.observe($("sheets"), { childList: true });
    });
  }

  // ----- playing -----
  async play(m, dropped) {
    const g = this.game, gen = this.gen, pre = g.spec();
    this.selected = null; const entry = g.push(m, true);
    this.view.badge = null; this.busy = true; this.refresh();
    const anim = dropped ? Promise.resolve() : this.view.animate(entry.from, entry.to, entry.piece, 150);
    const over = g.over, late = !!g.clock && !over;
    try {
      const rate = () => this.client.call({ op: "rate", spec: pre, move: m }).then(r => { if (gen !== this.gen) return; g.log[g.log.indexOf(entry)].rating = r; this.lastRating = r;
        this.view.badge = g.log[g.log.length - 1] === entry ? [(m >> 6) & 63, r.label, r.color] : null;
        if (r.eval_after !== null && r.eval_after !== undefined) this.eval = r.eval_after * (g.player === WHITE ? 1 : -1);
        this.setRating(r); this.refresh(); this.autosave(); });
      if (!late) await rate();
      if (gen !== this.gen) return;
      if (over) { await anim; this.busy = false; this.refresh(); this.autosave(); this.showEnd(); return; }
      const r = await this.client.call({ op: "move", spec: g.spec(), level: g.botLevel(), cap: g.timeCap() });
      if (gen !== this.gen) return;
      await anim;
      await this.applyBot(r.move, gen);
      if (late) await rate();
      if (gen === this.gen && !g.over) this.client.call({ op: "eval", spec: g.spec() }).then(cp => { if (gen === this.gen) { this.eval = cp; this.drawEval(); } }).catch(() => { });
    } catch (e) { if (gen === this.gen) { this.busy = false; $("status").textContent = "Error: " + e.message; } }
  }
  async applyBot(m, gen) {
    const g = this.game;
    if (!m) { this.busy = false; this.refresh(); return; }
    const entry = g.push(m, false); this.selected = null; this.refresh();
    await this.view.animate(entry.from, entry.to, entry.piece, 230);
    if (gen !== this.gen) return;
    this.busy = false; this.refresh(); this.autosave();
    if (g.over) this.showEnd();
  }
  async botFirst() {
    const g = this.game, gen = this.gen; this.busy = true; this.refresh();
    try { const r = await this.client.call({ op: "move", spec: g.spec(), level: g.botLevel(), cap: g.timeCap() }); if (gen === this.gen) await this.applyBot(r.move, gen); }
    catch (e) { if (gen === this.gen) { this.busy = false; $("status").textContent = "Error: " + e.message; } }
  }
  undo() {
    if (this.busy || this.view.animating || this.game.clock) return;
    this.gen++; this.client.abort();
    if (this.game.undoPair()) { this.selected = null; this.view.badge = null; this.setRating(null); this.refresh(); }
  }
  resign() {
    const g = this.game; if (g.over || this.busy) return;
    this.confirm("Resign this game?", "Resign", () => { this.gen++; this.client.abort(); g.over = { text: "You resigned", winner: -g.player }; if (g.clock) g.clock.stop(); this.refresh(); this.autosave(); this.showEnd(); });
  }
  confirm(text, yes, fn) {
    sheet((box, close) => { box.innerHTML = "<h3>" + text + "</h3>"; const row = el("div", "row"), n = el("button", "", "Cancel"), y = el("button", "accent", yes);
      n.onclick = close; y.onclick = () => { close(); fn(); }; row.append(n, y); box.appendChild(row); });
  }
  showEnd() {
    const g = this.game; if (!g.over) return;
    this.flushSave();
    const w = g.over.winner, who = w === 0 ? "It's a draw." : (w === g.player ? "You win!" : "Stonebot wins."), acc = g.accuracy();
    sheet((box, close) => {
      box.innerHTML = "<h3>Game over</h3><p>" + g.over.text + "<br><b>" + who + "</b>" + (acc === null ? "" : "<br><span class='muted'>Your accuracy: " + Math.round(acc) + "%</span>") + "</p>";
      const row = el("div", "row"), cp = el("button", "", "Copy PGN"), nw = el("button", "accent", "New game");
      cp.onclick = async () => { try { await navigator.clipboard.writeText(recordToPgn(recordFromGame(g))); toast("PGN copied"); } catch (e) { toast("Could not copy"); } };
      nw.onclick = () => { close(); this.newGame(g.player); };
      row.append(cp, nw); box.appendChild(row);
    });
  }

  // ----- saving -----
  autosave() {
    if (!cfg.autosave || !this.game.log.length) return;
    clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.flushSave(true), 350);
  }
  flushSave(announce) {
    clearTimeout(this.saveTimer); this.saveTimer = null;
    const g = this.game; if (!cfg.autosave || !g.log.length) return;
    try {
      const rec = recordFromGame(g); g.saveName = g.saveName || recordFilename(rec);
      saveRecord(rec, g.saveName); Store.set("sb.last", g.saveName);
      const all = listSaved(); for (const x of all.slice(40)) deleteRecord(x.name);
      if (announce === true) toast("Autosaved");
    } catch (e) { if (announce === true) toast("Could not autosave"); }
  }
  tryContinue() {
    try {
      const name = Store.get("sb.last"); if (!name) return;
      const rec = loadRecord(name);
      if (!rec.ucis.length || ["1-0", "0-1", "1/2-1/2"].includes(rec.result) || rec.mode !== "stonebot") return;
      sheet((box, close) => {
        box.innerHTML = "<h3>Continue your last game?</h3><p class='muted'>" + rec.white + " vs " + rec.black + " · " + rec.ucis.length + " moves</p>";
        const row = el("div", "row"), n = el("button", "", "New game"), y = el("button", "accent", "Continue");
        n.onclick = close; y.onclick = () => { close(); this.loadGame(rec, name); }; row.append(n, y); box.appendChild(row);
      });
    } catch (e) { }
  }
  loadGame(rec, name) {
    let g; try { g = gameFromRecord(rec, rec.player || WHITE); } catch (e) { toast("Could not load that game"); return; }
    this.gen++; this.client.abort(); g.saveName = name; g.level = rec.level; this.game = g;
    this.busy = false; this.selected = null; this.flipped = g.player === BLACK; this.eval = 0; this.view.badge = null; this.setRating(null);
    this.refresh(); this.view.resize();
    if (!g.over && !g.playerTurn()) this.botFirst();
  }

  // ----- sheets -----
  openLevels() {
    sheet((box, close) => {
      box.innerHTML = "<h3>Stonebot level</h3><div class='muted'>Changes take effect on the next bot move.</div>";
      const grid = el("div", "lvlgrid");
      for (let i = 1; i <= 15; i++) { const b = el("button", i === this.game.level ? "on" : "", String(i)); b.onclick = () => { this.game.setLevel(i); cfg.level = i; saveCfg(); close(); this.refresh(); toast("Level " + i + " · " + LEVEL_NAMES[i]); }; grid.appendChild(b); }
      box.appendChild(grid);
    });
  }
  openNew() {
    const start = (color) => { const go = () => this.newGame(color); if (this.game.log.some(e => e.mine) && !this.game.over) this.confirm("Start a new game? Your current game is autosaved.", "New game", go); else go(); };
    sheet((box, close) => {
      box.innerHTML = "<h3>New game</h3><div class='muted'>Clock</div>";
      const row = el("div", "row");
      for (const [label, val] of CLOCKS) { const b = el("button", cfg.clock === val ? "on" : "", label); b.onclick = () => { cfg.clock = val; saveCfg(); row.querySelectorAll("button").forEach(x => x.classList.remove("on")); b.classList.add("on"); }; row.appendChild(b); }
      box.appendChild(row);
      box.appendChild(el("div", "muted", "Play as"));
      const r2 = el("div", "row");
      for (const [label, col] of [["White", WHITE], ["Black", BLACK], ["Random", null]]) { const b = el("button", "accent", label); b.onclick = () => { close(); start(col); }; r2.appendChild(b); }
      box.appendChild(r2);
    });
  }
  openSettings() {
    sheet((box, close) => {
      const render = () => {
        box.innerHTML = "<h3>Themes &amp; settings</h3>";
        const tg = el("div", "themes");
        for (const name in THEMES) {
          const t = THEMES[name], b = el("button", cfg.theme === name ? "on" : "", ""); const c = document.createElement("canvas"); c.width = 160; c.height = 80; const x = c.getContext("2d");
          for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? t.board.dark : t.board.light; x.fillRect(i * 40, j * 40, 40, 40); }
          drawPiece(x, N, 0, 0, 40, t.pieces, null); drawPiece(x, -Q, 40, 40, 40, t.pieces, null);
          b.append(c, document.createTextNode(name)); b.onclick = () => { cfg.theme = name; cfg.piece_style = "theme"; saveCfg(); applyThemeVars(); this.refresh(); render(); }; tg.appendChild(b);
        }
        box.appendChild(tg); box.appendChild(el("div", "sp"));
        box.appendChild(el("div", "muted", "Piece style"));
        const ps = el("div", "row"), cur = theme().pieces.style;
        for (const k in PIECE_STYLES) { const b = el("button", cur === k ? "on" : "", PIECE_STYLES[k]); b.onclick = () => { cfg.piece_style = k; saveCfg(); this.refresh(); render(); }; ps.appendChild(b); }
        box.appendChild(ps);
        for (const [k, label] of [["coords", "Board coordinates"], ["last_move", "Highlight last move"], ["dots", "Legal-move dots"], ["animations", "Animate moves"], ["shadows", "Piece shadows"], ["eval_bar", "Evaluation bar"], ["autosave", "Auto-save games"]]) {
          const l = el("label", "", "<span>" + label + "</span>"), i = el("input"); i.type = "checkbox"; i.checked = !!cfg[k];
          i.onchange = () => { cfg[k] = i.checked; saveCfg(); if (k === "eval_bar") this.view.resize(); this.refresh(); }; l.appendChild(i); box.appendChild(l);
        }
        box.appendChild(el("p", "muted", "Stonebot " + VERSION + " · lite build for iPhone/iPad"));
      };
      render();
    });
  }
}

window.addEventListener("load", () => {
  const app = new App(); window.sbApp = app; app.view.resize();
  setTimeout(() => app.tryContinue(), 400);
});
