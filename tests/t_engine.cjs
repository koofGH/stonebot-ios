const E = require("./engine.cjs");
let bd = new E.Board("6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1");
const eng = new E.Engine();
let r = eng.search(bd, 4, 2); if (bd.san(r.move) !== "Ra8#") throw new Error("mate in 1: " + bd.san(r.move));
// mate in 2 / tactic: win a queen
bd = new E.Board("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");
r = eng.search(bd, 4, 3); console.log("fool's mate position (white is mated?)", bd.result());
bd = new E.Board("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 2 3");
r = eng.search(bd, 5, 3); if (bd.san(r.move) !== "Qxf7#") throw new Error("scholar: " + bd.san(r.move));
// speed
const t0 = Date.now(); bd = new E.Board(); const rr = new E.Engine().search(bd, 7, 20); console.log("startpos depth", rr.depth, "in", Date.now() - t0, "ms; best", bd.san(rr.move));
// levels play full games without errors
for (const lvl of [1, 5, 10]) { const bot = new E.Stonebot(lvl); const b = new E.Board(); const u = []; let n = 0; while (!b.result() && n < 60) { const m = bot.chooseMove(b, u, 0.1).move; u.push(E.uci(m)); b.make(m); n++; } }
// rater
const rater = new E.Rater(new E.Engine(), 3);
bd = new E.Board("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 2 3");
const good = rater.rate(bd, bd.legal().find(m => bd.san(m) === "Qxf7#"), []);
const bad = rater.rate(bd, bd.legal().find(m => bd.san(m) === "Qh5"), []);
console.log("rating mate:", good.label, "| Qh5:", bad.label, bad.best_san);
if (bad.label !== "blunder" && bad.label !== "mistake") throw new Error("rater");
const bk = rater.rate(new E.Board(), new E.Board().parseUci("e2e4"), []); if (bk.label !== "book") throw new Error("book");
console.log("engine ok");
