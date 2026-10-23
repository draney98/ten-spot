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

  /** Difficulty settings. Infinity means "unlimited". */
  var LEVELS = {
    easy:   { label: 'Easy',   adds: 8, minAdds: 4, hints: Infinity, undos: Infinity, compacts: Infinity, diag: true,  mult: 1,
              kinds: { pairs: { start: 4, every: 3 } } },
    normal: { label: 'Normal', adds: 5, minAdds: 2, hints: 3,        undos: 5,        compacts: 3,        diag: true,  mult: 1.5,
              kinds: { pairs: { start: 5, every: 2 } } },
    hard:   { label: 'Hard',   adds: 3, minAdds: 1, hints: 0,        undos: 1,        compacts: 1,        diag: true,  mult: 2.5,
              kinds: { pairs: { start: 6, every: 2 } } }
  };
  // `diag` is kept as a switch so a future mode can turn diagonals off. Every difficulty allows them today.

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
    levelPerLevel: 100,// level bonus = 100 x level ...
    parAdd: 200,       // ... + 200 for each match under par
    hintCost: 25,      // points, x mult
    undoCost: 5        // points, x mult
  };

  /* ------------------------------------------------------------------
     BOARDS
     ------------------------------------------------------------------ */

  /** How many tiles a level starts with. Level 1 is 28 (dealt in pairs). */
  function boardSize(level) {
    if (level <= 1) return 28;
    if (level === 2) return 36;
    if (level === 3) return 44;
    return 54;
  }

  /** Gridiron: mascots in play. Normal starts at 5 and adds one every two levels, up to 8. */
  function mascots(level, diff) {
    return kindCount(diff, level, 'pairs');
  }
  function mascotOf(v) { return Math.ceil(v / 2); }   // 1..8
  function isSolid(v) { return v % 2 === 0; }

  /** Pull one mascot down to a single pair. Spare pairs go to the fullest other mascot. */
  function plantStrand(counts, rng) {
    var victims = [];
    for (var i = 0; i < counts.length; i++) if (counts[i] > 1) victims.push(i);
    if (!victims.length) return;
    var v = victims[Math.floor(rng() * victims.length)];
    while (counts[v] > 1) {
      var dest = -1;
      for (var k = 0; k < counts.length; k++) {
        if (k === v) continue;
        if (dest < 0 || counts[k] > counts[dest]) dest = k;
      }
      counts[v]--;
      counts[dest]++;
    }
  }

  /** Gridiron board: an even share of pairs per mascot (Hard then leaves one mascot
      with a single pair). Each pair prefers one version (3/8 both outline,
      3/8 both solid, 1/4 one of each). Shuffle. */
  function pairsBoard(level, rng, diff) {
    var fams = mascots(level, diff);
    var pairCount = boardSize(level) / 2;
    var base = Math.floor(pairCount / fams);
    var extra = pairCount % fams;
    var counts = [];
    var order = [];
    for (var f = 0; f < fams; f++) { counts.push(base); order.push(f); }
    shuffle(order, rng);
    for (var e = 0; e < extra; e++) counts[order[e]]++;
    if (diff === 'hard') plantStrand(counts, rng);
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

  function parsePuzzle(text) {
    var m = /^(easy|normal|hard)-(\d+)-teams-([0-9a-f]{8})$/.exec(String(text || '').trim().toLowerCase());
    if (!m) return null;
    var level = Number(m[2]);
    if (level < 1 || level > 99) return null;
    return { diff: m[1], level: level, mode: 'teams', seed: parseInt(m[3], 16) };
  }

  function formatPuzzle(spec) {
    var hex = (spec.seed >>> 0).toString(16);
    while (hex.length < 8) hex = '0' + hex;
    return spec.diff + '-' + spec.level + '-teams-' + hex;
  }

  /** How many mascots a difficulty uses on a level. */
  function kindCount(diff, level) {
    var table = (LEVELS[diff] && LEVELS[diff].kinds) || LEVELS.normal.kinds;
    var spec = table.pairs;
    var steps = Math.max(0, (level || 1) - 1);
    return Math.min(MAX_MASCOTS, spec.start + Math.floor(steps / spec.every));
  }

  function makeBoard(level, rng, rules, diff) {
    return pairsBoard(level, rng || Math.random, diff);
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

  /** Same mascot. The rules argument is ignored; every deal is Gridiron. */
  function matches(x, y) {
    return mascotOf(x) === mascotOf(y);
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
      val = canClear(state.cells, LEVELS[state.diff].diag, state.rules, null, boardCols(state)) !== false;
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
      if (row.every(function (c) { return c.done; })) out.push(r);
    }
    return out;
  }

  /** Remove every row whose cells are all done. Remaining cells keep order. */
  function compact(cells, cols) {
    var out = [];
    var w = width(cols);
    for (var r = 0; r * w < cells.length; r++) {
      var row = cells.slice(r * w, r * w + w);
      if (!row.every(function (c) { return c.done; })) out = out.concat(row);
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
    for (var i = 0; i < cells.length; i++) if (!cells[i].done) n++;
    return n;
  }

  function rowLiveCounts(cells, cols) {
    var w = width(cols);
    var rows = Math.ceil(cells.length / w) || 0;
    var counts = new Array(rows);
    for (var r = 0; r < rows; r++) counts[r] = 0;
    for (var i = 0; i < cells.length; i++) {
      if (!cells[i].done) counts[Math.floor(i / w)]++;
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
        if (!cells[i].done) extra.push({ id: 0, v: cells[i].v, done: false });
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
      return { id: i + 1, v: (v && typeof v === 'object') ? v.v : v, done: false };
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
    var L = LEVELS[diff];
    var cols = colsFor(diff);
    var vals = pairsBoard(level, rng || Math.random, diff);
    var addsThisLevel = addsFor(diff, level);
    var play = tidyPlay(vals, L.diag, 'pairs', addsThisLevel, null, cols);
    return {
      level: level,
      rules: 'pairs',
      cols: cols,
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

  /** Every deal is Gridiron. A rules argument is ignored. */
  function newGame(diff, best, rng) {
    var s = levelFields(diff, 1, rng);
    s.diff = diff;
    s.moves = 0;
    s.score = 0;
    s.penalties = 0;
    s.best = best ? copy(best) : { easy: 0, normal: 0, hard: 0 };
    return s;
  }

  function dealPuzzle(spec) {
    return seekSeed(spec.seed, function (seed) {
      var s = levelFields(spec.diff, spec.level || 1, mulberry32(seed));
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
    var okPath = canLink(s.cells, a, b, LEVELS[s.diff].diag, boardCols(s));
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
    var diag = LEVELS[s.diff].diag;
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
  function canAdd(s) { return s.status === 'playing' && s.addsLeft > 0 && remaining(s) > 0; }

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
    indexOfId: indexOfId, remaining: remaining, wrapStroke: wrapStroke, canUndo: canUndo, canHint: canHint, canAdd: canAdd, canCompact: canCompact,
    kindCount: kindCount
  };
});
