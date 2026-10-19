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
function tileV(t) { return (t && typeof t === 'object') ? t.v : t; }
test('random board has right size and every value 1..9', function () {
  var b = L.randomBoard(3, Math.random);
  assert.strictEqual(b.length, 44);
  b.forEach(function (t) { var v = tileV(t); assert.ok(v >= 1 && v <= 9); });
});
test('dealt number pairs are complements that share one shade', function () {
  var outline = [], shaded = [];
  [0.01, 0.21, 0.41, 0.61, 0.81].forEach(function (low) {
    outline.push(low, 0);
    shaded.push(low, 0.5);
  });
  var light = L.randomBoard(2, scripted(outline));
  [1, 9, 2, 8, 3, 7, 4, 6, 5, 5].forEach(function (v, i) {
    assert.strictEqual(light[i].v, v);
    assert.strictEqual(light[i].solid, false);
  });
  var dark = L.randomBoard(2, scripted(shaded));
  assert.strictEqual(dark[0].v, 1);
  assert.strictEqual(dark[1].v, 9);
  assert.strictEqual(dark[0].solid, true);
  assert.strictEqual(dark[1].solid, true);
  assert.ok(light.every(function (t, i) { return i % 2 === 1 || t.v === 5 || t.v !== light[i + 1].v; }));
  assert.ok(!L.sameShade(1, 9, 'classic'));
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
test('first match on classic board (1 over 1) scores 30 on Normal', function () {
  var s = L.newGame('normal');
  s = L.select(s, 1).state;               // id 1 = top-left "1"
  var r = L.select(s, 10);                // id 10 = the "1" directly below it (column)
  assert.strictEqual(r.event.type, 'match');
  assert.strictEqual(r.event.kind, 'col');
  assert.strictEqual(r.event.gain, 30);        // 10 x 2 same shade x 1.5
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
test('clearing a full row awards +50 x mult and reports the row', function () {
  var s = stateWith([1,9,2,8,3,7,4,6,5, 5,1,2], 'easy');
  // clear pairs left to right; the last pair (4,6 at idx 6,7) leaves only idx 8 (5).
  [[1,2],[3,4],[5,6],[7,8]].forEach(function (p) { s = L.select(L.select(s, p[0]).state, p[1]).state; });
  var r = L.select(L.select(s, 9).state, 10); // 5 and 5 (idx 8 and 9: wrap)
  assert.deepStrictEqual(r.event.rowsCleared, [0]);
  assert.strictEqual(r.event.rowBonus, 30);
  assert.strictEqual(r.event.gain, 72); // wrap same-shade x1.4, plus the row
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
  var s = stateWith([3,7], 'normal', { par: 2 });
  var r = L.select(L.select(s, 1).state, 2);
  assert.strictEqual(r.state.status, 'clear');
  // 0 adds used, 2 under par: 1.5 * (100 + 400) = 750. Pair is mixed, plus one row.
  assert.strictEqual(r.state.bonus, 750);
  assert.strictEqual(r.event.gain, 60);
  assert.strictEqual(r.state.score, 810);
  assert.ok(r.state.newBest);
  assert.strictEqual(r.state.best.normal, 810);
});
test('no adds and no pairs left = game over', function () {
  var s = stateWith([1,1,2,3], 'normal', { addsLeft: 0 });
  var r = L.select(L.select(s, 1).state, 2);
  assert.strictEqual(r.state.status, 'lose');
  assert.strictEqual(r.state.reason, 'nopairs');
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
test('pairs: prefer both outline or both solid', function () {
  assert.deepStrictEqual(L.pairsBoard(1, scripted([0, 0])).slice(0, 2), [1, 1]);
  assert.deepStrictEqual(L.pairsBoard(1, scripted([0, 0.375])).slice(0, 2), [2, 2]);
  assert.deepStrictEqual(L.pairsBoard(1, scripted([0, 0.75])).slice(0, 2), [1, 2]);
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
    b.forEach(function (tile) {
      var v = tileV(tile);
      assert.ok((v >= 1 && v <= 9) || (v >= 11 && v < 11 + t[2]), 'value ' + v + ' on level ' + t[0]);
      if (v >= 11) count[v] = (count[v] || 0) + 1;
    });
    Object.keys(count).forEach(function (h) { assert.strictEqual(count[h] % 2, 0); });
  });
});
test('mahjong circles are complements that share one shade; honours stay identical', function () {
  var circles = L.mahjongBoard(1, scripted([0.5, 0.01, 0]));
  assert.strictEqual(circles[0].v, 1);
  assert.strictEqual(circles[1].v, 9);
  assert.strictEqual(circles[0].solid, false);
  assert.strictEqual(circles[1].solid, false);
  var honours = L.mahjongBoard(1, scripted([0, 0]));
  assert.deepStrictEqual(honours.slice(0, 2), [11, 11]);
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
test('a complement with a shared shade earns the style bonus and keeps that shade', function () {
  var light = L.select(L.select(stateWith([{ v: 1, solid: false }, { v: 9, solid: false }, 2], 'easy'), 1).state, 2);
  assert.strictEqual(light.event.same, true);
  assert.strictEqual(light.event.gain, 20);
  assert.strictEqual(light.event.shade, 'outline');
  assert.strictEqual(light.state.cells[0].solid, false);
  var shaded = L.select(L.select(stateWith([{ v: 1, solid: true }, { v: 9, solid: true }, 2], 'easy'), 1).state, 2);
  assert.strictEqual(shaded.event.shade, 'solid');
  assert.strictEqual(shaded.event.gain, 20);
  var hinted = L.hint(stateWith([{ v: 1, solid: false }, { v: 9, solid: false }, 2, 2], 'normal'));
  assert.deepStrictEqual(hinted.event.ids, [1, 2]);
});
test('add copies the shade of leftover tiles', function () {
  var n = L.addNumbers(stateWith([{ v: 1, solid: true }, { v: 9, solid: false }], 'easy')).state;
  var added = n.cells.filter(function (c) { return c.id > 2; });
  assert.strictEqual(added[0].v, 1);
  assert.strictEqual(added[0].solid, true);
  assert.strictEqual(added[1].v, 9);
  assert.strictEqual(added[1].solid, false);
});
test('a generated level stores the shared shade on each cell', function () {
  var dealt = L.nextLevel(stateWith([1, 1], 'easy', { status: 'clear', level: 1 }), scripted([0.01, 0])).state;
  assert.strictEqual(dealt.cells[0].v, 1);
  assert.strictEqual(dealt.cells[1].v, 9);
  assert.strictEqual(dealt.cells[0].solid, false);
  assert.strictEqual(dealt.cells[1].solid, false);
  assert.ok(dealt.cells.every(function (c) { return typeof c.solid === 'boolean' && c.v >= 1 && c.v <= 9; }));
});
test('an outline and a shaded tile score normal points', function () {
  var r = L.select(L.select(stateWith([3,7,1], 'easy', { score: 100 }), 1).state, 2);
  assert.strictEqual(r.event.type, 'match'); assert.strictEqual(r.state.cleared, 2);
  assert.strictEqual(r.event.same, false);
  assert.strictEqual(r.event.gain, 10);
  assert.strictEqual(r.state.score, 110);
  assert.strictEqual(r.state.streak, 1);
});
test('undo charges its cost and never goes below 0', function () {
  var s = L.select(L.select(stateWith([3,7,1], 'easy', { score: 100 }), 1).state, 2).state;
  assert.strictEqual(L.undo(s).state.score, 95);   // back to 100, then undo costs 5
  var broke = L.select(L.select(stateWith([3,7,1], 'easy'), 1).state, 2).state;
  assert.strictEqual(L.undo(broke).state.score, 0);
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
  assert.strictEqual(mix.event.gain, 10); assert.strictEqual(mix.event.same, false);
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

test('seekSeed skips a rejected seed', function () {
  var seen = [];
  var board = L.seekSeed(1, function (seed) { seen.push(seed); return { seed: seed }; }, function (b) { return b.seed !== 1; });
  assert.deepStrictEqual(seen, [1, L.nextSeed(1)]);
  assert.strictEqual(board.seed, L.nextSeed(1));
});

test('parsePuzzle accepts only a full puzzle code', function () {
  assert.strictEqual(L.parsePuzzle('nope'), null);
  assert.strictEqual(L.parsePuzzle('normal-0-icons-00a1b2c3'), null);
  assert.strictEqual(L.parsePuzzle('normal-1-icons-00a1b2c'), null);
  assert.deepStrictEqual(L.parsePuzzle(' NORMAL-1-ICONS-00A1B2C3 '), {
    diff: 'normal', level: 1, mode: 'icons', seed: 0x00a1b2c3
  });
  assert.strictEqual(L.formatPuzzle({ diff: 'normal', level: 1, mode: 'icons', seed: 0x00a1b2c3 }), 'normal-1-icons-00a1b2c3');
});

test('classic level 1 is the fixed board on every difficulty', function () {
  ['easy', 'normal', 'hard'].forEach(function (diff) {
    var s = L.dealPuzzle({ diff: diff, level: 1, rules: 'classic', seed: 5 });
    assert.deepStrictEqual(s.cells.map(function (c) { return c.v; }), L.classicBoard());
    assert.strictEqual(L.isBeatable(s), true);
    assert.strictEqual(s.seed, 5);
    assert.strictEqual(s.par, 3);
  });
});

test('the same puzzle code deals the same cells', function () {
  var first = L.dealPuzzle({ diff: 'normal', level: 2, rules: 'classic', seed: 1, score: 40, moves: 3, penalties: 2, best: { easy: 0, normal: 9, hard: 0 } });
  assert.strictEqual(L.isBeatable(first), true);
  assert.strictEqual(first.score, 40);
  assert.strictEqual(first.best.normal, 9);
  var again = L.dealPuzzle({ diff: 'normal', level: 2, rules: 'classic', seed: first.seed });
  assert.deepStrictEqual(again.cells.map(function (c) { return c.v; }), first.cells.map(function (c) { return c.v; }));
  assert.strictEqual(again.seed, first.seed);
  var pairs = L.dealPuzzle({ diff: 'hard', level: 1, rules: 'pairs', seed: 9 });
  var tiles = L.dealPuzzle({ diff: 'easy', level: 1, rules: 'mahjong', seed: 9 });
  assert.strictEqual(L.isBeatable(pairs), true);
  assert.strictEqual(L.isBeatable(tiles), true);
});

/* ---------------- dead boards (pairs) ---------------- */
test('pairs: one legal pair can still be a dead board', function () {
  var stuck = board([1, 7, 3, 4, 1, 8, 1, 8, 1], [1, 2, 3]);
  assert.deepStrictEqual(L.findPair(stuck, true, 'pairs'), [0, 4]);
  assert.strictEqual(L.canClear(stuck, true, 'pairs'), false);

  var pre = stateWith([1, 7, 3, 4, 1, 8, 1, 8, 1], 'normal', { rules: 'pairs', addsLeft: 0 });
  pre.cells[1].done = true;
  var r = L.select(L.select(pre, 3).state, 4);
  assert.strictEqual(r.event.type, 'match');
  assert.strictEqual(r.state.status, 'playing');
  assert.ok(L.findPair(r.state.cells, true, 'pairs'));
  assert.strictEqual(L.isBeatable(r.state), false);

  var open = stateWith([1, 7, 3, 4, 1, 8, 1, 8, 1], 'normal', { rules: 'pairs', addsLeft: 1 });
  open.cells[1].done = true;
  assert.strictEqual(L.select(L.select(open, 3).state, 4).state.status, 'playing');
});

test('pairs: hint shows a pair that keeps the board clearable', function () {
  var trap = board([1, 3, 1, 1, 1, 1, 3, 1, 3, 3]);
  assert.strictEqual(L.canClear(trap, true, 'pairs'), true);
  assert.deepStrictEqual(L.findPair(trap, true, 'pairs'), [1, 9]);
  var s = stateWith([1, 3, 1, 1, 1, 1, 3, 1, 3, 3], 'normal', { rules: 'pairs', addsLeft: 0 });
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

  var s = stateWith(vals, 'normal', { rules: 'pairs', addsLeft: 0, cleared: doneIdx.length });
  doneIdx.forEach(function (i) { s.cells[i].done = true; });
  function match(state, a, b) { return L.select(L.select(state, a).state, b).state; }
  s = L.compactBoard(match(s, 10, 11));
  s = L.compactBoard(match(s, 12, 13));
  s = L.compactBoard(match(s, 14, 15));
  s = match(s, 16, 17);
  assert.strictEqual(s.status, 'playing');
  var i1 = L.indexOfId(s.cells, 1), i2 = L.indexOfId(s.cells, 20);
  assert.strictEqual(L.canLink(s.cells, i1, i2, true), false);
  s = L.compactBoard(s);
  i1 = L.indexOfId(s.cells, 1); i2 = L.indexOfId(s.cells, 20);
  assert.strictEqual(L.canLink(s.cells, i1, i2, true), true);
  s = L.compactBoard(match(s, 1, 20));
  s = match(s, 2, 21);
  assert.strictEqual(s.status, 'clear');
});

test('pairs: a large board past the budget stays in play', function () {
  var vals = [];
  for (var i = 0; i < 54; i++) vals.push(i % 2 ? 3 : 1);
  assert.strictEqual(L.canClear(board(vals), true, 'pairs', 50), null);
  var s = stateWith(vals, 'normal', { rules: 'pairs', addsLeft: 0 });
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
  var r = L.select(L.select(stateWith([1, 9, 2], 'normal', { score: 10 }), 1).state, 2);
  assert.strictEqual(r.event.gain, 15);
  assert.strictEqual(r.event.same, false);
  assert.strictEqual(r.state.score, 25);
});
test('3 two crossed-out cells between a pair add the gap bonus', function () {
  var s = stateWith([3, 8, 8, 7, 2], 'normal');
  s.cells[1].done = true; s.cells[2].done = true;
  var r = L.select(L.select(s, 1).state, 4);
  assert.strictEqual(r.event.gaps, 2);
  assert.strictEqual(r.event.gain, 21);
});
test('4 a wrap of two outlines scores 45', function () {
  var vals = [3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 3];
  var r = L.select(L.select(stateWith(vals, 'normal'), 9).state, 10);
  assert.strictEqual(r.event.kind, 'wrap');
  assert.strictEqual(r.event.gain, 45);
});
test('5 a blocked reading order that is diagonal scores 45', function () {
  var vals = [1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 1, 3];
  var r = L.select(L.select(stateWith(vals, 'normal'), 1).state, 11);
  assert.strictEqual(r.event.kind, 'diag');
  assert.strictEqual(r.event.gaps, 0);
  assert.strictEqual(r.event.gain, 45);
});
test('6 a column with one crossed-out cell between scores 36', function () {
  var vals = [];
  for (var i = 0; i < 20; i++) vals.push(3);
  vals[0] = 4; vals[18] = 4;
  var s = stateWith(vals, 'normal');
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
  var s = stateWith(vals, 'normal');
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
  var r = L.select(L.select(stateWith([2, 3, 1], 'normal', { score: 100, streak: 2 }), 1).state, 2);
  assert.strictEqual(r.event.penalty, 18);
  assert.strictEqual(r.state.score, 82);
  assert.strictEqual(r.state.streak, 0);
});
test('10 two rows emptied at once pay 180', function () {
  var vals = [];
  for (var i = 0; i < 18; i++) vals.push(i === 0 || i === 9 ? 1 : 8);
  var done = [];
  for (var k = 0; k < 18; k++) if (k !== 0 && k !== 9) done.push(k);
  var s = stateWith(vals, 'normal');
  done.forEach(function (i) { s.cells[i].done = true; });
  var r = L.select(L.select(s, 1).state, 10);
  assert.strictEqual(r.event.rowsCleared.length, 2);
  assert.strictEqual(r.event.rowBonus, 180);
});
test('11 finishing under par pays the level bonus and the par bonus', function () {
  var r = L.select(L.select(stateWith([1, 1], 'normal', { par: 2, addsLeft: 5 }), 1).state, 2);
  assert.strictEqual(r.state.status, 'clear');
  assert.strictEqual(r.state.bonus, 750);
});
test('12 using more adds than par pays only the level part', function () {
  var r = L.select(L.select(stateWith([1, 1], 'normal', { par: 2, addsLeft: 2 }), 1).state, 2);
  assert.strictEqual(r.state.bonus, 150);
});
test('13 a hint costs 38 points, a hint count, and one streak step', function () {
  var r = L.hint(stateWith([1, 1, 2], 'normal', { score: 100, streak: 2 }));
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
  var s = L.select(L.select(stateWith([1, 1, 2, 2, 4, 3], 'normal', { score: 100 }), 1).state, 2).state;
  var missed = L.select(L.select(s, 5).state, 6);
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
  var board = [1, 9, 2, 8, 3, 5];
  assert.strictEqual(L.tidyAdds(board, true, 'classic', 5), L.tidyAdds(board, true, 'classic', 5));
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
  var rules = ['classic', 'pairs', 'mahjong'];
  for (var n = 0; n < 40; n++) {
    var rulesName = rules[n % 3];
    var vals = L.makeBoard(1 + (n % 6), L.mulberry32(1000 + n), rulesName);
    var cells = vals.map(function (tile, i) {
      return { id: i + 1, v: (tile && typeof tile === 'object') ? tile.v : tile, done: (n + i) % 7 === 0 };
    });
    assert.deepStrictEqual(L.allPairs(cells, true, rulesName), brutePairs(cells, true, rulesName));
    assert.deepStrictEqual(L.allPairs(cells, false, rulesName), brutePairs(cells, false, rulesName));
  }
});

test('the reference player matches a full recount, and classic level 1 needs 3 adds', function () {
  assert.strictEqual(L.tidyAdds(L.classicBoard(), true, 'classic', 5, 1000), 3);
  var board = [1, 9, 2, 8, 3, 5];
  assert.strictEqual(L.tidyAdds(board, true, 'classic', 5, 1000), slowAdds(board, true, 'classic', 5));
  for (var s = 1; s <= 6; s++) {
    var vals = L.makeBoard(2, L.mulberry32(s), 'classic').map(function (tile) {
      return (tile && typeof tile === 'object') ? tile.v : tile;
    });
    assert.strictEqual(L.tidyAdds(vals, true, 'classic', 5, 1000), slowAdds(vals, true, 'classic', 5));
  }
});

test('seeded reference plays finish under the time budget', function () {
  var rules = ['classic', 'pairs', 'mahjong'];
  var levels = [1, 2, 4, 6];
  var slow = 0, total = 0;
  rules.forEach(function (rulesName) {
    levels.forEach(function (level) {
      for (var s = 1; s <= 8; s++) {
        var vals = L.makeBoard(level, L.mulberry32(s), rulesName);
        var cap = L.addsFor('normal', level);
        var t0 = Date.now();
        var adds = L.tidyAdds(vals, true, rulesName, cap);
        if (Date.now() - t0 > 50) slow++;
        total++;
        assert.ok(adds >= 0 && adds <= cap);
      }
    });
  });
  assert.ok(slow / total <= 0.01, slow + ' of ' + total + ' boards took longer than 50ms');
});

test('17 mahjong honours do not double', function () {
  var r = L.select(L.select(stateWith([15, 15, 11], 'normal', { rules: 'mahjong' }), 1).state, 2);
  assert.strictEqual(r.event.same, false);
  assert.strictEqual(r.event.gain, 15);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
