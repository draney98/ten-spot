/* Run with:  node reference/tests/logic.test.js
   No libraries needed. Prints PASS/FAIL per test and exits 1 on failure. */
'use strict';
var assert = require('assert');
var L = require('../game-logic.js');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + e.message); }
}
// Build a cells array from values; `doneIdx` lists indexes that are done.
function board(values, doneIdx) {
  doneIdx = doneIdx || [];
  return values.map(function (v, i) {
    var cell = { id: i + 1, v: (v && typeof v === 'object') ? v.v : v, done: doneIdx.indexOf(i) >= 0 };
    if (v && typeof v === 'object' && typeof v.solid === 'boolean') cell.solid = v.solid;
    return cell;
  });
}
function scripted(seq) {
  var i = 0;
  return function () { return i < seq.length ? seq[i++] : 0.999; };
}
// A state with a custom board (level 1, given difficulty).
// Old fixtures were written per difficulty. On the ramp the point multiplier comes from the
// level, so each old difficulty maps to the level with its old multiplier (x1, x1.5, x2.5)
// and keeps its old width. Tools follow that level (see L.TOOLS).
var FIXTURE = { easy: { level: 1, cols: 7 }, normal: { level: 6, cols: 8 }, hard: { level: 16, cols: 9 } };
function stateWith(values, diff, extra) {
  var f = FIXTURE[diff || 'normal'];
  var s = L.newGame('easy');
  s.diff = diff || 'normal';
  s.level = f.level;
  s.cols = f.cols;
  var T = L.toolsAt(f.level);
  s.hintsLeft = T.hints; s.undosLeft = T.undos; s.compactsLeft = T.packs;
  s.cells = board(values);
  s.nextId = values.length + 1;
  s.total = values.length;
  for (var k in (extra || {})) s[k] = extra[k];
  return s;
}
var X = 0; // filler value used in canLink tests (value doesn't matter there)

/* ---------------- boards ---------------- */
test('ramp: tiles rise by 2 every 2 levels from 12 to 80, and are always even', function () {
  assert.deepStrictEqual([1, 2, 3, 13, 14, 15, 37, 69, 70, 120].map(function (l) { return L.boardSize(l); }), [12, 12, 14, 24, 24, 26, 48, 80, 80, 80]);
  for (var level = 1; level <= 120; level++) assert.strictEqual(L.boardSize(level) % 2, 0, 'level ' + level);
});
test('ramp: the board widens to hold its tiles and walls as a square', function () {
  assert.deepStrictEqual([1, 14, 15, 26, 27, 38, 39, 52, 53, 80].map(L.widthAt), [5, 5, 6, 6, 7, 7, 8, 8, 9, 9]);
  assert.strictEqual(L.newGame('easy').cols, 5);
  assert.strictEqual(L.newGame('normal').cols, 7);   // Normal starts at level 37
  assert.strictEqual(L.newGame('hard').cols, 9);     // Hard starts at level 53
});

/* ---------------- matching ---------------- */
test('matches: same mascot', function () {
  assert.ok(L.matches(1, 2)); assert.ok(L.matches(4, 4)); assert.ok(L.matches(5, 6));
  assert.ok(!L.matches(1, 9)); assert.ok(!L.matches(2, 3)); assert.ok(!L.matches(3, 7));
});

/* ---------------- adjacency ---------------- */
var blank = function (n) { var a = []; for (var i = 0; i < n; i++) a.push(X); return a; };
test('horizontal neighbours link', function () {
  assert.ok(L.canLink(board(blank(18)), 0, 1, true));
});
test('vertical neighbours link', function () {
  assert.ok(L.canLink(board(blank(18)), 0, 9, true));
});
test('diagonal neighbours link only when diagonals allowed', function () {
  assert.ok(L.canLink(board(blank(18)), 0, 10, true));
  assert.ok(L.canLink(board(blank(18)), 8, 16, true));   // anti-diagonal
  assert.ok(!L.canLink(board(blank(18)), 0, 10, false));
});
test('wrap: last cell of a row links to first cell of next row', function () {
  assert.ok(L.canLink(board(blank(18)), 8, 9, true));
});
test('gap of active cells blocks a horizontal link', function () {
  assert.ok(!L.canLink(board(blank(9)), 0, 2, true));
});
test('gap of done cells allows a horizontal link', function () {
  assert.ok(L.canLink(board(blank(9), [1]), 0, 2, true));
});
test('wrap across done cells: end of row 0 to middle of row 1', function () {
  // index 6 to index 11: cells 7,8,9,10 between must be done
  assert.ok(L.canLink(board(blank(18), [7, 8, 9, 10]), 6, 11, true));
  assert.ok(!L.canLink(board(blank(18), [7, 8, 10]), 6, 11, false));
});
test('vertical across done cells', function () {
  assert.ok(L.canLink(board(blank(27), [9]), 0, 18, true));
  assert.ok(!L.canLink(board(blank(27)), 0, 18, true));
});
test('diagonal across done cells', function () {
  assert.ok(L.canLink(board(blank(27), [10]), 0, 20, true));
  assert.ok(!L.canLink(board(blank(27)), 0, 20, true));
});
test('knight-move shape never links', function () {
  assert.ok(!L.canLink(board(blank(27)), 0, 11, true));
});
test('order of arguments does not matter', function () {
  assert.ok(L.canLink(board(blank(18)), 9, 0, true));
});
test('a vertical neighbour sits one width away', function () {
  assert.ok(L.canLink(board(blank(14)), 0, 7, true, 7));
  assert.ok(L.canLink(board(blank(16)), 0, 8, true, 8));
  assert.ok(L.canLink(board(blank(18)), 0, 9, true, 9));
  assert.ok(!L.canLink(board(blank(16)), 0, 10, true, 8));
});

/* ---------------- rows ---------------- */
test('compact removes only fully-done rows', function () {
  var b = board(blank(20), [0,1,2,3,4,5,6,7,8, 18]);
  var c = L.compact(b);
  assert.strictEqual(c.length, 11);
  assert.strictEqual(c[0].id, 10);
});
test('a fully-done partial last row is removed too', function () {
  var b = board(blank(11), [9, 10]);
  assert.strictEqual(L.compact(b).length, 9);
});

/* ---------------- difficulty ---------------- */
test('ramp: adds per level', function () {
  assert.deepStrictEqual([1, 10, 11, 26, 27, 58, 59, 100].map(function (l) { return L.addsFor('easy', l); }), [6, 6, 5, 5, 4, 4, 3, 3]);
  assert.strictEqual(L.addsFor('hard', 1), 6, 'the difficulty no longer matters');
});
test('point multiplier grows 0.1 a level', function () {
  assert.deepStrictEqual([1, 6, 16, 37, 53, 70].map(function (l) { return L.pointMult('easy', l); }), [1, 1.5, 2.5, 4.6, 6.2, 7.9]);
});

/* ---------------- actions ---------------- */
test('a same-shade column pair scores 30 on Normal', function () {
  var s = stateWith([1, 3, 3, 3, 3, 3, 3, 3, 1, 5], 'normal');
  var r = L.select(L.select(s, 1).state, 9);
  assert.strictEqual(r.event.type, 'match');
  assert.strictEqual(r.event.kind, 'col');
  assert.strictEqual(r.event.gain, 30);
  assert.strictEqual(r.event.shade, 'outline');
  assert.strictEqual(r.state.score, 30);
  assert.strictEqual(r.state.cleared, 2);
  assert.strictEqual(r.state.moves, 1);
});
test('streak grows by a tenth and a mismatch resets it', function () {
  var s = stateWith([1,1,2,2,3,3,4,6,4,4], 'easy');
  s = L.select(L.select(s, 1).state, 2).state; assert.strictEqual(s.score, 20);   // 10 x 2
  s = L.select(L.select(s, 3).state, 4).state; assert.strictEqual(s.score, 42);   // + 20 x 1.1
  var r = L.select(L.select(s, 5).state, 8);   // 3 and 6: not a match
  assert.strictEqual(r.event.type, 'bad'); assert.strictEqual(r.event.reason, 'value');
  assert.strictEqual(r.state.streak, 0);
  assert.strictEqual(r.state.selected, 8);
});
test('path failure reports reason "path"', function () {
  var s = stateWith([1,2,1,3,4,5,6,7,8], 'normal');
  var r = L.select(L.select(s, 1).state, 3);
  assert.strictEqual(r.event.reason, 'path');
});
test('tapping the selected cell deselects it', function () {
  var s = L.select(L.newGame('normal'), 1).state;
  var r = L.select(s, 1);
  assert.strictEqual(r.event.type, 'deselect'); assert.strictEqual(r.state.selected, null);
});
test('tapping a done cell does nothing', function () {
  var s = stateWith([1,1,2,8], 'normal');
  s = L.select(L.select(s, 1).state, 2).state;
  assert.strictEqual(L.select(s, 1).event, null);
});
test('clearing a full row awards the row bonus', function () {
  var s = stateWith([1, 1, 3, 3, 5, 5, 7, 7, 9], 'easy');
  [[1, 2], [3, 4], [5, 6]].forEach(function (p) { s = L.select(L.select(s, p[0]).state, p[1]).state; });
  var r = L.select(L.select(s, 7).state, 8);
  assert.deepStrictEqual(r.event.rowsCleared, [0]);
  assert.strictEqual(r.event.rowBonus, 30);
  assert.strictEqual(r.event.kind, 'wrap');
  assert.strictEqual(r.event.gain, 69);
});
test('add numbers appends copies of active values and spends an add', function () {
  var s = stateWith([1,2,3], 'normal');
  var r = L.addNumbers(s);
  assert.deepStrictEqual(r.state.cells.map(function (c) { return c.v; }), [1,2,3,1,2,3]);
  assert.strictEqual(r.state.addsLeft, s.addsLeft - 1);
  assert.strictEqual(r.state.total, 6);
  assert.deepStrictEqual(r.event.ids, [4,5,6]);
});
test('undo restores the board, costs an undo, refunds an add', function () {
  var s = stateWith([1,2,3], 'normal', { level: 30, undosLeft: 5 });
  var adds = s.addsLeft;
  s = L.addNumbers(s).state;
  var r = L.undo(s);
  assert.strictEqual(r.state.cells.length, 3);
  assert.strictEqual(r.state.addsLeft, adds);
  assert.strictEqual(r.state.undosLeft, 4);
});
test('undo is never unlimited: Easy levels start with 5', function () {
  var s = L.addNumbers(stateWith([1,2,3], 'easy')).state;
  assert.strictEqual(s.undosLeft, 5);
  assert.strictEqual(L.undo(s).state.undosLeft, 4);
});
test('hint returns a legal pair and costs a hint', function () {
  var r = L.hint(stateWith([1, 1, 3], 'normal', { hintsLeft: 3 }));
  assert.strictEqual(r.event.type, 'hint');
  assert.strictEqual(r.state.hintsLeft, 2);
  assert.deepStrictEqual(r.event.ids, [1, 2]);
});
test('from level 55 there are no hints', function () {
  assert.strictEqual(L.newGame('hard').hintsLeft, 1);          // level 53
  var s = L.dealPuzzle({ diff: 'hard', level: 55, seed: 3 });
  assert.strictEqual(s.hintsLeft, 0);
  assert.strictEqual(L.hint(s).event, null);
});
test('clearing the last pair clears the level with a bonus', function () {
  var s = stateWith([1, 2], 'normal', { par: 3 });
  var r = L.select(L.select(s, 1).state, 2);
  assert.strictEqual(r.state.status, 'clear');
  // Level 6 (x1.5): 1 match used, par 3, 2 under par: 1.5 * (100 x 6 + 400) = 1500. Pair is mixed, plus one row.
  assert.strictEqual(r.state.bonus, 1500);
  assert.strictEqual(r.event.gain, 60);
  assert.strictEqual(r.state.score, 1560);
  assert.ok(r.state.newBest);
  assert.strictEqual(r.state.best.normal, 1560);
});
test('no adds and no pairs left = game over', function () {
  var s = stateWith([1,1,2,3], 'normal', { addsLeft: 0 });
  var r = L.select(L.select(s, 1).state, 2);
  assert.strictEqual(r.state.status, 'lose');
  assert.strictEqual(r.state.reason, 'nopairs');
  assert.strictEqual(r.state.final, 30);
});
test('next level deals a bigger board, keeps score, resets adds', function () {
  var s = L.select(L.select(stateWith([1, 2], 'normal', { level: 10 }), 1).state, 2).state;
  var n = L.nextLevel(s, Math.random).state;
  assert.strictEqual(n.level, 11);
  assert.strictEqual(n.cells.length, 22);
  assert.strictEqual(n.score, s.score);
  assert.strictEqual(n.addsLeft, 5);
  assert.strictEqual(n.status, 'playing');
});
test('actions never mutate the state they were given', function () {
  var s = L.newGame('normal');
  var frozen = JSON.stringify(s);
  L.select(L.select(s, 1).state, 10); L.addNumbers(s); L.hint(s);
  assert.strictEqual(JSON.stringify(s), frozen);
});

/* ---------------- Hard mode ---------------- */
test('Hard allows a diagonal pair', function () {
  var vals = [];
  for (var i = 0; i < 11; i++) vals.push(3);
  vals[0] = 1; vals[10] = 1;
  var s = stateWith(vals, 'hard');
  var r = L.select(L.select(s, 1).state, 11);
  assert.strictEqual(r.event.type, 'match');
  assert.strictEqual(r.event.kind, 'diag');
  assert.strictEqual(r.event.gain, 75);        // (10 + 5) x 2 x 2.5
});

/* ---------------- Gridiron ('pairs' rules) ---------------- */
test('pairs: same mascot matches (outline+solid or identical), different mascot does not', function () {
  assert.ok(L.matches(1, 2, 'pairs'));   // mascot 1 outline + solid
  assert.ok(L.matches(3, 3, 'pairs'));   // two identical
  assert.ok(L.matches(16, 15, 'pairs')); // mascot 8
  assert.ok(!L.matches(2, 3, 'pairs'));  // mascot 1 vs mascot 2
  assert.ok(!L.matches(1, 9, 'pairs'));  // sums to 10 but different mascots
});
test('ramp: mascots 3 at level 1, then 4, 5, 6 and 7 at levels 15, 19, 23 and 31', function () {
  assert.deepStrictEqual([1, 14, 15, 19, 23, 30, 31, 100].map(function (l) { return L.mascots(l); }), [3, 3, 4, 5, 6, 6, 7, 7]);
});
test('ramp: stages are Easy to 36, Normal 37-52, Hard from 53', function () {
  assert.deepStrictEqual([1, 36, 37, 52, 53, 99].map(L.stageOf), ['easy', 'easy', 'normal', 'normal', 'hard', 'hard']);
  assert.deepStrictEqual(['easy', 'normal', 'hard'].map(L.startLevel), [1, 37, 53]);
});
test('pairs: boards have the ramp size and use only the allowed mascots', function () {
  [[1,12,3],[15,26,4],[31,42,7],[69,80,7]].forEach(function (t) {
    var b = L.pairsBoard(t[0], Math.random);
    assert.strictEqual(b.length, t[1]);
    b.forEach(function (v) { assert.ok(v >= 1 && v <= 2 * t[2], 'value ' + v + ' on level ' + t[0]); });
  });
});
test('pairs: prefer both outline or both solid', function () {
  function constant(x) { return function () { return x; }; }
  function shades(x) {
    var outline = 0, solid = 0;
    L.pairsBoard(1, constant(x)).forEach(function (v) { if (v % 2) outline++; else solid++; });
    return [outline, solid];
  }
  assert.deepStrictEqual(shades(0), [12, 0]);
  assert.deepStrictEqual(shades(0.5), [0, 12]);
  assert.deepStrictEqual(shades(0.8), [6, 6]);
});
function mascotTiles(board) {
  var count = {};
  board.forEach(function (v) { var m = L.mascotOf(v); count[m] = (count[m] || 0) + 1; });
  return count;
}
test('pairs: easy and normal deal every mascot, and counts differ by at most one pair', function () {
  ['easy', 'normal'].forEach(function (diff) {
    [1, 2, 4, 8, 13].forEach(function (level) {
      var fams = L.mascots(level, diff);
      var count = mascotTiles(L.pairsBoard(level, Math.random, diff));
      var pairs = [];
      for (var m = 1; m <= fams; m++) {
        assert.ok(count[m] > 0, diff + ' level ' + level + ' missing mascot ' + m);
        assert.strictEqual(count[m] % 2, 0, diff + ' level ' + level + ' mascot ' + m);
        pairs.push(count[m] / 2);
      }
      var min = Math.min.apply(null, pairs), max = Math.max.apply(null, pairs);
      assert.ok(max - min <= 1, diff + ' level ' + level + ' spread ' + min + '..' + max);
    });
  });
});
test('pairs: every mascot gets an even share of pairs', function () {
  [1, 15, 31, 69].forEach(function (level) {
    var fams = L.mascots(level);
    var count = mascotTiles(L.pairsBoard(level, Math.random));
    var counts = [];
    for (var m = 1; m <= fams; m++) { assert.ok(count[m] > 0, 'level ' + level + ' missing mascot ' + m); assert.strictEqual(count[m] % 2, 0); counts.push(count[m]); }
    assert.ok(Math.max.apply(null, counts) - Math.min.apply(null, counts) <= 2, 'level ' + level);
  });
});
test('pairs: new game, select, hint and next level keep the Gridiron rules', function () {
  var s = L.newGame('easy', null, Math.random, 'pairs');
  assert.strictEqual(s.rules, 'pairs');
  assert.strictEqual(s.cells.length, 12);
  s.cells = board([1, 2, 3, 6]); s.total = 4; s.nextId = 5;   // longhorn outline+solid, paw outline, helmet solid
  var h = L.hint(s);
  assert.deepStrictEqual(h.event.ids, [1, 2]);
  var bad = L.select(L.select(s, 2).state, 3);               // longhorn solid + paw outline
  assert.strictEqual(bad.event.reason, 'value');
  var ok = L.select(L.select(s, 1).state, 2);
  assert.strictEqual(ok.event.type, 'match');
  var cleared = L.select(L.select(stateWith([5, 6], 'normal', { rules: 'pairs' }), 1).state, 2).state;
  assert.strictEqual(cleared.status, 'clear');
  var next = L.nextLevel(cleared, Math.random).state;
  assert.strictEqual(next.rules, 'pairs');
  assert.strictEqual(next.cells.length, 18);   // level 7
});
test('Gridiron is the only ruleset', function () {
  assert.strictEqual(L.newGame('normal').rules, 'pairs');
});

/* ---------------- style bonus and mismatch penalty ---------------- */
test('shadeOf: odd outline, even solid', function () {
  assert.deepStrictEqual([1, 2, 3, 4].map(function (v) { return L.shadeOf(v); }), ['outline', 'solid', 'outline', 'solid']);
  assert.ok(L.sameShade(1, 3));
  assert.ok(!L.sameShade(1, 2));
  assert.ok(L.mixedShade(1, 2));
  assert.ok(!L.mixedShade(2, 4));
});
test('two outlines earn the style bonus', function () {
  var light = L.select(L.select(stateWith([1, 1, 2], 'easy'), 1).state, 2);
  assert.strictEqual(light.event.same, true);
  assert.strictEqual(light.event.gain, 20);
  assert.strictEqual(light.event.shade, 'outline');
  var hinted = L.hint(stateWith([1, 1, 2, 2], 'normal'));
  assert.deepStrictEqual(hinted.event.ids, [1, 2]);
});
test('add copies a stored shade flag onto the new tiles', function () {
  var n = L.addNumbers(stateWith([{ v: 1, solid: true }, { v: 2, solid: false }], 'easy')).state;
  var added = n.cells.filter(function (c) { return c.id > 2; });
  assert.strictEqual(added[0].v, 1);
  assert.strictEqual(added[0].solid, true);
  assert.strictEqual(added[1].v, 2);
  assert.strictEqual(added[1].solid, false);
});
test('the next level deals a larger Gridiron board', function () {
  var dealt = L.nextLevel(stateWith([1, 1], 'easy', { status: 'clear', level: 2 }), scripted([0.01, 0])).state;
  assert.strictEqual(dealt.level, 3);
  assert.strictEqual(dealt.cells.length, 14);
  assert.strictEqual(dealt.rules, 'pairs');
  assert.strictEqual(dealt.cols, 5);
  dealt.cells.forEach(function (c) { assert.ok(c.v >= 1 && c.v <= 6); });
});
test('an outline and a solid tile score normal points', function () {
  var r = L.select(L.select(stateWith([1, 2, 5], 'easy', { score: 100 }), 1).state, 2);
  assert.strictEqual(r.event.type, 'match'); assert.strictEqual(r.state.cleared, 2);
  assert.strictEqual(r.event.same, false);
  assert.strictEqual(r.event.gain, 10);
  assert.strictEqual(r.state.score, 110);
  assert.strictEqual(r.state.streak, 1);
});
test('undo charges its cost and never goes below 0', function () {
  var s = L.select(L.select(stateWith([1, 2, 5], 'easy', { score: 100 }), 1).state, 2).state;
  assert.strictEqual(L.undo(s).state.score, 95);   // back to 100, then undo costs 5
  var broke = L.select(L.select(stateWith([1, 2, 5], 'easy'), 1).state, 2).state;
  assert.strictEqual(L.undo(broke).state.score, 0);
});
test('hint prefers a pair with no mixed penalty', function () {
  var s = stateWith([1, 2, 3, 3], 'normal');
  var h = L.hint(s);
  assert.deepStrictEqual(h.event.ids, [3, 4]);
  var only = L.hint(stateWith([1, 2, 3, 5], 'normal'));
  assert.deepStrictEqual(only.event.ids, [1, 2]);
});
test('Gridiron: two solids earn the style bonus, outline + solid is a mixed pair', function () {
  var two = L.select(L.select(stateWith([2, 2, 5], 'easy'), 1).state, 2);
  assert.strictEqual(two.event.gain, 20); assert.strictEqual(two.event.shade, 'solid');
  var mix = L.select(L.select(stateWith([1, 2, 5], 'easy', { score: 100 }), 1).state, 2);
  assert.strictEqual(mix.event.gain, 10); assert.strictEqual(mix.event.same, false);
});
test('mismatch subtracts half of what the pair would have scored', function () {
  // 1 and 3 are both outlines and different mascots: (10 x 2) x 1.5 = 30, penalty 15
  var r = L.select(L.select(stateWith([1, 3], 'normal', { score: 100 }), 1).state, 2);
  assert.strictEqual(r.event.penalty, 15); assert.strictEqual(r.state.score, 85);
  // 2 and 3 are mixed shades: 10 x 1.5 = 15, penalty 8
  var r2 = L.select(L.select(stateWith([2, 3], 'normal', { score: 100 }), 1).state, 2);
  assert.strictEqual(r2.event.penalty, 8);
});
test('mismatch penalty never takes the score below 0; unreachable pairs cost nothing', function () {
  var r = L.select(L.select(stateWith([1, 3], 'normal', { score: 4 }), 1).state, 2);
  assert.strictEqual(r.state.score, 0); assert.strictEqual(r.event.penalty, 4);
  var p = L.select(L.select(stateWith([1, 2, 1], 'normal', { score: 50 }), 1).state, 3);
  assert.strictEqual(p.event.reason, 'path'); assert.strictEqual(p.event.penalty, 0); assert.strictEqual(p.state.score, 50);
});
test('undo does not give back mismatch penalties', function () {
  var s = stateWith([1, 1, 2, 3, 5, 5], 'easy');
  s = L.select(L.select(s, 1).state, 2).state;            // +20
  s = L.select(L.select(s, 3).state, 4).state;            // 2 vs 3, mixed, streak 2: round(11 / 2) = 6
  assert.strictEqual(s.score, 14);
  s = L.undo(s).state;
  assert.strictEqual(s.score, 0);
});

/* ---------------- beatability ---------------- */
test('isBeatable: tiny clearable board', function () {
  assert.strictEqual(L.isBeatable(stateWith([1, 2])), true);
});
test('isBeatable: values never match and no adds', function () {
  assert.strictEqual(L.isBeatable(stateWith([2, 3], 'normal', { addsLeft: 0 })), false);
});
test('isBeatable: lone tile needs Add to become a pair', function () {
  assert.strictEqual(L.isBeatable(stateWith([5], 'normal', { addsLeft: 1 })), true);
  assert.strictEqual(L.isBeatable(stateWith([5], 'normal', { addsLeft: 0 })), false);
});
test('isBeatable: a fresh Normal board', function () {
  assert.strictEqual(L.isBeatable(L.newGame('normal')), true);
});
test('isBeatable: already clear or empty remaining', function () {
  var cleared = stateWith([3, 7], 'normal', { status: 'clear', cleared: 2 });
  assert.strictEqual(L.isBeatable(cleared), true);
  var empty = stateWith([], 'normal', { total: 0, cleared: 0, nextId: 1 });
  assert.strictEqual(L.isBeatable(empty), true);
});
test('isBeatable: lose status is not beatable', function () {
  assert.strictEqual(L.isBeatable(stateWith([2, 3], 'normal', { status: 'lose', addsLeft: 0 })), false);
});
test('allPairs lists every legal pair, not only the first', function () {
  var cells = board([1, 1, 1]);
  var pairs = L.allPairs(cells, true, 'pairs');
  assert.deepStrictEqual(pairs, [[0, 1], [1, 2]]); // 0-2 blocked by active cell between
});

test('seekSeed skips a rejected seed', function () {
  var seen = [];
  var board = L.seekSeed(1, function (seed) { seen.push(seed); return { seed: seed }; }, function (b) { return b.seed !== 1; });
  assert.deepStrictEqual(seen, [1, L.nextSeed(1)]);
  assert.strictEqual(board.seed, L.nextSeed(1));
});

test('board codes are the level and the seed; old codes are recognised', function () {
  assert.strictEqual(L.parsePuzzle('nope'), null);
  assert.strictEqual(L.parsePuzzle('0-00a1b2c3'), null);
  assert.strictEqual(L.parsePuzzle('41-00a1b2c'), null);
  assert.deepStrictEqual(L.parsePuzzle(' 41-00A1B2C3 '), { diff: 'normal', level: 41, mode: 'teams', seed: 0x00a1b2c3 });
  assert.strictEqual(L.parsePuzzle('3-00a1b2c3').diff, 'easy');
  assert.strictEqual(L.parsePuzzle('60-00a1b2c3').diff, 'hard');
  assert.deepStrictEqual(L.parsePuzzle('normal-1-teams-00a1b2c3'), { old: true });
  assert.strictEqual(L.formatPuzzle({ diff: 'normal', level: 41, seed: 0x00a1b2c3 }), '41-00a1b2c3');
});

test('a dealt board remembers its opening tiles', function () {
  var s = L.newGame('normal');
  assert.strictEqual(s.opening.length, s.cells.length);
  assert.strictEqual(s.opening[0].v, s.cells[0].v);
  assert.ok(!s.opening[0].id);
});

test('each start point deals a beatable Gridiron board at its width', function () {
  ['easy', 'normal', 'hard'].forEach(function (diff) {
    var s = L.dealPuzzle({ diff: diff, seed: 5 });
    assert.strictEqual(s.level, L.startLevel(diff));
    assert.strictEqual(s.cols, L.widthAt(s.level));
    assert.strictEqual(s.rules, 'pairs');
    assert.strictEqual(s.total, L.boardSize(s.level));
    assert.strictEqual(L.isBeatable(s), true);
  });
});

test('the same puzzle code deals the same cells', function () {
  var first = L.dealPuzzle({ diff: 'normal', level: 41, seed: 1, score: 40, moves: 3, penalties: 2, best: { easy: 0, normal: 9, hard: 0 } });
  assert.strictEqual(L.isBeatable(first), true);
  assert.strictEqual(first.score, 40);
  assert.strictEqual(first.best.normal, 9);
  assert.strictEqual(first.cols, 8);
  var again = L.dealPuzzle({ diff: 'normal', level: 41, seed: first.seed });
  assert.deepStrictEqual(again.cells.map(function (c) { return c.v; }), first.cells.map(function (c) { return c.v; }));
  assert.strictEqual(again.seed, first.seed);
});

/* ---------------- dead boards (pairs) ---------------- */
test('pairs: one legal pair can still be a dead board', function () {
  var stuck = board([1, 7, 3, 4, 1, 8, 1, 8, 1], [1, 2, 3]);
  assert.deepStrictEqual(L.findPair(stuck, true, 'pairs'), [0, 4]);
  assert.strictEqual(L.canClear(stuck, true, 'pairs'), false);

  var pre = stateWith([1, 7, 3, 4, 1, 8, 1, 8, 1], 'normal', { addsLeft: 0, cols: 9 });
  pre.cells[1].done = true;
  var r = L.select(L.select(pre, 3).state, 4);
  assert.strictEqual(r.event.type, 'match');
  assert.strictEqual(r.state.status, 'playing');
  assert.ok(L.findPair(r.state.cells, true, 'pairs'));
  assert.strictEqual(L.isBeatable(r.state), false);

  var open = stateWith([1, 7, 3, 4, 1, 8, 1, 8, 1], 'normal', { addsLeft: 1, cols: 9 });
  open.cells[1].done = true;
  assert.strictEqual(L.select(L.select(open, 3).state, 4).state.status, 'playing');
});

test('pairs: hint shows a pair that keeps the board clearable', function () {
  var trap = board([1, 3, 1, 1, 1, 1, 3, 1, 3, 3]);
  assert.strictEqual(L.canClear(trap, true, 'pairs'), true);
  assert.deepStrictEqual(L.findPair(trap, true, 'pairs'), [1, 9]);
  var s = stateWith([1, 3, 1, 1, 1, 1, 3, 1, 3, 3], 'normal', { addsLeft: 0, cols: 9 });
  // Indexes 8 and 9 clear the one-cell second row and still leave a win.
  // findPair's first pair, indexes 1 and 9, does not.
  assert.deepStrictEqual(L.hint(s).event.ids, [9, 10]);
});

test('pairs: clearing a row changes which diagonals link', function () {
  var vals = [
    1, 3, 9, 9, 9, 9, 9, 9, 9,
    5, 5, 7, 7, 2, 2, 4, 4, 9,
    9, 1, 3, 9, 9, 9, 9, 9, 9
  ];
  var doneIdx = [2, 3, 4, 5, 6, 7, 8, 17, 18, 21, 22, 23, 24, 25, 26];
  assert.strictEqual(L.canClear(board(vals, doneIdx), true, 'pairs'), true);

  var s = stateWith(vals, 'normal', { addsLeft: 0, cleared: doneIdx.length, cols: 9 });
  doneIdx.forEach(function (i) { s.cells[i].done = true; });
  function match(state, a, b) { return L.select(L.select(state, a).state, b).state; }
  s = L.compactBoard(match(s, 10, 11));
  s = L.compactBoard(match(s, 12, 13));
  s = L.compactBoard(match(s, 14, 15));
  s = match(s, 16, 17);
  assert.strictEqual(s.status, 'playing');
  var i1 = L.indexOfId(s.cells, 1), i2 = L.indexOfId(s.cells, 20);
  assert.strictEqual(L.canLink(s.cells, i1, i2, true, s.cols), false);
  s = L.compactBoard(s);
  i1 = L.indexOfId(s.cells, 1); i2 = L.indexOfId(s.cells, 20);
  assert.strictEqual(L.canLink(s.cells, i1, i2, true, s.cols), true);
  s = L.compactBoard(match(s, 1, 20));
  s = match(s, 2, 21);
  assert.strictEqual(s.status, 'clear');
});

test('pairs: a large board past the budget stays in play', function () {
  var vals = [];
  for (var i = 0; i < 54; i++) vals.push(i % 2 ? 3 : 1);
  assert.strictEqual(L.canClear(board(vals), true, 'pairs', 50), null);
  var s = stateWith(vals, 'normal', { addsLeft: 0, cols: 9 });
  // Even indexes are longhorns. 0 and 10 are a diagonal pair.
  var r = L.select(L.select(s, 1).state, 11);
  assert.strictEqual(r.event.type, 'match');
  assert.strictEqual(r.state.status, 'playing');
});

/* ---------------- distance, streak, and the new level bonus ---------------- */
function near(m, want) { assert.ok(Math.abs(m - want) < 1e-9, m + ' !== ' + want); }

test('1 neighbours that share a shade score 30', function () {
  var r = L.select(L.select(stateWith([1, 1, 2], 'normal'), 1).state, 2);
  assert.strictEqual(r.event.gain, 30);
  assert.strictEqual(r.event.same, true);
  assert.strictEqual(r.state.streak, 1);
});
test('2 a mixed neighbour pair scores 15 and the score goes up', function () {
  var r = L.select(L.select(stateWith([1, 2, 5], 'normal', { score: 10 }), 1).state, 2);
  assert.strictEqual(r.event.gain, 15);
  assert.strictEqual(r.event.same, false);
  assert.strictEqual(r.state.score, 25);
});
test('3 two crossed-out cells between a pair add the gap bonus', function () {
  var s = stateWith([1, 8, 8, 2, 5], 'normal');
  s.cells[1].done = true; s.cells[2].done = true;
  var r = L.select(L.select(s, 1).state, 4);
  assert.strictEqual(r.event.gaps, 2);
  assert.strictEqual(r.event.gain, 21);
});
test('a wrap stroke goes right, through the gutter, then right into the lower cell', function () {
  var adjacent = L.wrapStroke({ x: 80, y: 10 }, { x: 20, y: 40 }, 0, 90, [10, 40]);
  assert.strictEqual(adjacent, 'M 80 10 L 90 10 L 90 25 L 0 25 L 0 40 L 20 40');
  var spanned = L.wrapStroke({ x: 80, y: 10 }, { x: 20, y: 70 }, 0, 90, [10, 40, 70]);
  assert.strictEqual(spanned, 'M 80 10 L 90 10 L 90 25 L 0 25 L 0 40 L 90 40 L 90 55 L 0 55 L 0 70 L 20 70');
});

test('4 a wrap of two outlines scores 45', function () {
  var vals = [3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 3];
  var r = L.select(L.select(stateWith(vals, 'normal', { cols: 9 }), 9).state, 10);
  assert.strictEqual(r.event.kind, 'wrap');
  assert.strictEqual(r.event.gain, 45);
});
test('5 a blocked reading order that is diagonal scores 45', function () {
  var vals = [1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 1, 3];
  var r = L.select(L.select(stateWith(vals, 'normal', { cols: 9 }), 1).state, 11);
  assert.strictEqual(r.event.kind, 'diag');
  assert.strictEqual(r.event.gaps, 0);
  assert.strictEqual(r.event.gain, 45);
});
test('6 a column with one crossed-out cell between scores 36', function () {
  var vals = [];
  for (var i = 0; i < 20; i++) vals.push(3);
  vals[0] = 4; vals[18] = 4;
  var s = stateWith(vals, 'normal', { cols: 9 });
  s.cells[9].done = true;
  var r = L.select(L.select(s, 1).state, 19);
  assert.strictEqual(r.event.kind, 'col');
  assert.strictEqual(r.event.gaps, 1);
  assert.strictEqual(r.event.gain, 36);
});
test('7 the streak multiplier reaches 1.2 on the third pair and stops at 2', function () {
  var vals = [];
  for (var row = 0; row < 3; row++) {
    for (var c = 0; c < 8; c++) vals.push(1);
    vals.push(5);
  }
  var s = stateWith(vals, 'normal', { cols: 9 });
  var pairs = [[1, 2], [3, 4], [5, 6], [7, 8], [10, 11], [12, 13], [14, 15], [16, 17], [19, 20], [21, 22], [23, 24], [25, 26]];
  var third, eleventh, twelfth;
  pairs.forEach(function (p, n) {
    var r = L.select(L.select(s, p[0]).state, p[1]);
    s = r.state;
    if (n === 2) third = r.event;
    if (n === 10) eleventh = r.event;
    if (n === 11) twelfth = r.event;
  });
  near(third.streakMult, 1.2);
  assert.strictEqual(third.gain, 36);
  near(eleventh.streakMult, 2);
  near(twelfth.streakMult, 2);
  assert.strictEqual(eleventh.gain, 60);
  assert.strictEqual(twelfth.gain, 60);
});
test('8 Add knocks the streak back one step', function () {
  var s = stateWith([1, 2], 'normal', { streak: 3 });
  assert.strictEqual(L.addNumbers(s).state.streak, 2);
});
test('9 a mismatch costs half of the new pair score and breaks the streak', function () {
  var r = L.select(L.select(stateWith([1, 3, 5], 'normal', { score: 100, streak: 2 }), 1).state, 2);
  assert.strictEqual(r.event.penalty, 18);
  assert.strictEqual(r.state.score, 82);
  assert.strictEqual(r.state.streak, 0);
});
test('10 two rows emptied at once pay 180', function () {
  var vals = [];
  for (var i = 0; i < 18; i++) vals.push(i === 0 || i === 9 ? 1 : 8);
  var done = [];
  for (var k = 0; k < 18; k++) if (k !== 0 && k !== 9) done.push(k);
  var s = stateWith(vals, 'normal', { cols: 9 });
  done.forEach(function (i) { s.cells[i].done = true; });
  var r = L.select(L.select(s, 1).state, 10);
  assert.strictEqual(r.event.rowsCleared.length, 2);
  assert.strictEqual(r.event.rowBonus, 180);
});
test('11 finishing under par pays the level bonus and the par bonus', function () {
  var r = L.select(L.select(stateWith([1, 1], 'normal', { par: 3, addsLeft: 5 }), 1).state, 2);
  assert.strictEqual(r.state.status, 'clear');
  assert.strictEqual(r.state.bonus, 1500); // level 6, 1 match, 2 under par: 1.5 * (600 + 400)
});
test('12 using more matches than par pays only the level part', function () {
  var r = L.select(L.select(stateWith([1, 1], 'normal', { par: 0, addsLeft: 2 }), 1).state, 2);
  assert.strictEqual(r.state.bonus, 900); // level 6, par 0: 1.5 * 600
});
test('13 a hint costs 38 points, a hint count, and one streak step', function () {
  var r = L.hint(stateWith([1, 1, 2], 'normal', { score: 100, streak: 2, hintsLeft: 3 }));
  assert.strictEqual(r.event.cost, 38);
  assert.strictEqual(r.state.score, 62);
  assert.strictEqual(r.state.hintsLeft, 2);
  assert.strictEqual(r.state.streak, 1);
});
test('14 undo restores the pair then charges 8, and never goes below 0', function () {
  var cleared = L.select(L.select(stateWith([1, 1, 2], 'normal', { score: 100 }), 1).state, 2).state;
  assert.strictEqual(cleared.score, 130);
  var back = L.undo(cleared);
  assert.strictEqual(back.event.cost, 8);
  assert.strictEqual(back.state.score, 92);
  var empty = L.select(L.select(stateWith([1, 1, 2], 'normal'), 1).state, 2).state;
  assert.strictEqual(L.undo(empty).state.score, 0);
});
test('15 mismatch and hint costs do not come back on undo', function () {
  var s = L.select(L.select(stateWith([1, 1, 3, 5, 7, 7], 'normal', { score: 100 }), 1).state, 2).state;
  var missed = L.select(L.select(s, 3).state, 4);
  assert.strictEqual(missed.event.penalty, 17);
  s = missed.state;
  var hinted = L.hint(s);
  assert.strictEqual(hinted.event.cost, 38);
  s = hinted.state;
  var back = L.undo(s);
  assert.strictEqual(back.state.score, 37);
  assert.strictEqual(back.event.cost, 8);
});
test('16 tidyAdds is the same number twice on one board', function () {
  var board = [1, 2, 3, 4, 5, 6];
  assert.strictEqual(L.tidyAdds(board, true, 'pairs', 5), L.tidyAdds(board, true, 'pairs', 5));
});
function brutePairs(cells, diag, rules) {
  var out = [];
  for (var i = 0; i < cells.length; i++) {
    if (cells[i].done) continue;
    for (var j = i + 1; j < cells.length; j++) {
      if (cells[j].done) continue;
      if (L.matches(cells[i].v, cells[j].v, rules) && L.canLink(cells, i, j, diag)) out.push([i, j]);
    }
  }
  return out;
}
function slowAdds(values, diag, rules, cap) {
  var cells = values.map(function (v, i) {
    return { id: i + 1, v: v, done: false };
  });
  var adds = 0, guard = 0;
  while (cells.some(function (c) { return !c.done; }) && guard++ < 400) {
    var pairs = L.allPairs(cells, diag, rules);
    if (!pairs.length) {
      if (adds >= cap) return cap;
      var live = cells.filter(function (c) { return !c.done; });
      cells = L.compact(cells.concat(live.map(function (c) { return { id: 0, v: c.v, done: false }; })));
      adds++;
      continue;
    }
    var best = pairs[0], bestN = -1;
    for (var q = 0; q < pairs.length; q++) {
      var p = pairs[q];
      var after = L.compact(cells.map(function (c, k) {
        return (k === p[0] || k === p[1]) ? { id: c.id, v: c.v, done: true } : c;
      }));
      var n = L.allPairs(after, diag, rules).length;
      if (n > bestN) { bestN = n; best = p; }
    }
    cells = L.compact(cells.map(function (c, k) {
      return (k === best[0] || k === best[1]) ? { id: c.id, v: c.v, done: true } : c;
    }));
  }
  return adds;
}

test('pointer pairs match the reading-order, column, and diagonal rules', function () {
  for (var n = 0; n < 20; n++) {
    var vals = L.makeBoard(1 + (n % 6), L.mulberry32(1000 + n));
    var cells = vals.map(function (tile, i) {
      return { id: i + 1, v: (tile && typeof tile === 'object') ? tile.v : tile, done: (n + i) % 7 === 0 };
    });
    assert.deepStrictEqual(L.allPairs(cells, true, 'pairs'), brutePairs(cells, true, 'pairs'));
    assert.deepStrictEqual(L.allPairs(cells, false, 'pairs'), brutePairs(cells, false, 'pairs'));
  }
});

test('a timed-out par counts a full add of the board for every add allowed', function () {
  var vals = [];
  for (var i = 0; i < 28; i++) vals.push(i % 2 ? 2 : 1);
  var play = L.tidyPlay(vals, true, 'pairs', 5, -1);
  assert.strictEqual(play.timedOut, true);
  assert.strictEqual(play.matches, 448); // 28 tiles doubled five times, then cleared
});

test('the reference player matches a full recount', function () {
  var board = [1, 2, 3, 4, 5, 6];
  assert.strictEqual(L.tidyAdds(board, true, 'pairs', 5, 1000), slowAdds(board, true, 'pairs', 5));
  for (var s = 1; s <= 6; s++) {
    var vals = L.makeBoard(2, L.mulberry32(s)).map(function (tile) {
      return (tile && typeof tile === 'object') ? tile.v : tile;
    });
    assert.strictEqual(L.tidyAdds(vals, true, 'pairs', 5, 1000), slowAdds(vals, true, 'pairs', 5));
  }
});

test('seeded reference plays finish under the time budget', function () {
  var levels = [1, 2, 4, 6];
  var slow = 0, total = 0;
  levels.forEach(function (level) {
    for (var s = 1; s <= 8; s++) {
      var vals = L.makeBoard(level, L.mulberry32(s));
      var cap = L.addsFor('normal', level);
      var t0 = Date.now();
      var adds = L.tidyAdds(vals, true, 'pairs', cap, null, L.colsFor('normal'));
      if (Date.now() - t0 > 50) slow++;
      total++;
      assert.ok(adds >= 0 && adds <= cap);
    }
  });
  assert.ok(slow / total <= 0.01, slow + ' of ' + total + ' boards took longer than 50ms');
});

test('par is stored and shown as a whole number', function () {
  var s = stateWith([1, 9], 'normal', { par: 22.6, cleared: 2, level: 2, score: 360 });
  var p = L.bonusParts(s);
  assert.strictEqual(p.par, 23);
  assert.strictEqual(p.used, 1);
  assert.strictEqual(p.under, 22);
});

test('compact drops cleared tiles, spends one, and undo puts the gaps back', function () {
  var s = stateWith([1, 2, 3, 4, 5], 'normal', { compactsLeft: 1, score: 40 });
  s.cells[1].done = true;
  s.cells[3].done = true;
  var packed = L.packBoard(s);
  assert.deepStrictEqual(packed.state.cells.map(function (c) { return c.v; }), [1, 3, 5]);
  assert.strictEqual(packed.state.compactsLeft, 0);
  assert.strictEqual(L.packBoard(packed.state).event, null);
  var back = L.undo(packed.state);
  assert.strictEqual(back.state.cells.length, 5);
  assert.strictEqual(back.state.cells[1].done, true);
  assert.strictEqual(back.state.compactsLeft, 1);
  assert.ok(back.event.cost > 0);
});

test('buttons follow the level: Pack from 10; Undo 5 / 3 / 1 for Easy / Normal / Hard; Hint and Pack shrink', function () {
  function tools(level) { var s = L.dealPuzzle({ diff: 'easy', level: level, seed: 2 }); return [s.hintsLeft, s.undosLeft, s.compactsLeft]; }
  assert.deepStrictEqual(tools(1), [Infinity, 5, 0]);
  assert.deepStrictEqual(tools(10), [Infinity, 5, Infinity]);
  assert.deepStrictEqual(tools(20), [5, 5, Infinity]);
  assert.deepStrictEqual(tools(30), [3, 5, 3]);
  assert.deepStrictEqual(tools(37), [3, 3, 3]);
  assert.deepStrictEqual(tools(45), [1, 3, 3]);
  assert.deepStrictEqual(tools(53), [1, 1, 3]);
  assert.deepStrictEqual(tools(55), [0, 1, 3]);
  assert.deepStrictEqual(tools(62), [0, 1, 2]);
  assert.strictEqual(L.PACK_FROM, 10);
});

test('FIX1 easy: 3 pairs blocks Add, 2 pairs allows it', function () {
  // three touching pairs: (1,2) (3,4) (5,6)
  var three = stateWith([1, 2, 3, 4, 5, 6], 'easy');
  assert.strictEqual(L.pairsOnBoard(three), 3);
  assert.strictEqual(L.canAdd(three), false);
  var r = L.addNumbers(three);
  assert.strictEqual(r.event.type, 'addBlocked');
  assert.strictEqual(r.event.max, 2);
  assert.strictEqual(r.state.addsLeft, three.addsLeft);   // no add used
  // two touching pairs: (1,2) (3,4), then a lone 5
  var two = stateWith([1, 2, 3, 4, 5], 'easy');
  assert.strictEqual(L.pairsOnBoard(two), 2);
  assert.strictEqual(L.canAdd(two), true);
  assert.notStrictEqual(L.addNumbers(two).event.type, 'addBlocked');
});
test('Add limit: 2 pairs or fewer before level 30, 1 from 30, none from 55', function () {
  assert.strictEqual(L.canAdd(stateWith([1, 2, 3, 4, 5], 'normal', { level: 29 })), true);
  var two = stateWith([1, 2, 3, 4, 5], 'normal', { level: 30 });
  assert.strictEqual(L.canAdd(two), false);
  assert.strictEqual(L.addNumbers(two).event.type, 'addBlocked');
  assert.strictEqual(L.canAdd(stateWith([1, 2, 5], 'normal', { level: 30 })), true);
  assert.strictEqual(L.canAdd(stateWith([1, 2, 5], 'normal', { level: 55 })), false);
  var none = stateWith([1, 5, 9], 'hard', { level: 55 });
  assert.strictEqual(L.pairsOnBoard(none), 0);
  assert.strictEqual(L.canAdd(none), true);
});
test('FIX1 a blocked Add on Easy changes nothing', function () {
  var s = stateWith([1, 2, 3, 4, 5, 6, 7, 8], 'easy', { streak: 3, score: 500 });
  var r = L.addNumbers(s);
  assert.strictEqual(r.event.type, 'addBlocked');
  assert.strictEqual(r.event.penalty, 0);
  assert.strictEqual(r.state, s);                 // same object, nothing changed
  assert.strictEqual(r.state.streak, 3);
  assert.strictEqual(r.state.history.length, s.history.length);
});
test('Add too early from level 30 is a mistake: points lost, streak lost, nothing added', function () {
  var s = stateWith([1, 2, 3, 4, 5], 'normal', { level: 30, streak: 3, score: 500, penalties: 10 });
  var r = L.addNumbers(s);
  assert.strictEqual(r.event.type, 'addBlocked');
  assert.strictEqual(r.event.pairs, 2);
  assert.ok(r.event.penalty > 0, 'costs points');
  assert.strictEqual(r.state.score, 500 - r.event.penalty);
  assert.strictEqual(r.state.penalties, 10 + r.event.penalty);
  assert.strictEqual(r.state.streak, 0);
  assert.strictEqual(r.state.cells.length, s.cells.length);   // no rows added
  assert.strictEqual(r.state.addsLeft, s.addsLeft);           // no add used
  assert.strictEqual(r.state.history.length, s.history.length);
  assert.strictEqual(s.score, 500);                           // the old state is untouched
});
test('an early Add never takes the score below zero', function () {
  var s = stateWith([1, 2, 5], 'hard', { level: 55, streak: 2, score: 3 });
  var r = L.addNumbers(s);
  assert.strictEqual(r.event.type, 'addBlocked');
  assert.ok(r.event.penalty <= 3);
  assert.strictEqual(r.state.score, 3 - r.event.penalty);
  assert.ok(r.state.score >= 0);
  assert.strictEqual(r.state.streak, 0);
  var zero = L.addNumbers(stateWith([1, 2, 5], 'hard', { level: 55, score: 0 }));
  assert.strictEqual(zero.event.penalty, 0);
  assert.strictEqual(zero.state.score, 0);
});
test('FIX1 undo after an allowed add still refunds the add', function () {
  var s = stateWith([1, 5, 9], 'hard');
  var added = L.addNumbers(s).state;
  assert.strictEqual(added.addsLeft, s.addsLeft - 1);
  assert.strictEqual(L.undo(added).state.addsLeft, s.addsLeft);
});

/* ---------------- walls ---------------- */
var WL = L.WALL;
test('walls: a wall never matches, not even another wall', function () {
  assert.strictEqual(L.matches(WL, WL), false);
  assert.strictEqual(L.matches(WL, 1), false);
  assert.strictEqual(L.matches(1, 2), true);
});
test('walls: a wall cannot be selected', function () {
  var s = stateWith([1, WL, 2], 'normal');
  var r = L.select(s, 2);
  assert.strictEqual(r.event, null);
  assert.strictEqual(r.state, s);
});
test('walls: a wall blocks the path between two tiles', function () {
  var s = stateWith([1, WL, 2], 'normal');
  var r = L.select(L.select(s, 1).state, 3);
  assert.strictEqual(r.event.type, 'bad');
  assert.strictEqual(r.event.reason, 'path');
  assert.deepStrictEqual(L.allPairs(s.cells, true, 'pairs', 8), []);
});
test('walls: clearing the rest of its row removes the wall and pays a wall bonus', function () {
  // 8 columns. Row 0: 1 1 W 3 3 5 5 7   Row 1: 9 11 13 15 9 11 13 7
  var vals = [1, 1, WL, 3, 3, 5, 5, 7, 9, 11, 13, 15, 9, 11, 13, 7];
  var s = stateWith(vals, 'normal', { total: 15 });
  [[1, 2], [4, 5], [6, 7]].forEach(function (p) { s = L.select(L.select(s, p[0]).state, p[1]).state; });
  var r = L.select(L.select(s, 8).state, 16);          // the last tile of row 0, paired straight down
  assert.strictEqual(r.event.type, 'match');
  assert.deepStrictEqual(r.event.rowsCleared, [0]);
  assert.strictEqual(r.event.wallsGone, 1);
  assert.strictEqual(r.event.wallBonus, Math.round(50 * L.pointMult('easy', 6)));
  var packed = L.compactBoard(r.state);
  assert.ok(packed.cells.every(function (c) { return !L.isWall(c); }), 'the wall left with its row');
});
test('walls: Add never copies a wall', function () {
  var s = stateWith([1, WL, 3, 5, 7, 9, 11, 13, 15], 'hard', { total: 8 });
  var r = L.addNumbers(s);
  assert.strictEqual(r.event.type, 'add');
  assert.strictEqual(r.event.count, 8);
  assert.strictEqual(r.state.cells.filter(L.isWall).length, 1);
});
test('walls: the board is clear when every tile is gone, even with a wall left', function () {
  var s = stateWith([1, 2, 3, 4, 5, 6, 7, 8, WL, 9, 10], 'normal', { total: 10 });
  [[1, 2], [3, 4], [5, 6], [7, 8], [10, 11]].forEach(function (p) { s = L.select(L.select(s, p[0]).state, p[1]).state; if (s.status === 'playing') s = L.compactBoard(s); });
  assert.strictEqual(s.status, 'clear');
});
test('walls: 1 from level 40, 2 from 46, back to 1 at 53, 2 from 65, 3 from 76', function () {
  assert.deepStrictEqual([1, 39, 40, 46, 53, 65, 76, 100].map(function (l) { return L.wallCount('easy', l); }), [0, 0, 1, 2, 1, 2, 3, 3]);
});
test('walls: dealt boards get their walls and the blank centre where the square is full', function () {
  [1, 13, 37, 40, 46, 53, 76].forEach(function (level) {
    var s = L.dealPuzzle({ diff: 'easy', level: level, seed: 100 + level });
    var walls = s.cells.filter(L.isWall).length, blanks = s.cells.filter(L.isBlank).length;
    assert.strictEqual(walls, L.wallCount('easy', level), 'level ' + level);
    assert.strictEqual(s.total, s.cells.length - walls - blanks);
    assert.strictEqual(s.addsLeft, L.addsFor('easy', level), 'level ' + level + ' adds');
    var w = s.cols, full = s.cells.length === w * w && w % 2 === 1;
    assert.strictEqual(blanks, full ? 1 : 0, 'level ' + level + ' blank');
    if (blanks) assert.ok(L.isBlank(s.cells[(w * w - 1) / 2]), 'blank in the centre');
    assert.strictEqual(L.isBeatable(s), true);
  });
});

/* ---------------- clean sweep ---------------- */
test('clean sweep: every tile with its twin straight below clears the board at once, with a bonus', function () {
  // 8 columns: row 0 = 1 3 5 7 9 11 13 15, row 1 the same
  var row = [1, 3, 5, 7, 9, 11, 13, 15];
  var s = stateWith(row.concat(row), 'normal', { score: 100 });
  assert.ok(L.sweepPairs(s));
  var r = L.cleanSweep(s);
  assert.strictEqual(r.event.type, 'sweep');
  assert.strictEqual(r.event.pairs.length, 8);
  assert.strictEqual(r.event.matches.length, 8);
  assert.strictEqual(r.event.bonus, Math.round(25 * 8 * L.pointMult('easy', 6)));
  assert.strictEqual(r.state.status, 'clear');
  assert.strictEqual(r.state.cleared, 16);
  assert.ok(r.state.score > 100 + r.event.bonus);
});
test('clean sweep: nothing happens when a tile has no partner, or the pairing cannot cover the board', function () {
  assert.strictEqual(L.cleanSweep(stateWith([1, 1, 3], 'normal')).event, null);
  assert.strictEqual(L.cleanSweep(stateWith([1, 1, 3, 5], 'normal')).event, null);
  // 1 2 1 2 in a row: (1,2) and (1,2) pair off; a sweep exists
  assert.ok(L.sweepPairs(stateWith([1, 2, 1, 2], 'normal')));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
