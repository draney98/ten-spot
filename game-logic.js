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

  /** The board is ALWAYS 9 columns wide. Rows are implicit: index i is
      row Math.floor(i / 9), column i % 9. */
  var COLS = 9;

  /** Difficulty settings. Infinity means "unlimited". */
  var LEVELS = {
    easy:   { label: 'Easy',   adds: 8, minAdds: 4, hints: Infinity, undos: Infinity, compacts: Infinity, diag: true,  mult: 1,
              kinds: { classic: { start: 3, every: 2 }, pairs: { start: 4, every: 2 }, mahjong: { start: 1, every: 2 } } },
    normal: { label: 'Normal', adds: 5, minAdds: 2, hints: 3,        undos: 5,        compacts: 3,        diag: true,  mult: 1.5,
              kinds: { classic: { start: 4, every: 1 }, pairs: { start: 5, every: 1 }, mahjong: { start: 2, every: 1 } } },
    hard:   { label: 'Hard',   adds: 3, minAdds: 1, hints: 0,        undos: 1,        compacts: 1,        diag: true,  mult: 2.5,
              kinds: { classic: { start: 5, every: 1 }, pairs: { start: 6, every: 1 }, mahjong: { start: 4, every: 1 } } }
  };
  // `diag` is kept as a switch so a future mode can turn diagonals off. Every difficulty allows them today.

  /** Three rule sets:
      'classic' — values 1..9; a pair matches if equal or summing to 10.
      'pairs'   — Gridiron mode. Value v belongs to mascot Math.ceil(v / 2):
                  odd v = outline, even v = solid twin. Any two tiles of the
                  same mascot match (outline+solid, or two identical tiles).
      'mahjong' — Mahjong mode. Values 1..9 are circle ("dots") tiles and
                  follow the classic rule. Values 11..17 are honour tiles
                  (11 East, 12 South, 13 West, 14 North wind, 15 red dragon,
                  16 green dragon, 17 white dragon); an honour tile matches
                  ONLY an identical honour tile. */
  var MAX_MASCOTS = 8;
  var HONOUR_FIRST = 11, MAX_HONOURS = 7;

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
    levelPerLevel: 100,// level bonus = 100 x level ...
    parAdd: 200,       // ... + 200 for each match under par
    hintCost: 25,      // points, x mult
    undoCost: 5        // points, x mult
  };

  /* ------------------------------------------------------------------
     BOARDS
     ------------------------------------------------------------------ */

  /** Level 1 board: the digits of 1..19, skipping 10 (it would need a 0).
      Result (27 values, 3 rows of 9):
        1 2 3 4 5 6 7 8 9
        1 1 1 2 1 3 1 4 1
        5 1 6 1 7 1 8 1 9                                                */
  function classicBoard() {
    var vals = [];
    for (var n = 1; n <= 19; n++) {
      if (n === 10) continue;
      String(n).split('').forEach(function (d) { vals.push(Number(d)); });
    }
    return vals;
  }

  /** How many numbers a level starts with. Gridiron and Mahjong level 1 is 28 (dealt in pairs). */
  function boardSize(level, rules) {
    if (level <= 1) return (rules === 'pairs' || rules === 'mahjong') ? 28 : 27;
    if (level === 2) return 36;
    if (level === 3) return 44;
    return 54;
  }

  /** Gridiron: mascots in play. Normal starts at 5 and adds one each level, up to 8. */
  function mascots(level, diff) {
    return kindCount(diff, level, 'pairs');
  }
  function mascotOf(v) { return Math.ceil(v / 2); }   // 1..8
  function isSolid(v) { return v % 2 === 0; }

  /** Gridiron board: pick a mascot, then prefer one version (3/8 both outline,
      3/8 both solid, 1/4 one of each). Shuffle. */
  function pairsBoard(level, rng, diff) {
    var size = boardSize(level, 'pairs'), fams = mascots(level, diff), vals = [];
    for (var i = 0; i < size / 2; i++) {
      var f = 1 + Math.floor(rng() * fams);
      var roll = rng();
      var outline = 2 * f - 1, solid = 2 * f;
      if (roll < 0.375) vals.push(outline, outline);
      else if (roll < 0.75) vals.push(solid, solid);
      else vals.push(outline, solid);
    }
    return shuffle(vals, rng);
  }

  /** Mahjong: honour kinds in play. Normal starts at 2 and adds one each level, up to 7. */
  function honoursInPlay(level, diff) {
    return kindCount(diff, level, 'mahjong');
  }
  function isHonour(v) { return v >= HONOUR_FIRST; }

  /** A circle pair is always a complement (1 with 9, 2 with 8, 3 with 7,
      4 with 6, or 5 with 5) and both tiles share one shade. */
  function circlePair(rng, kinds) {
    var n = kinds || 5;
    var low = 1 + Math.floor(rng() * n);
    var solid = rng() >= 0.5;
    return [{ v: low, solid: solid }, { v: 10 - low, solid: solid }];
  }

  /** Mahjong board: about a third of the pairs are identical honour tiles,
      the rest are circle complements that share one shade. Shuffled. */
  function mahjongBoard(level, rng, diff) {
    var size = boardSize(level, 'mahjong'), kinds = honoursInPlay(level, diff), vals = [];
    for (var i = 0; i < size / 2; i++) {
      if (rng() < 0.35) {
        var h = HONOUR_FIRST + Math.floor(rng() * kinds);
        vals.push(h, h);
      } else {
        var pair = circlePair(rng);
        vals.push(pair[0], pair[1]);
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

  function parsePuzzle(text) {
    var m = /^(easy|normal|hard)-(\d+)-(num|tiles|icons|teams)-([0-9a-f]{8})$/.exec(String(text || '').trim().toLowerCase());
    if (!m) return null;
    var level = Number(m[2]);
    if (level < 1 || level > 99) return null;
    return { diff: m[1], level: level, mode: m[3], seed: parseInt(m[4], 16) };
  }

  function formatPuzzle(spec) {
    var hex = (spec.seed >>> 0).toString(16);
    while (hex.length < 8) hex = '0' + hex;
    return spec.diff + '-' + spec.level + '-' + spec.mode + '-' + hex;
  }

  /** Levels 2+: complements that share one shade (1 with 9, never 1 with 1),
      then shuffled (Fisher–Yates). 5 pairs with itself. */
  function randomBoard(level, rng, diff) {
    var size = boardSize(level);
    var kinds = kindCount(diff, level, 'classic');
    var vals = [];
    for (var i = 0; i < size / 2; i++) {
      var pair = circlePair(rng, kinds);
      vals.push(pair[0], pair[1]);
    }
    return shuffle(vals, rng);
  }

  /** How many tile kinds a difficulty uses on a level. Numbers start the
      schedule at level 2, because level 1 is the fixed classic board. */
  function kindCount(diff, level, rules) {
    var name = (rules === 'pairs' || rules === 'mahjong') ? rules : 'classic';
    var table = (LEVELS[diff] && LEVELS[diff].kinds) || LEVELS.normal.kinds;
    var spec = table[name];
    var steps = name === 'classic' ? Math.max(0, level - 2) : Math.max(0, level - 1);
    var max = name === 'pairs' ? MAX_MASCOTS : (name === 'mahjong' ? MAX_HONOURS : 5);
    return Math.min(max, spec.start + Math.floor(steps / spec.every));
  }

  function makeBoard(level, rng, rules, diff) {
    rng = rng || Math.random;
    if (rules === 'pairs') return pairsBoard(level, rng, diff);
    if (rules === 'mahjong') return mahjongBoard(level, rng, diff);
    return level <= 1 ? classicBoard() : randomBoard(level, rng, diff);
  }

  /* ------------------------------------------------------------------
     RULE HELPERS
     ------------------------------------------------------------------ */

  /** Adds allowed on a level: starts at LEVELS[diff].adds and drops by 1
      every 2 levels, never below LEVELS[diff].minAdds. */
  function addsFor(diff, level) {
    var L = LEVELS[diff];
    return Math.max(L.minAdds, L.adds - Math.floor((level - 1) / 2));
  }

  /** Point multiplier: difficulty multiplier, +20% per level above 1. */
  function pointMult(diff, level) {
    return LEVELS[diff].mult * (1 + 0.2 * (level - 1));
  }

  /** classic: equal OR sum to 10.  pairs: same mascot.  mahjong: honours identical, circles classic. */
  function matches(x, y, rules) {
    if (rules === 'pairs') return mascotOf(x) === mascotOf(y);
    if (rules === 'mahjong' && (isHonour(x) || isHonour(y))) return x === y;
    return x === y || x + y === 10;
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
  function canLink(cells, a, b, diag) {
    if (a > b) { var t = a; a = b; b = t; }
    if (a === b) return false;

    var clear = true;
    for (var k = a + 1; k < b; k++) {
      if (!cells[k].done) { clear = false; break; }
    }
    if (clear) return true;

    var ra = Math.floor(a / COLS), ca = a % COLS;
    var rb = Math.floor(b / COLS), cb = b % COLS;
    var dr = rb - ra, dc = cb - ca;
    if (dr <= 0) return false; // same row and rule 1 failed

    if (dc === 0 || (diag && Math.abs(dc) === dr)) {
      var step = Math.sign(dc); // 0 for vertical, ±1 for diagonal
      for (var s = 1; s < dr; s++) {
        if (!cells[(ra + s) * COLS + ca + s * step].done) return false;
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

  function buildNext(cells, diag) {
    var n = cells.length;
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
    var colPrev = new Array(COLS);
    for (var c = 0; c < COLS; c++) colPrev[c] = -1;
    for (var i = 0; i < n; i++) {
      if (cells[i].done) continue;
      var col = i % COLS;
      var up = colPrev[col];
      if (up >= 0) { next[2][up] = i; next[3][i] = up; }
      colPrev[col] = i;
    }
    if (diag) {
      var downRight = Object.create(null);
      var downLeft = Object.create(null);
      for (var i = 0; i < n; i++) {
        if (cells[i].done) continue;
        var r = Math.floor(i / COLS), cc = i % COLS;
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
  function findPair(cells, diag, rules, preferSame) {
    var first = null;
    var next = buildNext(cells, diag);
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
  function allPairs(cells, diag, rules) {
    return listPairs(cells, buildNext(cells, diag), rules);
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
    for (var i = 0; i < cells.length; i++) if (!cells[i].done) return true;
    return false;
  }

  function mascotCounts(cells) {
    var counts = Object.create(null);
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].done) continue;
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
  function orderedPairs(cells, diag, rules) {
    var pairs = allPairs(cells, diag, rules);
    var rows = doneRows(cells).length;
    var counts = rules === 'pairs' ? mascotCounts(cells) : null;
    var ranked = pairs.map(function (p, i) {
      var marked = markDone(cells, p[0], p[1]);
      var tier = doneRows(marked).length > rows ? 2 : 0;
      if (counts && counts[mascotOf(cells[p[0]].v)] === 2) tier += 1;
      return { p: p, i: i, tier: tier };
    });
    ranked.sort(function (a, b) { return b.tier - a.tier || a.i - b.i; });
    return ranked.map(function (r) { return r.p; });
  }

  /** Depth-first search over legal pairs, compacting after every move.
      result is true (some line clears the board), false (every line sticks),
      or null (gave up after `budget` positions). ids is a winning first pair. */
  function clearingSearch(cells, diag, rules, budget) {
    if (budget == null) budget = CLEAR_BUDGET;
    var visited = 0;
    var memo = Object.create(null);

    function rec(cells) {
      cells = compact(cells);
      var key = positionKey(cells);
      if (Object.prototype.hasOwnProperty.call(memo, key)) return memo[key];
      if (!hasLive(cells)) { memo[key] = true; return true; }
      if (visited >= budget) return null;
      visited++;
      var pairs = orderedPairs(cells, diag, rules);
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

    var base = compact(copyCells(cells));
    var key = positionKey(base);
    if (!hasLive(base)) return { result: true, ids: null };
    if (visited >= budget) return { result: null, ids: null };
    visited++;
    var pairs = orderedPairs(base, diag, rules);
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
  function canClear(cells, diag, rules, budget) {
    return clearingSearch(cells, diag, rules, budget).result;
  }

  /** Fingerprint for memoizing beatability search. */
  function beatableKey(s) {
    var parts = [s.rules || 'classic', s.addsLeft];
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
      val = canClear(state.cells, LEVELS[state.diff].diag, state.rules) !== false;
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

      var diag = LEVELS[s.diff].diag;
      var pairs = allPairs(s.cells, diag, s.rules);
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
  function doneRows(cells) {
    var out = [];
    for (var r = 0; r * COLS < cells.length; r++) {
      var row = cells.slice(r * COLS, r * COLS + COLS);
      if (row.every(function (c) { return c.done; })) out.push(r);
    }
    return out;
  }

  /** Remove every row whose cells are all done. Remaining cells keep order. */
  function compact(cells) {
    var out = [];
    for (var r = 0; r * COLS < cells.length; r++) {
      var row = cells.slice(r * COLS, r * COLS + COLS);
      if (!row.every(function (c) { return c.done; })) out = out.concat(row);
    }
    return out;
  }

  /** How a tile is drawn: 'outline' or 'solid' (shaded), or null if it has no shading.
      classic + mahjong circles: 1..5 outline, 6..9 solid.
      pairs (Gridiron): odd outline, even solid.  mahjong winds/dragons: null. */
  function shadeOf(v, rules) {
    if (rules === 'pairs') return isSolid(v) ? 'solid' : 'outline';
    if (rules === 'mahjong' && isHonour(v)) return null;
    return v >= 6 ? 'solid' : 'outline';
  }
  /** Shade of a dealt cell. A stored `solid` flag wins over the value, so a
      light 9 stays an outline. Missing flag keeps the value-based shade. */
  function shadeOfTile(tile, rules) {
    if (tile && typeof tile === 'object') {
      if (rules === 'pairs') return isSolid(tile.v) ? 'solid' : 'outline';
      if (rules === 'mahjong' && isHonour(tile.v)) return null;
      if (typeof tile.solid === 'boolean') return tile.solid ? 'solid' : 'outline';
      return shadeOf(tile.v, rules);
    }
    return shadeOf(tile, rules);
  }
  function tilesSame(x, y, rules) {
    var a = shadeOfTile(x, rules);
    return a !== null && a === shadeOfTile(y, rules);
  }
  function tilesMixed(x, y, rules) {
    var a = shadeOfTile(x, rules), b = shadeOfTile(y, rules);
    return a !== null && b !== null && a !== b;
  }
  /** True when both tiles are outlines, or both are solid. Value-based. */
  function sameShade(x, y, rules) {
    var a = shadeOf(x, rules);
    return a !== null && a === shadeOf(y, rules);
  }
  /** True when one tile is an outline and the other is solid (a "mixed" pair). */
  function mixedShade(x, y, rules) {
    var a = shadeOf(x, rules), b = shadeOf(y, rules);
    return a !== null && b !== null && a !== b;
  }

  /** a, b = indexes in state.cells (either order). The pair is already known to be legal. */
  function linkInfo(cells, a, b) {
    if (a > b) { var t = a; a = b; b = t; }
    var clear = true;
    for (var k = a + 1; k < b; k++) if (!cells[k].done) { clear = false; break; }
    var ra = Math.floor(a / COLS), rb = Math.floor(b / COLS);
    // 1. reading order wins if it is clear (same row = 'row', different rows = 'wrap')
    if (clear) return { kind: ra === rb ? 'row' : 'wrap', gaps: b - a - 1 };
    // 2. otherwise column, 3. otherwise diagonal
    var dr = rb - ra, dc = (b % COLS) - (a % COLS);
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
    var li = linkInfo(cells, a, b);
    var raw = SCORE.base + SCORE.perGap * li.gaps
            + (li.kind === 'diag' ? SCORE.diagonal : 0)
            + (li.kind === 'wrap' ? SCORE.wrap : 0);
    var same = tilesSame(cells[a], cells[b], state.rules);
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
    for (var i = 0; i < cells.length; i++) if (!cells[i].done) n++;
    return n;
  }

  function rowLiveCounts(cells) {
    var rows = Math.ceil(cells.length / COLS) || 0;
    var counts = new Array(rows);
    for (var r = 0; r < rows; r++) counts[r] = 0;
    for (var i = 0; i < cells.length; i++) {
      if (!cells[i].done) counts[Math.floor(i / COLS)]++;
    }
    return counts;
  }

  /** Pointer board for the reference player. Clearing a tile only retargets its neighbours. */
  function linkBoard(cells, diag, rules) {
    var next = buildNext(cells, diag);
    var rowLive = rowLiveCounts(cells);
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
      var ri = Math.floor(i / COLS), rj = Math.floor(j / COLS);
      if (ri === rj) return rowLive[ri] <= 2;
      return rowLive[ri] <= 1 || rowLive[rj] <= 1;
    }

    function drop(x, log) {
      var neigh = new Array(8);
      for (var d = 0; d < 8; d++) neigh[d] = next[d][x];
      count -= incident(x, neigh);
      log.push(['done', x]);
      cells[x].done = true;
      var row = Math.floor(x / COLS);
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
        var after = compact(marked);
        return listPairs(after, buildNext(after, diag), rules).length;
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
        return linkBoard(compact(marked), diag, rules);
      }
      drop(i, []);
      drop(j, []);
      return api;
    }

    function added() {
      var extra = [];
      for (var i = 0; i < cells.length; i++) {
        if (!cells[i].done) extra.push({ id: 0, v: cells[i].v, done: false });
      }
      return linkBoard(compact(cells.concat(extra)), diag, rules);
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
  function tidyPlay(values, diag, rules, cap, budgetMs) {
    if (budgetMs == null) budgetMs = PAR_BUDGET_MS;
    var deadline = Date.now() + budgetMs;
    var cells = values.map(function (v, i) {
      return { id: i + 1, v: (v && typeof v === 'object') ? v.v : v, done: false };
    });
    var board = linkBoard(cells, diag, rules);
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

  function tidyAdds(values, diag, rules, cap, budgetMs) {
    return tidyPlay(values, diag, rules, cap, budgetMs).adds;
  }

  /* ------------------------------------------------------------------
     STATE
     ------------------------------------------------------------------
     {
       diff: 'easy'|'normal'|'hard',
       rules: 'classic'|'pairs'|'mahjong',   // 'pairs' = Gridiron, 'mahjong' = Mahjong
       level: 1,
       cells: [{ id, v, done }],   // flat list, 9 per row
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

  function levelFields(diff, level, rng, rules) {
    var L = LEVELS[diff];
    var rulesName = (rules === 'pairs' || rules === 'mahjong') ? rules : 'classic';
    var vals = makeBoard(level, rng, rules, diff);
    var addsThisLevel = addsFor(diff, level);
    // Classic level 1 is one fixed board. The reference player uses 3 adds and 29 matches.
    var play = (level <= 1 && rulesName === 'classic')
      ? { adds: 3, matches: 29, cleared: true, timedOut: false }
      : tidyPlay(vals, L.diag, rulesName, addsThisLevel);
    return {
      level: level,
      rules: rulesName,
      cells: vals.map(function (tile, i) {
        var v = (tile && typeof tile === 'object') ? tile.v : tile;
        var cell = { id: i + 1, v: v, done: false };
        if (tile && typeof tile === 'object' && typeof tile.solid === 'boolean') cell.solid = tile.solid;
        return cell;
      }),
      nextId: vals.length + 1,
      selected: null,
      streak: 0,
      par: Math.round(play.matches),
      refClear: play.cleared || play.timedOut,
      cleared: 0,
      total: vals.length,
      addsLeft: addsFor(diff, level),
      hintsLeft: L.hints,
      undosLeft: L.undos,
      compactsLeft: L.compacts,
      history: [],
      status: 'playing',
      bonus: 0,
      final: 0,
      newBest: false,
      opening: vals.map(function (tile) {
        var v = (tile && typeof tile === 'object') ? tile.v : tile;
        var tile0 = { v: v };
        if (tile && typeof tile === 'object' && typeof tile.solid === 'boolean') tile0.solid = tile.solid;
        return tile0;
      })
    };
  }

  /** rules: 'classic' (default), 'pairs' (Gridiron) or 'mahjong' (Mahjong). */
  function newGame(diff, best, rng, rules) {
    var s = levelFields(diff, 1, rng, rules);
    s.diff = diff;
    s.moves = 0;
    s.score = 0;
    s.penalties = 0;
    s.best = best ? copy(best) : { easy: 0, normal: 0, hard: 0 };
    return s;
  }

  function dealPuzzle(spec) {
    return seekSeed(spec.seed, function (seed) {
      var s = levelFields(spec.diff, spec.level || 1, mulberry32(seed), spec.rules);
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
    var diag = LEVELS[n.diff].diag;
    if (n.total - n.cleared === 0) {
      n.status = 'clear';
      n.reason = null;
      n.bonus = levelBonus(n);
      n.score += n.bonus;
      n.final = n.score;
    } else if (n.addsLeft > 0 || findPair(n.cells, diag, n.rules)) {
      n.status = 'playing';
      n.reason = null;
      return n;
    } else if (!inBeatable && canClear(n.cells, diag, n.rules) === true) {
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
    if (idx < 0 || s.cells[idx].done) return { state: s, event: null };

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
    var okPath = canLink(s.cells, a, b, LEVELS[s.diff].diag);
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
    var had = doneRows(before);
    var rowsCleared = doneRows(cells).filter(function (r) { return had.indexOf(r) < 0; });
    var streak = (s.streak || 0) + 1;
    var scored = pairScore(s, a, b, streak, rowsCleared.length);

    var n = copy(s);
    n.history = snapshot(s);
    n.cells = cells;
    n.selected = null;
    n.moves = s.moves + 1;
    n.cleared = s.cleared + 2;
    n.streak = streak;
    n.score = s.score + scored.gain;
    finish(n);

    return {
      state: n,
      event: {
        type: 'match',
        ids: [before[a].id, before[b].id],
        indexes: [a, b],
        gain: scored.gain,
        pair: scored.pair,
        streak: streak,
        streakMult: scored.streakMult,
        rowsCleared: rowsCleared,
        rowBonus: scored.rowBonus,
        kind: scored.kind,
        gaps: scored.gaps,
        same: scored.same,
        shade: scored.same ? shadeOfTile(before[a], s.rules) : null,
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

  /** Copy every not-done value, in order, onto the end of the board. */
  function addNumbers(s) {
    if (s.status !== 'playing' || s.addsLeft <= 0) return { state: s, event: null };
    var active = s.cells.filter(function (c) { return !c.done; });
    if (!active.length) return { state: s, event: null };

    var nextId = s.nextId;
    var added = active.map(function (c) {
      var tile = { id: nextId++, v: c.v, done: false };
      if (typeof c.solid === 'boolean') tile.solid = c.solid;
      return tile;
    });

    var n = copy(s);
    n.history = snapshot(s);
    n.cells = compact(s.cells.concat(added));
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
    var diag = LEVELS[s.diff].diag;
    var ids = null;
    if (s.addsLeft <= 0) {
      var found = clearingSearch(s.cells, diag, s.rules);
      if (found.result === true && found.ids) ids = found.ids;
    }
    if (!ids) {
      var p = findPair(s.cells, diag, s.rules, true);
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
    var cells = compact(s.cells);
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
  function canAdd(s) { return s.status === 'playing' && s.addsLeft > 0 && remaining(s) > 0; }

  return {
    COLS: COLS, LEVELS: LEVELS, MAX_MASCOTS: MAX_MASCOTS,
    classicBoard: classicBoard, randomBoard: randomBoard, pairsBoard: pairsBoard, boardSize: boardSize, makeBoard: makeBoard,
    mascots: mascots, mascotOf: mascotOf, isSolid: isSolid,
    MAX_HONOURS: MAX_HONOURS, honoursInPlay: honoursInPlay, isHonour: isHonour, mahjongBoard: mahjongBoard,
    addsFor: addsFor, pointMult: pointMult, matches: matches, canLink: canLink, findPair: findPair, canClear: canClear,
    allPairs: allPairs, isBeatable: isBeatable,
    doneRows: doneRows, compact: compact, levelBonus: levelBonus, bonusParts: bonusParts,
    SCORE: SCORE, linkInfo: linkInfo, pairScore: pairScore, streakMult: streakMult, tidyAdds: tidyAdds, tidyPlay: tidyPlay,
    shadeOf: shadeOf, sameShade: sameShade, mixedShade: mixedShade,
    newGame: newGame, dealPuzzle: dealPuzzle, select: select, addNumbers: addNumbers, packBoard: packBoard, undo: undo, hint: hint,
    nextLevel: nextLevel, compactBoard: compactBoard,
    mulberry32: mulberry32, nextSeed: nextSeed, randomSeed: randomSeed, seekSeed: seekSeed,
    parsePuzzle: parsePuzzle, formatPuzzle: formatPuzzle,
    indexOfId: indexOfId, remaining: remaining, wrapStroke: wrapStroke, canUndo: canUndo, canHint: canHint, canAdd: canAdd, canCompact: canCompact,
    kindCount: kindCount
  };
});
