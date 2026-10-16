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
  return values.map(function (v, i) { return { id: i + 1, v: v, done: doneIdx.indexOf(i) >= 0 }; });
}
// A state with a custom board (level 1, given difficulty).
function stateWith(values, diff, extra) {
  var s = L.newGame(diff || 'normal');
  s.cells = board(values);
  s.nextId = values.length + 1;
  s.total = values.length;
  for (var k in (extra || {})) s[k] = extra[k];
  return s;
}
var X = 0; // filler value used in canLink tests (value doesn't matter there)

/* ---------------- boards ---------------- */
test('classic board is the 27 digits of 1..19 without 10', function () {
  assert.deepStrictEqual(L.classicBoard(), [1,2,3,4,5,6,7,8,9, 1,1,1,2,1,3,1,4,1, 5,1,6,1,7,1,8,1,9]);
});
test('board sizes per level', function () {
  assert.deepStrictEqual([1,2,3,4,9].map(L.boardSize), [27,36,44,54,54]);
});
test('random board has right size and every value 1..9', function () {
  var b = L.randomBoard(3, Math.random);
  assert.strictEqual(b.length, 44);
  b.forEach(function (v) { assert.ok(v >= 1 && v <= 9); });
});

/* ---------------- matching ---------------- */
test('matches: equal or sum to 10', function () {
  assert.ok(L.matches(4, 4)); assert.ok(L.matches(3, 7)); assert.ok(L.matches(5, 5)); assert.ok(L.matches(1, 9));
  assert.ok(!L.matches(2, 3)); assert.ok(!L.matches(4, 5)); assert.ok(!L.matches(9, 2));
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
test('adds per level drop by one every two levels to a minimum', function () {
  assert.deepStrictEqual([1,2,3,4,5,6,7,8,9,10].map(function (l) { return L.addsFor('normal', l); }), [5,5,4,4,3,3,2,2,2,2]);
  assert.deepStrictEqual([1,3,5,7,9,11].map(function (l) { return L.addsFor('easy', l); }), [8,7,6,5,4,4]);
  assert.deepStrictEqual([1,2,3,4].map(function (l) { return L.addsFor('hard', l); }), [3,3,2,2]);
  assert.strictEqual(L.addsFor('hard', 99), 1);
});
test('point multiplier', function () {
  assert.strictEqual(L.pointMult('normal', 1), 1.5);
  assert.ok(Math.abs(L.pointMult('hard', 3) - 3.5) < 1e-9);
});

/* ---------------- actions ---------------- */
test('first match on classic board (1 over 1) scores 30 on Normal (15 + style bonus 15)', function () {
  var s = L.newGame('normal');
  s = L.select(s, 1).state;               // id 1 = top-left "1"
  var r = L.select(s, 10);                // id 10 = first cell of row 2, also "1"
  assert.strictEqual(r.event.type, 'match');
  assert.strictEqual(r.event.gain, 30);        // (10 + 10 style bonus) x 1.5
  assert.strictEqual(r.event.styleBonus, 15);
  assert.strictEqual(r.event.shade, 'outline');
  assert.strictEqual(r.state.score, 30);
  assert.strictEqual(r.state.cleared, 2);
  assert.strictEqual(r.state.moves, 1);
});
test('combo adds +2 per pair, resets on a miss', function () {
  var s = stateWith([1,1,2,2,3,3,4,6,4,4], 'easy');
  s = L.select(L.select(s, 1).state, 2).state; assert.strictEqual(s.score, 20);   // 10 + style 10
  s = L.select(L.select(s, 3).state, 4).state; assert.strictEqual(s.score, 42);   // + 10 + 2 combo + 10 style
  var r = L.select(L.select(s, 5).state, 8);   // 3 and 4: not a match
  assert.strictEqual(r.event.type, 'bad'); assert.strictEqual(r.event.reason, 'value');
  assert.strictEqual(r.state.combo, 0);
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
test('clearing a full row awards +50 x mult and reports the row', function () {
  var s = stateWith([1,9,2,8,3,7,4,6,5, 5,1,2], 'easy');
  // clear pairs left to right; the last pair (4,6 at idx 6,7) leaves only idx 8 (5).
  [[1,2],[3,4],[5,6],[7,8]].forEach(function (p) { s = L.select(L.select(s, p[0]).state, p[1]).state; });
  var r = L.select(L.select(s, 9).state, 10); // 5 and 5 (idx 8 and 9: wrap)
  assert.deepStrictEqual(r.event.rowsCleared, [0]);
  assert.strictEqual(r.event.gain, Math.round((10 + 8 + 10 + 50) * 1)); // combo 5 => +8, 5+5 both outline => +10
});
test('add numbers appends copies of active values and spends an add', function () {
  var s = stateWith([1,2,3], 'normal');
  var r = L.addNumbers(s);
  assert.deepStrictEqual(r.state.cells.map(function (c) { return c.v; }), [1,2,3,1,2,3]);
  assert.strictEqual(r.state.addsLeft, 4);
  assert.strictEqual(r.state.total, 6);
  assert.deepStrictEqual(r.event.ids, [4,5,6]);
});
test('undo restores the board, costs an undo, refunds an add', function () {
  var s = stateWith([1,2,3], 'normal');
  s = L.addNumbers(s).state;
  var r = L.undo(s);
  assert.strictEqual(r.state.cells.length, 3);
  assert.strictEqual(r.state.addsLeft, 5);
  assert.strictEqual(r.state.undosLeft, 4);
});
test('unlimited undo stays unlimited', function () {
  var s = L.addNumbers(stateWith([1,2,3], 'easy')).state;
  assert.strictEqual(L.undo(s).state.undosLeft, Infinity);
});
test('hint returns a legal pair and costs a hint', function () {
  var r = L.hint(L.newGame('normal'));
  assert.strictEqual(r.event.type, 'hint');
  assert.strictEqual(r.state.hintsLeft, 2);
  assert.deepStrictEqual(r.event.ids, [1, 10]); // the "1" top-left and the "1" directly below it
});
test('hard mode has no hints', function () {
  assert.strictEqual(L.hint(L.newGame('hard')).event, null);
});
test('clearing the last pair clears the level with a bonus', function () {
  var s = stateWith([3,7], 'normal');
  var r = L.select(L.select(s, 1).state, 2);
  assert.strictEqual(r.state.status, 'clear');
  // bonus = round(1.5 * (100*5 adds + 25*3 hints + 200*level 1)) = round(1162.5) = 1163
  assert.strictEqual(r.state.bonus, 1163);
  // 3 + 7 is a MIXED pair (outline + solid) that also empties row 0:
  // row bonus 50 * 1.5 = 75, minus half of the pair's worth round(15 / 2) = 8  ->  67
  assert.strictEqual(r.event.mixed, true);
  assert.strictEqual(r.event.gain, 67);
  assert.strictEqual(r.state.score, 67 + 1163);
  assert.ok(r.state.newBest);
  assert.strictEqual(r.state.best.normal, 1230);
});
test('no adds and no pairs left = game over', function () {
  var s = stateWith([1,1,2,3], 'normal', { addsLeft: 0 });
  var r = L.select(L.select(s, 1).state, 2);
  assert.strictEqual(r.state.status, 'lose');
  assert.strictEqual(r.state.final, 30);
});
test('next level deals a bigger board, keeps score, resets adds', function () {
  var s = L.select(L.select(stateWith([3,7], 'normal'), 1).state, 2).state;
  var n = L.nextLevel(s, Math.random).state;
  assert.strictEqual(n.level, 2);
  assert.strictEqual(n.cells.length, 36);
  assert.strictEqual(n.score, s.score);
  assert.strictEqual(n.addsLeft, 5);
  assert.strictEqual(n.status, 'playing');
  var n3 = L.nextLevel(Object.assign({}, n, { status: 'clear' }), Math.random).state;
  assert.strictEqual(n3.addsLeft, 4);
});
test('actions never mutate the state they were given', function () {
  var s = L.newGame('normal');
  var frozen = JSON.stringify(s);
  L.select(L.select(s, 1).state, 10); L.addNumbers(s); L.hint(s);
  assert.strictEqual(JSON.stringify(s), frozen);
});

/* ---------------- Hard mode ---------------- */
test('Hard allows diagonal pairs (top-left 1 with the diagonal 1)', function () {
  var s = L.newGame('hard');
  var r = L.select(L.select(s, 1).state, 11);  // idx 0 and idx 10
  assert.strictEqual(r.event.type, 'match');
  assert.strictEqual(r.event.gain, 50);        // (10 + 10 style) x 2.5
});

/* ---------------- Gridiron ('pairs' rules) ---------------- */
test('pairs: same mascot matches (outline+solid or identical), different mascot does not', function () {
  assert.ok(L.matches(1, 2, 'pairs'));   // mascot 1 outline + solid
  assert.ok(L.matches(3, 3, 'pairs'));   // two identical
  assert.ok(L.matches(16, 15, 'pairs')); // mascot 8
  assert.ok(!L.matches(2, 3, 'pairs'));  // mascot 1 vs mascot 2
  assert.ok(!L.matches(1, 9, 'pairs'));  // sums to 10 but different mascots
});
test('pairs: mascots per level are 5, 6, 7, then 8 forever', function () {
  assert.deepStrictEqual([1,2,3,4,5,12].map(L.mascots), [5,6,7,8,8,8]);
});
test('pairs: board sizes are 28, 36, 44, 54 and use only the allowed mascots', function () {
  [[1,28,5],[2,36,6],[3,44,7],[4,54,8]].forEach(function (t) {
    var b = L.pairsBoard(t[0], Math.random);
    assert.strictEqual(b.length, t[1]);
    b.forEach(function (v) { assert.ok(v >= 1 && v <= 2 * t[2], 'value ' + v + ' on level ' + t[0]); });
  });
});
test('pairs: every mascot appears an even number of times', function () {
  var b = L.pairsBoard(4, Math.random), count = {};
  b.forEach(function (v) { var m = L.mascotOf(v); count[m] = (count[m] || 0) + 1; });
  Object.keys(count).forEach(function (m) { assert.strictEqual(count[m] % 2, 0); });
});
test('pairs: new game, select, hint and next level keep the Gridiron rules', function () {
  var s = L.newGame('normal', null, Math.random, 'pairs');
  assert.strictEqual(s.rules, 'pairs');
  assert.strictEqual(s.cells.length, 28);
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
  assert.strictEqual(next.cells.length, 36);
});
/* ---------------- Mahjong ('mahjong' rules) ---------------- */
test('mahjong: circle tiles match like classic, honours only identical', function () {
  assert.ok(L.matches(3, 7, 'mahjong'));
  assert.ok(L.matches(4, 4, 'mahjong'));
  assert.ok(L.matches(11, 11, 'mahjong'));   // East + East
  assert.ok(!L.matches(11, 12, 'mahjong'));  // East + South
  assert.ok(!L.matches(1, 11, 'mahjong'));   // circle + honour
  assert.ok(!L.matches(15, 15 - 5, 'mahjong'));
});
test('mahjong: honour kinds per level are 2, 3, 4 ... up to 7', function () {
  assert.deepStrictEqual([1,2,3,4,5,6,7,9].map(L.honoursInPlay), [2,3,4,5,6,7,7,7]);
});
test('mahjong: board sizes 28, 36, 44, 54, honours limited to those in play, dealt in pairs', function () {
  [[1,28,2],[2,36,3],[3,44,4],[4,54,5]].forEach(function (t) {
    var b = L.mahjongBoard(t[0], Math.random), count = {};
    assert.strictEqual(b.length, t[1]);
    b.forEach(function (v) {
      assert.ok((v >= 1 && v <= 9) || (v >= 11 && v < 11 + t[2]), 'value ' + v + ' on level ' + t[0]);
      if (v >= 11) count[v] = (count[v] || 0) + 1;
    });
    Object.keys(count).forEach(function (h) { assert.strictEqual(count[h] % 2, 0); });
  });
});
test('mahjong: game keeps its rules through select and next level', function () {
  var s = L.newGame('normal', null, Math.random, 'mahjong');
  assert.strictEqual(s.rules, 'mahjong');
  assert.strictEqual(s.cells.length, 28);
  var bad = L.select(L.select(stateWith([11, 12], 'normal', { rules: 'mahjong' }), 1).state, 2);
  assert.strictEqual(bad.event.reason, 'value');
  var ok = L.select(L.select(stateWith([16, 16], 'normal', { rules: 'mahjong' }), 1).state, 2).state;
  assert.strictEqual(ok.status, 'clear');
  assert.strictEqual(L.nextLevel(ok, Math.random).state.rules, 'mahjong');
});

test('classic is still the default', function () {
  assert.strictEqual(L.newGame('normal').rules, 'classic');
});

/* ---------------- style bonus and mismatch penalty ---------------- */
test('shadeOf: classic 1-5 outline, 6-9 solid; Gridiron odd/even; mahjong honours none', function () {
  assert.deepStrictEqual([1,4,5,6,9].map(function (v) { return L.shadeOf(v, 'classic'); }), ['outline','outline','outline','solid','solid']);
  assert.strictEqual(L.shadeOf(3, 'pairs'), 'outline'); assert.strictEqual(L.shadeOf(4, 'pairs'), 'solid');
  assert.strictEqual(L.shadeOf(7, 'mahjong'), 'solid'); assert.strictEqual(L.shadeOf(12, 'mahjong'), null);
  assert.ok(L.sameShade(2, 3, 'classic')); assert.ok(!L.sameShade(1, 9, 'classic'));
  assert.ok(!L.sameShade(15, 15, 'mahjong'));
});
test('outline + solid pair still clears but costs half its worth', function () {
  var r = L.select(L.select(stateWith([3,7,1], 'easy', { score: 100 }), 1).state, 2);
  assert.strictEqual(r.event.type, 'match'); assert.strictEqual(r.state.cleared, 2);
  assert.strictEqual(r.event.mixed, true); assert.strictEqual(r.event.styleBonus, 0);
  assert.strictEqual(r.event.gain, -5); assert.strictEqual(r.event.penalty, 5);   // round(10 / 2)
  assert.strictEqual(r.state.score, 95);
  assert.strictEqual(r.state.combo, 1);                     // it still counts toward the combo
});
test('mixed pair at score 0 costs nothing (never below 0); undo refunds a mixed clear', function () {
  var r = L.select(L.select(stateWith([3,7,1], 'easy'), 1).state, 2);
  assert.strictEqual(r.state.score, 0); assert.strictEqual(r.event.gain, 0); assert.strictEqual(r.event.penalty, 0);
  var s = L.select(L.select(stateWith([3,7,1], 'easy', { score: 100 }), 1).state, 2).state;
  assert.strictEqual(L.undo(s).state.score, 100);
});
test('hint prefers a pair with no mixed penalty', function () {
  var s = stateWith([1,9,2,2], 'normal');     // 1+9 is legal but mixed; 2+2 is same-shade
  var h = L.hint(s);
  assert.deepStrictEqual(h.event.ids, [3, 4]);
  var only = L.hint(stateWith([1,9,2,3], 'normal'));   // only a mixed pair exists: hint shows it
  assert.deepStrictEqual(only.event.ids, [1, 2]);
});
test('mahjong winds and dragons are never mixed', function () {
  assert.ok(!L.mixedShade(15, 15, 'mahjong')); assert.ok(L.mixedShade(1, 9, 'mahjong'));
});
test('Gridiron: two solids earn the style bonus, outline + solid is a mixed pair', function () {
  var two = L.select(L.select(stateWith([2,2,5], 'easy', { rules: 'pairs' }), 1).state, 2);
  assert.strictEqual(two.event.gain, 20); assert.strictEqual(two.event.shade, 'solid');
  var mix = L.select(L.select(stateWith([1,2,5], 'easy', { rules: 'pairs', score: 100 }), 1).state, 2);
  assert.strictEqual(mix.event.gain, -5); assert.strictEqual(mix.event.mixed, true);
});
test('mismatch subtracts half of what the pair would have scored', function () {
  // 2 and 3: both outlines, combo would be 1 -> (10 + 10) x 1.5 = 30 -> penalty 15
  var r = L.select(L.select(stateWith([2,3], 'normal', { score: 100 }), 1).state, 2);
  assert.strictEqual(r.event.penalty, 15); assert.strictEqual(r.state.score, 85);
  // 2 and 8 would match; 2 and 9 (outline + solid) -> 10 x 1.5 = 15 -> penalty 8
  var r2 = L.select(L.select(stateWith([2,9], 'normal', { score: 100 }), 1).state, 2);
  assert.strictEqual(r2.event.penalty, 8);
});
test('mismatch penalty never takes the score below 0; unreachable pairs cost nothing', function () {
  var r = L.select(L.select(stateWith([2,3], 'normal', { score: 4 }), 1).state, 2);
  assert.strictEqual(r.state.score, 0); assert.strictEqual(r.event.penalty, 4);
  var p = L.select(L.select(stateWith([1,2,1], 'normal', { score: 50 }), 1).state, 3);
  assert.strictEqual(p.event.reason, 'path'); assert.strictEqual(p.event.penalty, 0); assert.strictEqual(p.state.score, 50);
});
test('undo does not give back mismatch penalties', function () {
  var s = stateWith([1,1,2,3,5,5], 'easy');
  s = L.select(L.select(s, 1).state, 2).state;            // +20
  s = L.select(L.select(s, 3).state, 4).state;            // 2 vs 3 mismatch: -10 (combo would be 2: (10+2+10)/2 = 11)
  assert.strictEqual(s.score, 9);
  s = L.undo(s).state;                                    // back to before the 1+1 match
  assert.strictEqual(s.score, 0);                         // 0 - 11, floored at 0
});

/* ---------------- beatability ---------------- */
test('isBeatable: tiny clearable board', function () {
  assert.strictEqual(L.isBeatable(stateWith([3, 7])), true);
});
test('isBeatable: values never match and no adds', function () {
  assert.strictEqual(L.isBeatable(stateWith([2, 3], 'normal', { addsLeft: 0 })), false);
});
test('isBeatable: lone tile needs Add to become a pair', function () {
  assert.strictEqual(L.isBeatable(stateWith([5], 'normal', { addsLeft: 1 })), true);
  assert.strictEqual(L.isBeatable(stateWith([5], 'normal', { addsLeft: 0 })), false);
});
test('isBeatable: classic level-1 Normal board', function () {
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
  var pairs = L.allPairs(cells, true, 'classic');
  assert.deepStrictEqual(pairs, [[0, 1], [1, 2]]); // 0-2 blocked by active cell between
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
