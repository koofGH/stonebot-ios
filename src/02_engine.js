// ==========================================================================
// engine.js - Stonebot's brain: evaluation, alpha-beta search, 15 levels, opening book, move rating.
// ==========================================================================
const INF = 1000000, MATE = 100000;
const VAL = [0, 100, 320, 330, 500, 900, 0];       // indexed by piece type
const PHASE = [0, 0, 1, 1, 2, 4, 0];
const _PST_ROWS = {
  1: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  2: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  3: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  4: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  5: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
};
const KING_MG = [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20];
const KING_EG = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30,
  -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];
// PST_W[type][sq] / PST_B[type][sq] include the piece value.
const PST_W = [null], PST_B = [null];
const KMG_W = new Int32Array(64), KEG_W = new Int32Array(64), KMG_B = new Int32Array(64), KEG_B = new Int32Array(64);
for (let t = 1; t <= 5; t++) {
  PST_W.push(new Int32Array(64)); PST_B.push(new Int32Array(64));
  for (let s = 0; s < 64; s++) {
    const r = s >> 3, f = s & 7;
    PST_W[t][s] = VAL[t] + _PST_ROWS[t][(7 - r) * 8 + f];
    PST_B[t][s] = VAL[t] + _PST_ROWS[t][r * 8 + f];
  }
}
for (let s = 0; s < 64; s++) {
  const r = s >> 3, f = s & 7;
  KMG_W[s] = KING_MG[(7 - r) * 8 + f]; KEG_W[s] = KING_EG[(7 - r) * 8 + f];
  KMG_B[s] = KING_MG[r * 8 + f]; KEG_B[s] = KING_EG[r * 8 + f];
}
PST_W.push(null); PST_B.push(null);   // index 6 (king) unused

function evaluate(bd) {   // centipawns from the side to move's point of view
  const b = bd.b;
  let score = 0, phase = 0, kmg = 0, keg = 0, wb = 0, bb = 0;
  for (let s = 0; s < 64; s++) {
    const p = b[s];
    if (!p) continue;
    if (p > 0) {
      if (p === K) { kmg += KMG_W[s]; keg += KEG_W[s]; }
      else { score += PST_W[p][s]; phase += PHASE[p]; if (p === B) wb++; }
    } else if (p === -K) { kmg -= KMG_B[s]; keg -= KEG_B[s]; }
    else { score -= PST_B[-p][s]; phase += PHASE[-p]; if (p === -B) bb++; }
  }
  if (wb >= 2) score += 30;
  if (bb >= 2) score -= 30;
  if (phase > 24) phase = 24;
  score += Math.floor((kmg * phase + keg * (24 - phase)) / 24);
  return (bd.turn === WHITE ? score : -score) + 10;
}

class SearchTimeout { }
const _TIMEOUT = new SearchTimeout();
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

class Engine {
  constructor() {
    this.tt = new Map();
    this.killers = []; for (let i = 0; i < 64; i++) this.killers.push([0, 0]);
    this.history = new Int32Array(32768);
    this.nodes = 0; this.deadline = 0; this.bd = null;
  }
  reset() { this.tt.clear(); this.history.fill(0); }
  _timeUp() { return this.deadline && now() > this.deadline; }

  _order(moves, ttmove, ply) {
    const b = this.bd.b, k = this.killers[ply];
    const scored = new Array(moves.length);
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i], f = m & 63, t = (m >> 6) & 63;
      let sc;
      if (m === ttmove) sc = 10000000;
      else {
        const v = b[t];
        if (v) sc = 100000 + 10 * VAL[Math.abs(v)] - Math.floor(VAL[Math.abs(b[f])] / 10);
        else if (m >> 12) sc = 100800;
        else if (m === k[0]) sc = 9000;
        else if (m === k[1]) sc = 8000;
        else sc = this.history[m];
      }
      scored[i] = [sc, m];
    }
    scored.sort((a, c) => c[0] - a[0]);
    return scored.map(x => x[1]);
  }

  _quiesce(alpha, beta, ply) {
    this.nodes++;
    if (!(this.nodes & 1023) && this._timeUp()) throw _TIMEOUT;
    const bd = this.bd;
    const stand = evaluate(bd);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    const ms = this._order(bd.pseudo(true), 0, ply < 63 ? ply : 63);
    for (let i = 0; i < ms.length; i++) {
      bd.make(ms[i]);
      if (bd.attacked(bd.king[-bd.turn], bd.turn)) { bd.undo(); continue; }
      const sc = -this._quiesce(-beta, -alpha, ply + 1);
      bd.undo();
      if (sc >= beta) return sc;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  }

  _hasPieces() {
    const us = this.bd.turn, b = this.bd.b;
    for (let i = 0; i < 64; i++) { const p = b[i]; if (p * us > 0) { const a = Math.abs(p); if (a === N || a === B || a === R || a === Q) return true; } }
    return false;
  }

  _negamax(d, alpha, beta, ply) {
    this.nodes++;
    if (!(this.nodes & 1023) && this._timeUp()) throw _TIMEOUT;
    const bd = this.bd;
    if (ply > 0 && (bd.half >= 100 || bd.isRepetition(2))) return 0;
    const inCheck = bd.inCheck();
    if (inCheck) d++;
    if (d <= 0 || ply >= 60) return this._quiesce(alpha, beta, ply);
    const key = bd.key();
    let ttmove = 0;
    const ent = this.tt.get(key);
    if (ent) {
      const ed = ent[0], flag = ent[1]; let esc = ent[2]; ttmove = ent[3];
      if (esc > MATE - 1000) esc -= ply; else if (esc < -MATE + 1000) esc += ply;
      if (ed >= d && ply > 0) {
        if (flag === 0) return esc;
        if (flag === 1 && esc >= beta) return esc;
        if (flag === 2 && esc <= alpha) return esc;
      }
    }
    // null-move pruning
    if (!inCheck && d >= 3 && ply > 0 && beta < MATE - 1000 && this._hasPieces()) {
      const ep = bd.ep, h1 = bd.h1, h2 = bd.h2;
      bd.turn = -bd.turn;
      bd.h1 = h1 ^ ZS1 ^ (ep >= 0 ? ZE1[ep & 7] : 0); bd.h2 = h2 ^ ZS2 ^ (ep >= 0 ? ZE2[ep & 7] : 0);
      bd.ep = -1;
      bd.hist.push(bd.key());
      let sc;
      try { sc = -this._negamax(d - 3, -beta, -beta + 1, ply + 1); }
      finally { bd.hist.pop(); bd.ep = ep; bd.h1 = h1; bd.h2 = h2; bd.turn = -bd.turn; }
      if (sc >= beta) return beta;
    }
    let best = -INF, bestmove = 0, legal = 0;
    const origAlpha = alpha;
    const ms = this._order(bd.pseudo(), ttmove, ply);
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      bd.make(m);
      if (bd.attacked(bd.king[-bd.turn], bd.turn)) { bd.undo(); continue; }
      legal++;
      let sc;
      if (legal === 1) sc = -this._negamax(d - 1, -beta, -alpha, ply + 1);
      else {
        sc = -this._negamax(d - 1, -alpha - 1, -alpha, ply + 1);
        if (sc > alpha && sc < beta) sc = -this._negamax(d - 1, -beta, -alpha, ply + 1);
      }
      const quiet = !bd.stack[bd.stack.length - 1][1] && !(m >> 12);
      bd.undo();
      if (sc > best) {
        best = sc; bestmove = m;
        if (sc > alpha) {
          alpha = sc;
          if (alpha >= beta) {
            if (quiet) {
              const kl = this.killers[ply];
              if (kl[0] !== m) { kl[1] = kl[0]; kl[0] = m; }
              this.history[m] += d * d;
            }
            break;
          }
        }
      }
    }
    if (legal === 0) return inCheck ? -(MATE - ply) : 0;
    const flag = (origAlpha < best && best < beta) ? 0 : (best >= beta ? 1 : 2);
    let store = best;
    if (store > MATE - 1000) store += ply; else if (store < -MATE + 1000) store -= ply;
    if (this.tt.size > 400000) this.tt.clear();
    this.tt.set(key, [d, flag, store, bestmove]);
    return best;
  }

  // Score every legal move at a fixed depth (full window each). Returns [[move, cp]] best first (cp for the mover).
  scoreRootMoves(bd, depth, seconds) {
    this.bd = bd; this.nodes = 0;
    this.deadline = seconds ? now() + seconds * 1000 : 0;
    const out = [];
    const ent = this.tt.get(bd.key());
    const ttm = ent ? ent[3] : 0;
    try {
      const ms = this._order(bd.legal(), ttm, 0);
      for (const m of ms) {
        bd.make(m);
        let sc;
        try { sc = -this._negamax(depth - 1, -INF, INF, 1); } finally { bd.undo(); }
        out.push([m, sc]);
      }
    } catch (e) { if (e !== _TIMEOUT) throw e; }
    this.deadline = 0;
    out.sort((a, c) => c[1] - a[1]);
    return out;
  }

  // Iterative deepening. Returns {move, score, depth}.
  search(bd, maxDepth, seconds) {
    this.bd = bd; this.nodes = 0;
    this.deadline = seconds ? now() + seconds * 1000 : 0;
    const legal = bd.legal();
    if (!legal.length) return { move: 0, score: 0, depth: 0 };
    let best = legal[0], bscore = 0, depthDone = 0;
    try {
      for (let d = 1; d <= maxDepth; d++) {
        let alpha = -INF; const beta = INF;
        let curBest = 0, curScore = -INF;
        for (const m of this._order(legal, best, 0)) {
          bd.make(m);
          let sc;
          try {
            if (curBest === 0) sc = -this._negamax(d - 1, -beta, -alpha, 1);
            else {
              sc = -this._negamax(d - 1, -alpha - 1, -alpha, 1);
              if (sc > alpha) sc = -this._negamax(d - 1, -beta, -alpha, 1);
            }
          } finally { bd.undo(); }
          if (sc > curScore) { curBest = m; curScore = sc; alpha = Math.max(alpha, sc); }
        }
        best = curBest; bscore = curScore; depthDone = d;
        if (Math.abs(bscore) > MATE - 1000) break;
      }
    } catch (e) { if (e !== _TIMEOUT) throw e; }
    this.deadline = 0;
    return { move: best, score: bscore, depth: depthDone };
  }
}

// level: [max depth, seconds per move, noise in centipawns, chance of a random move]
const LEVELS = {
  1: [1, 0.2, 400, 0.40], 2: [1, 0.2, 280, 0.25], 3: [2, 0.4, 200, 0.12], 4: [2, 0.4, 130, 0.06],
  5: [2, 0.5, 80, 0.0], 6: [3, 0.8, 60, 0.0], 7: [3, 1.0, 40, 0.0], 8: [3, 1.2, 20, 0.0],
  9: [4, 1.5, 12, 0.0], 10: [4, 2.0, 0, 0.0], 11: [5, 2.5, 0, 0.0], 12: [5, 3.5, 0, 0.0],
  13: [6, 4.5, 0, 0.0], 14: [8, 6.0, 0, 0.0], 15: [12, 9.0, 0, 0.0],
};
const LEVEL_NAMES = { 1: "Pebble", 2: "Gravel", 3: "Cobble", 4: "Flint", 5: "Slate", 6: "Sandstone", 7: "Limestone",
  8: "Granite", 9: "Basalt", 10: "Obsidian", 11: "Quartz", 12: "Jasper", 13: "Onyx", 14: "Sapphire", 15: "Diamond" };

const BOOK_LINES = `
e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6 c2c3 e8g8
e2e4 e7e5 g1f3 b8c6 f1b5 g8f6 e1g1 f6e4 d2d4 e4d6 b5c6 d7c6 d4e5 d6f5
e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6 e1g1 e8g8
e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3 f8c5 c2c3 d7d6
e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 g8f6 d4c6 b7c6 e4e5 d8e7
e2e4 e7e5 g1f3 g8f6 f3e5 d7d6 e5f3 f6e4 d2d4 d6d5 f1d3 f8e7
e2e4 e7e5 f2f4 e5f4 g1f3 g7g5 h2h4 g5g4 f3e5
e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3 e7e5 d4b3 c8e6
e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g8f6 b1c3 d7d6 c1g5 e7e6 d1d2 a7a6
e2e4 c7c5 g1f3 e7e6 d2d4 c5d4 f3d4 a7a6 f1d3 g8f6 e1g1 d8c7
e2e4 c7c5 b1c3 b8c6 g2g3 g7g6 f1g2 f8g7 d2d3 d7d6
e2e4 c7c5 c2c3 d7d5 e4d5 d8d5 d2d4 g8f6 g1f3 c8g4
e2e4 e7e6 d2d4 d7d5 b1c3 g8f6 c1g5 f8e7 e4e5 f6d7 g5e7 d8e7
e2e4 e7e6 d2d4 d7d5 b1c3 f8b4 e4e5 c7c5 a2a3 b4c3 b2c3 g8e7
e2e4 e7e6 d2d4 d7d5 e4e5 c7c5 c2c3 b8c6 g1f3 d8b6 a2a3 c5c4
e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5 e4g3 f5g6 h2h4 h7h6 g1f3 b8d7
e2e4 c7c6 d2d4 d7d5 e4e5 c8f5 g1f3 e7e6 f1e2 c6c5 e1g1 b8c6
e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 d2d4 g8f6 g1f3 c7c6 f1c4 c8f5
e2e4 d7d6 d2d4 g8f6 b1c3 g7g6 f2f4 f8g7 g1f3 e8g8
e2e4 g7g6 d2d4 f8g7 b1c3 d7d6 f2f4 g8f6 g1f3 e8g8
d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8 g1f3 b8d7
d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 g1f3 f8e7 c1f4 e8g8 e2e3 c7c5
d2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 d5c4 a2a4 c8f5 e2e3 e7e6
d2d4 d7d5 c2c4 d5c4 g1f3 g8f6 e2e3 e7e6 f1c4 c7c5 e1g1 a7a6
d2d4 d7d5 g1f3 g8f6 c1f4 e7e6 e2e3 c7c5 c2c3 b8c6 b1d2 f8d6
d2d4 d7d5 c2c4 e7e5 d4e5 d5d4 g1f3 b8c6 g2g3 c8e6
d2d4 g8f6 c2c4 e7e6 b1c3 f8b4 e2e3 e8g8 f1d3 d7d5 g1f3 c7c5 e1g1 b8c6
d2d4 g8f6 c2c4 e7e6 g1f3 b7b6 g2g3 c8b7 f1g2 f8e7 e1g1 e8g8 b1c3 f6e4
d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8 f1e2 e7e5 e1g1 b8c6
d2d4 g8f6 c2c4 g7g6 b1c3 d7d5 c4d5 f6d5 e2e4 d5c3 b2c3 f8g7 g1f3 c7c5
d2d4 g8f6 g1f3 e7e6 c2c4 d7d5 b1c3 f8e7 c1g5 e8g8 e2e3 h7h6 g5h4 b7b6
d2d4 g8f6 c2c4 e7e6 b1c3 d7d5 c4d5 e6d5 c1g5 c7e7 e2e3 c8e6
c2c4 e7e5 b1c3 g8f6 g1f3 b8c6 g2g3 d7d5 c4d5 f6d5 f1g2 d5b6 e1g1 f8e7
c2c4 g8f6 b1c3 e7e6 e2e4 d7d5 e4e5 d5d4 e5f6 d4c3 b2c3 d8f6
c2c4 c7c5 g1f3 g8f6 b1c3 b8c6 g2g3 g7g6 f1g2 f8g7 e1g1 e8g8
c2c4 e7e6 g1f3 d7d5 g2g3 g8f6 f1g2 f8e7 e1g1 e8g8 d2d4 d5c4
g1f3 d7d5 g2g3 g8f6 f1g2 e7e6 e1g1 f8e7 d2d3 e8g8 b1d2 c7c5
g1f3 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 d2d4 e8g8 f1e2 e7e5
g1f3 d7d5 d2d4 g8f6 c2c4 e7e6 b1c3 f8e7 c1g5 e8g8
g1f3 c7c5 c2c4 g8f6 b1c3 e7e6 g2g3 b7b6 f1g2 c8b7 e1g1 f8e7
f2f4 d7d5 g1f3 g8f6 e2e3 g7g6 f1e2 f8g7 e1g1 e8g8 d2d3
b2b3 e7e5 c1b2 b8c6 e2e3 d7d5 f1b5 f8d6 f2f4 d8e7
`;
const BOOK = BOOK_LINES.trim().split("\n").map(l => l.trim().split(/\s+/));
function _prefix(l, a, n) { for (let i = 0; i < n; i++) if (l[i] !== a[i]) return false; return true; }
function inBook(ucis) { const n = ucis.length; return n > 0 && BOOK.some(l => l.length >= n && _prefix(l, ucis, n)); }
function bookMove(ucis) {
  const n = ucis.length, opts = BOOK.filter(l => l.length > n && _prefix(l, ucis, n)).map(l => l[n]);
  return opts.length ? opts[Math.floor(Math.random() * opts.length)] : null;
}

class Stonebot {
  constructor(level) { this.level = level || 5; this.engine = new Engine(); }
  setLevel(l) { this.level = Math.max(1, Math.min(15, l)); }
  // Returns {move, info}. timeCap (seconds) shortens thinking when the bot is short on the clock.
  chooseMove(bd, ucis, timeCap) {
    const level = this.level;
    let [depth, secs, noise, blunder] = LEVELS[level];
    if (timeCap != null) secs = Math.max(0.05, Math.min(secs, timeCap));
    const legal = bd.legal();
    if (!legal.length) return { move: 0, info: "" };
    if (level >= 3) {
      const bm = bookMove(ucis);
      if (bm) { const m = bd.parseUci(bm); if (legal.includes(m)) return { move: m, info: "book" }; }
    }
    if (Math.random() < blunder) return { move: legal[Math.floor(Math.random() * legal.length)], info: "random" };
    if (noise) {
      const scored = this.engine.scoreRootMoves(bd, depth, secs);
      if (!scored.length) return { move: legal[Math.floor(Math.random() * legal.length)], info: "random" };
      let pick = scored[0], pv = -Infinity;
      for (const s of scored) { const v = s[1] + (Math.random() * 2 - 1) * noise; if (v > pv) { pv = v; pick = s; } }
      return { move: pick[0], info: "depth " + depth };
    }
    const r = this.engine.search(bd, depth, secs);
    return { move: r.move || legal[0], info: "depth " + r.depth };
  }
}

// ---------- move rating ----------
const LABELS = {
  brilliant: ["Brilliant!!", "#26c2a3"], great: ["Great move!", "#5c8bb0"], best: ["Best move", "#96bc4b"],
  excellent: ["Excellent", "#96bc4b"], good: ["Good", "#a3b18a"], book: ["Book move", "#a88865"],
  inaccuracy: ["Inaccuracy", "#f7c631"], mistake: ["Mistake", "#e58f2a"], blunder: ["Blunder", "#ca3431"],
};
function winPct(cp) { cp = Math.max(-1500, Math.min(1500, cp)); return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1); }
function accuracyOf(loss) { return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669)); }

function _matStatic(bd) { let m = 0; for (let i = 0; i < 64; i++) { const p = bd.b[i]; if (p > 0) m += VAL[p]; else if (p < 0) m -= VAL[-p]; } return bd.turn === WHITE ? m : -m; }
function _qmat(bd, alpha, beta, depth) {
  const stand = _matStatic(bd);
  if (stand >= beta || depth > 6) return stand;
  alpha = Math.max(alpha, stand);
  for (const m of bd.pseudo(true)) {
    bd.make(m);
    if (bd.attacked(bd.king[-bd.turn], bd.turn)) { bd.undo(); continue; }
    const sc = -_qmat(bd, -beta, -alpha, depth + 1);
    bd.undo();
    if (sc >= beta) return sc;
    alpha = Math.max(alpha, sc);
  }
  return alpha;
}
function _materialAfter(bd, m) { bd.make(m); const v = -_qmat(bd, -INF, INF, 0); bd.undo(); return v; }

function ratingResult(label, loss, san, bestSan, playedCp) {
  return { label, text: LABELS[label][0], color: LABELS[label][1], loss, san, best_san: bestSan, eval_after: playedCp };
}

class Rater {
  constructor(engine, depth) { this.engine = engine || new Engine(); this.depth = depth || 3; }
  // Rate move m played in position bd (before the move); ucisBefore = game so far (UCI strings).
  rate(bd, m, ucisBefore) {
    const san = bd.san(m);
    if (inBook(ucisBefore.concat([uci(m)]))) return ratingResult("book", 0, san, null, null);
    const scored = this.engine.scoreRootMoves(bd, this.depth, 6.0);
    if (!scored.length) return ratingResult("good", 0, san, null, null);
    const [bestM, bestCp] = scored[0];
    const hit = scored.find(s => s[0] === m);
    let playedCp;
    if (hit) playedCp = hit[1];
    else {
      bd.make(m);
      const lg = bd.legal();
      playedCp = lg.length ? -this.engine.scoreRootMoves(bd, Math.max(1, this.depth - 1), 2.0)[0][1] : (bd.inCheck() ? MATE : 0);
      bd.undo();
    }
    const loss = Math.max(0, winPct(bestCp) - winPct(playedCp));
    const secondCp = scored.length > 1 ? scored[1][1] : null;
    const bestSan = bestM !== m ? bd.san(bestM) : null;
    let label;
    if (bestM === m || playedCp >= bestCp - 5) label = "best";
    else if (loss <= 2) label = "excellent";
    else if (loss <= 5) label = "good";
    else if (loss <= 10) label = "inaccuracy";
    else if (loss <= 15) label = "mistake";
    else label = "blunder";
    const afterWin = winPct(playedCp), beforeWin = winPct(bestCp);
    if (label === "best" && secondCp !== null && scored.length > 2) {
      if (winPct(bestCp) - winPct(secondCp) >= 15 && beforeWin < 92 && afterWin > 25) label = "great";
    }
    if (["best", "excellent", "great"].includes(label) && loss <= 2 && afterWin >= 45 && beforeWin < 92) {
      if (_matStatic(bd) - _materialAfter(bd, m) >= 200) label = "brilliant";
    }
    const r = ratingResult(label, loss, san, bestSan, playedCp);
    r.best_move = bestM !== m ? bestM : null;
    return r;
  }
}
