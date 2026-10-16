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
    easy:   { label: 'Easy',   adds: 8, minAdds: 4, hints: Infinity, undos: Infinity, diag: true,  mult: 1   },
    normal: { label: 'Normal', adds: 5, minAdds: 2, hints: 3,        undos: 5,        diag: true,  mult: 1.5 },
    hard:   { label: 'Hard',   adds: 3, minAdds: 1, hints: 0,        undos: 1,        diag: true,  mult: 2.5 }
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

  /** Style bonus: base points added when both tiles of a pair are drawn the
      same way (two outlines, or two shaded/solid tiles). */
  var STYLE_BONUS = 10;

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

  /** Gridiron: mascots in play on a level — 5 on level 1, one more per level, up to 8. */
  function mascots(level) {
    return Math.min(MAX_MASCOTS, 4 + level);
  }
  function mascotOf(v) { return Math.ceil(v / 2); }   // 1..8
  function isSolid(v) { return v % 2 === 0; }

  /** Gridiron board: pick a mascot, push two tiles of it (each randomly outline or solid), repeat; shuffle. */
  function pairsBoard(level, rng) {
    var size = boardSize(level, 'pairs'), fams = mascots(level), vals = [];
    for (var i = 0; i < size / 2; i++) {
      var f = 1 + Math.floor(rng() * fams);
      vals.push(2 * f - (rng() < 0.5 ? 1 : 0), 2 * f - (rng() < 0.5 ? 1 : 0));
    }
    return shuffle(vals, rng);
  }

  /** Mahjong: honour kinds in play — 2 on level 1, one more per level, up to 7. */
  function honoursInPlay(level) {
    return Math.min(MAX_HONOURS, level + 1);
  }
  function isHonour(v) { return v >= HONOUR_FIRST; }

  /** Mahjong board: about a third of the pairs are identical honour tiles,
      the rest are circle-tile pairs (same count, or adding to 10). Shuffled. */
  function mahjongBoard(level, rng) {
    var size = boardSize(level, 'mahjong'), kinds = honoursInPlay(level), vals = [];
    for (var i = 0; i < size / 2; i++) {
      if (rng() < 0.35) {
        var h = HONOUR_FIRST + Math.floor(rng() * kinds);
        vals.push(h, h);
      } else {
        var a = 1 + Math.floor(rng() * 9);
        vals.push(a, rng() < 0.5 ? a : 10 - a);
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

  /** Levels 2+: random values dealt IN PAIRS that could match each other
      (equal, or summing to 10), then shuffled (Fisher–Yates). */
  function randomBoard(level, rng) {
    var size = boardSize(level);
    var vals = [];
    for (var i = 0; i < size / 2; i++) {
      var a = 1 + Math.floor(rng() * 9);          // 1..9
      vals.push(a, rng() < 0.5 ? a : 10 - a);     // partner: same or complement
    }
    return shuffle(vals, rng);
  }

  function makeBoard(level, rng, rules) {
    rng = rng || Math.random;
    if (rules === 'pairs') return pairsBoard(level, rng);
    if (rules === 'mahjong') return mahjongBoard(level, rng);
    return level <= 1 ? classicBoard() : randomBoard(level, rng);
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

  /** First legal pair [i, j] (indexes, i < j) or null.
      preferSame: return a pair with no mixed-shade penalty if there is one. */
  function findPair(cells, diag, rules, preferSame) {
    var first = null;
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].done) continue;
      for (var j = i + 1; j < cells.length; j++) {
        if (cells[j].done) continue;
        if (matches(cells[i].v, cells[j].v, rules) && canLink(cells, i, j, diag)) {
          if (!preferSame || !mixedShade(cells[i].v, cells[j].v, rules)) return [i, j];
          if (!first) first = [i, j];
        }
      }
    }
    return first;
  }

  /** Every legal pair [i, j] (indexes, i < j). Order matters for solvability. */
  function allPairs(cells, diag, rules) {
    var out = [];
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].done) continue;
      for (var j = i + 1; j < cells.length; j++) {
        if (cells[j].done) continue;
        if (matches(cells[i].v, cells[j].v, rules) && canLink(cells, i, j, diag)) out.push([i, j]);
      }
    }
    return out;
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
      (using remaining addsLeft). Does not use Hint or mismatches. */
  function isBeatable(state) {
    if (!state) return false;
    if (state.status === 'clear' || remaining(state) === 0) return true;
    if (state.status === 'lose') return false;
    if (state.status !== 'playing') return false;

    var seen = Object.create(null);
    function search(s) {
      if (s.status === 'clear' || remaining(s) === 0) return true;
      if (s.status !== 'playing') return false;
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

      if (canAdd(s)) {
        var added = addNumbers(s);
        if (added.event && search(added.state)) return true;
      }
      return false;
    }
    return search(state);
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
  /** True when both tiles are outlines, or both are solid. */
  function sameShade(x, y, rules) {
    var a = shadeOf(x, rules);
    return a !== null && a === shadeOf(y, rules);
  }
  /** True when one tile is an outline and the other is solid (a "mixed" pair). */
  function mixedShade(x, y, rules) {
    var a = shadeOf(x, rules), b = shadeOf(y, rules);
    return a !== null && b !== null && a !== b;
  }

  /** Points for one cleared pair. combo is 1 for the first pair in a streak.
      sameStyle adds STYLE_BONUS base points (before the multiplier). */
  function pairPoints(combo, rowsCleared, mult, sameStyle) {
    return Math.round((10 + Math.min((combo - 1) * 2, 20) + (sameStyle ? STYLE_BONUS : 0) + 50 * rowsCleared) * mult);
  }

  /** Points taken away for a mismatch (two tiles that don't match): half of what
      the pair would have scored as a real match (no row bonus), rounded. */
  function mismatchPenalty(s, x, y) {
    return Math.round(pairPoints(s.combo + 1, 0, pointMult(s.diff, s.level), sameShade(x, y, s.rules)) / 2);
  }

  /** Bonus for clearing a level. */
  function levelBonus(s) {
    var spareHints = isFinite(s.hintsLeft) ? 25 * s.hintsLeft : 0;
    return Math.round(pointMult(s.diff, s.level) * (100 * s.addsLeft + spareHints + 200 * s.level));
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
       moves, score, combo,
       penalties,                  // total points lost to mismatches this game (Undo never gives them back)
       cleared, total,             // numbers cleared / numbers dealt this level
       addsLeft, hintsLeft, undosLeft,
       history: [snapshot],        // for Undo (this level only)
       status: 'playing' | 'clear' | 'lose',
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
    var vals = makeBoard(level, rng, rules);
    return {
      level: level,
      rules: (rules === 'pairs' || rules === 'mahjong') ? rules : 'classic',
      cells: vals.map(function (v, i) { return { id: i + 1, v: v, done: false }; }),
      nextId: vals.length + 1,
      selected: null,
      combo: 0,
      cleared: 0,
      total: vals.length,
      addsLeft: addsFor(diff, level),
      hintsLeft: L.hints,
      undosLeft: L.undos,
      history: [],
      status: 'playing',
      bonus: 0,
      final: 0,
      newBest: false
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
    }, isBeatable);
  }

  function snapshot(s) {
    var h = s.history.concat([{
      cells: s.cells, nextId: s.nextId, moves: s.moves, cleared: s.cleared, total: s.total,
      score: s.score, combo: s.combo, addsLeft: s.addsLeft, penalties: s.penalties || 0
    }]);
    return h.length > HISTORY_LIMIT ? h.slice(h.length - HISTORY_LIMIT) : h;
  }

  /** Decide whether the level is cleared or lost. Mutates and returns n. */
  function finish(n) {
    if (n.total - n.cleared === 0) {
      n.status = 'clear';
      n.bonus = levelBonus(n);
      n.score += n.bonus;
      n.final = n.score;
    } else if (n.addsLeft <= 0 && !findPair(n.cells, LEVELS[n.diff].diag, n.rules)) {
      n.status = 'lose';
      n.bonus = 0;
      n.final = n.score;
    } else {
      n.status = 'playing';
      return n;
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
    n.combo = 0;       // a miss breaks the streak
    // A mismatch (values don't match) costs half the points the pair would have earned.
    // A matching pair that just isn't reachable costs nothing. Score never goes below 0.
    var penalty = okValue ? 0 : Math.min(s.score, mismatchPenalty(s, s.cells[a].v, s.cells[b].v));
    n.score = s.score - penalty;
    n.penalties = (s.penalties || 0) + penalty;
    return { state: n, event: { type: 'bad', id: id, reason: okValue ? 'path' : 'value', penalty: penalty } };
  }

  function applyMatch(s, a, b) {
    var before = s.cells;
    var cells = before.map(function (c, i) {
      return (i === a || i === b) ? { id: c.id, v: c.v, done: true } : c;
    });
    var had = doneRows(before);
    var rowsCleared = doneRows(cells).filter(function (r) { return had.indexOf(r) < 0; });
    var combo = s.combo + 1;
    var mult = pointMult(s.diff, s.level);
    var sameStyle = sameShade(before[a].v, before[b].v, s.rules);
    var mixed = mixedShade(before[a].v, before[b].v, s.rules);
    var rowBonus = Math.round(50 * rowsCleared.length * mult);
    // A mixed pair (outline + solid) still clears, but instead of points it costs half
    // of what the pair is worth (any row bonus is still paid). The score never goes below 0.
    var penalty = mixed ? Math.round(pairPoints(combo, 0, mult, false) / 2) : 0;
    var gain = mixed ? rowBonus - penalty : pairPoints(combo, rowsCleared.length, mult, sameStyle);
    gain = Math.max(gain, -s.score) || 0;      // `|| 0` turns -0 into 0
    if (mixed) penalty = rowBonus - gain;      // what was actually taken

    var n = copy(s);
    n.history = snapshot(s);
    n.cells = cells;
    n.selected = null;
    n.moves = s.moves + 1;
    n.cleared = s.cleared + 2;
    n.combo = combo;
    n.score = s.score + gain;
    finish(n);

    return {
      state: n,
      event: {
        type: 'match',
        ids: [before[a].id, before[b].id],
        indexes: [a, b],
        gain: gain,
        combo: combo,
        rowsCleared: rowsCleared,
        rowBonus: rowBonus,
        mixed: mixed,
        penalty: penalty,
        styleBonus: sameStyle ? Math.round(STYLE_BONUS * mult) : 0,
        shade: sameStyle ? shadeOf(before[a].v, s.rules) : null,
        status: n.status,
        newBest: n.newBest
      }
    };
  }

  /** Copy every not-done value, in order, onto the end of the board. */
  function addNumbers(s) {
    if (s.status !== 'playing' || s.addsLeft <= 0) return { state: s, event: null };
    var active = s.cells.filter(function (c) { return !c.done; });
    if (!active.length) return { state: s, event: null };

    var nextId = s.nextId;
    var added = active.map(function (c) { return { id: nextId++, v: c.v, done: false }; });

    var n = copy(s);
    n.history = snapshot(s);
    n.cells = compact(s.cells.concat(added));
    n.nextId = nextId;
    n.selected = null;
    n.moves = s.moves + 1;
    n.total = s.total + added.length;
    n.addsLeft = s.addsLeft - 1;
    n.combo = 0;
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
    // Undo gives back the move's points but NOT mismatch penalties paid since then.
    n.score = Math.max(0, last.score - ((s.penalties || 0) - (last.penalties || 0)));
    n.combo = last.combo; n.addsLeft = last.addsLeft;
    n.undosLeft = s.undosLeft - 1;  // Infinity - 1 === Infinity
    n.history = h;
    n.selected = null;
    n.status = 'playing'; n.bonus = 0; n.final = 0; n.newBest = false;
    return { state: n, event: { type: 'undo' } };
  }

  /** Reveal one legal pair. Costs one hint (only if a pair exists). */
  function hint(s) {
    if (s.status !== 'playing' || s.hintsLeft <= 0) return { state: s, event: null };
    var p = findPair(s.cells, LEVELS[s.diff].diag, s.rules, true);
    if (!p) return { state: s, event: { type: 'nohint' } };
    var n = copy(s);
    n.hintsLeft = s.hintsLeft - 1;
    n.selected = null;
    n.combo = 0;
    return { state: n, event: { type: 'hint', ids: [s.cells[p[0]].id, s.cells[p[1]].id] } };
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
  function remaining(s) { return s.total - s.cleared; }
  function canUndo(s) { return s.history.length > 0 && s.undosLeft > 0 && s.status !== 'clear'; }
  function canHint(s) { return s.status === 'playing' && s.hintsLeft > 0 && remaining(s) > 0; }
  function canAdd(s) { return s.status === 'playing' && s.addsLeft > 0 && remaining(s) > 0; }

  return {
    COLS: COLS, LEVELS: LEVELS, MAX_MASCOTS: MAX_MASCOTS,
    classicBoard: classicBoard, randomBoard: randomBoard, pairsBoard: pairsBoard, boardSize: boardSize, makeBoard: makeBoard,
    mascots: mascots, mascotOf: mascotOf, isSolid: isSolid,
    MAX_HONOURS: MAX_HONOURS, honoursInPlay: honoursInPlay, isHonour: isHonour, mahjongBoard: mahjongBoard,
    addsFor: addsFor, pointMult: pointMult, matches: matches, canLink: canLink, findPair: findPair,
    allPairs: allPairs, isBeatable: isBeatable,
    doneRows: doneRows, compact: compact, pairPoints: pairPoints, levelBonus: levelBonus,
    STYLE_BONUS: STYLE_BONUS, shadeOf: shadeOf, sameShade: sameShade, mixedShade: mixedShade, mismatchPenalty: mismatchPenalty,
    newGame: newGame, dealPuzzle: dealPuzzle, select: select, addNumbers: addNumbers, undo: undo, hint: hint,
    nextLevel: nextLevel, compactBoard: compactBoard,
    mulberry32: mulberry32, nextSeed: nextSeed, randomSeed: randomSeed, seekSeed: seekSeed,
    parsePuzzle: parsePuzzle, formatPuzzle: formatPuzzle,
    indexOfId: indexOfId, remaining: remaining, canUndo: canUndo, canHint: canHint, canAdd: canAdd
  };
});
