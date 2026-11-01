// ==========================================================================
// game.js - game controller (no UI), clock, engine request handler (runs in the worker), records, PGN, storage.
// ==========================================================================
const nowSec = () => Date.now() / 1000;

class Clock {
  constructor(base, inc, turn) {
    this.t = { 1: +base, "-1": +base }; this.inc = +inc; this.turn = turn || WHITE; this.t0 = nowSec(); this.stopped = false;
  }
  left(color) { let v = this.t[color]; if (!this.stopped && color === this.turn) v -= nowSec() - this.t0; return Math.max(0, v); }
  switch() {
    if (this.stopped) return;
    const n = nowSec();
    this.t[this.turn] = Math.max(0, this.t[this.turn] - (n - this.t0));
    if (this.t[this.turn] > 0) this.t[this.turn] += this.inc;
    this.turn = -this.turn; this.t0 = n;
  }
  stop() { if (!this.stopped) { this.t[this.turn] = this.left(this.turn); this.stopped = true; } }
  flagged() {
    for (const c of [WHITE, BLACK]) if (this.t[c] <= 0 || (!this.stopped && c === this.turn && this.left(c) <= 0)) return c;
    return 0;
  }
}

// A plain-data description of a position so the engine worker can rebuild it.
function positionSpec(bd, startFen, ucis) {
  return { chaos: false, startFen: startFen || null, ucis: ucis.slice() };
}
function buildPosition(spec) {
  const bd = new Board(spec.startFen || START_FEN);
  for (const u of spec.ucis) bd.make(bd.parseUci(u));
  return bd;
}

// Handles engine requests. Lives in the worker (or inline when workers are unavailable).
class EngineHost {
  constructor() {
    this.bots = {}; this.sharedEngine = new Engine();
    this.rater = new Rater(this.sharedEngine, 3);
  }
  bot(level) { if (!this.bots[level]) this.bots[level] = new Stonebot(level); return this.bots[level]; }
  handle(req) {
    switch (req.op) {
      case "reset": for (const k in this.bots) this.bots[k].engine.reset(); this.sharedEngine.reset(); return true;
      case "move": {
        const pos = buildPosition(req.spec);
        const ucis = req.spec.startFen ? ["~"].concat(req.spec.ucis) : req.spec.ucis;
        const r = this.bot(req.level).chooseMove(pos, ucis, req.cap);
        return { move: r.move, info: r.info };
      }
      case "rate": {
        const pos = buildPosition(req.spec);
        const ucis = req.spec.startFen ? ["~"].concat(req.spec.ucis) : req.spec.ucis;
        return this.rater.rate(pos, req.move, ucis);
      }
      case "eval": {
        const pos = buildPosition(req.spec);
        let cp;
        { const sc = this.sharedEngine.scoreRootMoves(pos.copy(), 3, 1.2); cp = sc.length ? sc[0][1] : 0; }
        return cp * pos.turn;
      }
      default: throw new Error("unknown op " + req.op);
    }
  }
}

class Game {
  constructor(mode, level, tier, playerColor) {
    this.mode = mode || "stonebot"; this.level = level || 5; this.tier = tier || 1;
    this.startFen = null; this.clock = null; this.tc = null;
    this.new(playerColor || WHITE);
  }
  get chaosOn() { return false; }
  get botName() { return "Stonebot"; }
  new(playerColor, mode, tier, fen, tc) {
    if (mode != null) this.mode = mode;
    if (tier != null) this.tier = tier;
    if (this.chaosOn) { fen = null; tc = null; }
    this.startFen = fen || null;
    this.bd = new Board(fen || START_FEN);
    this.tc = tc || null;
    this.clock = tc ? new Clock(tc[0], tc[1], this.bd.turn) : null;
    this.started = nowSec(); this.saveName = null; this.endNote = "";
    this.ucis = []; this.log = []; this.player = playerColor; this.over = null;
  }
  setLevel(l) { this.level = Math.max(1, Math.min(15, l)); }
  spec() { return positionSpec(this.bd, this.startFen, this.ucis); }
  botLevel() { return this.level; }
  timeCap() { const c = this.clock; return c ? Math.max(0.05, c.left(-this.player) / 28 + c.inc * 0.7) : null; }
  playerTurn() { return this.bd.turn === this.player; }
  push(m, mine) {
    const f = m & 63, t = (m >> 6) & 63;
    const entry = { san: this.bd.san(m), color: this.bd.turn, mine, rating: null, uci: uci(m), from: f, to: t, piece: this.bd.b[f], cap: this.bd.b[t] };
    this.bd.make(m); this.ucis.push(entry.uci); this.log.push(entry);
    this.over = this.bd.result();
    if (this.clock) { this.clock.switch(); if (this.over) this.clock.stop(); }
    return entry;
  }
  flagCheck() {
    const c = this.clock;
    if (!c || this.over) return false;
    const loser = c.flagged();
    if (!loser) return false;
    c.stop();
    const winner = -loser, b = this.bd.b;
    let minor = 0, enough = false;
    for (const p of b) { if (p * winner > 0) { const a = Math.abs(p); if (a === P || a === R || a === Q) enough = true; if (a === N || a === B) minor++; } }
    enough = enough || minor >= 2;
    this.over = { text: (loser === this.player ? "You" : this.botName) + " ran out of time", winner: enough ? winner : 0 };
    return true;
  }
  undoPair() {
    if (!this.log.some(e => e.mine)) return false;
    while (this.log.length) { const e = this.log.pop(); this.bd.undo(); this.ucis.pop(); if (e.mine) break; }
    this.over = null;
    return true;
  }
  tally() { const c = {}; for (const e of this.log) if (e.mine && e.rating) c[e.rating.label] = (c[e.rating.label] || 0) + 1; return c; }
  accuracy() {
    const a = this.log.filter(e => e.mine && e.rating).map(e => accuracyOf(e.rating.loss));
    return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  }
  captured() {
    const start = { 1: 8, 2: 2, 3: 2, 4: 2, 5: 1 };
    const have = { 1: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, "-1": { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    for (const p of this.bd.b) if (p && start[Math.abs(p)]) have[p > 0 ? 1 : -1][Math.abs(p)]++;
    const w = {}, bl = {};
    for (const t in start) { w[t] = Math.max(0, start[t] - have[1][t]); bl[t] = Math.max(0, start[t] - have[-1][t]); }
    return [w, bl];
  }
}

// ---------- records & PGN ----------
const RESULT_TAG = { 1: "1-0", "-1": "0-1", 0: "1/2-1/2" };
const PLAYER_TAG = { 1: "white", "-1": "black", 0: "none" };
const TAG_RE_SRC = '\\[(\\w+)\\s+"((?:[^"\\\\]|\\\\.)*)"\\]';
const TOKEN_RE_SRC = "\\{[^}]*\\}|;[^\\n]*|\\(|\\)|\\$\\d+|\\d+\\.+|1-0|0-1|1/2-1/2|\\*|[^\\s{}();$]+";

function recordFromGame(g, white, black) {
  const bot = g.botName + " L" + g.level;
  const ratings = {};
  g.log.forEach((e, i) => { if (e.mine && e.rating) ratings[String(i)] = [e.rating.label, Math.round(e.rating.loss * 10) / 10]; });
  const over = g.over;
  return {
    mode: g.mode, level: g.level, tier: g.tier, player: g.player, start_fen: g.startFen, ucis: g.ucis.slice(),
    white: white || (g.player === WHITE ? "You" : bot), black: black || (g.player === BLACK ? "You" : bot),
    result: over ? RESULT_TAG[over.winner] : "*", note: over ? over.text : "",
    tc: g.tc ? g.tc[0] + "+" + g.tc[1] : "", started: g.started, ratings,
  };
}
const _clean = s => String(s).replace(/"/g, "'").replace(/\n/g, " ");
function _pad(n) { return String(n).padStart(2, "0"); }
function recordToPgn(rec) {
  const bd = new Board(rec.start_fen || START_FEN);
  let num = bd.full, whiteToMove = bd.turn === WHITE, first = true;
  const parts = [];
  rec.ucis.forEach((u, i) => {
    const m = bd.parseUci(u);
    if (whiteToMove) parts.push(num + ".");
    else if (first) parts.push(num + "...");
    first = false;
    parts.push(bd.san(m));
    const r = (rec.ratings || {})[String(i)];
    if (r) parts.push("{[%sb " + r[0] + " " + r[1] + "]}");
    bd.make(m);
    if (!whiteToMove) num++;
    whiteToMove = !whiteToMove;
  });
  parts.push(rec.result || "*");
  const d = new Date((rec.started || nowSec()) * 1000);
  const date = d.getFullYear() + "." + _pad(d.getMonth() + 1) + "." + _pad(d.getDate());
  const tags = [["Event", "Stonebot game"], ["Site", "Stonebot"], ["Date", date], ["Round", "-"], ["White", rec.white], ["Black", rec.black], ["Result", rec.result || "*"]];
  if (rec.start_fen) tags.push(["SetUp", "1"], ["FEN", rec.start_fen]);
  if (rec.tc) tags.push(["TimeControl", rec.tc]);
  if (rec.note) tags.push(["Termination", rec.note]);
  tags.push(["StonebotMode", rec.mode], ["StonebotLevel", String(rec.level)], ["StonebotTier", String(rec.tier)], ["StonebotPlayer", PLAYER_TAG[rec.player] || "white"]);
  for (const k of ["wlevel", "blevel"]) if (rec[k]) tags.push(["Stonebot" + (k === "wlevel" ? "White" : "Black") + "Level", String(rec[k])]);
  const head = tags.map(([k, v]) => "[" + k + ' "' + _clean(v) + '"]').join("\n");
  const lines = []; let cur = "";
  for (const p of parts) { if (cur.length + p.length + 1 > 78) { lines.push(cur); cur = p; } else cur = (cur + " " + p).trim(); }
  lines.push(cur);
  return head + "\n\n" + lines.join("\n") + "\n";
}
function _firstGame(text) { const i = text.indexOf("\n[Event ", 1); return i < 0 ? text : text.slice(0, i); }
function pgnParse(text0) {
  const text = _firstGame(text0.replace(/\r/g, ""));
  const tags = {};
  for (const m of text.matchAll(new RegExp(TAG_RE_SRC, "g"))) tags[m[1]] = m[2];
  const body = text.replace(new RegExp(TAG_RE_SRC, "g"), "");
  const fen = (tags.SetUp === undefined || tags.SetUp === "1") ? (tags.FEN || null) : null;
  let bd;
  try { bd = new Board(fen || START_FEN); } catch (e) { throw new Error("The starting position in this file is not valid."); }
  const ucis = [], ratings = {}; let depth = 0, result = tags.Result || "*";
  for (const tok of (body.match(new RegExp(TOKEN_RE_SRC, "g")) || [])) {
    const c = tok[0];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (depth || c === ";" || c === "$" || /^\d+\.+$/.test(tok)) continue;
    else if (c === "{") {
      const mm = /\[%sb (\w+) ([\d.]+)\]/.exec(tok);
      if (mm && ucis.length && LABELS[mm[1]]) ratings[String(ucis.length - 1)] = [mm[1], parseFloat(mm[2])];
    } else if (["1-0", "0-1", "1/2-1/2", "*"].includes(tok)) { result = tok; break; }
    else {
      const want = tok.replace("0-0-0", "O-O-O").replace("0-0", "O-O").replace(/[+#!?]+$/, "").replace(/=/g, "");
      let found = null;
      for (const m of bd.legal()) if (bd.san(m).replace(/[+#]+$/, "").replace(/=/g, "") === want) { found = m; break; }
      if (found === null) throw new Error("Move " + (ucis.length + 1) + " (" + tok + ") is not legal in this position.");
      ucis.push(uci(found)); bd.make(found);
    }
  }
  const num = (k, d) => { const v = parseInt(tags[k], 10); return isNaN(v) ? d : v; };
  const pl = { white: WHITE, black: BLACK, none: 0 }[tags.StonebotPlayer];
  const mode = tags.StonebotMode || "stonebot";
  let started = Date.parse((tags.Date || "").replace(/\./g, "-")); started = isNaN(started) ? nowSec() : started / 1000;
  return {
    mode: (mode === "stonebot" || mode === "rulecarve") ? mode : "stonebot", level: Math.max(1, Math.min(15, num("StonebotLevel", 5))),
    tier: Math.max(1, Math.min(7, num("StonebotTier", 1))), player: pl === undefined ? null : pl, start_fen: fen, ucis,
    white: tags.White || "?", black: tags.Black || "?", result, note: tags.Termination || "", tc: tags.TimeControl || "", ratings,
    wlevel: num("StonebotWhiteLevel", 0), blevel: num("StonebotBlackLevel", 0), started,
  };
}
function findMove(bd, u) {
  const f = nameSq(u.slice(0, 2)), t = nameSq(u.slice(2, 4));
  const promo = u.length > 4 && PROMO_FROM[u[4]] ? PROMO_FROM[u[4]] : 0;
  const moves = bd.legal();
  for (const m of moves) if ((m & 63) === f && ((m >> 6) & 63) === t && (!promo || (m >> 12) === promo)) return m;
  return null;
}
function gameFromRecord(rec, player) {
  const pl = player != null ? player : (rec.player ? rec.player : WHITE);
  const g = new Game(rec.mode, rec.level, rec.tier, pl);
  g.new(pl, rec.mode, rec.tier, rec.start_fen || null);
  rec.ucis.forEach((u, i) => {
    const m = findMove(g.bd, u);
    if (m === null) throw new Error("Move " + (i + 1) + " (" + u + ") is not legal in this position.");
    const mine = g.bd.turn === g.player, e = g.push(m, mine), r = (rec.ratings || {})[String(i)];
    if (r && mine && LABELS[r[0]]) e.rating = { label: r[0], text: LABELS[r[0]][0], color: LABELS[r[0]][1], loss: r[1], san: e.san, best_san: null, eval_after: null };
  });
  if (!g.over && ["1-0", "0-1", "1/2-1/2"].includes(rec.result)) g.over = { text: rec.note || "Game ended", winner: { "1-0": WHITE, "0-1": BLACK, "1/2-1/2": 0 }[rec.result] };
  return g;
}

// ---------- saved games (localStorage, with an in-memory fallback) ----------
const Store = {
  mem: {},
  _ls() { try { return window.localStorage; } catch (e) { return null; } },
  get(k) { try { const l = this._ls(); const v = l ? l.getItem(k) : this.mem[k]; return v == null ? null : v; } catch (e) { return this.mem[k] || null; } },
  set(k, v) { try { const l = this._ls(); if (l) l.setItem(k, v); else this.mem[k] = v; return true; } catch (e) { this.mem[k] = v; return false; } },
  del(k) { try { const l = this._ls(); if (l) l.removeItem(k); } catch (e) { } delete this.mem[k]; },
  keys() { try { const l = this._ls(); if (l) { const o = []; for (let i = 0; i < l.length; i++) o.push(l.key(i)); return o; } } catch (e) { } return Object.keys(this.mem); },
};
const GAME_PREFIX = "sb.game.";
function _slug(s) { return String(s).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 18) || "x"; }
function recordFilename(rec) {
  const d = new Date((rec.started || nowSec()) * 1000);
  const stamp = d.getFullYear() + "-" + _pad(d.getMonth() + 1) + "-" + _pad(d.getDate()) + "_" + _pad(d.getHours()) + _pad(d.getMinutes()) + _pad(d.getSeconds());
  return stamp + "_" + _slug(rec.white) + "_vs_" + _slug(rec.black) + ((rec.mode === "rulecarve" && rec.tier >= 2) ? ".sbg" : ".pgn");
}
function saveRecord(rec, name) {
  name = name || recordFilename(rec);
  Store.set(GAME_PREFIX + name, JSON.stringify({ saved: Date.now(), rec }));
  return name;
}
function loadRecord(name) {
  const t = Store.get(GAME_PREFIX + name);
  if (!t) throw new Error("That game is gone.");
  const rec = JSON.parse(t).rec;
  for (const [k, d] of [["start_fen", null], ["ratings", {}], ["note", ""], ["tc", ""], ["player", 1]]) if (rec[k] === undefined) rec[k] = d;
  return rec;
}
function deleteRecord(name) { Store.del(GAME_PREFIX + name); }
function listSaved() {
  const out = [];
  for (const k of Store.keys()) {
    if (!k.startsWith(GAME_PREFIX)) continue;
    try {
      const w = JSON.parse(Store.get(k)), r = w.rec;
      out.push({ name: k.slice(GAME_PREFIX.length), white: r.white, black: r.black, result: r.result, moves: r.ucis.length, tc: r.tc || "",
        custom: !!r.start_fen, mode: r.mode, tier: r.tier, mtime: w.saved });
    } catch (e) { }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}
