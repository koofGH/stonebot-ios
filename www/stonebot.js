
// ----- 01_board.js -----
// ==========================================================================
// board.js - chess rules: board, move generation, make/undo. (Port of core.py's Board.)
// Squares are 0..63 (rank*8+file), pieces are signed ints (white +, black -).
// Moves are ints:  from | to<<6 | promo<<12
// ==========================================================================
const WHITE = 1, BLACK = -1;
const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
const FILES = "abcdefgh";
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const PROMO_CHAR = { 2: "n", 3: "b", 4: "r", 5: "q" };
const PROMO_FROM = { n: 2, b: 3, r: 4, q: 5 };
const LETTER = { 2: "N", 3: "B", 4: "R", 5: "Q", 6: "K" };

function sqName(s) { return FILES[s & 7] + String((s >> 3) + 1); }
function nameSq(n) { return (parseInt(n[1], 10) - 1) * 8 + FILES.indexOf(n[0]); }
function mk(f, t, promo) { return f | (t << 6) | ((promo || 0) << 12); }
function uci(m) {
  let s = sqName(m & 63) + sqName((m >> 6) & 63);
  if (m >> 12) s += PROMO_CHAR[m >> 12];
  return s;
}

const KNIGHT = [], KING = [], ROOK_RAYS = [], BISHOP_RAYS = [];
(function () {
  const ok = (r, f) => r >= 0 && r < 8 && f >= 0 && f < 8;
  for (let s = 0; s < 64; s++) {
    const r = s >> 3, f = s & 7;
    KNIGHT.push([]); KING.push([]); ROOK_RAYS.push([]); BISHOP_RAYS.push([]);
    for (const [dr, df] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]])
      if (ok(r + dr, f + df)) KNIGHT[s].push((r + dr) * 8 + f + df);
    for (let dr = -1; dr <= 1; dr++) for (let df = -1; df <= 1; df++)
      if ((dr || df) && ok(r + dr, f + df)) KING[s].push((r + dr) * 8 + f + df);
    for (const [dr, df] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ray = []; let rr = r + dr, ff = f + df;
      while (ok(rr, ff)) { ray.push(rr * 8 + ff); rr += dr; ff += df; }
      ROOK_RAYS[s].push(ray);
    }
    for (const [dr, df] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ray = []; let rr = r + dr, ff = f + df;
      while (ok(rr, ff)) { ray.push(rr * 8 + ff); rr += dr; ff += df; }
      BISHOP_RAYS[s].push(ray);
    }
  }
})();

// Zobrist keys: two 32-bit halves per key (the position key keeps 21 + 32 = 53 bits so it fits a JS number).
let _seed = 20261028;
function _rnd32() { _seed = (Math.imul(_seed, 1664525) + 1013904223) | 0; let x = _seed; x ^= x >>> 15; x = Math.imul(x, 2246822519); x ^= x >>> 13; return x | 0; }
const ZP1 = [], ZP2 = [];
for (let i = 0; i < 13; i++) { ZP1.push(new Int32Array(64)); ZP2.push(new Int32Array(64)); for (let s = 0; s < 64; s++) { ZP1[i][s] = _rnd32(); ZP2[i][s] = _rnd32(); } }
const ZS1 = _rnd32(), ZS2 = _rnd32();
const ZC1 = new Int32Array(16), ZC2 = new Int32Array(16), ZE1 = new Int32Array(8), ZE2 = new Int32Array(8);
for (let i = 0; i < 16; i++) { ZC1[i] = _rnd32(); ZC2[i] = _rnd32(); }
for (let i = 0; i < 8; i++) { ZE1[i] = _rnd32(); ZE2[i] = _rnd32(); }
function hashKey(h1, h2) { return (h1 & 0x1FFFFF) * 4294967296 + (h2 >>> 0); }

const CASTLE_MASK = new Int8Array(64).fill(15);
CASTLE_MASK[0] = 15 & ~2; CASTLE_MASK[4] = 15 & ~3; CASTLE_MASK[7] = 15 & ~1;
CASTLE_MASK[56] = 15 & ~8; CASTLE_MASK[60] = 15 & ~12; CASTLE_MASK[63] = 15 & ~4;

class Board {
  constructor(fen) { this.setFen(fen || START_FEN); }

  setFen(fen) {
    const parts = fen.trim().split(/\s+/);
    this.b = new Int8Array(64);
    let r = 7, f = 0;
    for (const ch of parts[0]) {
      if (ch === "/") { r--; f = 0; }
      else if (ch >= "0" && ch <= "9") f += parseInt(ch, 10);
      else {
        const t = "pnbrqk".indexOf(ch.toLowerCase()) + 1;
        if (t <= 0 || r < 0 || f > 7) throw new Error("bad FEN");
        this.b[r * 8 + f] = ch === ch.toUpperCase() ? t : -t;
        f++;
      }
    }
    this.turn = parts[1] === "w" ? WHITE : BLACK;
    const c = parts[2] || "-";
    this.castle = (c.includes("K") ? 1 : 0) | (c.includes("Q") ? 2 : 0) | (c.includes("k") ? 4 : 0) | (c.includes("q") ? 8 : 0);
    this.ep = !parts[3] || parts[3] === "-" ? -1 : nameSq(parts[3]);
    this.half = parts.length > 4 ? parseInt(parts[4], 10) || 0 : 0;
    this.full = parts.length > 5 ? parseInt(parts[5], 10) || 1 : 1;
    const wk = this.b.indexOf(K), bk = this.b.indexOf(-K);
    if (wk < 0 || bk < 0) throw new Error("bad FEN: missing king");
    this.king = { 1: wk, "-1": bk };
    this.stack = [];
    this._hash();
    this.hist = [this.key()];
  }

  _hash() {
    let h1 = ZC1[this.castle], h2 = ZC2[this.castle];
    if (this.turn === BLACK) { h1 ^= ZS1; h2 ^= ZS2; }
    if (this.ep >= 0) { h1 ^= ZE1[this.ep & 7]; h2 ^= ZE2[this.ep & 7]; }
    for (let s = 0; s < 64; s++) if (this.b[s]) { h1 ^= ZP1[this.b[s] + 6][s]; h2 ^= ZP2[this.b[s] + 6][s]; }
    this.h1 = h1; this.h2 = h2;
  }
  key() { return hashKey(this.h1, this.h2); }

  copy() { const c = new Board(this.fen()); c.hist = this.hist.slice(); return c; }

  fen() {
    const rows = [];
    for (let r = 7; r >= 0; r--) {
      let row = "", empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.b[r * 8 + f];
        if (!p) empty++;
        else {
          if (empty) { row += empty; empty = 0; }
          const ch = "pnbrqk"[Math.abs(p) - 1];
          row += p > 0 ? ch.toUpperCase() : ch;
        }
      }
      if (empty) row += empty;
      rows.push(row);
    }
    const c = (this.castle & 1 ? "K" : "") + (this.castle & 2 ? "Q" : "") + (this.castle & 4 ? "k" : "") + (this.castle & 8 ? "q" : "");
    return rows.join("/") + " " + (this.turn === WHITE ? "w" : "b") + " " + (c || "-") + " " + (this.ep >= 0 ? sqName(this.ep) : "-") + " " + this.half + " " + this.full;
  }

  attacked(sq, by) {
    const b = this.b, f = sq & 7;
    if (by === WHITE) {
      if (sq > 7) { if (f > 0 && b[sq - 9] === P) return true; if (f < 7 && b[sq - 7] === P) return true; }
    } else if (sq < 56) { if (f > 0 && b[sq + 7] === -P) return true; if (f < 7 && b[sq + 9] === -P) return true; }
    const n = N * by;
    let a = KNIGHT[sq];
    for (let i = 0; i < a.length; i++) if (b[a[i]] === n) return true;
    const k = K * by;
    a = KING[sq];
    for (let i = 0; i < a.length; i++) if (b[a[i]] === k) return true;
    const rk = R * by, qn = Q * by, bs = B * by;
    let rays = ROOK_RAYS[sq];
    for (let i = 0; i < rays.length; i++) { const ray = rays[i]; for (let j = 0; j < ray.length; j++) { const p = b[ray[j]]; if (p) { if (p === rk || p === qn) return true; break; } } }
    rays = BISHOP_RAYS[sq];
    for (let i = 0; i < rays.length; i++) { const ray = rays[i]; for (let j = 0; j < ray.length; j++) { const p = b[ray[j]]; if (p) { if (p === bs || p === qn) return true; break; } } }
    return false;
  }

  inCheck() { return this.attacked(this.king[this.turn], -this.turn); }

  pseudo(capsOnly) {
    const b = this.b, us = this.turn, moves = [];
    for (let s = 0; s < 64; s++) {
      const p = b[s];
      if (p === 0 || (p > 0) !== (us > 0)) continue;
      const t = p > 0 ? p : -p;
      if (t === P) {
        const r = s >> 3, f = s & 7, prank = us === WHITE ? 7 : 0;
        let to = s + 8 * us;
        if (b[to] === 0) {
          if ((to >> 3) === prank) {
            if (capsOnly) moves.push(mk(s, to, Q)); else for (const pr of [Q, R, B, N]) moves.push(mk(s, to, pr));
          } else if (!capsOnly) {
            moves.push(mk(s, to));
            if (r === (us === WHITE ? 1 : 6) && b[to + 8 * us] === 0) moves.push(mk(s, to + 8 * us));
          }
        }
        for (const df of [-1, 1]) {
          const nf = f + df;
          if (nf >= 0 && nf < 8) {
            to = s + 8 * us + df;
            const q = b[to];
            if (q && (q > 0) !== (us > 0)) {
              if ((to >> 3) === prank) { if (capsOnly) moves.push(mk(s, to, Q)); else for (const pr of [Q, R, B, N]) moves.push(mk(s, to, pr)); }
              else moves.push(mk(s, to));
            } else if (to === this.ep) moves.push(mk(s, to));
          }
        }
      } else if (t === N || t === K) {
        const a = t === N ? KNIGHT[s] : KING[s];
        for (let i = 0; i < a.length; i++) {
          const to = a[i], q = b[to];
          if (q === 0) { if (!capsOnly) moves.push(mk(s, to)); }
          else if ((q > 0) !== (us > 0)) moves.push(mk(s, to));
        }
      } else {
        const sets = t === B ? [BISHOP_RAYS[s]] : t === R ? [ROOK_RAYS[s]] : [ROOK_RAYS[s], BISHOP_RAYS[s]];
        for (const rays of sets) for (let i = 0; i < rays.length; i++) {
          const ray = rays[i];
          for (let j = 0; j < ray.length; j++) {
            const to = ray[j], q = b[to];
            if (q === 0) { if (!capsOnly) moves.push(mk(s, to)); }
            else { if ((q > 0) !== (us > 0)) moves.push(mk(s, to)); break; }
          }
        }
      }
    }
    if (!capsOnly && this.castle) {
      if (us === WHITE) {
        if ((this.castle & 1) && b[5] === 0 && b[6] === 0 && !this.attacked(4, BLACK) && !this.attacked(5, BLACK) && !this.attacked(6, BLACK)) moves.push(mk(4, 6));
        if ((this.castle & 2) && b[1] === 0 && b[2] === 0 && b[3] === 0 && !this.attacked(4, BLACK) && !this.attacked(3, BLACK) && !this.attacked(2, BLACK)) moves.push(mk(4, 2));
      } else {
        if ((this.castle & 4) && b[61] === 0 && b[62] === 0 && !this.attacked(60, WHITE) && !this.attacked(61, WHITE) && !this.attacked(62, WHITE)) moves.push(mk(60, 62));
        if ((this.castle & 8) && b[57] === 0 && b[58] === 0 && b[59] === 0 && !this.attacked(60, WHITE) && !this.attacked(59, WHITE) && !this.attacked(58, WHITE)) moves.push(mk(60, 58));
      }
    }
    return moves;
  }

  legal() {
    const out = [], ps = this.pseudo();
    for (let i = 0; i < ps.length; i++) {
      this.make(ps[i]);
      if (!this.attacked(this.king[-this.turn], this.turn)) out.push(ps[i]);
      this.undo();
    }
    return out;
  }

  make(m) {
    const b = this.b, f = m & 63, t = (m >> 6) & 63, promo = m >> 12;
    const p = b[f], cap = b[t], us = this.turn;
    this.stack.push([m, cap, this.castle, this.ep, this.half, this.h1, this.h2]);
    let h1 = this.h1 ^ ZS1 ^ ZC1[this.castle], h2 = this.h2 ^ ZS2 ^ ZC2[this.castle];
    if (this.ep >= 0) { h1 ^= ZE1[this.ep & 7]; h2 ^= ZE2[this.ep & 7]; }
    const ap = p > 0 ? p : -p;
    h1 ^= ZP1[p + 6][f]; h2 ^= ZP2[p + 6][f];
    if (cap) { h1 ^= ZP1[cap + 6][t]; h2 ^= ZP2[cap + 6][t]; }
    b[f] = 0;
    const placed = promo ? promo * us : p;
    b[t] = placed;
    h1 ^= ZP1[placed + 6][t]; h2 ^= ZP2[placed + 6][t];
    if (ap === P && t === this.ep && (f & 7) !== (t & 7) && cap === 0) {
      const cs = t - 8 * us;
      h1 ^= ZP1[b[cs] + 6][cs]; h2 ^= ZP2[b[cs] + 6][cs];
      b[cs] = 0;
    } else if (ap === K) {
      this.king[us] = t;
      if (t - f === 2 || f - t === 2) {
        const rf = t > f ? f + 3 : f - 4, rt = t > f ? f + 1 : f - 1;
        const rook = b[rf];
        b[rf] = 0; b[rt] = rook;
        h1 ^= ZP1[rook + 6][rf] ^ ZP1[rook + 6][rt]; h2 ^= ZP2[rook + 6][rf] ^ ZP2[rook + 6][rt];
      }
    }
    this.ep = (ap === P && (t - f === 16 || f - t === 16)) ? (f + t) >> 1 : -1;
    this.castle &= CASTLE_MASK[f] & CASTLE_MASK[t];
    this.half = (ap === P || cap) ? 0 : this.half + 1;
    if (us === BLACK) this.full++;
    this.turn = -us;
    h1 ^= ZC1[this.castle]; h2 ^= ZC2[this.castle];
    if (this.ep >= 0) { h1 ^= ZE1[this.ep & 7]; h2 ^= ZE2[this.ep & 7]; }
    this.h1 = h1; this.h2 = h2;
    this.hist.push(hashKey(h1, h2));
  }

  undo() {
    const [m, cap, castle, ep, half, h1, h2] = this.stack.pop();
    this.hist.pop();
    const us = this.turn = -this.turn, b = this.b;
    const f = m & 63, t = (m >> 6) & 63, promo = m >> 12;
    const p = promo ? P * us : b[t];
    b[f] = p; b[t] = cap;
    const ap = p > 0 ? p : -p;
    if (ap === P && t === ep && (f & 7) !== (t & 7) && cap === 0) b[t - 8 * us] = -P * us;
    else if (ap === K) {
      this.king[us] = f;
      if (t - f === 2 || f - t === 2) {
        const rf = t > f ? f + 3 : f - 4, rt = t > f ? f + 1 : f - 1;
        b[rf] = b[rt]; b[rt] = 0;
      }
    }
    this.castle = castle; this.ep = ep; this.half = half; this.h1 = h1; this.h2 = h2;
    if (us === BLACK) this.full--;
  }

  isCapture(m) { const f = m & 63, t = (m >> 6) & 63; return this.b[t] !== 0 || (Math.abs(this.b[f]) === P && (f & 7) !== (t & 7)); }

  isRepetition(times) {
    times = times || 3;
    const h = this.key(), n = this.hist.length;
    let cnt = 1;
    for (let i = n - 3; i > Math.max(n - 2 - this.half, -1); i -= 2) {
      if (i >= 0 && this.hist[i] === h) { cnt++; if (cnt >= times) return true; }
    }
    return false;
  }

  insufficient() {
    let minors = 0;
    for (let i = 0; i < 64; i++) { const a = Math.abs(this.b[i]); if (a === P || a === R || a === Q) return false; if (a === N || a === B) minors++; }
    return minors <= 1;
  }

  // null while the game is on, else {text, winner} (winner 1 / -1 / 0)
  result() {
    if (!this.legal().length) return this.inCheck() ? { text: "Checkmate", winner: -this.turn } : { text: "Stalemate", winner: 0 };
    if (this.half >= 100) return { text: "Draw by 50-move rule", winner: 0 };
    if (this.isRepetition(3)) return { text: "Draw by repetition", winner: 0 };
    if (this.insufficient()) return { text: "Draw: insufficient material", winner: 0 };
    return null;
  }

  parseUci(s) { return mk(nameSq(s.slice(0, 2)), nameSq(s.slice(2, 4)), s.length > 4 ? PROMO_FROM[s[4]] : 0); }

  san(m) {
    const f = m & 63, t = (m >> 6) & 63, promo = m >> 12, p = Math.abs(this.b[f]);
    const cap = this.b[t] !== 0 || (p === P && t === this.ep && (f & 7) !== (t & 7));
    let s;
    if (p === K && Math.abs(t - f) === 2) s = t > f ? "O-O" : "O-O-O";
    else {
      s = "";
      if (p !== P) {
        s += LETTER[p];
        const others = this.legal().filter(o => o !== m && ((o >> 6) & 63) === t && Math.abs(this.b[o & 63]) === p).map(o => o & 63);
        if (others.length) {
          if (others.every(o => (o & 7) !== (f & 7))) s += FILES[f & 7];
          else if (others.every(o => (o >> 3) !== (f >> 3))) s += String((f >> 3) + 1);
          else s += sqName(f);
        }
      } else if (cap) s += FILES[f & 7];
      if (cap) s += "x";
      s += sqName(t);
      if (promo) s += "=" + LETTER[promo];
    }
    this.make(m);
    if (this.inCheck()) s += this.legal().length ? "+" : "#";
    this.undo();
    return s;
  }
}

function perft(bd, depth) {
  if (depth === 0) return 1;
  let n = 0;
  const ps = bd.pseudo();
  for (let i = 0; i < ps.length; i++) {
    bd.make(ps[i]);
    if (!bd.attacked(bd.king[-bd.turn], bd.turn)) n += perft(bd, depth - 1);
    bd.undo();
  }
  return n;
}


// ----- 02_engine.js -----
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


// ----- 04_game.js -----
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

const ENGINE_SRC = "\n// ----- 01_board.js -----\n// ==========================================================================\n// board.js - chess rules: board, move generation, make/undo. (Port of core.py's Board.)\n// Squares are 0..63 (rank*8+file), pieces are signed ints (white +, black -).\n// Moves are ints:  from | to<<6 | promo<<12\n// ==========================================================================\nconst WHITE = 1, BLACK = -1;\nconst P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;\nconst FILES = \"abcdefgh\";\nconst START_FEN = \"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1\";\nconst PROMO_CHAR = { 2: \"n\", 3: \"b\", 4: \"r\", 5: \"q\" };\nconst PROMO_FROM = { n: 2, b: 3, r: 4, q: 5 };\nconst LETTER = { 2: \"N\", 3: \"B\", 4: \"R\", 5: \"Q\", 6: \"K\" };\n\nfunction sqName(s) { return FILES[s & 7] + String((s >> 3) + 1); }\nfunction nameSq(n) { return (parseInt(n[1], 10) - 1) * 8 + FILES.indexOf(n[0]); }\nfunction mk(f, t, promo) { return f | (t << 6) | ((promo || 0) << 12); }\nfunction uci(m) {\n  let s = sqName(m & 63) + sqName((m >> 6) & 63);\n  if (m >> 12) s += PROMO_CHAR[m >> 12];\n  return s;\n}\n\nconst KNIGHT = [], KING = [], ROOK_RAYS = [], BISHOP_RAYS = [];\n(function () {\n  const ok = (r, f) => r >= 0 && r < 8 && f >= 0 && f < 8;\n  for (let s = 0; s < 64; s++) {\n    const r = s >> 3, f = s & 7;\n    KNIGHT.push([]); KING.push([]); ROOK_RAYS.push([]); BISHOP_RAYS.push([]);\n    for (const [dr, df] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]])\n      if (ok(r + dr, f + df)) KNIGHT[s].push((r + dr) * 8 + f + df);\n    for (let dr = -1; dr <= 1; dr++) for (let df = -1; df <= 1; df++)\n      if ((dr || df) && ok(r + dr, f + df)) KING[s].push((r + dr) * 8 + f + df);\n    for (const [dr, df] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {\n      const ray = []; let rr = r + dr, ff = f + df;\n      while (ok(rr, ff)) { ray.push(rr * 8 + ff); rr += dr; ff += df; }\n      ROOK_RAYS[s].push(ray);\n    }\n    for (const [dr, df] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {\n      const ray = []; let rr = r + dr, ff = f + df;\n      while (ok(rr, ff)) { ray.push(rr * 8 + ff); rr += dr; ff += df; }\n      BISHOP_RAYS[s].push(ray);\n    }\n  }\n})();\n\n// Zobrist keys: two 32-bit halves per key (the position key keeps 21 + 32 = 53 bits so it fits a JS number).\nlet _seed = 20261028;\nfunction _rnd32() { _seed = (Math.imul(_seed, 1664525) + 1013904223) | 0; let x = _seed; x ^= x >>> 15; x = Math.imul(x, 2246822519); x ^= x >>> 13; return x | 0; }\nconst ZP1 = [], ZP2 = [];\nfor (let i = 0; i < 13; i++) { ZP1.push(new Int32Array(64)); ZP2.push(new Int32Array(64)); for (let s = 0; s < 64; s++) { ZP1[i][s] = _rnd32(); ZP2[i][s] = _rnd32(); } }\nconst ZS1 = _rnd32(), ZS2 = _rnd32();\nconst ZC1 = new Int32Array(16), ZC2 = new Int32Array(16), ZE1 = new Int32Array(8), ZE2 = new Int32Array(8);\nfor (let i = 0; i < 16; i++) { ZC1[i] = _rnd32(); ZC2[i] = _rnd32(); }\nfor (let i = 0; i < 8; i++) { ZE1[i] = _rnd32(); ZE2[i] = _rnd32(); }\nfunction hashKey(h1, h2) { return (h1 & 0x1FFFFF) * 4294967296 + (h2 >>> 0); }\n\nconst CASTLE_MASK = new Int8Array(64).fill(15);\nCASTLE_MASK[0] = 15 & ~2; CASTLE_MASK[4] = 15 & ~3; CASTLE_MASK[7] = 15 & ~1;\nCASTLE_MASK[56] = 15 & ~8; CASTLE_MASK[60] = 15 & ~12; CASTLE_MASK[63] = 15 & ~4;\n\nclass Board {\n  constructor(fen) { this.setFen(fen || START_FEN); }\n\n  setFen(fen) {\n    const parts = fen.trim().split(/\\s+/);\n    this.b = new Int8Array(64);\n    let r = 7, f = 0;\n    for (const ch of parts[0]) {\n      if (ch === \"/\") { r--; f = 0; }\n      else if (ch >= \"0\" && ch <= \"9\") f += parseInt(ch, 10);\n      else {\n        const t = \"pnbrqk\".indexOf(ch.toLowerCase()) + 1;\n        if (t <= 0 || r < 0 || f > 7) throw new Error(\"bad FEN\");\n        this.b[r * 8 + f] = ch === ch.toUpperCase() ? t : -t;\n        f++;\n      }\n    }\n    this.turn = parts[1] === \"w\" ? WHITE : BLACK;\n    const c = parts[2] || \"-\";\n    this.castle = (c.includes(\"K\") ? 1 : 0) | (c.includes(\"Q\") ? 2 : 0) | (c.includes(\"k\") ? 4 : 0) | (c.includes(\"q\") ? 8 : 0);\n    this.ep = !parts[3] || parts[3] === \"-\" ? -1 : nameSq(parts[3]);\n    this.half = parts.length > 4 ? parseInt(parts[4], 10) || 0 : 0;\n    this.full = parts.length > 5 ? parseInt(parts[5], 10) || 1 : 1;\n    const wk = this.b.indexOf(K), bk = this.b.indexOf(-K);\n    if (wk < 0 || bk < 0) throw new Error(\"bad FEN: missing king\");\n    this.king = { 1: wk, \"-1\": bk };\n    this.stack = [];\n    this._hash();\n    this.hist = [this.key()];\n  }\n\n  _hash() {\n    let h1 = ZC1[this.castle], h2 = ZC2[this.castle];\n    if (this.turn === BLACK) { h1 ^= ZS1; h2 ^= ZS2; }\n    if (this.ep >= 0) { h1 ^= ZE1[this.ep & 7]; h2 ^= ZE2[this.ep & 7]; }\n    for (let s = 0; s < 64; s++) if (this.b[s]) { h1 ^= ZP1[this.b[s] + 6][s]; h2 ^= ZP2[this.b[s] + 6][s]; }\n    this.h1 = h1; this.h2 = h2;\n  }\n  key() { return hashKey(this.h1, this.h2); }\n\n  copy() { const c = new Board(this.fen()); c.hist = this.hist.slice(); return c; }\n\n  fen() {\n    const rows = [];\n    for (let r = 7; r >= 0; r--) {\n      let row = \"\", empty = 0;\n      for (let f = 0; f < 8; f++) {\n        const p = this.b[r * 8 + f];\n        if (!p) empty++;\n        else {\n          if (empty) { row += empty; empty = 0; }\n          const ch = \"pnbrqk\"[Math.abs(p) - 1];\n          row += p > 0 ? ch.toUpperCase() : ch;\n        }\n      }\n      if (empty) row += empty;\n      rows.push(row);\n    }\n    const c = (this.castle & 1 ? \"K\" : \"\") + (this.castle & 2 ? \"Q\" : \"\") + (this.castle & 4 ? \"k\" : \"\") + (this.castle & 8 ? \"q\" : \"\");\n    return rows.join(\"/\") + \" \" + (this.turn === WHITE ? \"w\" : \"b\") + \" \" + (c || \"-\") + \" \" + (this.ep >= 0 ? sqName(this.ep) : \"-\") + \" \" + this.half + \" \" + this.full;\n  }\n\n  attacked(sq, by) {\n    const b = this.b, f = sq & 7;\n    if (by === WHITE) {\n      if (sq > 7) { if (f > 0 && b[sq - 9] === P) return true; if (f < 7 && b[sq - 7] === P) return true; }\n    } else if (sq < 56) { if (f > 0 && b[sq + 7] === -P) return true; if (f < 7 && b[sq + 9] === -P) return true; }\n    const n = N * by;\n    let a = KNIGHT[sq];\n    for (let i = 0; i < a.length; i++) if (b[a[i]] === n) return true;\n    const k = K * by;\n    a = KING[sq];\n    for (let i = 0; i < a.length; i++) if (b[a[i]] === k) return true;\n    const rk = R * by, qn = Q * by, bs = B * by;\n    let rays = ROOK_RAYS[sq];\n    for (let i = 0; i < rays.length; i++) { const ray = rays[i]; for (let j = 0; j < ray.length; j++) { const p = b[ray[j]]; if (p) { if (p === rk || p === qn) return true; break; } } }\n    rays = BISHOP_RAYS[sq];\n    for (let i = 0; i < rays.length; i++) { const ray = rays[i]; for (let j = 0; j < ray.length; j++) { const p = b[ray[j]]; if (p) { if (p === bs || p === qn) return true; break; } } }\n    return false;\n  }\n\n  inCheck() { return this.attacked(this.king[this.turn], -this.turn); }\n\n  pseudo(capsOnly) {\n    const b = this.b, us = this.turn, moves = [];\n    for (let s = 0; s < 64; s++) {\n      const p = b[s];\n      if (p === 0 || (p > 0) !== (us > 0)) continue;\n      const t = p > 0 ? p : -p;\n      if (t === P) {\n        const r = s >> 3, f = s & 7, prank = us === WHITE ? 7 : 0;\n        let to = s + 8 * us;\n        if (b[to] === 0) {\n          if ((to >> 3) === prank) {\n            if (capsOnly) moves.push(mk(s, to, Q)); else for (const pr of [Q, R, B, N]) moves.push(mk(s, to, pr));\n          } else if (!capsOnly) {\n            moves.push(mk(s, to));\n            if (r === (us === WHITE ? 1 : 6) && b[to + 8 * us] === 0) moves.push(mk(s, to + 8 * us));\n          }\n        }\n        for (const df of [-1, 1]) {\n          const nf = f + df;\n          if (nf >= 0 && nf < 8) {\n            to = s + 8 * us + df;\n            const q = b[to];\n            if (q && (q > 0) !== (us > 0)) {\n              if ((to >> 3) === prank) { if (capsOnly) moves.push(mk(s, to, Q)); else for (const pr of [Q, R, B, N]) moves.push(mk(s, to, pr)); }\n              else moves.push(mk(s, to));\n            } else if (to === this.ep) moves.push(mk(s, to));\n          }\n        }\n      } else if (t === N || t === K) {\n        const a = t === N ? KNIGHT[s] : KING[s];\n        for (let i = 0; i < a.length; i++) {\n          const to = a[i], q = b[to];\n          if (q === 0) { if (!capsOnly) moves.push(mk(s, to)); }\n          else if ((q > 0) !== (us > 0)) moves.push(mk(s, to));\n        }\n      } else {\n        const sets = t === B ? [BISHOP_RAYS[s]] : t === R ? [ROOK_RAYS[s]] : [ROOK_RAYS[s], BISHOP_RAYS[s]];\n        for (const rays of sets) for (let i = 0; i < rays.length; i++) {\n          const ray = rays[i];\n          for (let j = 0; j < ray.length; j++) {\n            const to = ray[j], q = b[to];\n            if (q === 0) { if (!capsOnly) moves.push(mk(s, to)); }\n            else { if ((q > 0) !== (us > 0)) moves.push(mk(s, to)); break; }\n          }\n        }\n      }\n    }\n    if (!capsOnly && this.castle) {\n      if (us === WHITE) {\n        if ((this.castle & 1) && b[5] === 0 && b[6] === 0 && !this.attacked(4, BLACK) && !this.attacked(5, BLACK) && !this.attacked(6, BLACK)) moves.push(mk(4, 6));\n        if ((this.castle & 2) && b[1] === 0 && b[2] === 0 && b[3] === 0 && !this.attacked(4, BLACK) && !this.attacked(3, BLACK) && !this.attacked(2, BLACK)) moves.push(mk(4, 2));\n      } else {\n        if ((this.castle & 4) && b[61] === 0 && b[62] === 0 && !this.attacked(60, WHITE) && !this.attacked(61, WHITE) && !this.attacked(62, WHITE)) moves.push(mk(60, 62));\n        if ((this.castle & 8) && b[57] === 0 && b[58] === 0 && b[59] === 0 && !this.attacked(60, WHITE) && !this.attacked(59, WHITE) && !this.attacked(58, WHITE)) moves.push(mk(60, 58));\n      }\n    }\n    return moves;\n  }\n\n  legal() {\n    const out = [], ps = this.pseudo();\n    for (let i = 0; i < ps.length; i++) {\n      this.make(ps[i]);\n      if (!this.attacked(this.king[-this.turn], this.turn)) out.push(ps[i]);\n      this.undo();\n    }\n    return out;\n  }\n\n  make(m) {\n    const b = this.b, f = m & 63, t = (m >> 6) & 63, promo = m >> 12;\n    const p = b[f], cap = b[t], us = this.turn;\n    this.stack.push([m, cap, this.castle, this.ep, this.half, this.h1, this.h2]);\n    let h1 = this.h1 ^ ZS1 ^ ZC1[this.castle], h2 = this.h2 ^ ZS2 ^ ZC2[this.castle];\n    if (this.ep >= 0) { h1 ^= ZE1[this.ep & 7]; h2 ^= ZE2[this.ep & 7]; }\n    const ap = p > 0 ? p : -p;\n    h1 ^= ZP1[p + 6][f]; h2 ^= ZP2[p + 6][f];\n    if (cap) { h1 ^= ZP1[cap + 6][t]; h2 ^= ZP2[cap + 6][t]; }\n    b[f] = 0;\n    const placed = promo ? promo * us : p;\n    b[t] = placed;\n    h1 ^= ZP1[placed + 6][t]; h2 ^= ZP2[placed + 6][t];\n    if (ap === P && t === this.ep && (f & 7) !== (t & 7) && cap === 0) {\n      const cs = t - 8 * us;\n      h1 ^= ZP1[b[cs] + 6][cs]; h2 ^= ZP2[b[cs] + 6][cs];\n      b[cs] = 0;\n    } else if (ap === K) {\n      this.king[us] = t;\n      if (t - f === 2 || f - t === 2) {\n        const rf = t > f ? f + 3 : f - 4, rt = t > f ? f + 1 : f - 1;\n        const rook = b[rf];\n        b[rf] = 0; b[rt] = rook;\n        h1 ^= ZP1[rook + 6][rf] ^ ZP1[rook + 6][rt]; h2 ^= ZP2[rook + 6][rf] ^ ZP2[rook + 6][rt];\n      }\n    }\n    this.ep = (ap === P && (t - f === 16 || f - t === 16)) ? (f + t) >> 1 : -1;\n    this.castle &= CASTLE_MASK[f] & CASTLE_MASK[t];\n    this.half = (ap === P || cap) ? 0 : this.half + 1;\n    if (us === BLACK) this.full++;\n    this.turn = -us;\n    h1 ^= ZC1[this.castle]; h2 ^= ZC2[this.castle];\n    if (this.ep >= 0) { h1 ^= ZE1[this.ep & 7]; h2 ^= ZE2[this.ep & 7]; }\n    this.h1 = h1; this.h2 = h2;\n    this.hist.push(hashKey(h1, h2));\n  }\n\n  undo() {\n    const [m, cap, castle, ep, half, h1, h2] = this.stack.pop();\n    this.hist.pop();\n    const us = this.turn = -this.turn, b = this.b;\n    const f = m & 63, t = (m >> 6) & 63, promo = m >> 12;\n    const p = promo ? P * us : b[t];\n    b[f] = p; b[t] = cap;\n    const ap = p > 0 ? p : -p;\n    if (ap === P && t === ep && (f & 7) !== (t & 7) && cap === 0) b[t - 8 * us] = -P * us;\n    else if (ap === K) {\n      this.king[us] = f;\n      if (t - f === 2 || f - t === 2) {\n        const rf = t > f ? f + 3 : f - 4, rt = t > f ? f + 1 : f - 1;\n        b[rf] = b[rt]; b[rt] = 0;\n      }\n    }\n    this.castle = castle; this.ep = ep; this.half = half; this.h1 = h1; this.h2 = h2;\n    if (us === BLACK) this.full--;\n  }\n\n  isCapture(m) { const f = m & 63, t = (m >> 6) & 63; return this.b[t] !== 0 || (Math.abs(this.b[f]) === P && (f & 7) !== (t & 7)); }\n\n  isRepetition(times) {\n    times = times || 3;\n    const h = this.key(), n = this.hist.length;\n    let cnt = 1;\n    for (let i = n - 3; i > Math.max(n - 2 - this.half, -1); i -= 2) {\n      if (i >= 0 && this.hist[i] === h) { cnt++; if (cnt >= times) return true; }\n    }\n    return false;\n  }\n\n  insufficient() {\n    let minors = 0;\n    for (let i = 0; i < 64; i++) { const a = Math.abs(this.b[i]); if (a === P || a === R || a === Q) return false; if (a === N || a === B) minors++; }\n    return minors <= 1;\n  }\n\n  // null while the game is on, else {text, winner} (winner 1 / -1 / 0)\n  result() {\n    if (!this.legal().length) return this.inCheck() ? { text: \"Checkmate\", winner: -this.turn } : { text: \"Stalemate\", winner: 0 };\n    if (this.half >= 100) return { text: \"Draw by 50-move rule\", winner: 0 };\n    if (this.isRepetition(3)) return { text: \"Draw by repetition\", winner: 0 };\n    if (this.insufficient()) return { text: \"Draw: insufficient material\", winner: 0 };\n    return null;\n  }\n\n  parseUci(s) { return mk(nameSq(s.slice(0, 2)), nameSq(s.slice(2, 4)), s.length > 4 ? PROMO_FROM[s[4]] : 0); }\n\n  san(m) {\n    const f = m & 63, t = (m >> 6) & 63, promo = m >> 12, p = Math.abs(this.b[f]);\n    const cap = this.b[t] !== 0 || (p === P && t === this.ep && (f & 7) !== (t & 7));\n    let s;\n    if (p === K && Math.abs(t - f) === 2) s = t > f ? \"O-O\" : \"O-O-O\";\n    else {\n      s = \"\";\n      if (p !== P) {\n        s += LETTER[p];\n        const others = this.legal().filter(o => o !== m && ((o >> 6) & 63) === t && Math.abs(this.b[o & 63]) === p).map(o => o & 63);\n        if (others.length) {\n          if (others.every(o => (o & 7) !== (f & 7))) s += FILES[f & 7];\n          else if (others.every(o => (o >> 3) !== (f >> 3))) s += String((f >> 3) + 1);\n          else s += sqName(f);\n        }\n      } else if (cap) s += FILES[f & 7];\n      if (cap) s += \"x\";\n      s += sqName(t);\n      if (promo) s += \"=\" + LETTER[promo];\n    }\n    this.make(m);\n    if (this.inCheck()) s += this.legal().length ? \"+\" : \"#\";\n    this.undo();\n    return s;\n  }\n}\n\nfunction perft(bd, depth) {\n  if (depth === 0) return 1;\n  let n = 0;\n  const ps = bd.pseudo();\n  for (let i = 0; i < ps.length; i++) {\n    bd.make(ps[i]);\n    if (!bd.attacked(bd.king[-bd.turn], bd.turn)) n += perft(bd, depth - 1);\n    bd.undo();\n  }\n  return n;\n}\n\n\n// ----- 02_engine.js -----\n// ==========================================================================\n// engine.js - Stonebot's brain: evaluation, alpha-beta search, 15 levels, opening book, move rating.\n// ==========================================================================\nconst INF = 1000000, MATE = 100000;\nconst VAL = [0, 100, 320, 330, 500, 900, 0];       // indexed by piece type\nconst PHASE = [0, 0, 1, 1, 2, 4, 0];\nconst _PST_ROWS = {\n  1: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10,\n      5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5,\n      5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],\n  2: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30,\n      -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30,\n      -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],\n  3: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10,\n      -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10,\n      -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],\n  4: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5,\n      -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,\n      -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],\n  5: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10,\n      -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10,\n      -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],\n};\nconst KING_MG = [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,\n  -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,\n  -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10,\n  20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20];\nconst KING_EG = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30,\n  -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,\n  -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30,\n  -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];\n// PST_W[type][sq] / PST_B[type][sq] include the piece value.\nconst PST_W = [null], PST_B = [null];\nconst KMG_W = new Int32Array(64), KEG_W = new Int32Array(64), KMG_B = new Int32Array(64), KEG_B = new Int32Array(64);\nfor (let t = 1; t <= 5; t++) {\n  PST_W.push(new Int32Array(64)); PST_B.push(new Int32Array(64));\n  for (let s = 0; s < 64; s++) {\n    const r = s >> 3, f = s & 7;\n    PST_W[t][s] = VAL[t] + _PST_ROWS[t][(7 - r) * 8 + f];\n    PST_B[t][s] = VAL[t] + _PST_ROWS[t][r * 8 + f];\n  }\n}\nfor (let s = 0; s < 64; s++) {\n  const r = s >> 3, f = s & 7;\n  KMG_W[s] = KING_MG[(7 - r) * 8 + f]; KEG_W[s] = KING_EG[(7 - r) * 8 + f];\n  KMG_B[s] = KING_MG[r * 8 + f]; KEG_B[s] = KING_EG[r * 8 + f];\n}\nPST_W.push(null); PST_B.push(null);   // index 6 (king) unused\n\nfunction evaluate(bd) {   // centipawns from the side to move's point of view\n  const b = bd.b;\n  let score = 0, phase = 0, kmg = 0, keg = 0, wb = 0, bb = 0;\n  for (let s = 0; s < 64; s++) {\n    const p = b[s];\n    if (!p) continue;\n    if (p > 0) {\n      if (p === K) { kmg += KMG_W[s]; keg += KEG_W[s]; }\n      else { score += PST_W[p][s]; phase += PHASE[p]; if (p === B) wb++; }\n    } else if (p === -K) { kmg -= KMG_B[s]; keg -= KEG_B[s]; }\n    else { score -= PST_B[-p][s]; phase += PHASE[-p]; if (p === -B) bb++; }\n  }\n  if (wb >= 2) score += 30;\n  if (bb >= 2) score -= 30;\n  if (phase > 24) phase = 24;\n  score += Math.floor((kmg * phase + keg * (24 - phase)) / 24);\n  return (bd.turn === WHITE ? score : -score) + 10;\n}\n\nclass SearchTimeout { }\nconst _TIMEOUT = new SearchTimeout();\nconst now = () => (typeof performance !== \"undefined\" ? performance.now() : Date.now());\n\nclass Engine {\n  constructor() {\n    this.tt = new Map();\n    this.killers = []; for (let i = 0; i < 64; i++) this.killers.push([0, 0]);\n    this.history = new Int32Array(32768);\n    this.nodes = 0; this.deadline = 0; this.bd = null;\n  }\n  reset() { this.tt.clear(); this.history.fill(0); }\n  _timeUp() { return this.deadline && now() > this.deadline; }\n\n  _order(moves, ttmove, ply) {\n    const b = this.bd.b, k = this.killers[ply];\n    const scored = new Array(moves.length);\n    for (let i = 0; i < moves.length; i++) {\n      const m = moves[i], f = m & 63, t = (m >> 6) & 63;\n      let sc;\n      if (m === ttmove) sc = 10000000;\n      else {\n        const v = b[t];\n        if (v) sc = 100000 + 10 * VAL[Math.abs(v)] - Math.floor(VAL[Math.abs(b[f])] / 10);\n        else if (m >> 12) sc = 100800;\n        else if (m === k[0]) sc = 9000;\n        else if (m === k[1]) sc = 8000;\n        else sc = this.history[m];\n      }\n      scored[i] = [sc, m];\n    }\n    scored.sort((a, c) => c[0] - a[0]);\n    return scored.map(x => x[1]);\n  }\n\n  _quiesce(alpha, beta, ply) {\n    this.nodes++;\n    if (!(this.nodes & 1023) && this._timeUp()) throw _TIMEOUT;\n    const bd = this.bd;\n    const stand = evaluate(bd);\n    if (stand >= beta) return stand;\n    if (stand > alpha) alpha = stand;\n    const ms = this._order(bd.pseudo(true), 0, ply < 63 ? ply : 63);\n    for (let i = 0; i < ms.length; i++) {\n      bd.make(ms[i]);\n      if (bd.attacked(bd.king[-bd.turn], bd.turn)) { bd.undo(); continue; }\n      const sc = -this._quiesce(-beta, -alpha, ply + 1);\n      bd.undo();\n      if (sc >= beta) return sc;\n      if (sc > alpha) alpha = sc;\n    }\n    return alpha;\n  }\n\n  _hasPieces() {\n    const us = this.bd.turn, b = this.bd.b;\n    for (let i = 0; i < 64; i++) { const p = b[i]; if (p * us > 0) { const a = Math.abs(p); if (a === N || a === B || a === R || a === Q) return true; } }\n    return false;\n  }\n\n  _negamax(d, alpha, beta, ply) {\n    this.nodes++;\n    if (!(this.nodes & 1023) && this._timeUp()) throw _TIMEOUT;\n    const bd = this.bd;\n    if (ply > 0 && (bd.half >= 100 || bd.isRepetition(2))) return 0;\n    const inCheck = bd.inCheck();\n    if (inCheck) d++;\n    if (d <= 0 || ply >= 60) return this._quiesce(alpha, beta, ply);\n    const key = bd.key();\n    let ttmove = 0;\n    const ent = this.tt.get(key);\n    if (ent) {\n      const ed = ent[0], flag = ent[1]; let esc = ent[2]; ttmove = ent[3];\n      if (esc > MATE - 1000) esc -= ply; else if (esc < -MATE + 1000) esc += ply;\n      if (ed >= d && ply > 0) {\n        if (flag === 0) return esc;\n        if (flag === 1 && esc >= beta) return esc;\n        if (flag === 2 && esc <= alpha) return esc;\n      }\n    }\n    // null-move pruning\n    if (!inCheck && d >= 3 && ply > 0 && beta < MATE - 1000 && this._hasPieces()) {\n      const ep = bd.ep, h1 = bd.h1, h2 = bd.h2;\n      bd.turn = -bd.turn;\n      bd.h1 = h1 ^ ZS1 ^ (ep >= 0 ? ZE1[ep & 7] : 0); bd.h2 = h2 ^ ZS2 ^ (ep >= 0 ? ZE2[ep & 7] : 0);\n      bd.ep = -1;\n      bd.hist.push(bd.key());\n      let sc;\n      try { sc = -this._negamax(d - 3, -beta, -beta + 1, ply + 1); }\n      finally { bd.hist.pop(); bd.ep = ep; bd.h1 = h1; bd.h2 = h2; bd.turn = -bd.turn; }\n      if (sc >= beta) return beta;\n    }\n    let best = -INF, bestmove = 0, legal = 0;\n    const origAlpha = alpha;\n    const ms = this._order(bd.pseudo(), ttmove, ply);\n    for (let i = 0; i < ms.length; i++) {\n      const m = ms[i];\n      bd.make(m);\n      if (bd.attacked(bd.king[-bd.turn], bd.turn)) { bd.undo(); continue; }\n      legal++;\n      let sc;\n      if (legal === 1) sc = -this._negamax(d - 1, -beta, -alpha, ply + 1);\n      else {\n        sc = -this._negamax(d - 1, -alpha - 1, -alpha, ply + 1);\n        if (sc > alpha && sc < beta) sc = -this._negamax(d - 1, -beta, -alpha, ply + 1);\n      }\n      const quiet = !bd.stack[bd.stack.length - 1][1] && !(m >> 12);\n      bd.undo();\n      if (sc > best) {\n        best = sc; bestmove = m;\n        if (sc > alpha) {\n          alpha = sc;\n          if (alpha >= beta) {\n            if (quiet) {\n              const kl = this.killers[ply];\n              if (kl[0] !== m) { kl[1] = kl[0]; kl[0] = m; }\n              this.history[m] += d * d;\n            }\n            break;\n          }\n        }\n      }\n    }\n    if (legal === 0) return inCheck ? -(MATE - ply) : 0;\n    const flag = (origAlpha < best && best < beta) ? 0 : (best >= beta ? 1 : 2);\n    let store = best;\n    if (store > MATE - 1000) store += ply; else if (store < -MATE + 1000) store -= ply;\n    if (this.tt.size > 400000) this.tt.clear();\n    this.tt.set(key, [d, flag, store, bestmove]);\n    return best;\n  }\n\n  // Score every legal move at a fixed depth (full window each). Returns [[move, cp]] best first (cp for the mover).\n  scoreRootMoves(bd, depth, seconds) {\n    this.bd = bd; this.nodes = 0;\n    this.deadline = seconds ? now() + seconds * 1000 : 0;\n    const out = [];\n    const ent = this.tt.get(bd.key());\n    const ttm = ent ? ent[3] : 0;\n    try {\n      const ms = this._order(bd.legal(), ttm, 0);\n      for (const m of ms) {\n        bd.make(m);\n        let sc;\n        try { sc = -this._negamax(depth - 1, -INF, INF, 1); } finally { bd.undo(); }\n        out.push([m, sc]);\n      }\n    } catch (e) { if (e !== _TIMEOUT) throw e; }\n    this.deadline = 0;\n    out.sort((a, c) => c[1] - a[1]);\n    return out;\n  }\n\n  // Iterative deepening. Returns {move, score, depth}.\n  search(bd, maxDepth, seconds) {\n    this.bd = bd; this.nodes = 0;\n    this.deadline = seconds ? now() + seconds * 1000 : 0;\n    const legal = bd.legal();\n    if (!legal.length) return { move: 0, score: 0, depth: 0 };\n    let best = legal[0], bscore = 0, depthDone = 0;\n    try {\n      for (let d = 1; d <= maxDepth; d++) {\n        let alpha = -INF; const beta = INF;\n        let curBest = 0, curScore = -INF;\n        for (const m of this._order(legal, best, 0)) {\n          bd.make(m);\n          let sc;\n          try {\n            if (curBest === 0) sc = -this._negamax(d - 1, -beta, -alpha, 1);\n            else {\n              sc = -this._negamax(d - 1, -alpha - 1, -alpha, 1);\n              if (sc > alpha) sc = -this._negamax(d - 1, -beta, -alpha, 1);\n            }\n          } finally { bd.undo(); }\n          if (sc > curScore) { curBest = m; curScore = sc; alpha = Math.max(alpha, sc); }\n        }\n        best = curBest; bscore = curScore; depthDone = d;\n        if (Math.abs(bscore) > MATE - 1000) break;\n      }\n    } catch (e) { if (e !== _TIMEOUT) throw e; }\n    this.deadline = 0;\n    return { move: best, score: bscore, depth: depthDone };\n  }\n}\n\n// level: [max depth, seconds per move, noise in centipawns, chance of a random move]\nconst LEVELS = {\n  1: [1, 0.2, 400, 0.40], 2: [1, 0.2, 280, 0.25], 3: [2, 0.4, 200, 0.12], 4: [2, 0.4, 130, 0.06],\n  5: [2, 0.5, 80, 0.0], 6: [3, 0.8, 60, 0.0], 7: [3, 1.0, 40, 0.0], 8: [3, 1.2, 20, 0.0],\n  9: [4, 1.5, 12, 0.0], 10: [4, 2.0, 0, 0.0], 11: [5, 2.5, 0, 0.0], 12: [5, 3.5, 0, 0.0],\n  13: [6, 4.5, 0, 0.0], 14: [8, 6.0, 0, 0.0], 15: [12, 9.0, 0, 0.0],\n};\nconst LEVEL_NAMES = { 1: \"Pebble\", 2: \"Gravel\", 3: \"Cobble\", 4: \"Flint\", 5: \"Slate\", 6: \"Sandstone\", 7: \"Limestone\",\n  8: \"Granite\", 9: \"Basalt\", 10: \"Obsidian\", 11: \"Quartz\", 12: \"Jasper\", 13: \"Onyx\", 14: \"Sapphire\", 15: \"Diamond\" };\n\nconst BOOK_LINES = `\ne2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6 c2c3 e8g8\ne2e4 e7e5 g1f3 b8c6 f1b5 g8f6 e1g1 f6e4 d2d4 e4d6 b5c6 d7c6 d4e5 d6f5\ne2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6 e1g1 e8g8\ne2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3 f8c5 c2c3 d7d6\ne2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 g8f6 d4c6 b7c6 e4e5 d8e7\ne2e4 e7e5 g1f3 g8f6 f3e5 d7d6 e5f3 f6e4 d2d4 d6d5 f1d3 f8e7\ne2e4 e7e5 f2f4 e5f4 g1f3 g7g5 h2h4 g5g4 f3e5\ne2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3 e7e5 d4b3 c8e6\ne2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g8f6 b1c3 d7d6 c1g5 e7e6 d1d2 a7a6\ne2e4 c7c5 g1f3 e7e6 d2d4 c5d4 f3d4 a7a6 f1d3 g8f6 e1g1 d8c7\ne2e4 c7c5 b1c3 b8c6 g2g3 g7g6 f1g2 f8g7 d2d3 d7d6\ne2e4 c7c5 c2c3 d7d5 e4d5 d8d5 d2d4 g8f6 g1f3 c8g4\ne2e4 e7e6 d2d4 d7d5 b1c3 g8f6 c1g5 f8e7 e4e5 f6d7 g5e7 d8e7\ne2e4 e7e6 d2d4 d7d5 b1c3 f8b4 e4e5 c7c5 a2a3 b4c3 b2c3 g8e7\ne2e4 e7e6 d2d4 d7d5 e4e5 c7c5 c2c3 b8c6 g1f3 d8b6 a2a3 c5c4\ne2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5 e4g3 f5g6 h2h4 h7h6 g1f3 b8d7\ne2e4 c7c6 d2d4 d7d5 e4e5 c8f5 g1f3 e7e6 f1e2 c6c5 e1g1 b8c6\ne2e4 d7d5 e4d5 d8d5 b1c3 d5a5 d2d4 g8f6 g1f3 c7c6 f1c4 c8f5\ne2e4 d7d6 d2d4 g8f6 b1c3 g7g6 f2f4 f8g7 g1f3 e8g8\ne2e4 g7g6 d2d4 f8g7 b1c3 d7d6 f2f4 g8f6 g1f3 e8g8\nd2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8 g1f3 b8d7\nd2d4 d7d5 c2c4 e7e6 b1c3 g8f6 g1f3 f8e7 c1f4 e8g8 e2e3 c7c5\nd2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 d5c4 a2a4 c8f5 e2e3 e7e6\nd2d4 d7d5 c2c4 d5c4 g1f3 g8f6 e2e3 e7e6 f1c4 c7c5 e1g1 a7a6\nd2d4 d7d5 g1f3 g8f6 c1f4 e7e6 e2e3 c7c5 c2c3 b8c6 b1d2 f8d6\nd2d4 d7d5 c2c4 e7e5 d4e5 d5d4 g1f3 b8c6 g2g3 c8e6\nd2d4 g8f6 c2c4 e7e6 b1c3 f8b4 e2e3 e8g8 f1d3 d7d5 g1f3 c7c5 e1g1 b8c6\nd2d4 g8f6 c2c4 e7e6 g1f3 b7b6 g2g3 c8b7 f1g2 f8e7 e1g1 e8g8 b1c3 f6e4\nd2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8 f1e2 e7e5 e1g1 b8c6\nd2d4 g8f6 c2c4 g7g6 b1c3 d7d5 c4d5 f6d5 e2e4 d5c3 b2c3 f8g7 g1f3 c7c5\nd2d4 g8f6 g1f3 e7e6 c2c4 d7d5 b1c3 f8e7 c1g5 e8g8 e2e3 h7h6 g5h4 b7b6\nd2d4 g8f6 c2c4 e7e6 b1c3 d7d5 c4d5 e6d5 c1g5 c7e7 e2e3 c8e6\nc2c4 e7e5 b1c3 g8f6 g1f3 b8c6 g2g3 d7d5 c4d5 f6d5 f1g2 d5b6 e1g1 f8e7\nc2c4 g8f6 b1c3 e7e6 e2e4 d7d5 e4e5 d5d4 e5f6 d4c3 b2c3 d8f6\nc2c4 c7c5 g1f3 g8f6 b1c3 b8c6 g2g3 g7g6 f1g2 f8g7 e1g1 e8g8\nc2c4 e7e6 g1f3 d7d5 g2g3 g8f6 f1g2 f8e7 e1g1 e8g8 d2d4 d5c4\ng1f3 d7d5 g2g3 g8f6 f1g2 e7e6 e1g1 f8e7 d2d3 e8g8 b1d2 c7c5\ng1f3 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 d2d4 e8g8 f1e2 e7e5\ng1f3 d7d5 d2d4 g8f6 c2c4 e7e6 b1c3 f8e7 c1g5 e8g8\ng1f3 c7c5 c2c4 g8f6 b1c3 e7e6 g2g3 b7b6 f1g2 c8b7 e1g1 f8e7\nf2f4 d7d5 g1f3 g8f6 e2e3 g7g6 f1e2 f8g7 e1g1 e8g8 d2d3\nb2b3 e7e5 c1b2 b8c6 e2e3 d7d5 f1b5 f8d6 f2f4 d8e7\n`;\nconst BOOK = BOOK_LINES.trim().split(\"\\n\").map(l => l.trim().split(/\\s+/));\nfunction _prefix(l, a, n) { for (let i = 0; i < n; i++) if (l[i] !== a[i]) return false; return true; }\nfunction inBook(ucis) { const n = ucis.length; return n > 0 && BOOK.some(l => l.length >= n && _prefix(l, ucis, n)); }\nfunction bookMove(ucis) {\n  const n = ucis.length, opts = BOOK.filter(l => l.length > n && _prefix(l, ucis, n)).map(l => l[n]);\n  return opts.length ? opts[Math.floor(Math.random() * opts.length)] : null;\n}\n\nclass Stonebot {\n  constructor(level) { this.level = level || 5; this.engine = new Engine(); }\n  setLevel(l) { this.level = Math.max(1, Math.min(15, l)); }\n  // Returns {move, info}. timeCap (seconds) shortens thinking when the bot is short on the clock.\n  chooseMove(bd, ucis, timeCap) {\n    const level = this.level;\n    let [depth, secs, noise, blunder] = LEVELS[level];\n    if (timeCap != null) secs = Math.max(0.05, Math.min(secs, timeCap));\n    const legal = bd.legal();\n    if (!legal.length) return { move: 0, info: \"\" };\n    if (level >= 3) {\n      const bm = bookMove(ucis);\n      if (bm) { const m = bd.parseUci(bm); if (legal.includes(m)) return { move: m, info: \"book\" }; }\n    }\n    if (Math.random() < blunder) return { move: legal[Math.floor(Math.random() * legal.length)], info: \"random\" };\n    if (noise) {\n      const scored = this.engine.scoreRootMoves(bd, depth, secs);\n      if (!scored.length) return { move: legal[Math.floor(Math.random() * legal.length)], info: \"random\" };\n      let pick = scored[0], pv = -Infinity;\n      for (const s of scored) { const v = s[1] + (Math.random() * 2 - 1) * noise; if (v > pv) { pv = v; pick = s; } }\n      return { move: pick[0], info: \"depth \" + depth };\n    }\n    const r = this.engine.search(bd, depth, secs);\n    return { move: r.move || legal[0], info: \"depth \" + r.depth };\n  }\n}\n\n// ---------- move rating ----------\nconst LABELS = {\n  brilliant: [\"Brilliant!!\", \"#26c2a3\"], great: [\"Great move!\", \"#5c8bb0\"], best: [\"Best move\", \"#96bc4b\"],\n  excellent: [\"Excellent\", \"#96bc4b\"], good: [\"Good\", \"#a3b18a\"], book: [\"Book move\", \"#a88865\"],\n  inaccuracy: [\"Inaccuracy\", \"#f7c631\"], mistake: [\"Mistake\", \"#e58f2a\"], blunder: [\"Blunder\", \"#ca3431\"],\n};\nfunction winPct(cp) { cp = Math.max(-1500, Math.min(1500, cp)); return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1); }\nfunction accuracyOf(loss) { return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669)); }\n\nfunction _matStatic(bd) { let m = 0; for (let i = 0; i < 64; i++) { const p = bd.b[i]; if (p > 0) m += VAL[p]; else if (p < 0) m -= VAL[-p]; } return bd.turn === WHITE ? m : -m; }\nfunction _qmat(bd, alpha, beta, depth) {\n  const stand = _matStatic(bd);\n  if (stand >= beta || depth > 6) return stand;\n  alpha = Math.max(alpha, stand);\n  for (const m of bd.pseudo(true)) {\n    bd.make(m);\n    if (bd.attacked(bd.king[-bd.turn], bd.turn)) { bd.undo(); continue; }\n    const sc = -_qmat(bd, -beta, -alpha, depth + 1);\n    bd.undo();\n    if (sc >= beta) return sc;\n    alpha = Math.max(alpha, sc);\n  }\n  return alpha;\n}\nfunction _materialAfter(bd, m) { bd.make(m); const v = -_qmat(bd, -INF, INF, 0); bd.undo(); return v; }\n\nfunction ratingResult(label, loss, san, bestSan, playedCp) {\n  return { label, text: LABELS[label][0], color: LABELS[label][1], loss, san, best_san: bestSan, eval_after: playedCp };\n}\n\nclass Rater {\n  constructor(engine, depth) { this.engine = engine || new Engine(); this.depth = depth || 3; }\n  // Rate move m played in position bd (before the move); ucisBefore = game so far (UCI strings).\n  rate(bd, m, ucisBefore) {\n    const san = bd.san(m);\n    if (inBook(ucisBefore.concat([uci(m)]))) return ratingResult(\"book\", 0, san, null, null);\n    const scored = this.engine.scoreRootMoves(bd, this.depth, 6.0);\n    if (!scored.length) return ratingResult(\"good\", 0, san, null, null);\n    const [bestM, bestCp] = scored[0];\n    const hit = scored.find(s => s[0] === m);\n    let playedCp;\n    if (hit) playedCp = hit[1];\n    else {\n      bd.make(m);\n      const lg = bd.legal();\n      playedCp = lg.length ? -this.engine.scoreRootMoves(bd, Math.max(1, this.depth - 1), 2.0)[0][1] : (bd.inCheck() ? MATE : 0);\n      bd.undo();\n    }\n    const loss = Math.max(0, winPct(bestCp) - winPct(playedCp));\n    const secondCp = scored.length > 1 ? scored[1][1] : null;\n    const bestSan = bestM !== m ? bd.san(bestM) : null;\n    let label;\n    if (bestM === m || playedCp >= bestCp - 5) label = \"best\";\n    else if (loss <= 2) label = \"excellent\";\n    else if (loss <= 5) label = \"good\";\n    else if (loss <= 10) label = \"inaccuracy\";\n    else if (loss <= 15) label = \"mistake\";\n    else label = \"blunder\";\n    const afterWin = winPct(playedCp), beforeWin = winPct(bestCp);\n    if (label === \"best\" && secondCp !== null && scored.length > 2) {\n      if (winPct(bestCp) - winPct(secondCp) >= 15 && beforeWin < 92 && afterWin > 25) label = \"great\";\n    }\n    if ([\"best\", \"excellent\", \"great\"].includes(label) && loss <= 2 && afterWin >= 45 && beforeWin < 92) {\n      if (_matStatic(bd) - _materialAfter(bd, m) >= 200) label = \"brilliant\";\n    }\n    const r = ratingResult(label, loss, san, bestSan, playedCp);\n    r.best_move = bestM !== m ? bestM : null;\n    return r;\n  }\n}\n\n\n// ----- 04_game.js -----\n// ==========================================================================\n// game.js - game controller (no UI), clock, engine request handler (runs in the worker), records, PGN, storage.\n// ==========================================================================\nconst nowSec = () => Date.now() / 1000;\n\nclass Clock {\n  constructor(base, inc, turn) {\n    this.t = { 1: +base, \"-1\": +base }; this.inc = +inc; this.turn = turn || WHITE; this.t0 = nowSec(); this.stopped = false;\n  }\n  left(color) { let v = this.t[color]; if (!this.stopped && color === this.turn) v -= nowSec() - this.t0; return Math.max(0, v); }\n  switch() {\n    if (this.stopped) return;\n    const n = nowSec();\n    this.t[this.turn] = Math.max(0, this.t[this.turn] - (n - this.t0));\n    if (this.t[this.turn] > 0) this.t[this.turn] += this.inc;\n    this.turn = -this.turn; this.t0 = n;\n  }\n  stop() { if (!this.stopped) { this.t[this.turn] = this.left(this.turn); this.stopped = true; } }\n  flagged() {\n    for (const c of [WHITE, BLACK]) if (this.t[c] <= 0 || (!this.stopped && c === this.turn && this.left(c) <= 0)) return c;\n    return 0;\n  }\n}\n\n// A plain-data description of a position so the engine worker can rebuild it.\nfunction positionSpec(bd, startFen, ucis) {\n  return { chaos: false, startFen: startFen || null, ucis: ucis.slice() };\n}\nfunction buildPosition(spec) {\n  const bd = new Board(spec.startFen || START_FEN);\n  for (const u of spec.ucis) bd.make(bd.parseUci(u));\n  return bd;\n}\n\n// Handles engine requests. Lives in the worker (or inline when workers are unavailable).\nclass EngineHost {\n  constructor() {\n    this.bots = {}; this.sharedEngine = new Engine();\n    this.rater = new Rater(this.sharedEngine, 3);\n  }\n  bot(level) { if (!this.bots[level]) this.bots[level] = new Stonebot(level); return this.bots[level]; }\n  handle(req) {\n    switch (req.op) {\n      case \"reset\": for (const k in this.bots) this.bots[k].engine.reset(); this.sharedEngine.reset(); return true;\n      case \"move\": {\n        const pos = buildPosition(req.spec);\n        const ucis = req.spec.startFen ? [\"~\"].concat(req.spec.ucis) : req.spec.ucis;\n        const r = this.bot(req.level).chooseMove(pos, ucis, req.cap);\n        return { move: r.move, info: r.info };\n      }\n      case \"rate\": {\n        const pos = buildPosition(req.spec);\n        const ucis = req.spec.startFen ? [\"~\"].concat(req.spec.ucis) : req.spec.ucis;\n        return this.rater.rate(pos, req.move, ucis);\n      }\n      case \"eval\": {\n        const pos = buildPosition(req.spec);\n        let cp;\n        { const sc = this.sharedEngine.scoreRootMoves(pos.copy(), 3, 1.2); cp = sc.length ? sc[0][1] : 0; }\n        return cp * pos.turn;\n      }\n      default: throw new Error(\"unknown op \" + req.op);\n    }\n  }\n}\n\nclass Game {\n  constructor(mode, level, tier, playerColor) {\n    this.mode = mode || \"stonebot\"; this.level = level || 5; this.tier = tier || 1;\n    this.startFen = null; this.clock = null; this.tc = null;\n    this.new(playerColor || WHITE);\n  }\n  get chaosOn() { return false; }\n  get botName() { return \"Stonebot\"; }\n  new(playerColor, mode, tier, fen, tc) {\n    if (mode != null) this.mode = mode;\n    if (tier != null) this.tier = tier;\n    if (this.chaosOn) { fen = null; tc = null; }\n    this.startFen = fen || null;\n    this.bd = new Board(fen || START_FEN);\n    this.tc = tc || null;\n    this.clock = tc ? new Clock(tc[0], tc[1], this.bd.turn) : null;\n    this.started = nowSec(); this.saveName = null; this.endNote = \"\";\n    this.ucis = []; this.log = []; this.player = playerColor; this.over = null;\n  }\n  setLevel(l) { this.level = Math.max(1, Math.min(15, l)); }\n  spec() { return positionSpec(this.bd, this.startFen, this.ucis); }\n  botLevel() { return this.level; }\n  timeCap() { const c = this.clock; return c ? Math.max(0.05, c.left(-this.player) / 28 + c.inc * 0.7) : null; }\n  playerTurn() { return this.bd.turn === this.player; }\n  push(m, mine) {\n    const f = m & 63, t = (m >> 6) & 63;\n    const entry = { san: this.bd.san(m), color: this.bd.turn, mine, rating: null, uci: uci(m), from: f, to: t, piece: this.bd.b[f], cap: this.bd.b[t] };\n    this.bd.make(m); this.ucis.push(entry.uci); this.log.push(entry);\n    this.over = this.bd.result();\n    if (this.clock) { this.clock.switch(); if (this.over) this.clock.stop(); }\n    return entry;\n  }\n  flagCheck() {\n    const c = this.clock;\n    if (!c || this.over) return false;\n    const loser = c.flagged();\n    if (!loser) return false;\n    c.stop();\n    const winner = -loser, b = this.bd.b;\n    let minor = 0, enough = false;\n    for (const p of b) { if (p * winner > 0) { const a = Math.abs(p); if (a === P || a === R || a === Q) enough = true; if (a === N || a === B) minor++; } }\n    enough = enough || minor >= 2;\n    this.over = { text: (loser === this.player ? \"You\" : this.botName) + \" ran out of time\", winner: enough ? winner : 0 };\n    return true;\n  }\n  undoPair() {\n    if (!this.log.some(e => e.mine)) return false;\n    while (this.log.length) { const e = this.log.pop(); this.bd.undo(); this.ucis.pop(); if (e.mine) break; }\n    this.over = null;\n    return true;\n  }\n  tally() { const c = {}; for (const e of this.log) if (e.mine && e.rating) c[e.rating.label] = (c[e.rating.label] || 0) + 1; return c; }\n  accuracy() {\n    const a = this.log.filter(e => e.mine && e.rating).map(e => accuracyOf(e.rating.loss));\n    return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;\n  }\n  captured() {\n    const start = { 1: 8, 2: 2, 3: 2, 4: 2, 5: 1 };\n    const have = { 1: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, \"-1\": { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };\n    for (const p of this.bd.b) if (p && start[Math.abs(p)]) have[p > 0 ? 1 : -1][Math.abs(p)]++;\n    const w = {}, bl = {};\n    for (const t in start) { w[t] = Math.max(0, start[t] - have[1][t]); bl[t] = Math.max(0, start[t] - have[-1][t]); }\n    return [w, bl];\n  }\n}\n\n// ---------- records & PGN ----------\nconst RESULT_TAG = { 1: \"1-0\", \"-1\": \"0-1\", 0: \"1/2-1/2\" };\nconst PLAYER_TAG = { 1: \"white\", \"-1\": \"black\", 0: \"none\" };\nconst TAG_RE_SRC = '\\\\[(\\\\w+)\\\\s+\"((?:[^\"\\\\\\\\]|\\\\\\\\.)*)\"\\\\]';\nconst TOKEN_RE_SRC = \"\\\\{[^}]*\\\\}|;[^\\\\n]*|\\\\(|\\\\)|\\\\$\\\\d+|\\\\d+\\\\.+|1-0|0-1|1/2-1/2|\\\\*|[^\\\\s{}();$]+\";\n\nfunction recordFromGame(g, white, black) {\n  const bot = g.botName + \" L\" + g.level;\n  const ratings = {};\n  g.log.forEach((e, i) => { if (e.mine && e.rating) ratings[String(i)] = [e.rating.label, Math.round(e.rating.loss * 10) / 10]; });\n  const over = g.over;\n  return {\n    mode: g.mode, level: g.level, tier: g.tier, player: g.player, start_fen: g.startFen, ucis: g.ucis.slice(),\n    white: white || (g.player === WHITE ? \"You\" : bot), black: black || (g.player === BLACK ? \"You\" : bot),\n    result: over ? RESULT_TAG[over.winner] : \"*\", note: over ? over.text : \"\",\n    tc: g.tc ? g.tc[0] + \"+\" + g.tc[1] : \"\", started: g.started, ratings,\n  };\n}\nconst _clean = s => String(s).replace(/\"/g, \"'\").replace(/\\n/g, \" \");\nfunction _pad(n) { return String(n).padStart(2, \"0\"); }\nfunction recordToPgn(rec) {\n  const bd = new Board(rec.start_fen || START_FEN);\n  let num = bd.full, whiteToMove = bd.turn === WHITE, first = true;\n  const parts = [];\n  rec.ucis.forEach((u, i) => {\n    const m = bd.parseUci(u);\n    if (whiteToMove) parts.push(num + \".\");\n    else if (first) parts.push(num + \"...\");\n    first = false;\n    parts.push(bd.san(m));\n    const r = (rec.ratings || {})[String(i)];\n    if (r) parts.push(\"{[%sb \" + r[0] + \" \" + r[1] + \"]}\");\n    bd.make(m);\n    if (!whiteToMove) num++;\n    whiteToMove = !whiteToMove;\n  });\n  parts.push(rec.result || \"*\");\n  const d = new Date((rec.started || nowSec()) * 1000);\n  const date = d.getFullYear() + \".\" + _pad(d.getMonth() + 1) + \".\" + _pad(d.getDate());\n  const tags = [[\"Event\", \"Stonebot game\"], [\"Site\", \"Stonebot\"], [\"Date\", date], [\"Round\", \"-\"], [\"White\", rec.white], [\"Black\", rec.black], [\"Result\", rec.result || \"*\"]];\n  if (rec.start_fen) tags.push([\"SetUp\", \"1\"], [\"FEN\", rec.start_fen]);\n  if (rec.tc) tags.push([\"TimeControl\", rec.tc]);\n  if (rec.note) tags.push([\"Termination\", rec.note]);\n  tags.push([\"StonebotMode\", rec.mode], [\"StonebotLevel\", String(rec.level)], [\"StonebotTier\", String(rec.tier)], [\"StonebotPlayer\", PLAYER_TAG[rec.player] || \"white\"]);\n  for (const k of [\"wlevel\", \"blevel\"]) if (rec[k]) tags.push([\"Stonebot\" + (k === \"wlevel\" ? \"White\" : \"Black\") + \"Level\", String(rec[k])]);\n  const head = tags.map(([k, v]) => \"[\" + k + ' \"' + _clean(v) + '\"]').join(\"\\n\");\n  const lines = []; let cur = \"\";\n  for (const p of parts) { if (cur.length + p.length + 1 > 78) { lines.push(cur); cur = p; } else cur = (cur + \" \" + p).trim(); }\n  lines.push(cur);\n  return head + \"\\n\\n\" + lines.join(\"\\n\") + \"\\n\";\n}\nfunction _firstGame(text) { const i = text.indexOf(\"\\n[Event \", 1); return i < 0 ? text : text.slice(0, i); }\nfunction pgnParse(text0) {\n  const text = _firstGame(text0.replace(/\\r/g, \"\"));\n  const tags = {};\n  for (const m of text.matchAll(new RegExp(TAG_RE_SRC, \"g\"))) tags[m[1]] = m[2];\n  const body = text.replace(new RegExp(TAG_RE_SRC, \"g\"), \"\");\n  const fen = (tags.SetUp === undefined || tags.SetUp === \"1\") ? (tags.FEN || null) : null;\n  let bd;\n  try { bd = new Board(fen || START_FEN); } catch (e) { throw new Error(\"The starting position in this file is not valid.\"); }\n  const ucis = [], ratings = {}; let depth = 0, result = tags.Result || \"*\";\n  for (const tok of (body.match(new RegExp(TOKEN_RE_SRC, \"g\")) || [])) {\n    const c = tok[0];\n    if (c === \"(\") depth++;\n    else if (c === \")\") depth = Math.max(0, depth - 1);\n    else if (depth || c === \";\" || c === \"$\" || /^\\d+\\.+$/.test(tok)) continue;\n    else if (c === \"{\") {\n      const mm = /\\[%sb (\\w+) ([\\d.]+)\\]/.exec(tok);\n      if (mm && ucis.length && LABELS[mm[1]]) ratings[String(ucis.length - 1)] = [mm[1], parseFloat(mm[2])];\n    } else if ([\"1-0\", \"0-1\", \"1/2-1/2\", \"*\"].includes(tok)) { result = tok; break; }\n    else {\n      const want = tok.replace(\"0-0-0\", \"O-O-O\").replace(\"0-0\", \"O-O\").replace(/[+#!?]+$/, \"\").replace(/=/g, \"\");\n      let found = null;\n      for (const m of bd.legal()) if (bd.san(m).replace(/[+#]+$/, \"\").replace(/=/g, \"\") === want) { found = m; break; }\n      if (found === null) throw new Error(\"Move \" + (ucis.length + 1) + \" (\" + tok + \") is not legal in this position.\");\n      ucis.push(uci(found)); bd.make(found);\n    }\n  }\n  const num = (k, d) => { const v = parseInt(tags[k], 10); return isNaN(v) ? d : v; };\n  const pl = { white: WHITE, black: BLACK, none: 0 }[tags.StonebotPlayer];\n  const mode = tags.StonebotMode || \"stonebot\";\n  let started = Date.parse((tags.Date || \"\").replace(/\\./g, \"-\")); started = isNaN(started) ? nowSec() : started / 1000;\n  return {\n    mode: (mode === \"stonebot\" || mode === \"rulecarve\") ? mode : \"stonebot\", level: Math.max(1, Math.min(15, num(\"StonebotLevel\", 5))),\n    tier: Math.max(1, Math.min(7, num(\"StonebotTier\", 1))), player: pl === undefined ? null : pl, start_fen: fen, ucis,\n    white: tags.White || \"?\", black: tags.Black || \"?\", result, note: tags.Termination || \"\", tc: tags.TimeControl || \"\", ratings,\n    wlevel: num(\"StonebotWhiteLevel\", 0), blevel: num(\"StonebotBlackLevel\", 0), started,\n  };\n}\nfunction findMove(bd, u) {\n  const f = nameSq(u.slice(0, 2)), t = nameSq(u.slice(2, 4));\n  const promo = u.length > 4 && PROMO_FROM[u[4]] ? PROMO_FROM[u[4]] : 0;\n  const moves = bd.legal();\n  for (const m of moves) if ((m & 63) === f && ((m >> 6) & 63) === t && (!promo || (m >> 12) === promo)) return m;\n  return null;\n}\nfunction gameFromRecord(rec, player) {\n  const pl = player != null ? player : (rec.player ? rec.player : WHITE);\n  const g = new Game(rec.mode, rec.level, rec.tier, pl);\n  g.new(pl, rec.mode, rec.tier, rec.start_fen || null);\n  rec.ucis.forEach((u, i) => {\n    const m = findMove(g.bd, u);\n    if (m === null) throw new Error(\"Move \" + (i + 1) + \" (\" + u + \") is not legal in this position.\");\n    const mine = g.bd.turn === g.player, e = g.push(m, mine), r = (rec.ratings || {})[String(i)];\n    if (r && mine && LABELS[r[0]]) e.rating = { label: r[0], text: LABELS[r[0]][0], color: LABELS[r[0]][1], loss: r[1], san: e.san, best_san: null, eval_after: null };\n  });\n  if (!g.over && [\"1-0\", \"0-1\", \"1/2-1/2\"].includes(rec.result)) g.over = { text: rec.note || \"Game ended\", winner: { \"1-0\": WHITE, \"0-1\": BLACK, \"1/2-1/2\": 0 }[rec.result] };\n  return g;\n}\n\n// ---------- saved games (localStorage, with an in-memory fallback) ----------\nconst Store = {\n  mem: {},\n  _ls() { try { return window.localStorage; } catch (e) { return null; } },\n  get(k) { try { const l = this._ls(); const v = l ? l.getItem(k) : this.mem[k]; return v == null ? null : v; } catch (e) { return this.mem[k] || null; } },\n  set(k, v) { try { const l = this._ls(); if (l) l.setItem(k, v); else this.mem[k] = v; return true; } catch (e) { this.mem[k] = v; return false; } },\n  del(k) { try { const l = this._ls(); if (l) l.removeItem(k); } catch (e) { } delete this.mem[k]; },\n  keys() { try { const l = this._ls(); if (l) { const o = []; for (let i = 0; i < l.length; i++) o.push(l.key(i)); return o; } } catch (e) { } return Object.keys(this.mem); },\n};\nconst GAME_PREFIX = \"sb.game.\";\nfunction _slug(s) { return String(s).replace(/[^A-Za-z0-9]+/g, \"-\").replace(/^-+|-+$/g, \"\").slice(0, 18) || \"x\"; }\nfunction recordFilename(rec) {\n  const d = new Date((rec.started || nowSec()) * 1000);\n  const stamp = d.getFullYear() + \"-\" + _pad(d.getMonth() + 1) + \"-\" + _pad(d.getDate()) + \"_\" + _pad(d.getHours()) + _pad(d.getMinutes()) + _pad(d.getSeconds());\n  return stamp + \"_\" + _slug(rec.white) + \"_vs_\" + _slug(rec.black) + ((rec.mode === \"rulecarve\" && rec.tier >= 2) ? \".sbg\" : \".pgn\");\n}\nfunction saveRecord(rec, name) {\n  name = name || recordFilename(rec);\n  Store.set(GAME_PREFIX + name, JSON.stringify({ saved: Date.now(), rec }));\n  return name;\n}\nfunction loadRecord(name) {\n  const t = Store.get(GAME_PREFIX + name);\n  if (!t) throw new Error(\"That game is gone.\");\n  const rec = JSON.parse(t).rec;\n  for (const [k, d] of [[\"start_fen\", null], [\"ratings\", {}], [\"note\", \"\"], [\"tc\", \"\"], [\"player\", 1]]) if (rec[k] === undefined) rec[k] = d;\n  return rec;\n}\nfunction deleteRecord(name) { Store.del(GAME_PREFIX + name); }\nfunction listSaved() {\n  const out = [];\n  for (const k of Store.keys()) {\n    if (!k.startsWith(GAME_PREFIX)) continue;\n    try {\n      const w = JSON.parse(Store.get(k)), r = w.rec;\n      out.push({ name: k.slice(GAME_PREFIX.length), white: r.white, black: r.black, result: r.result, moves: r.ucis.length, tc: r.tc || \"\",\n        custom: !!r.start_fen, mode: r.mode, tier: r.tier, mtime: w.saved });\n    } catch (e) { }\n  }\n  out.sort((a, b) => b.mtime - a.mtime);\n  return out;\n}\n\nconst __host = new EngineHost();\nonmessage = function (e) {\n  const d = e.data;\n  try { postMessage({ id: d.id, res: __host.handle(d.req) }); }\n  catch (err) { postMessage({ id: d.id, err: String(err && err.stack || err) }); }\n};\n";

// ----- 05_ui.js -----
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
