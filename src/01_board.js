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
