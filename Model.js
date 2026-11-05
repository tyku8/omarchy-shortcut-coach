.pragma library

// Pure logic for Shortcut Coach: parse the tracker's files, group binds into
// families, count usage, and pick recommendations. Kept free of QML so it can
// be tested with node (tests/model.test.js).

var MAX_LINES = 50000
var MAX_TEXT = 120

// Shortcuts most Omarchy users lean on, by family key (see familyKey). The
// weight is how much a habit pays off; anything not listed counts as 1.
// Families missing from the live catalog are ignored, so a renamed default
// simply drops out.
var POPULAR = {
  "Switch to workspace {n}": 10,
  "Omarchy menu": 10,
  "Terminal": 9,
  "Apps": 9,
  "Keybindings": 9,
  "Move window to workspace {n}": 9,
  "Close window": 8,
  "Browser": 8,
  "Full screen": 8,
  "Toggle window floating/tiling": 8,
  "Former workspace": 8,
  "Focus on {d} window": 7,
  "Swap window {d}": 7,
  "Toggle window split": 7,
  "Clipboard manager": 7,
  "Screenshot": 7,
  "File manager": 7,
  "Toggle scratchpad": 6,
  "Next workspace": 6,
  "Focus on next window": 6,
  "Lock system": 6,
  "Universal copy": 6,
  "Universal paste": 6,
  "Move window silently to workspace {n}": 6,
  "Dismiss last notification": 5,
  "Previous workspace": 5,
  "Move window to scratchpad": 5,
  "Toggle window grouping": 5,
  "Pop window out (float & pin)": 5,
  "Extract text (OCR) from screenshot": 5,
  "Move window to {d} monitor": 5,
  "Cycle workspace layout": 5,
  "Expand window {d}": 4,
  "Shrink window {d}": 4,
  "Move workspace to {d} monitor": 4,
  "Open notification history": 4,
  "Toggle silencing notifications": 4,
  "Screenrecording": 4,
  "Minimize window to the dock": 4,
  "Tiled full screen": 4,
  "Full width": 4,
  "Capture menu": 4,
  "Emojis": 4,
  "Color picker": 3,
  "Set reminder": 3,
  "Toggle top bar": 3,
  "Theme menu": 3,
  "Background switcher": 3,
  "Toggle window gaps": 3,
  "Share": 3
}

// Below this many uses in the window, a shortcut is not a habit yet.
var HABIT_THRESHOLD = 3

var DIRECTION_RE = /\b(to the left|to the right|left|right|up|down|above|below)\b/i
var NUMBER_RE = /\b\d+\b/

function clip(text) {
  var s = String(text === undefined || text === null ? "" : text)
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s
}

function lines(text) {
  var all = String(text || "").split("\n")
  return all.length > MAX_LINES ? all.slice(all.length - MAX_LINES) : all
}

// "Focus on left window" -> { key: "Focus on {d} window", part: "left" }
// "Switch to workspace 4" -> { key: "Switch to workspace {n}", part: "4" }
function familyKey(description) {
  var d = clip(description).trim()
  var m = d.match(DIRECTION_RE)
  if (m) return { key: d.replace(DIRECTION_RE, "{d}"), part: m[1].toLowerCase(), kind: "d" }
  m = d.match(NUMBER_RE)
  if (m) return { key: d.replace(NUMBER_RE, "{n}"), part: m[0], kind: "n" }
  return { key: d, part: "", kind: "" }
}

// catalog.tsv: "bind\tCOMBO\tDESCRIPTION\tFLAGS" and "unbind\tCOMBO", in
// config order. Returns the live binds that have a description.
function parseCatalog(text) {
  // One key can carry several binds (a consuming one plus non-consuming
  // ones), so keep every entry and let an unbind remove them all.
  var entries = []
  var rows = lines(text)
  for (var i = 0; i < rows.length; i++) {
    var f = rows[i].split("\t")
    if (f[0] === "bind" && f.length >= 3) {
      entries.push({ combo: clip(f[1]), description: clip(f[2]), passive: f[3] === "passive", removed: false })
    } else if (f[0] === "unbind" && f.length >= 2) {
      var all = String(f[1]).toLowerCase() === "all"
      var target = clip(f[1])
      for (var j = 0; j < entries.length; j++) {
        if (all || entries[j].combo === target) entries[j].removed = true
      }
    }
  }
  return entries
    .filter(function(e) { return !e.removed && e.description !== "" })
    .map(function(e) { return { combo: e.combo, description: e.description, passive: e.passive } })
}

// presses.tsv: "EPOCH\tCOMBO\tDESCRIPTION". Returns presses at or after
// sinceEpoch (0 = all).
function parsePresses(text, sinceEpoch) {
  var out = []
  var rows = lines(text)
  for (var i = 0; i < rows.length; i++) {
    var f = rows[i].split("\t")
    if (f.length < 3) continue
    var t = parseInt(f[0], 10)
    if (!(t > 0) || t < (sinceEpoch || 0)) continue
    out.push({ time: t, combo: clip(f[1]), description: clip(f[2]) })
  }
  return out
}

var ARROWS = { LEFT: "←", RIGHT: "→", UP: "↑", DOWN: "↓" }

// Omarchy binds the number row by keycode so it works on any layout.
var KEYCODES = {
  "code:10": "1", "code:11": "2", "code:12": "3", "code:13": "4", "code:14": "5",
  "code:15": "6", "code:16": "7", "code:17": "8", "code:18": "9", "code:19": "0",
  "code:20": "MINUS", "code:21": "EQUAL", "code:34": "[", "code:35": "]", "code:49": "~"
}

function displayCombo(combo) {
  var parts = String(combo).split(" + ")
  var last = parts.length - 1
  if (parts[last] in KEYCODES) parts[last] = KEYCODES[parts[last]]
  return parts.join(" + ")
}

function splitCombo(combo) {
  var parts = displayCombo(combo).split(" + ")
  return { mods: parts.slice(0, -1).join(" + "), key: parts[parts.length - 1] }
}

// One readable key label for a family: "SUPER + 1…0", "SUPER + ←→↑↓",
// "SUPER + W / Q", or the shortest chord plus how many alternatives exist.
function familyKeys(combos) {
  if (combos.length === 0) return ""
  if (combos.length === 1) return displayCombo(combos[0])
  var split = combos.map(splitCombo)
  var mods = split[0].mods
  var same = split.every(function(s) { return s.mods === mods })
  if (!same) {
    var shortest = combos.map(displayCombo).sort(function(a, b) { return a.length - b.length })[0]
    return shortest + "  +" + (combos.length - 1)
  }
  var keys = split.map(function(s) { return s.key })
  var prefix = mods ? mods + " + " : ""
  if (keys.every(function(k) { return /^\d$/.test(k) })) return prefix + "1…0"
  if (keys.every(function(k) { return k in ARROWS })) return prefix + keys.map(function(k) { return ARROWS[k] }).join("")
  return prefix + keys.join(" / ")
}

function familyLabel(key, parts, kind) {
  if (kind === "n") {
    var nums = parts.map(function(p) { return parseInt(p, 10) }).sort(function(a, b) { return a - b })
    var span = nums.length > 1 ? nums[0] + "–" + nums[nums.length - 1] : String(nums[0])
    return key.replace("{n}", span)
  }
  if (kind === "d") return key.replace("{d}", parts.join("/"))
  return key
}

// Group binds into families and attach usage counts from presses.
function summarize(catalog, presses) {
  var families = {}
  var byCombo = {}
  var order = []

  function familyFor(description) {
    var f = familyKey(description)
    if (!(f.key in families)) {
      families[f.key] = { key: f.key, kind: f.kind, parts: [], combos: [], count: 0, lastUsed: 0, passive: true }
      order.push(f.key)
    }
    var fam = families[f.key]
    if (f.part && fam.parts.indexOf(f.part) < 0) fam.parts.push(f.part)
    return fam
  }

  for (var i = 0; i < catalog.length; i++) {
    var b = catalog[i]
    var fam = familyFor(b.description)
    if (fam.combos.indexOf(b.combo) < 0) fam.combos.push(b.combo)
    if (!b.passive) fam.passive = false
    byCombo[b.combo] = fam
    byCombo[b.combo + "\t" + b.description] = fam
  }

  var total = 0
  for (var j = 0; j < presses.length; j++) {
    var p = presses[j]
    // Prefer the live bind for this combo; fall back to the logged description
    // for binds that have since been removed.
    var target = byCombo[p.combo + "\t" + p.description] || byCombo[p.combo] || (p.description ? familyFor(p.description) : null)
    if (!target) continue
    if (target.combos.length === 0) target.combos.push(p.combo)
    target.count++
    if (p.time > target.lastUsed) target.lastUsed = p.time
    total++
  }

  var list = order.map(function(k) {
    var f = families[k]
    return {
      key: f.key,
      label: familyLabel(f.key, f.parts, f.kind),
      keys: familyKeys(f.combos),
      count: f.count,
      lastUsed: f.lastUsed,
      passive: f.passive,
      live: f.combos.some(function(c) { return c in byCombo }),
      weight: POPULAR[f.key] || 1,
      popular: f.key in POPULAR
    }
  })

  return { families: list, total: total }
}

function topUsed(summary, limit) {
  return summary.families
    .filter(function(f) { return f.count > 0 })
    .sort(function(a, b) { return b.count - a.count || b.lastUsed - a.lastUsed })
    .slice(0, limit)
}

// Live, trackable shortcuts that aren't a habit yet, best payoff first.
// Hardware keys (XF86…) are skipped: nobody needs reminding of a volume key.
function recommendations(summary) {
  return summary.families
    .filter(function(f) {
      if (!f.live || f.passive || f.count >= HABIT_THRESHOLD) return false
      return f.keys.indexOf("XF86") < 0
    })
    .map(function(f) {
      var score = f.weight * (1 - f.count / HABIT_THRESHOLD)
      return Object.assign({}, f, { score: score })
    })
    .sort(function(a, b) { return b.score - a.score || (a.label < b.label ? -1 : 1) })
}

// Share of live, trackable shortcut families used at least once.
function coverage(summary) {
  var live = summary.families.filter(function(f) { return f.live && !f.passive })
  if (live.length === 0) return 0
  var used = live.filter(function(f) { return f.count > 0 }).length
  return used / live.length
}

function sinceFor(rangeDays, nowEpoch) {
  return rangeDays > 0 ? nowEpoch - rangeDays * 86400 : 0
}

// Recommendations shown as a page of `size`, starting at `page`, wrapping.
function page(list, pageIndex, size) {
  if (list.length <= size) return list
  var start = (pageIndex * size) % list.length
  var out = []
  for (var i = 0; i < size && i < list.length; i++) out.push(list[(start + i) % list.length])
  return out
}

if (typeof module !== "undefined") {
  module.exports = {
    POPULAR: POPULAR, HABIT_THRESHOLD: HABIT_THRESHOLD,
    familyKey: familyKey, parseCatalog: parseCatalog, parsePresses: parsePresses,
    familyKeys: familyKeys, displayCombo: displayCombo, familyLabel: familyLabel, summarize: summarize,
    topUsed: topUsed, recommendations: recommendations, coverage: coverage,
    sinceFor: sinceFor, page: page
  }
}
