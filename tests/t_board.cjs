const E = require("./engine.cjs");
const cases = [[E.START_FEN, [20, 400, 8902, 197281]],
 ["r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", [48, 2039, 97862]],
 ["8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", [14, 191, 2812, 43238]],
 ["r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", [6, 264, 9467]]];
let t0 = Date.now();
for (const [fen, exp] of cases) { const bd = new E.Board(fen); exp.forEach((n, i) => { const got = E.perft(bd, i + 1); if (got !== n) throw new Error(fen + " depth " + (i + 1) + ": " + got + " != " + n); }); }
console.log("perft ok", Date.now() - t0, "ms");
const bd = new E.Board("6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1"); const m = bd.legal().find(x => bd.san(x) === "Ra8#"); if (!m) throw new Error("san/mate");
const b2 = new E.Board(); for (const u of ["e2e4","e7e5","g1f3","b8c6","f1b5"]) b2.make(b2.parseUci(u)); if (b2.fen() !== "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3") throw new Error(b2.fen());
const r = new E.Board(); for (const u of ["g1f3","g8f6","f3g1","f6g8","g1f3","g8f6","f3g1","f6g8"]) r.make(r.parseUci(u)); if (!r.result() || r.result().text !== "Draw by repetition") throw new Error("repetition " + JSON.stringify(r.result()));
console.log("board tests ok");
