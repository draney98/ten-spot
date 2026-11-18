/* Run with:  node tests/designs.test.js
   Designed boards: the format in game-logic.js (checkDesign, stateFromDesign, designFromState,
   designBeatable) and how the server stores them (server/designs.js). Routes: designs-http.test.js. */
'use strict';
var assert = require('assert');
var L = require('../game-logic.js');
var scores = require('../server/scores.js');
var D = require('../server/designs.js');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e.stack || e.message)); }
}

// a small board: two pairs side by side, a wall, and an empty spot
var SMALL = { v: 1, name: 'Warm-up', level: 12, cols: 5, cells: [1, 1, 3, 3, -1, 0, 5, 5, 7, 7], adds: 1, par: 0 };

test('a good board passes the check', function () {
  assert.deepStrictEqual(L.checkDesign(SMALL), { ok: true, errors: [] });
  assert.ok(L.checkDesign({ v: 1, level: 1, cols: 5, cells: [1, 2] }).ok, 'a day and a night tile of one mascot pair up');
});

test('a bad board gets one plain reason per problem', function () {
  var r = L.checkDesign({ v: 2, level: 0, cols: 2, cells: [1, 3, 5, -9], adds: 12, par: 30, name: 7 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.errors.length, 8);   // format, name, level, width, a bad cell, odd mascots, adds, par
  assert.ok(r.errors.some(function (e) { return /even number/.test(e); }));
  assert.deepStrictEqual(L.checkDesign(null).errors, ['A board must be an object.']);
  assert.ok(/at least two tiles/.test(L.checkDesign({ v: 1, level: 1, cols: 5, cells: [-1, 0] }).errors.join(' ')));
});

test('a designed board plays like a dealt one: its cells, buttons, walls and empty spots', function () {
  var s = L.stateFromDesign(SMALL, { mode: 'daily' });
  assert.strictEqual(s.status, 'playing');
  assert.strictEqual(s.mode, 'daily');
  assert.strictEqual(s.total, 8, 'tiles only, not the wall or the empty spot');
  assert.strictEqual(s.addsLeft, 1);
  assert.deepStrictEqual(s.cells.map(function (c) { return c.done; }), [false, false, false, false, false, true, false, false, false, false]);
  assert.strictEqual(s.design.name, 'Warm-up');
  var ids = [[1, 2], [3, 4], [7, 8], [9, 10]];
  ids.forEach(function (p) { s = L.select(L.select(s, p[0]).state, p[1]).state; });
  assert.strictEqual(s.status, 'clear');
  assert.ok(s.score > 0);
});

test('a small 3 x 3 board with an empty centre plays and clears', function () {
  var d = { v: 1, level: 1, cols: 3, cells: [1, 1, 3, 3, 0, 5, 5, 7, 7], adds: 0 };
  assert.ok(L.checkDesign(d).ok);
  assert.strictEqual(L.designBeatable(d), true);
  var s = L.stateFromDesign(d);
  assert.strictEqual(s.total, 8);
  [[1, 2], [3, 4], [6, 7], [8, 9]].forEach(function (p) { s = L.select(L.select(s, p[0]).state, p[1]).state; });
  assert.strictEqual(s.status, 'clear');
});

test('buttons not given come from the ramp for that level', function () {
  var s = L.stateFromDesign({ v: 1, level: 45, cols: 9, cells: [1, 1, 3, 3] });
  var T = L.toolsAt(45);
  assert.strictEqual(s.addsLeft, L.addsFor(45));
  assert.deepStrictEqual([s.hintsLeft, s.undosLeft, s.compactsLeft], [T.hints, T.undos, T.packs]);
  assert.throws(function () { L.stateFromDesign({ v: 1, level: 1, cols: 5, cells: [1, 3] }); }, /even number/);
});

test('a dealt board written down and played back is the same board', function () {
  [5, 42, 77].forEach(function (level) {
    var dealt = L.dealPuzzle({ diff: 'easy', level: level, seed: 900 + level, score: 0 });
    var d = L.designFromState(dealt);
    assert.ok(L.checkDesign(d).ok, 'level ' + level);
    var again = L.stateFromDesign(d);
    assert.deepStrictEqual(again.cells.map(function (c) { return [c.v, c.done]; }), dealt.cells.map(function (c) { return [c.v, c.done]; }));
    assert.strictEqual(again.par, dealt.par);
    assert.strictEqual(again.total, dealt.total);
    assert.strictEqual(again.cols, dealt.cols);
  });
});

test('the board as it stands now: cleared tiles become empty spots, buttons as left', function () {
  var s = L.stateFromDesign(SMALL);
  s = L.select(L.select(s, 1).state, 2).state;
  var d = L.designFromState(s, { now: true });
  assert.deepStrictEqual(d.cells, [0, 0, 3, 3, -1, 0, 5, 5, 7, 7]);
  assert.strictEqual(d.adds, 1);
  assert.strictEqual(d.name, 'Warm-up');
  assert.ok(L.checkDesign(d).ok);
  assert.deepStrictEqual(L.designFromState(s).cells, SMALL.cells, 'without now: the board it started as');
});

test('beatable: with its own Adds, yes or no', function () {
  var stuck = { v: 1, level: 12, cols: 5, cells: [1, 3, 1, 3], adds: 0 };
  assert.strictEqual(L.designBeatable(stuck), false);
  assert.strictEqual(L.designBeatable(Object.assign({}, stuck, { adds: 1 })), true, 'an Add copies them into reach');
  assert.strictEqual(L.designBeatable(SMALL), true);
});

test('slots: three a day, chapters of ten', function () {
  assert.deepStrictEqual(D.parseSlot('daily/2026-11-18/2'), { kind: 'daily', date: '2026-11-18', n: 2 });
  assert.deepStrictEqual(D.parseSlot('saga/3/10'), { kind: 'saga', chapter: 3, board: 10 });
  ['daily/2026-11-18/4', 'daily/2026-02-30/1', 'daily/26-11-18/1', 'saga/0/1', 'saga/1/11', 'saga/100/1', 'other/1', '', null]
    .forEach(function (bad) { assert.strictEqual(D.parseSlot(bad), null, String(bad)); });
});

test('the admin key: only a long enough key turns admin on, and only that key is the admin', function () {
  var key = 'k'.repeat(D.MIN_KEY);
  assert.strictEqual(D.adminKeyUsable(key.slice(1)), false);
  assert.strictEqual(D.isAdmin(key, key), true);
  assert.strictEqual(D.isAdmin(key, key + 'x'), false);
  assert.strictEqual(D.isAdmin(key, ''), false);
  assert.strictEqual(D.isAdmin('', ''), false, 'no key set: nobody is the admin');
  assert.strictEqual(D.isAdmin('short', 'short'), false);
});

test('saving: checked first, then stored; a day reads back in order with gaps as null', function () {
  var db = scores.openScores(':memory:');
  assert.throws(function () { D.putDesign(db, 'daily/2026-11-18/9', SMALL); }, /unknown slot/);
  assert.throws(function () { D.putDesign(db, 'daily/2026-11-18/1', { v: 1, level: 1, cols: 5, cells: [1, 3] }); }, /even number/);
  assert.throws(function () { D.putDesign(db, 'daily/2026-11-18/1', { v: 1, level: 12, cols: 5, cells: [1, 3, 1, 3], adds: 0 }); }, /cannot be cleared/);
  D.putDesign(db, 'daily/2026-11-18/3', SMALL, 1000);
  D.putDesign(db, 'daily/2026-11-18/1', Object.assign({}, SMALL, { name: 'First' }), 1000);
  var day = D.getDaily(db, '2026-11-18');
  assert.deepStrictEqual(day.boards.map(function (b) { return b && b.name; }), ['First', null, 'Warm-up']);
  D.putDesign(db, 'daily/2026-11-18/1', Object.assign({}, SMALL, { name: 'Replaced' }), 2000);
  assert.strictEqual(D.getDaily(db, '2026-11-18').boards[0].name, 'Replaced');
  assert.deepStrictEqual(D.getDaily(db, '2026-11-19').boards, [null, null, null]);
  assert.strictEqual(D.removeDesign(db, 'daily/2026-11-18/3').removed, true);
  assert.strictEqual(D.getDaily(db, '2026-11-18').boards[2], null);
  assert.throws(function () { D.getDaily(db, 'tomorrow'); }, /invalid date/);
});

test('Saga reads back by chapter and board number, in order', function () {
  var db = scores.openScores(':memory:');
  ['saga/2/1', 'saga/1/10', 'saga/1/2', 'saga/1/1'].forEach(function (slot) { D.putDesign(db, slot, Object.assign({}, SMALL, { name: slot })); });
  var saga = D.getSaga(db);
  assert.deepStrictEqual(saga.chapters.map(function (c) { return [c.chapter, c.boards.map(function (b) { return b.board; })]; }), [[1, [1, 2, 10]], [2, [1]]]);
  assert.strictEqual(saga.chapters[0].boards[2].design.name, 'saga/1/10');
  assert.deepStrictEqual(D.listDesigns(db, 'saga/1/').designs.map(function (d) { return d.slot; }), ['saga/1/1', 'saga/1/10', 'saga/1/2']);
  assert.throws(function () { D.listDesigns(db, "x' OR 1=1"); }, /invalid prefix/);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
