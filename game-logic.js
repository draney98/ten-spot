/* =====================================================================
   NUMBER MATCH — PURE GAME LOGIC
   ---------------------------------------------------------------------
   * No DOM. No timers. No randomness except through the `rng` argument.
   * Every "action" function takes a state and returns { state, event }.
     It NEVER changes the state it was given; it returns a new object.
   * Works in the browser (window.NumberMatchLogic) and in Node
     (require('./game-logic.js')) so it can be unit-tested.
   ===================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NumberMatchLogic = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Columns per difficulty. Rows are implicit: index i is
      row Math.floor(i / cols), column i % cols. A missing width is 9,
      so an old link fixture still describes a 9-wide board. Play always
      passes the deal's width. */
  function colsFor(diff) {
    if (diff === 'easy') return 7;
    if (diff === 'hard') return 9;
    return 8;
  }
  function width(cols) { return cols || 9; }
  function boardCols(s) { return (s && s.cols) || colsFor(s && s.diff); }

  /* THE RAMP. One run climbs from level 1 for as long as you last. Nothing depends on a
     difficulty setting any more: every rule comes from the level.
     Each row is true FROM its level on, until the next row. Tuned with tools/sim.js:
     about 10% of runs reach level 71 and 1-2% reach level 81. */
  var RAMP = [
    { from: 1,  kinds: 3, adds: 6, walls: 0 },
    { from: 11, kinds: 3, adds: 5, walls: 0 },
    { from: 15, kinds: 4, adds: 5, walls: 0 },
    { from: 19, kinds: 5, adds: 5, walls: 0 },
    { from: 23, kinds: 6, adds: 5, walls: 0 },
    { from: 27, kinds: 6, adds: 4, walls: 0 },
    { from: 31, kinds: 7, adds: 4, walls: 0 },
    { from: 40, kinds: 7, adds: 4, walls: 1 },
    { from: 46, kinds: 7, adds: 4, walls: 2 },
    { from: 53, kinds: 7, adds: 4, walls: 1 },   // the board goes 9 wide here, so one wall goes away
    { from: 59, kinds: 7, adds: 3, walls: 1 },
    { from: 65, kinds: 7, adds: 3, walls: 2 },
    { from: 76, kinds: 7, adds: 3, walls: 3 }
  ];
  /* The buttons you have. Infinity means unlimited. Undo is never unlimited: with unlimited
     undo any board can be won by stepping back and trying again (tools/sim.js style bot:
     level 70 losses 20% -> 7%), while 1-10 undos only forgive slips. Easy 5, Normal 3, Hard 1. addAt = Add works once this many pairs
     or fewer are left. mistake = pressing Add sooner costs points and the streak
     (otherwise the button is just greyed out). Each row lands away from the RAMP rows. */
  var TOOLS = [
    { from: 1,  hints: Infinity, undos: 5,        packs: 0,        addAt: 2, mistake: false },
    { from: 10, hints: Infinity, undos: 5,        packs: Infinity, addAt: 2, mistake: false },
    { from: 20, hints: 5,        undos: 5,        packs: Infinity, addAt: 2, mistake: false },
    { from: 30, hints: 3,        undos: 5,        packs: 3,        addAt: 1, mistake: true },
    { from: 37, hints: 3,        undos: 3,        packs: 3,        addAt: 1, mistake: true },   // Normal: 3 undos
    { from: 45, hints: 1,        undos: 3,        packs: 3,        addAt: 1, mistake: true },
    { from: 53, hints: 1,        undos: 1,        packs: 3,        addAt: 1, mistake: true },   // Hard: 1 undo (a wall goes away here too)
    { from: 55, hints: 0,        undos: 1,        packs: 3,        addAt: 0, mistake: true },
    { from: 62, hints: 0,        undos: 1,        packs: 2,        addAt: 0, mistake: true }
  ];
  /* Stage names. A run can start at Easy (level 1), or at Normal / Hard once the player
     has reached them. `diff` in the game state is the start point (bests are kept per start). */
  var LEVELS = {
    easy:   { label: 'Easy',   start: 1 },
    normal: { label: 'Normal', start: 37 },
    hard:   { label: 'Hard',   start: 53 }
  };
  var DIAG = true;   // every level allows diagonal pairs
  var PACK_FROM = 10;

  function rowFor(table, level) {
    var lv = Math.max(1, level || 1), row = table[0];
    for (var i = 0; i < table.length; i++) if (table[i].from <= lv) row = table[i];
    return row;
  }
  function rampAt(level) { return rowFor(RAMP, level); }
  function toolsAt(level) { return rowFor(TOOLS, level); }
  /** 'easy' (levels 1-36), 'normal' (37-52) or 'hard' (53 on). */
  function stageOf(level) {
    var lv = level || 1;
    return lv >= LEVELS.hard.start ? 'hard' : lv >= LEVELS.normal.start ? 'normal' : 'easy';
  }
  /** Tiles rise by 2 every 2 levels, from 12 at level 1 to 80 at level 69. */
  function tilesAt(level) { return Math.min(80, 10 + 2 * Math.ceil(Math.max(1, level || 1) / 2)); }
  /** The board is as wide as it needs to be to hold the tiles and walls as a square:
      5 x 5, 6 x 6 ... 9 x 9 (odd squares keep the centre spot blank). Never wider than 9. */
  function widthAt(level) {
    var need = tilesAt(level) + rampAt(level).walls;
    for (var w = 5; w <= 9; w++) if (w * w - (w % 2) >= need) return w;
    return 9;
  }

  /** Gridiron. Value v belongs to mascot Math.ceil(v / 2):
      odd v = outline, even v = solid twin. Any two tiles of the
      same mascot match (outline+solid, or two identical tiles). */
  var MAX_MASCOTS = 8;

  var HISTORY_LIMIT = 200;
  /** Positions canClear will explore before it gives up and returns null. */
  var CLEAR_BUDGET = 20000;
  /** While isBeatable is searching, finish must not run canClear again. */
  var inBeatable = 0;

  var SCORE = {
    base: 10,          // every pair
    perGap: 2,         // per crossed-out cell between the two tiles
    diagonal: 5,       // extra for a diagonal pair
    wrap: 5,           // extra for a pair joined across the end of a row
    sameStyle: 2,      // two outlines, or two shaded: points x2
    streakStep: 0.1,   // streak multiplier grows 0.1 per pair in a row
    streakMax: 2,      // ...up to x2
    row: 30,           // row bonus = 30 x (rows emptied by this pair)^2
    wall: 50,          // + 50 for each wall that leaves with its row (x mult)
    sweep: 25,         // clean sweep: + 25 per pair (x mult), on top of each pair's own points
    levelPerLevel: 100,// level bonus = 100 x level ...
    parAdd: 200,       // ... + 200 for each match under par
    hintCost: 25,      // points, x mult
    undoCost: 5        // points, x mult
  };

  /* ------------------------------------------------------------------
     BOARDS
     ------------------------------------------------------------------ */

  /** How many tiles a level starts with (see tilesAt). The diff argument is ignored. */
  function boardSize(level, diff) { return tilesAt(level); }

  /** Gridiron: mascots in play on a level (see RAMP). */
  function mascots(level, diff) {
    return kindCount(diff, level, 'pairs');
  }
  function mascotOf(v) { return Math.ceil(v / 2); }   // 1..8
  function isSolid(v) { return v % 2 === 0; }

  /** Gridiron board: an even share of pairs per mascot. Each pair prefers one version (3/8 both outline,
      3/8 both solid, 1/4 one of each). Shuffle. */
  function pairsBoard(level, rng, diff) {
    var fams = mascots(level, diff);
    var pairCount = boardSize(level, diff) / 2;
    var base = Math.floor(pairCount / fams);
    var extra = pairCount % fams;
    var counts = [];
    var order = [];
    for (var f = 0; f < fams; f++) { counts.push(base); order.push(f); }
    shuffle(order, rng);
    for (var e = 0; e < extra; e++) counts[order[e]]++;
    var vals = [];
    for (var m = 0; m < fams; m++) {
      var outline = 2 * m + 1, solid = 2 * m + 2;
      for (var p = 0; p < counts[m]; p++) {
        var roll = rng();
        if (roll < 0.375) vals.push(outline, outline);
        else if (roll < 0.75) vals.push(solid, solid);
        else vals.push(outline, solid);
      }
    }
    return shuffle(vals, rng);
  }

  function shuffle(vals, rng) {
    for (var j = vals.length - 1; j > 0; j--) {
      var k = Math.floor(rng() * (j + 1));
      var t = vals[j]; vals[j] = vals[k]; vals[k] = t;
    }
    return vals;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), a | 1);
      t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function nextSeed(seed) { return (seed + 0x9E3779B9) >>> 0; }

  function randomSeed() {
    var buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0];
  }

  function seekSeed(seed, build, ok) {
    var s = seed >>> 0;
    for (var i = 0; i < 32; i++) {
      var board = build(s);
      if (ok(board)) return board;
      s = nextSeed(s);
    }
    throw new Error('no beatable board');
  }

  /** A board code is the level and the seed, e.g. "41-1a2b3c4d".
      Returns null if it isn't a code, or { old: true } for a code from before the ramp. */
  function parsePuzzle(text) {
    var t = String(text || '').trim().toLowerCase();
    if (/^(easy|normal|hard)-\d+-teams-[0-9a-f]{8}$/.test(t)) return { old: true };
    var m = /^(\d+)-([0-9a-f]{8})$/.exec(t);
    if (!m) return null;
    var level = Number(m[1]);
    if (level < 1 || level > 999) return null;
    return { diff: stageOf(level), level: level, mode: 'teams', seed: parseInt(m[2], 16) };
  }

  function formatPuzzle(spec) {
    var hex = (spec.seed >>> 0).toString(16);
    while (hex.length < 8) hex = '0' + hex;
    return spec.level + '-' + hex;
  }

  /** How many mascots a level uses (see RAMP). The diff argument is ignored. */
  function kindCount(diff, level) {
    return Math.min(MAX_MASCOTS, rampAt(level).kinds);
  }

  function makeBoard(level, rng, rules, diff) {
    return pairsBoard(level, rng || Math.random, diff);
  }

  /* ------------------------------------------------------------------
     RULE HELPERS
     ------------------------------------------------------------------ */

  /** Adds allowed on a level (see RAMP). The diff argument is ignored. */
  function addsFor(diff, level) {
    return rampAt(level).adds;
  }

  /** Point multiplier: x1 on level 1, +0.1 a level (x4.6 at 37, x6.2 at 53, x7.9 at 70). */
  function pointMult(diff, level) {
    return Math.round((1 + 0.1 * ((level || 1) - 1)) * 10) / 10;
  }

  /** Same mascot. The rules argument is ignored; every deal is Gridiron. */
  function matches(x, y) {
    return x > 0 && y > 0 && mascotOf(x) === mascotOf(y);   // a wall (v = -1) never matches
  }

  /* WALLS. A wall is a cell with v = WALL (-1). It is never done and never matches, so it blocks
     every path through it. It can't be selected, and Add never copies it. When every tile
     in its row is cleared, the row is removed and the wall goes with it. */
  var WALL = -1;
  function isWall(c) { return c.v === WALL; }
  /** A row is gone when it has no tiles left: every cell is cleared or a wall. */
  function rowGone(row) {
    var tile = false;
    for (var i = 0; i < row.length; i++) {
      if (isWall(row[i])) continue;
      if (!row[i].done) return false;
      tile = true;
    }
    return tile;
  }
  /** How many walls a level is dealt with (see RAMP). The diff argument is ignored. */
  function wallCount(diff, level) {
    return rampAt(level).walls;
  }
  /** On an odd square that is exactly full (5 x 5, 7 x 7, 9 x 9) the centre spot is blank:
      an empty spot that starts cleared, so paths pass through it. v = BLANK (0). */
  var BLANK = 0;
  function isBlank(c) { return c.v === BLANK && c.done; }
  function placeBlank(vals, cols) {
    var w = width(cols);
    if (w % 2 === 0 || vals.length !== w * w - 1) return vals;
    var out = vals.slice();
    out.splice((w * w - 1) / 2, 0, { v: BLANK, done: true });
    return out;
  }
  /** Put `count` walls into the tile list, each in a different row and never in the last row. */
  function placeWalls(vals, count, cols, rng) {
    if (!count) return vals;
    var w = width(cols);
    var rows = Math.floor((vals.length + count - 1) / w);   // rows before the last one
    var pick = [];
    for (var r = 0; r < rows; r++) pick.push(r);
    shuffle(pick, rng);
    pick = pick.slice(0, Math.min(count, pick.length)).sort(function (a, b) { return a - b; });
    var out = vals.slice();
    for (var k = 0; k < pick.length; k++) {
      var at = pick[k] * w + Math.floor(rng() * w);
      out.splice(at, 0, { v: WALL });
    }
    return out;
  }

  /** Can cells at indexes a and b be paired (position rule only)?
      TRUE if ANY of these is true:
        1. Reading order: every cell strictly between a and b (in the flat
           left-to-right, top-to-bottom list) is done. This covers
           horizontal neighbours AND wrapping from the end of one row to
           the start of the next.
        2. Same column, and every cell between them in that column is done.
        3. (only if diag) Exact diagonal (|row diff| === |col diff|), and
           every cell between them on that diagonal is done.            */
  function canLink(cells, a, b, diag, cols) {
    if (a > b) { var t = a; a = b; b = t; }
    if (a === b) return false;

    var clear = true;
    for (var k = a + 1; k < b; k++) {
      if (!cells[k].done) { clear = false; break; }
    }
    if (clear) return true;

    var w = width(cols);
    var ra = Math.floor(a / w), ca = a % w;
    var rb = Math.floor(b / w), cb = b % w;
    var dr = rb - ra, dc = cb - ca;
    if (dr <= 0) return false; // same row and rule 1 failed

    if (dc === 0 || (diag && Math.abs(dc) === dr)) {
      var step = Math.sign(dc); // 0 for vertical, ±1 for diagonal
      for (var s = 1; s < dr; s++) {
        if (!cells[(ra + s) * w + ca + s * step].done) return false;
      }
      return true;
    }
    return false;
  }

  /** Nearest live cell in each direction. A live tile can pair only with these:
      0 right and 1 left in reading order, 2 down and 3 up the column,
      4 down-right, 5 up-left, 6 down-left, 7 up-right.
      Forward directions (0, 2, 4, 6) are enough to list each pair once. */
  var LINK_FWD = [0, 2, 4, 6];
  var LINK_OPP = [1, 0, 3, 2, 5, 4, 7, 6];

  function buildNext(cells, diag, cols) {
    var n = cells.length;
    var w = width(cols);
    var next = new Array(8);
    for (var d = 0; d < 8; d++) {
      next[d] = new Array(n);
      for (var i = 0; i < n; i++) next[d][i] = -1;
    }
    var prev = -1;
    for (var i = 0; i < n; i++) {
      if (cells[i].done) continue;
      if (prev >= 0) { next[0][prev] = i; next[1][i] = prev; }
      prev = i;
    }
    var colPrev = new Array(w);
    for (var c = 0; c < w; c++) colPrev[c] = -1;
    for (var i = 0; i < n; i++) {
      if (cells[i].done) continue;
      var col = i % w;
      var up = colPrev[col];
      if (up >= 0) { next[2][up] = i; next[3][i] = up; }
      colPrev[col] = i;
    }
    if (diag) {
      var downRight = Object.create(null);
      var downLeft = Object.create(null);
      for (var i = 0; i < n; i++) {
        if (cells[i].done) continue;
        var r = Math.floor(i / w), cc = i % w;
        var keyR = cc - r;
        var predR = downRight[keyR];
        if (predR !== undefined) { next[4][predR] = i; next[5][i] = predR; }
        downRight[keyR] = i;
        var keyL = cc + r;
        var predL = downLeft[keyL];
        if (predL !== undefined) { next[6][predL] = i; next[7][i] = predL; }
        downLeft[keyL] = i;
      }
    }
    return next;
  }

  /** Sorted partner indexes with a higher index than i. At most one per forward direction. */
  function partnerIndexes(next, i) {
    var js = [];
    for (var f = 0; f < LINK_FWD.length; f++) {
      var j = next[LINK_FWD[f]][i];
      if (j <= i) continue;
      var seen = false;
      for (var u = 0; u < js.length; u++) if (js[u] === j) seen = true;
      if (!seen) js.push(j);
    }
    js.sort(function (a, b) { return a - b; });
    return js;
  }

  function listPairs(cells, next, rules) {
    var out = [];
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].done) continue;
      var js = partnerIndexes(next, i);
      for (var t = 0; t < js.length; t++) {
        var j = js[t];
        if (matches(cells[i].v, cells[j].v, rules)) out.push([i, j]);
      }
    }
    return out;
  }

  /** First legal pair [i, j] (indexes, i < j) or null.
      preferSame: return a pair with no mixed-shade penalty if there is one. */
  function findPair(cells, diag, rules, preferSame, cols) {
    var first = null;
    var next = buildNext(cells, diag, cols);
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].done) continue;
      var js = partnerIndexes(next, i);
      for (var t = 0; t < js.length; t++) {
        var j = js[t];
        if (!matches(cells[i].v, cells[j].v, rules)) continue;
        if (!preferSame || !tilesMixed(cells[i], cells[j], rules)) return [i, j];
        if (!first) first = [i, j];
      }
    }
    return first;
  }

  /** Every legal pair [i, j] (indexes, i < j). Order matters for solvability. */
  function allPairs(cells, diag, rules, cols) {
    return listPairs(cells, buildNext(cells, diag, cols), rules);
  }

  function copyCell(c, done) {
    var o = { id: c.id, v: c.v, done: done == null ? c.done : done };
    if (typeof c.solid === 'boolean') o.solid = c.solid;
    return o;
  }

  function copyCells(cells) {
    return cells.map(function (c) { return copyCell(c); });
  }

  function positionKey(cells) {
    var parts = [];
    for (var i = 0; i < cells.length; i++) {
      if (!cells[i].done) parts.push(i + ':' + cells[i].v);
    }
    return parts.join(',');
  }

  function hasLive(cells) {
    for (var i = 0; i < cells.length; i++) if (!cells[i].done && !isWall(cells[i])) return true;
    return false;
  }

  function mascotCounts(cells) {
    var counts = Object.create(null);
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].done || isWall(cells[i])) continue;
      var m = mascotOf(cells[i].v);
      counts[m] = (counts[m] || 0) + 1;
    }
    return counts;
  }

  function markDone(cells, a, b) {
    return cells.map(function (c, i) {
      return (i === a || i === b) ? copyCell(c, true) : c;
    });
  }

  /** Legal pairs, row-clearing ones first, then a mascot that has only two left.
      Scan order is kept inside a tier. */
  function orderedPairs(cells, diag, rules, cols) {
    var pairs = allPairs(cells, diag, rules, cols);
    var rows = doneRows(cells, cols).length;
    var counts = mascotCounts(cells);
    var ranked = pairs.map(function (p, i) {
      var marked = markDone(cells, p[0], p[1]);
      var tier = doneRows(marked, cols).length > rows ? 2 : 0;
      if (counts && counts[mascotOf(cells[p[0]].v)] === 2) tier += 1;
      return { p: p, i: i, tier: tier };
    });
    ranked.sort(function (a, b) { return b.tier - a.tier || a.i - b.i; });
    return ranked.map(function (r) { return r.p; });
  }

  /** Depth-first search over legal pairs, compacting after every move.
      result is true (some line clears the board), false (every line sticks),
      or null (gave up after `budget` positions). ids is a winning first pair. */
  function clearingSearch(cells, diag, rules, budget, cols) {
    if (budget == null) budget = CLEAR_BUDGET;
    var visited = 0;
    var memo = Object.create(null);

    function rec(cells) {
      cells = compact(cells, cols);
      var key = positionKey(cells);
      if (Object.prototype.hasOwnProperty.call(memo, key)) return memo[key];
      if (!hasLive(cells)) { memo[key] = true; return true; }
      if (visited >= budget) return null;
      visited++;
      var pairs = orderedPairs(cells, diag, rules, cols);
      var unknown = false;
      for (var n = 0; n < pairs.length; n++) {
        var result = rec(markDone(cells, pairs[n][0], pairs[n][1]));
        if (result === true) { memo[key] = true; return true; }
        if (result === null) unknown = true;
      }
      if (unknown) return null;
      memo[key] = false;
      return false;
    }

    var base = compact(copyCells(cells), cols);
    var key = positionKey(base);
    if (!hasLive(base)) return { result: true, ids: null };
    if (visited >= budget) return { result: null, ids: null };
    visited++;
    var pairs = orderedPairs(base, diag, rules, cols);
    var unknown = false;
    for (var n = 0; n < pairs.length; n++) {
      var pair = pairs[n];
      var result = rec(markDone(base, pair[0], pair[1]));
      if (result === true) {
        memo[key] = true;
        return { result: true, ids: [base[pair[0]].id, base[pair[1]].id] };
      }
      if (result === null) unknown = true;
    }
    if (unknown) return { result: null, ids: null };
    memo[key] = false;
    return { result: false, ids: null };
  }

  /** true if some sequence of legal pairs clears every cell, false if every
      sequence gets stuck, null if the search stops after `budget` positions. */
  function canClear(cells, diag, rules, budget, cols) {
    return clearingSearch(cells, diag, rules, budget, cols).result;
  }

  /** Fingerprint for memoizing beatability search. */
  function beatableKey(s) {
    var parts = ['pairs', s.addsLeft, boardCols(s)];
    for (var i = 0; i < s.cells.length; i++) {
      var c = s.cells[i];
      parts.push(c.done ? 'x' : c.v);
    }
    return parts.join('|');
  }

  /** True if the board can reach status 'clear' via legal matches and Add
      (using remaining addsLeft). Does not use Hint or mismatches.
      With no adds left, a dead board (every line sticks) is false even when
      a pair is still legal. An unfinished search is not treated as dead. */
  var beatCacheKey = '';
  var beatCacheVal = false;
  function isBeatable(state) {
    if (!state) return false;
    if (state.status === 'clear' || remaining(state) === 0) return true;
    if (state.status === 'lose') return false;
    if (state.status !== 'playing') return false;
    var key = beatableKey(state) + '|' + state.diff + '|' + (state.level || 0);
    if (key === beatCacheKey) return beatCacheVal;
    var val;
    if ((state.addsLeft || 0) <= 0) {
      val = canClear(state.cells, DIAG, state.rules, null, boardCols(state)) !== false;
    } else {
      inBeatable++;
      try {
        val = beatableNow(state);
      } finally {
        inBeatable--;
      }
    }
    beatCacheKey = key;
    beatCacheVal = val;
    return val;
  }

  function beatableNow(state) {
    if (!state) return false;
    if (state.status === 'clear' || remaining(state) === 0) return true;
    if (state.status === 'lose') return false;
    if (state.status !== 'playing') return false;

    var seen = Object.create(null);
    var steps = 0;
    var aborted = false;
    var deadline = Date.now() + 40;
    function search(s) {
      if (s.status === 'clear' || remaining(s) === 0) return true;
      if (s.status !== 'playing') return false;
      if (aborted) return null;
      if (++steps > 30000 || ((steps & 127) === 0 && Date.now() > deadline)) {
        aborted = true;
        return null;
      }
      var key = beatableKey(s);
      if (seen[key]) return false;
      seen[key] = true;

      var diag = DIAG;
      var pairs = allPairs(s.cells, diag, s.rules, boardCols(s));
      for (var p = 0; p < pairs.length; p++) {
        var i = pairs[p][0], j = pairs[p][1];
        var r1 = select(s, s.cells[i].id);
        var r2 = select(r1.state, s.cells[j].id);
        if (!r2.event || r2.event.type !== 'match') continue;
        var next = r2.state;
        if (next.status === 'playing') next = compactBoard(next);
        if (search(next)) return true;
      }

      var unknown = false;
      if (canAdd(s)) {
        var added = addNumbers(s);
        if (added.event) {
          var addedResult = search(added.state);
          if (addedResult === true) return true;
          if (addedResult === null) unknown = true;
        }
      }
      if (unknown || aborted) return null;
      return false;
    }
    var found = search(state);
    return found !== false;
  }

  /** Row numbers whose cells are ALL done. */
  function doneRows(cells, cols) {
    var out = [];
    var w = width(cols);
    for (var r = 0; r * w < cells.length; r++) {
      var row = cells.slice(r * w, r * w + w);
      if (rowGone(row)) out.push(r);
    }
    return out;
  }

  /** Remove every row with no tiles left (walls in it go too). Remaining cells keep order. */
  function compact(cells, cols) {
    var out = [];
    var w = width(cols);
    for (var r = 0; r * w < cells.length; r++) {
      var row = cells.slice(r * w, r * w + w);
      if (!rowGone(row)) out = out.concat(row);
    }
    return out;
  }

  /** How a tile is drawn: odd outline, even solid. */
  function shadeOf(v) {
    return isSolid(v) ? 'solid' : 'outline';
  }
  /** Shade of a dealt cell. Gridiron shade follows the value, not a stored flag. */
  function shadeOfTile(tile) {
    var v = (tile && typeof tile === 'object') ? tile.v : tile;
    return shadeOf(v);
  }
  function tilesSame(x, y) {
    return shadeOfTile(x) === shadeOfTile(y);
  }
  function tilesMixed(x, y) {
    return shadeOfTile(x) !== shadeOfTile(y);
  }
  /** True when both tiles are outlines, or both are solid. */
  function sameShade(x, y) {
    return shadeOf(x) === shadeOf(y);
  }
  /** True when one tile is an outline and the other is solid (a "mixed" pair). */
  function mixedShade(x, y) {
    return shadeOf(x) !== shadeOf(y);
  }

  /** a, b = indexes in state.cells (either order). The pair is already known to be legal. */
  function linkInfo(cells, a, b, cols) {
    if (a > b) { var t = a; a = b; b = t; }
    var clear = true;
    for (var k = a + 1; k < b; k++) if (!cells[k].done) { clear = false; break; }
    var w = width(cols);
    var ra = Math.floor(a / w), rb = Math.floor(b / w);
    // 1. reading order wins if it is clear (same row = 'row', different rows = 'wrap')
    if (clear) return { kind: ra === rb ? 'row' : 'wrap', gaps: b - a - 1 };
    // 2. otherwise column, 3. otherwise diagonal
    var dr = rb - ra, dc = (b % w) - (a % w);
    return { kind: dc === 0 ? 'col' : 'diag', gaps: dr - 1 };
  }

  function streakMult(streak) {                 // streak = 1 for the first pair in a run
    return Math.min(SCORE.streakMax, 1 + SCORE.streakStep * (streak - 1));
  }
  /** Points for clearing cells a and b. Call BEFORE marking them done.
      rows = how many rows this pair empties (the existing rowsCleared.length).
      Same shade uses the tile's drawn shade, so a light 1 and a light 9 double. */
  function pairScore(state, a, b, streak, rows) {
    var cells = state.cells, mult = pointMult(state.diff, state.level);
    var li = linkInfo(cells, a, b, boardCols(state));
    var raw = SCORE.base + SCORE.perGap * li.gaps
            + (li.kind === 'diag' ? SCORE.diagonal : 0)
            + (li.kind === 'wrap' ? SCORE.wrap : 0);
    var same = tilesSame(cells[a], cells[b]);
    if (same) raw *= SCORE.sameStyle;
    var pair = Math.round(raw * streakMult(streak) * mult);
    var rowBonus = Math.round(SCORE.row * rows * rows * mult);
    return { gain: pair + rowBonus, pair: pair, rowBonus: rowBonus, kind: li.kind, gaps: li.gaps, same: same, streakMult: streakMult(streak) };
  }

  /** Matches the player has made. Two cleared tiles are one match. */
  function matchesMade(s) {
    return Math.floor((s.cleared || 0) / 2);
  }

  /** Bonus for clearing a level. Unused hints no longer pay. */
  function levelBonus(s) {
    var used = matchesMade(s);
    var underPar = Math.max(0, Math.round(s.par || 0) - used);
    return Math.round(pointMult(s.diff, s.level) * (SCORE.levelPerLevel * s.level + SCORE.parAdd * underPar));
  }

  function bonusParts(s) {
    var mult = pointMult(s.diff, s.level);
    var used = matchesMade(s);
    var par = Math.round(s.par || 0);
    var under = Math.max(0, par - used);
    return {
      levelPoints: Math.round(mult * SCORE.levelPerLevel * s.level),
      parPoints: Math.round(mult * SCORE.parAdd * under),
      under: under,
      used: used,
      par: par
    };
  }

  /** Wall-clock cap for one reference play-out. Past this, par is a generous match count. */
  var PAR_BUDGET_MS = 50;

  /** Matches it would take to add the whole board once per allowed add, then clear it.
      Higher than a careful game, so a timed-out par is never unfair. */
  function generousMatches(tileCount, cap) {
    var tiles = tileCount;
    for (var i = 0; i < cap; i++) tiles *= 2;
    return Math.ceil(tiles / 2);
  }

  function countLive(cells) {
    var n = 0;
    for (var i = 0; i < cells.length; i++) if (!cells[i].done && !isWall(cells[i])) n++;
    return n;
  }

  function rowLiveCounts(cells, cols) {
    var w = width(cols);
    var rows = Math.ceil(cells.length / w) || 0;
    var counts = new Array(rows);
    for (var r = 0; r < rows; r++) counts[r] = 0;
    for (var i = 0; i < cells.length; i++) {
      if (!cells[i].done && !isWall(cells[i])) counts[Math.floor(i / w)]++;
    }
    return counts;
  }

  /** Pointer board for the reference player. Clearing a tile only retargets its neighbours. */
  function linkBoard(cells, diag, rules, cols) {
    var w = width(cols);
    var next = buildNext(cells, diag, w);
    var rowLive = rowLiveCounts(cells, w);
    var count = listPairs(cells, next, rules).length;
    var live = countLive(cells);

    function incident(x, neigh) {
      var c = 0;
      for (var d = 0; d < 8; d++) {
        var y = neigh[d];
        if (y < 0) continue;
        var dup = false;
        for (var e = 0; e < d; e++) if (neigh[e] === y) dup = true;
        if (!dup && matches(cells[x].v, cells[y].v, rules)) c++;
      }
      return c;
    }

    function completesRow(i, j) {
      var ri = Math.floor(i / w), rj = Math.floor(j / w);
      if (ri === rj) return rowLive[ri] <= 2;
      return rowLive[ri] <= 1 || rowLive[rj] <= 1;
    }

    function drop(x, log) {
      var neigh = new Array(8);
      for (var d = 0; d < 8; d++) neigh[d] = next[d][x];
      count -= incident(x, neigh);
      log.push(['done', x]);
      cells[x].done = true;
      var row = Math.floor(x / w);
      rowLive[row]--;
      log.push(['row', row]);
      live--;
      for (var f = 0; f < LINK_FWD.length; f++) {
        var d = LINK_FWD[f];
        var opp = LINK_OPP[d];
        var nxt = neigh[d];
        var pred = neigh[opp];
        if (pred >= 0) {
          log.push(['ptr', d, pred, next[d][pred]]);
          next[d][pred] = nxt;
        }
        if (nxt >= 0) {
          log.push(['ptr', opp, nxt, next[opp][nxt]]);
          next[opp][nxt] = pred;
        }
        if (pred >= 0 && nxt >= 0 && matches(cells[pred].v, cells[nxt].v, rules)) {
          var dup = false;
          for (var e = 0; e < 8; e++) {
            if (e !== d && next[e][pred] === nxt) { dup = true; break; }
          }
          if (!dup) count++;
        }
      }
    }

    function undo(log) {
      for (var i = log.length - 1; i >= 0; i--) {
        var op = log[i];
        if (op[0] === 'ptr') next[op[1]][op[2]] = op[3];
        else if (op[0] === 'done') { cells[op[1]].done = false; live++; }
        else if (op[0] === 'row') rowLive[op[1]]++;
      }
    }

    function options(i, j) {
      if (completesRow(i, j)) {
        var marked = cells.map(function (c, k) {
          return (k === i || k === j) ? { id: c.id, v: c.v, done: true } : c;
        });
        var after = compact(marked, w);
        return listPairs(after, buildNext(after, diag, w), rules).length;
      }
      var saved = count;
      var log = [];
      drop(i, log);
      drop(j, log);
      var n = count;
      undo(log);
      count = saved;
      return n;
    }

    function play(i, j) {
      if (completesRow(i, j)) {
        var marked = cells.map(function (c, k) {
          return (k === i || k === j) ? { id: c.id, v: c.v, done: true } : c;
        });
        return linkBoard(compact(marked, w), diag, rules, w);
      }
      drop(i, []);
      drop(j, []);
      return api;
    }

    function added() {
      var extra = [];
      for (var i = 0; i < cells.length; i++) {
        if (!cells[i].done && !isWall(cells[i])) extra.push({ id: 0, v: cells[i].v, done: false });
      }
      return linkBoard(compact(cells.concat(extra), w), diag, rules, w);
    }

    var api = {
      live: function () { return live > 0; },
      pairs: function () { return listPairs(cells, next, rules); },
      options: options,
      play: play,
      added: added
    };
    return api;
  }

  /** Reference player: the pair that leaves the most legal pairs, else Add.
      Same board, same cap, same answer. Stops once adds reach `cap`.
      `{ adds, matches, cleared, timedOut }`. A match is one cleared pair; an add is not.
      On a time budget, matches is the generous count and timedOut is set. */
  function tidyPlay(values, diag, rules, cap, budgetMs, cols) {
    if (budgetMs == null) budgetMs = PAR_BUDGET_MS;
    var w = width(cols);
    var deadline = Date.now() + budgetMs;
    var cells = values.map(function (v, i) {
      return { id: i + 1, v: (v && typeof v === 'object') ? v.v : v, done: !!(v && typeof v === 'object' && v.done) };
    });
    var board = linkBoard(cells, diag, rules, w);
    var adds = 0, matches = 0, guard = 0;
    function unfinished(timedOut) {
      return {
        adds: cap,
        matches: timedOut ? generousMatches(values.length, cap) : matches,
        cleared: false,
        timedOut: !!timedOut
      };
    }
    while (board.live() && guard++ < 400) {
      if (Date.now() > deadline) return unfinished(true);
      var pairs = board.pairs();
      if (!pairs.length) {
        if (adds >= cap) return unfinished(false);
        board = board.added();
        adds++;
        continue;
      }
      var best = pairs[0], bestN = -1;
      for (var q = 0; q < pairs.length; q++) {
        if ((q & 31) === 0 && Date.now() > deadline) return unfinished(true);
        var n = board.options(pairs[q][0], pairs[q][1]);
        if (n > bestN) { bestN = n; best = pairs[q]; }
      }
      board = board.play(best[0], best[1]);
      matches++;
    }
    if (board.live()) return unfinished(false);
    return { adds: adds, matches: matches, cleared: true, timedOut: false };
  }

  function tidyAdds(values, diag, rules, cap, budgetMs, cols) {
    return tidyPlay(values, diag, rules, cap, budgetMs, cols).adds;
  }

  /* ------------------------------------------------------------------
     STATE
     ------------------------------------------------------------------
     {
       diff: 'easy'|'normal'|'hard',
       rules: 'pairs',                 // Gridiron
       cols: 7|8|9,                 // easy, normal, hard
       level: 1,
       cells: [{ id, v, done }],   // flat list, cols per row
       nextId: number,             // next cell id to hand out
       selected: null | cellId,
       moves, score, streak,
       par,                        // matches the reference player made on this board
       penalties,                  // total points lost to mismatches this game (Undo never gives them back)
       cleared, total,             // numbers cleared / numbers dealt this level
       addsLeft, hintsLeft, undosLeft, compactsLeft,
       history: [snapshot],        // for Undo (this level only)
       status: 'playing' | 'clear' | 'lose',
       reason: null | 'nopairs',  // set when status is 'lose'
       bonus, final,               // filled when status changes
       best: { easy, normal, hard },
       newBest: boolean
     }
     ------------------------------------------------------------------ */

  function copy(s) {
    var o = {};
    for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) o[k] = s[k];
    return o;
  }

  function levelFields(diff, level, rng) {
    var T = toolsAt(level);
    var cols = widthAt(level);
    var tiles = pairsBoard(level, rng || Math.random, diff);
    var walls = wallCount(diff, level);
    var vals = placeBlank(placeWalls(tiles, walls, cols, rng || Math.random), cols);
    var addsThisLevel = addsFor(diff, level);
    var play = tidyPlay(vals, DIAG, 'pairs', addsThisLevel, null, cols);
    return {
      level: level,
      rules: 'pairs',
      cols: cols,
      cells: vals.map(function (tile, i) {
        var v = (tile && typeof tile === 'object') ? tile.v : tile;
        var cell = { id: i + 1, v: v, done: !!(tile && typeof tile === 'object' && tile.done) };
        if (tile && typeof tile === 'object' && typeof tile.solid === 'boolean') cell.solid = tile.solid;
        return cell;
      }),
      nextId: vals.length + 1,
      selected: null,
      streak: 0,
      par: Math.round(play.matches),
      refClear: play.cleared || play.timedOut,
      cleared: 0,
      total: tiles.length,   // tiles only; walls are never cleared
      addsLeft: addsThisLevel,
      hintsLeft: T.hints,
      undosLeft: T.undos,
      compactsLeft: T.packs,
      history: [],
      status: 'playing',
      bonus: 0,
      final: 0,
      newBest: false,
      opening: vals.map(function (tile) {
        var v = (tile && typeof tile === 'object') ? tile.v : tile;
        var tile0 = { v: v };
        if (tile && typeof tile === 'object' && tile.done) tile0.done = true;
        if (tile && typeof tile === 'object' && typeof tile.solid === 'boolean') tile0.solid = tile.solid;
        return tile0;
      })
    };
  }

  /** Every deal is Gridiron. A rules argument is ignored. */
  function newGame(diff, best, rng) {
    var s = levelFields(diff, startLevel(diff), rng);
    s.diff = diff;
    s.moves = 0;
    s.score = 0;
    s.penalties = 0;
    s.best = best ? copy(best) : { easy: 0, normal: 0, hard: 0 };
    return s;
  }

  /** First level of a start point: Easy 1, Normal 37, Hard 53. */
  function startLevel(diff) { return (LEVELS[diff] || LEVELS.easy).start; }

  function dealPuzzle(spec) {
    return seekSeed(spec.seed, function (seed) {
      var s = levelFields(spec.diff, spec.level || startLevel(spec.diff), mulberry32(seed));
      s.diff = spec.diff;
      s.seed = seed;
      s.moves = spec.moves || 0;
      s.score = spec.score || 0;
      s.penalties = spec.penalties || 0;
      s.best = spec.best ? copy(spec.best) : { easy: 0, normal: 0, hard: 0 };
      return s;
    }, function (s) { return s.refClear; });
  }

  function snapshot(s) {
    var h = s.history.concat([{
      cells: s.cells, nextId: s.nextId, moves: s.moves, cleared: s.cleared, total: s.total,
      score: s.score, streak: s.streak, addsLeft: s.addsLeft, penalties: s.penalties || 0,
      compactsLeft: s.compactsLeft
    }]);
    return h.length > HISTORY_LIMIT ? h.slice(h.length - HISTORY_LIMIT) : h;
  }

  function lose(n, reason) {
    n.status = 'lose';
    n.reason = reason;
    n.bonus = 0;
    n.final = n.score;
  }

  /** Decide whether the level is cleared or lost. Mutates and returns n.
      A dead board that still has a legal pair stays in play; the title turns
      red instead. canClear can keep the level going when the only remaining
      pair appears after a finished row collapses. */
  function finish(n) {
    var diag = DIAG;
    var w = boardCols(n);
    if (n.total - n.cleared === 0) {
      n.status = 'clear';
      n.reason = null;
      n.bonus = levelBonus(n);
      n.score += n.bonus;
      n.final = n.score;
    } else if (n.addsLeft > 0 || findPair(n.cells, diag, n.rules, false, w)) {
      n.status = 'playing';
      n.reason = null;
      return n;
    } else if (!inBeatable && canClear(n.cells, diag, n.rules, null, w) === true) {
      n.status = 'playing';
      n.reason = null;
      return n;
    } else {
      lose(n, 'nopairs');
    }
    var prev = n.best[n.diff] || 0;
    n.newBest = n.final > prev;
    if (n.newBest) {
      n.best = copy(n.best);
      n.best[n.diff] = n.final;
    }
    return n;
  }

  /* ------------------------------------------------------------------
     ACTIONS — each returns { state, event }. event is null if nothing
     happened. Events tell the UI what to animate.
     ------------------------------------------------------------------ */

  /** The player tapped cell `id`. */
  function select(s, id) {
    if (s.status !== 'playing') return { state: s, event: null };
    var idx = indexOfId(s.cells, id);
    if (idx < 0 || s.cells[idx].done || isWall(s.cells[idx])) return { state: s, event: null };

    var n;
    if (s.selected === null) {
      n = copy(s); n.selected = id;
      return { state: n, event: { type: 'select', id: id } };
    }
    if (s.selected === id) {
      n = copy(s); n.selected = null;
      return { state: n, event: { type: 'deselect', id: id } };
    }
    var pi = indexOfId(s.cells, s.selected);
    var a = Math.min(pi, idx), b = Math.max(pi, idx);
    var okValue = matches(s.cells[a].v, s.cells[b].v, s.rules);
    var okPath = canLink(s.cells, a, b, DIAG, boardCols(s));
    if (okValue && okPath) return applyMatch(s, a, b);

    n = copy(s);
    n.selected = id;   // selection moves to the newly tapped cell
    // A mismatch costs half of what the pair would have scored. A matching pair
    // that is not reachable costs nothing and does not break the streak.
    var penalty = 0;
    if (!okValue) {
      var would = pairScore(s, a, b, (s.streak || 0) + 1, 0).pair;
      penalty = Math.min(s.score, Math.round(would / 2));
      n.streak = 0;
    }
    n.score = s.score - penalty;
    n.penalties = (s.penalties || 0) + penalty;
    return { state: n, event: { type: 'bad', id: id, reason: okValue ? 'path' : 'value', penalty: penalty } };
  }

  function applyMatch(s, a, b) {
    var before = s.cells;
    var cells = before.map(function (c, i) {
      return (i === a || i === b) ? copyCell(c, true) : c;
    });
    var w = boardCols(s);
    var had = doneRows(before, w);
    var rowsCleared = doneRows(cells, w).filter(function (r) { return had.indexOf(r) < 0; });
    var streak = (s.streak || 0) + 1;
    var scored = pairScore(s, a, b, streak, rowsCleared.length);
    var wallsGone = 0;
    rowsCleared.forEach(function (r) {
      for (var k = r * w; k < Math.min(cells.length, r * w + w); k++) if (isWall(cells[k])) wallsGone++;
    });
    var wallBonus = Math.round(SCORE.wall * wallsGone * pointMult(s.diff, s.level));

    var n = copy(s);
    n.history = snapshot(s);
    n.cells = cells;
    n.selected = null;
    n.moves = s.moves + 1;
    n.cleared = s.cleared + 2;
    n.streak = streak;
    n.score = s.score + scored.gain + wallBonus;
    finish(n);

    return {
      state: n,
      event: {
        type: 'match',
        ids: [before[a].id, before[b].id],
        indexes: [a, b],
        gain: scored.gain + wallBonus,
        pair: scored.pair,
        wallsGone: wallsGone,
        wallBonus: wallBonus,
        streak: streak,
        streakMult: scored.streakMult,
        rowsCleared: rowsCleared,
        rowBonus: scored.rowBonus,
        kind: scored.kind,
        gaps: scored.gaps,
        same: scored.same,
        shade: scored.same ? shadeOfTile(before[a]) : null,
        status: n.status,
        newBest: n.newBest
      }
    };
  }

  /** Drop every cleared tile and slide the live tiles together, still 9 across. */
  function packBoard(s) {
    if (!canCompact(s)) return { state: s, event: null };
    var live = [];
    for (var i = 0; i < s.cells.length; i++) if (!s.cells[i].done) live.push(s.cells[i]);
    var n = copy(s);
    n.history = snapshot(s);
    n.cells = live;
    n.selected = null;
    n.compactsLeft = s.compactsLeft - 1;   // Infinity - 1 === Infinity
    return { state: n, event: { type: 'compact', compactsLeft: n.compactsLeft } };
  }

  function canCompact(s) {
    if (s.status !== 'playing' || !(s.compactsLeft > 0)) return false;
    for (var i = 0; i < s.cells.length; i++) if (s.cells[i].done) return true;
    return false;
  }

  /* CLEAN SWEEP. Right after an Add or a Pack, if every tile left can be paired off at once
     using pairs that are legal right now (each tile used once), they all clear together for
     a bonus. Clearing tiles only opens paths, so any full pairing of legal pairs works. */
  var SWEEP_BUDGET = 20000;
  /** A full pairing of the board's tiles, as index pairs, or null. */
  function sweepPairs(s) {
    if (s.status !== 'playing') return null;
    var cells = s.cells, live = [], adj = {};
    for (var i = 0; i < cells.length; i++) if (!cells[i].done && !isWall(cells[i])) { live.push(i); adj[i] = []; }
    if (!live.length || live.length % 2) return null;
    allPairs(cells, DIAG, s.rules, boardCols(s)).forEach(function (p) { adj[p[0]].push(p[1]); adj[p[1]].push(p[0]); });
    for (var k = 0; k < live.length; k++) if (!adj[live[k]].length) return null;
    var used = {}, out = [], steps = 0;
    function go() {
      if (++steps > SWEEP_BUDGET) return false;
      var pick = -1, fewest = Infinity;
      for (var a = 0; a < live.length; a++) {
        var x = live[a];
        if (used[x]) continue;
        var free = 0;
        for (var b = 0; b < adj[x].length; b++) if (!used[adj[x][b]]) free++;
        if (!free) return false;
        if (free < fewest) { fewest = free; pick = x; }
      }
      if (pick < 0) return true;
      used[pick] = true;
      for (var c = 0; c < adj[pick].length; c++) {
        var y = adj[pick][c];
        if (used[y]) continue;
        used[y] = true; out.push([pick, y]);
        if (go()) return true;
        out.pop(); used[y] = false;
      }
      used[pick] = false;
      return false;
    }
    return go() ? out : null;
  }
  /** Clear the whole board at once if it can be swept. event.matches has each pair's match
      event (for drawing the lines); event.bonus is the sweep bonus; event.gain is everything. */
  function cleanSweep(s) {
    var found = sweepPairs(s);
    if (!found) return { state: s, event: null };
    var pairs = found.map(function (p) { return [s.cells[p[0]].id, s.cells[p[1]].id]; });
    var bonus = Math.round(SCORE.sweep * pairs.length * pointMult(s.diff, s.level));
    var n = copy(s);
    n.score = s.score + bonus;
    n.selected = null;
    var matches = [], gain = bonus;
    for (var i = 0; i < pairs.length; i++) {
      var r2 = select(select(n, pairs[i][0]).state, pairs[i][1]);
      if (!r2.event || r2.event.type !== 'match') return { state: s, event: null };   // should not happen
      n = r2.state;
      matches.push(r2.event);
      gain += r2.event.gain;
    }
    return { state: n, event: { type: 'sweep', pairs: pairs, matches: matches, bonus: bonus, gain: gain, status: n.status, newBest: n.newBest } };
  }

  /** Copy every not-done value, in order, onto the end of the board. */
  function addNumbers(s) {
    var block = addBlock(s);
    if (block === 'tooManyPairs') {
      var pairs = pairsOnBoard(s), max = toolsAt(s.level).addAt;
      // Before level 30 the button is greyed out, so this only happens if it is called anyway. Nothing changes.
      if (!toolsAt(s.level).mistake) return { state: s, event: { type: 'addBlocked', pairs: pairs, max: max, penalty: 0 } };
      // From level 30: pressing Add too early is a mistake, like picking two tiles that don't match.
      // It costs half of what the best pair on the board (the one Hint would show) would have scored,
      // and the streak goes back to zero. No rows are added and no add is used.
      var p = findPair(s.cells, DIAG, s.rules, true, boardCols(s));
      var would = p ? pairScore(s, p[0], p[1], (s.streak || 0) + 1, 0).pair : 0;
      var penalty = Math.min(s.score, Math.round(would / 2));
      var n = copy(s);
      n.score = s.score - penalty;
      n.penalties = (s.penalties || 0) + penalty;
      n.streak = 0;
      return { state: n, event: { type: 'addBlocked', pairs: pairs, max: max, penalty: penalty } };
    }
    if (block) return { state: s, event: null };
    var active = s.cells.filter(function (c) { return !c.done && !isWall(c); });   // walls are never copied
    if (!active.length) return { state: s, event: null };

    var nextId = s.nextId;
    var added = active.map(function (c) {
      var tile = { id: nextId++, v: c.v, done: false };
      if (typeof c.solid === 'boolean') tile.solid = c.solid;
      return tile;
    });

    var n = copy(s);
    n.history = snapshot(s);
    n.cells = compact(s.cells.concat(added), boardCols(s));
    n.nextId = nextId;
    n.selected = null;
    n.moves = s.moves + 1;
    n.total = s.total + added.length;
    n.addsLeft = s.addsLeft - 1;
    n.streak = Math.max(0, (s.streak || 0) - 1);
    finish(n);
    return {
      state: n,
      event: {
        type: 'add',
        ids: added.map(function (c) { return c.id; }),
        count: added.length,
        addsLeft: n.addsLeft,
        status: n.status,
        newBest: n.newBest
      }
    };
  }

  /** Step back one move. Costs one undo. Undoing an Add refunds that add. */
  function undo(s) {
    if (!s.history.length || s.undosLeft <= 0 || s.status === 'clear') return { state: s, event: null };
    var h = s.history.slice();
    var last = h.pop();
    var n = copy(s);
    n.cells = last.cells; n.nextId = last.nextId; n.moves = last.moves;
    n.cleared = last.cleared; n.total = last.total;
    // Undo gives back the move's points but NOT mismatch, hint, or undo costs paid since then.
    n.score = Math.max(0, last.score - ((s.penalties || 0) - (last.penalties || 0)));
    n.streak = last.streak || 0; n.addsLeft = last.addsLeft;
    if (last.compactsLeft != null) n.compactsLeft = last.compactsLeft;
    n.undosLeft = s.undosLeft - 1;  // Infinity - 1 === Infinity
    n.history = h;
    n.selected = null;
    n.status = 'playing'; n.reason = null; n.bonus = 0; n.final = 0; n.newBest = false;
    var cost = Math.min(n.score, Math.round(SCORE.undoCost * pointMult(n.diff, n.level)));
    n.score -= cost;
    n.penalties = (n.penalties || 0) + cost;
    return { state: n, event: { type: 'undo', cost: cost } };
  }

  /** Reveal one legal pair. Costs one hint (only if a pair exists).
      With no adds left, prefer a pair that still leaves the board clearable. */
  function hint(s) {
    if (s.status !== 'playing' || s.hintsLeft <= 0) return { state: s, event: null };
    var diag = DIAG;
    var w = boardCols(s);
    var ids = null;
    if (s.addsLeft <= 0) {
      var found = clearingSearch(s.cells, diag, s.rules, null, w);
      if (found.result === true && found.ids) ids = found.ids;
    }
    if (!ids) {
      var p = findPair(s.cells, diag, s.rules, true, w);
      if (!p) return { state: s, event: { type: 'nohint' } };
      ids = [s.cells[p[0]].id, s.cells[p[1]].id];
    }
    var n = copy(s);
    var cost = Math.min(s.score, Math.round(SCORE.hintCost * pointMult(s.diff, s.level)));
    n.hintsLeft = s.hintsLeft - 1;
    n.selected = null;
    n.streak = Math.max(0, (s.streak || 0) - 1);
    n.score = s.score - cost;
    n.penalties = (s.penalties || 0) + cost;
    return { state: n, event: { type: 'hint', ids: ids, cost: cost } };
  }

  /** After status 'clear': deal the next level. Score and moves carry over. */
  function nextLevel(s, rng) {
    if (s.status !== 'clear') return { state: s, event: null };
    var n = copy(s);
    var f = levelFields(s.diff, s.level + 1, rng, s.rules);
    for (var k in f) n[k] = f[k];
    return { state: n, event: { type: 'level', level: n.level } };
  }

  /** Called by the UI ~900 ms after a match: collapse fully-done rows. */
  function compactBoard(s) {
    var cells = compact(s.cells, boardCols(s));
    if (cells.length === s.cells.length) return s;
    var n = copy(s); n.cells = cells;
    return n;
  }

  /* ------------------------------------------------------------------
     SMALL QUERIES FOR THE UI
     ------------------------------------------------------------------ */
  function indexOfId(cells, id) {
    for (var i = 0; i < cells.length; i++) if (cells[i].id === id) return i;
    return -1;
  }
  /** SVG path for a wrap match: right to the row end, through the gutter to the
      next row's left edge, and right again. `rowYs` are row centers from the
      upper cell to the lower cell. Other pair kinds stay a straight line. */
  function wrapStroke(from, to, left, right, rowYs) {
    var ys = rowYs && rowYs.length > 1 ? rowYs : [from.y, to.y];
    var n = function (x) { return Math.round(x * 10) / 10; };
    var d = ['M', n(from.x), n(from.y), 'L', n(right), n(ys[0])];
    for (var i = 1; i < ys.length; i++) {
      var mid = (ys[i - 1] + ys[i]) / 2;
      d.push('L', n(right), n(mid), 'L', n(left), n(mid), 'L', n(left), n(ys[i]));
      if (i < ys.length - 1) d.push('L', n(right), n(ys[i]));
    }
    d.push('L', n(to.x), n(to.y));
    return d.join(' ');
  }

  function remaining(s) { return s.total - s.cleared; }
  function canUndo(s) { return s.history.length > 0 && s.undosLeft > 0 && s.status !== 'clear'; }
  function canHint(s) { return s.status === 'playing' && s.hintsLeft > 0 && remaining(s) > 0; }
  /** How many legal pairs are on the board right now. */
  function pairsOnBoard(s) {
    return allPairs(s.cells, DIAG, s.rules, boardCols(s)).length;
  }

  /** Why Add is not allowed right now.
      Returns null if Add IS allowed.
      Otherwise returns 'notPlaying', 'noAdds' or 'tooManyPairs'. */
  function addBlock(s) {
    if (s.status !== 'playing' || remaining(s) <= 0) return 'notPlaying';
    if (s.addsLeft <= 0) return 'noAdds';
    if (pairsOnBoard(s) > toolsAt(s.level).addAt) return 'tooManyPairs';
    return null;
  }
  function canAdd(s) { return addBlock(s) === null; }

  return {
    colsFor: colsFor, LEVELS: LEVELS, MAX_MASCOTS: MAX_MASCOTS,
    pairsBoard: pairsBoard, boardSize: boardSize, makeBoard: makeBoard,
    mascots: mascots, mascotOf: mascotOf, isSolid: isSolid,
    addsFor: addsFor, pointMult: pointMult, matches: matches, canLink: canLink, findPair: findPair, canClear: canClear,
    allPairs: allPairs, isBeatable: isBeatable,
    doneRows: doneRows, compact: compact, levelBonus: levelBonus, bonusParts: bonusParts,
    SCORE: SCORE, linkInfo: linkInfo, pairScore: pairScore, streakMult: streakMult, tidyAdds: tidyAdds, tidyPlay: tidyPlay,
    shadeOf: shadeOf, sameShade: sameShade, mixedShade: mixedShade,
    newGame: newGame, dealPuzzle: dealPuzzle, select: select, addNumbers: addNumbers, packBoard: packBoard, undo: undo, hint: hint,
    nextLevel: nextLevel, compactBoard: compactBoard,
    mulberry32: mulberry32, nextSeed: nextSeed, randomSeed: randomSeed, seekSeed: seekSeed,
    parsePuzzle: parsePuzzle, formatPuzzle: formatPuzzle,
    indexOfId: indexOfId, remaining: remaining, wrapStroke: wrapStroke, canUndo: canUndo, canHint: canHint, canAdd: canAdd, addBlock: addBlock, pairsOnBoard: pairsOnBoard, canCompact: canCompact,
    kindCount: kindCount, wallCount: wallCount, isWall: isWall, WALL: WALL,
    RAMP: RAMP, TOOLS: TOOLS, PACK_FROM: PACK_FROM, rampAt: rampAt, toolsAt: toolsAt, stageOf: stageOf, tilesAt: tilesAt, widthAt: widthAt,
    startLevel: startLevel, BLANK: BLANK, isBlank: isBlank, sweepPairs: sweepPairs, cleanSweep: cleanSweep
  };
});
