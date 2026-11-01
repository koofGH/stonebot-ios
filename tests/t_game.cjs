const E = require("./engine.cjs");
// full game vs bot via host, rate, save/load PGN round trip
const host = new E.EngineHost();
const g = new E.Game("stonebot", 4, 1, E.WHITE);
for (let i = 0; i < 16 && !g.over; i++) {
  const mine = g.playerTurn();
  const spec = g.spec();
  const mv = host.handle({ op: "move", spec, level: 4, cap: 0.1 }).move;
  const rating = host.handle({ op: "rate", spec, move: mv });
  const e = g.push(mv, mine); e.rating = rating;
}
const rec = E.recordFromGame(g);
const pgn = E.recordToPgn(rec); console.log(pgn.split("\n").slice(0, 3).join("|"));
const back = E.pgnParse(pgn);
if (back.ucis.join() !== rec.ucis.join()) throw new Error("pgn roundtrip");
if (JSON.stringify(back.ratings) !== JSON.stringify(rec.ratings)) throw new Error("ratings roundtrip");
const g2 = E.gameFromRecord(back); if (g2.ucis.length !== 16) throw new Error("replay");
// custom fen + chaos record
const g3 = new E.Game("stonebot", 3, 1, E.WHITE); g3.new(E.WHITE, null, null, "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1", [300, 2]);
if (!g3.clock) throw new Error("clock");
const r3 = E.pgnParse(E.recordToPgn(E.recordFromGame(g3))); if (r3.start_fen !== "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1") throw new Error("fen tag");
console.log("eval", host.handle({ op: "eval", spec: g.spec() }), "game ok");
