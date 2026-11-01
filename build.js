// Builds www/stonebot.js (the whole app: engine + UI, with the engine source embedded for the Web Worker)
// and tests/engine.cjs (engine only, for the Node tests).  Files 01-04 are the engine, 05+ are the UI.
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "src");
const files = fs.readdirSync(dir).filter(f => f.endsWith(".js")).sort();
const read = f => "\n// ----- " + f + " -----\n" + fs.readFileSync(path.join(dir, f), "utf8");
const engineFiles = files.filter(f => parseInt(f, 10) <= 4), uiFiles = files.filter(f => parseInt(f, 10) > 4);
const engine = engineFiles.map(read).join("\n");
const bootstrap = `
const __host = new EngineHost();
onmessage = function (e) {
  const d = e.data;
  try { postMessage({ id: d.id, res: __host.handle(d.req) }); }
  catch (err) { postMessage({ id: d.id, err: String(err && err.stack || err) }); }
};
`;
const app = engine + "\nconst ENGINE_SRC = " + JSON.stringify(engine + bootstrap) + ";\n" + uiFiles.map(read).join("\n");
fs.mkdirSync(path.join(__dirname, "www"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "www", "stonebot.js"), app);
const names = (engine.match(/^(?:class|function|const|let) +([A-Za-z_][A-Za-z0-9_]*)/gm) || []).map(l => l.split(/\s+/)[1]);
for (const line of engine.split("\n")) {
  if (!/^(const|let) /.test(line)) continue;
  for (const part of line.replace(/^(const|let) /, "").split(/, (?=[A-Za-z_]\w* = )/)) { const m = /^([A-Za-z_]\w*) = /.exec(part); if (m) names.push(m[1]); }
}
fs.writeFileSync(path.join(__dirname, "tests", "engine.cjs"), engine + "\nmodule.exports = {" + [...new Set(names)].join(",") + "};\n");
console.log("built", files.length, "files,", app.length, "bytes");
