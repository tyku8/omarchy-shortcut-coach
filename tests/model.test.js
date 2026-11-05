// Run: node tests/model.test.js
const fs = require("fs")
const path = require("path")
const assert = require("assert")

const src = fs.readFileSync(path.join(__dirname, "..", "Model.js"), "utf8").replace(/^\.pragma library\s*/, "")
const mod = { exports: {} }
new Function("module", src)(mod)
const M = mod.exports

let failed = 0
function test(name, fn) {
  try { fn(); console.log("ok   " + name) } catch (e) { failed++; console.log("FAIL " + name + "\n     " + e.message) }
}

const catalogText = [
  "#loaded\t1",
  "bind\tSUPER + 1\tSwitch to workspace 1\t",
  "bind\tSUPER + 2\tSwitch to workspace 2\t",
  "bind\tSUPER + 0\tSwitch to workspace 10\t",
  "bind\tSUPER + LEFT\tFocus on left window\t",
  "bind\tSUPER + RIGHT\tFocus on right window\t",
  "bind\tSUPER + W\tClose window\t",
  "bind\tSUPER + Q\tClose window\t",
  "bind\tSUPER + RETURN\tTerminal\t",
  "bind\tPRINT\tScreenshot\t",
  "bind\tXF86AudioMute\tMute\t",
  "bind\tSUPER + mouse:272\tMove window\tpassive",
  "bind\tSUPER + K\tKeybindings\t",
  "bind\tSUPER + X\t\t",
  "unbind\tPRINT",
  "bind\tPRINT\tOmasnap\t",
].join("\n")

test("parseCatalog applies unbinds and drops undescribed binds", () => {
  const c = M.parseCatalog(catalogText)
  const print = c.filter(b => b.combo === "PRINT")
  assert.strictEqual(print.length, 1)
  assert.strictEqual(print[0].description, "Omasnap")
  assert.ok(!c.some(b => b.combo === "SUPER + X"))
  assert.ok(c.find(b => b.combo === "SUPER + mouse:272").passive)
})

test("unbind all clears the catalog", () => {
  assert.strictEqual(M.parseCatalog(catalogText + "\nunbind\tall").length, 0)
})

test("familyKey groups numbers and directions", () => {
  assert.strictEqual(M.familyKey("Switch to workspace 10").key, "Switch to workspace {n}")
  assert.strictEqual(M.familyKey("Swap window to the left").key, "Swap window {d}")
  assert.strictEqual(M.familyKey("Swap window down").key, "Swap window {d}")
  assert.strictEqual(M.familyKey("Terminal").key, "Terminal")
})

test("familyKeys compacts digits, arrows and alternatives", () => {
  assert.strictEqual(M.familyKeys(["SUPER + 1", "SUPER + 2", "SUPER + 0"]), "SUPER + 1…0")
  assert.strictEqual(M.familyKeys(["SUPER + LEFT", "SUPER + RIGHT"]), "SUPER + ←→")
  assert.strictEqual(M.familyKeys(["SUPER + W", "SUPER + Q"]), "SUPER + W / Q")
  assert.strictEqual(M.familyKeys(["ALT + SHIFT + 4", "PRINT", "F12"]), "F12  +2")
  assert.strictEqual(M.familyKeys(["SUPER + code:10", "SUPER + code:19"]), "SUPER + 1…0")
  assert.strictEqual(M.familyKeys(["SUPER + SHIFT + code:49"]), "SUPER + SHIFT + ~")
})

test("parsePresses filters by time and skips junk", () => {
  const p = M.parsePresses("100\tSUPER + 1\tSwitch to workspace 1\ngarbage\n50\tSUPER + 2\tx\nabc\tA\tB", 60)
  assert.strictEqual(p.length, 1)
  assert.strictEqual(p[0].combo, "SUPER + 1")
})

const pressesText = [
  "100\tSUPER + 1\tSwitch to workspace 1",
  "101\tSUPER + 2\tSwitch to workspace 2",
  "102\tSUPER + 1\tSwitch to workspace 1",
  "103\tSUPER + RETURN\tTerminal",
  "104\tSUPER + RETURN\tTerminal",
  "105\tSUPER + RETURN\tTerminal",
  "106\tSUPER + RETURN\tTerminal",
  "107\tSUPER + LEFT\tFocus on left window",
  "108\tSUPER + T\tGone bind",
].join("\n")

test("summarize counts by family, including removed binds", () => {
  const s = M.summarize(M.parseCatalog(catalogText), M.parsePresses(pressesText, 0))
  const ws = s.families.find(f => f.key === "Switch to workspace {n}")
  assert.strictEqual(ws.count, 3)
  assert.strictEqual(ws.label, "Switch to workspace 1–10")
  const gone = s.families.find(f => f.key === "Gone bind")
  assert.strictEqual(gone.count, 1)
  assert.strictEqual(gone.live, false)
  assert.strictEqual(s.total, 9)
})

test("topUsed sorts by count", () => {
  const s = M.summarize(M.parseCatalog(catalogText), M.parsePresses(pressesText, 0))
  const top = M.topUsed(s, 2)
  assert.deepStrictEqual(top.map(f => f.key), ["Terminal", "Switch to workspace {n}"])
})

test("recommendations skip habits, passive, hardware and removed binds", () => {
  const s = M.summarize(M.parseCatalog(catalogText), M.parsePresses(pressesText, 0))
  const recs = M.recommendations(s).map(f => f.key)
  assert.ok(!recs.includes("Terminal"), "habit")
  assert.ok(!recs.includes("Switch to workspace {n}"), "habit")
  assert.ok(!recs.includes("Move window"), "passive")
  assert.ok(!recs.includes("Mute"), "hardware")
  assert.ok(!recs.includes("Gone bind"), "removed")
  assert.strictEqual(recs[0], "Keybindings")
  // Used once: still recommended, but below an unused shortcut of equal weight.
  assert.ok(recs.includes("Focus on {d} window"))
})

test("coverage counts live trackable families", () => {
  const s = M.summarize(M.parseCatalog(catalogText), M.parsePresses(pressesText, 0))
  // live trackable: workspace, focus, close, terminal, omasnap, mute, keybindings = 7; used: 3
  assert.ok(Math.abs(M.coverage(s) - 3 / 7) < 1e-9)
})

test("page wraps around", () => {
  assert.deepStrictEqual(M.page([1, 2, 3, 4, 5], 1, 3), [4, 5, 1])
  assert.deepStrictEqual(M.page([1, 2], 3, 3), [1, 2])
})

test("markup-shaped descriptions survive as plain data, clipped", () => {
  const evil = '<img src="https://example.invalid/t">' + "x".repeat(500)
  const c = M.parseCatalog("bind\tSUPER + Z\t" + evil + "\t")
  assert.strictEqual(c[0].description.length, 120)
  assert.ok(c[0].description.startsWith("<img"))
})

if (failed) { console.log(failed + " failed"); process.exit(1) }
console.log("all passed")
