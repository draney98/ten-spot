/* Run with:  node tests/save.test.js */
'use strict';
var assert = require('assert');
var SV = require('../save.js');
var L = require('../game-logic.js');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + e.message); }
}

test('unlimited hints and packs survive a save', function () {
  var s = L.dealPuzzle({ diff: 'easy', level: 10, seed: 12345 });   // Pack unlocks at level 10
  assert.strictEqual(s.hintsLeft, Infinity);
  var back = SV.unpack(SV.pack(s, { settingsOpen: true, boardCode: 'abc-123' }));
  assert.ok(back);
  assert.strictEqual(back.state.hintsLeft, Infinity);
  assert.strictEqual(back.state.undosLeft, 5);
  assert.strictEqual(back.state.compactsLeft, Infinity);
  assert.strictEqual(back.extras.settingsOpen, true);
  assert.strictEqual(back.extras.boardCode, 'abc-123');
});

test('Hard mid-level: board, score and counts come back the same, and Undo still works', function () {
  var s = L.dealPuzzle({ diff: 'hard', level: 2, seed: 777, score: 500 });
  s.score = 640; s.streak = 2; s.selected = s.cells[3].id;
  s.history = [{ cells: s.cells, nextId: s.nextId, moves: 0, cleared: 0, total: s.total, score: 500, streak: 0, addsLeft: s.addsLeft, penalties: 0, compactsLeft: s.compactsLeft }];
  var back = SV.unpack(SV.pack(s)).state;
  assert.deepStrictEqual(back.cells, s.cells);
  assert.strictEqual(back.score, 640);
  assert.strictEqual(back.streak, 2);
  assert.strictEqual(back.selected, s.cells[3].id);
  assert.strictEqual(back.level, 2);
  assert.strictEqual(back.diff, 'hard');
  assert.strictEqual(back.seed, s.seed);
  assert.ok(L.canUndo(back));
  var r = L.undo(back);
  assert.ok(r.event !== null, 'undo did nothing');
  assert.strictEqual(r.state.history.length, 0);
});

test('a cleared level and a Game over both come back on their end card', function () {
  var s = L.dealPuzzle({ diff: 'normal', level: 1, seed: 42 });
  s.status = 'clear'; s.bonus = 120;
  assert.strictEqual(SV.unpack(SV.pack(s)).state.status, 'clear');
  s.status = 'lose'; s.reason = 'nopairs'; s.final = 900;
  var back = SV.unpack(SV.pack(s)).state;
  assert.strictEqual(back.status, 'lose');
  assert.strictEqual(back.final, 900);
});

test('undo history is trimmed to the last 50 steps', function () {
  var s = L.dealPuzzle({ diff: 'easy', level: 1, seed: 9 });
  s.history = [];
  for (var i = 0; i < 120; i++) s.history.push({ cells: s.cells, nextId: s.nextId, moves: i, cleared: 0, total: s.total, score: i, streak: 0, addsLeft: s.addsLeft, penalties: 0, compactsLeft: s.compactsLeft });
  var back = SV.unpack(SV.pack(s)).state;
  assert.strictEqual(back.history.length, 50);
  assert.strictEqual(back.history[49].moves, 119);
  assert.strictEqual(s.history.length, 120, 'pack must not change the live game');
});

test('missing, broken, old-version or fake saves give null', function () {
  assert.strictEqual(SV.unpack(null), null);
  assert.strictEqual(SV.unpack(''), null);
  assert.strictEqual(SV.unpack('{not json'), null);
  var good = JSON.parse(SV.pack(L.dealPuzzle({ diff: 'normal', level: 1, seed: 5 })));
  var old = JSON.parse(JSON.stringify(good)); old.v = 0;
  assert.strictEqual(SV.unpack(JSON.stringify(old)), null);
  var badDiff = JSON.parse(JSON.stringify(good)); badDiff.state.diff = 'expert';
  assert.strictEqual(SV.unpack(JSON.stringify(badDiff)), null);
  var noCells = JSON.parse(JSON.stringify(good)); noCells.state.cells = [];
  assert.strictEqual(SV.unpack(JSON.stringify(noCells)), null);
  var badStatus = JSON.parse(JSON.stringify(good)); badStatus.state.status = 'paused';
  assert.strictEqual(SV.unpack(JSON.stringify(badStatus)), null);
  assert.ok(SV.unpack(JSON.stringify(good)));
});

test('pack can keep fewer undo steps (for the server copy)', function () {
  var s = { diff: 'easy', status: 'playing', level: 3, cols: 5, score: 0, cells: [{ id: 1, v: 1, done: false }], history: [] };
  for (var i = 0; i < 12; i++) s.history.push({ cells: [{ id: 1, v: 1, done: false }], n: i });
  assert.strictEqual(SV.unpack(SV.pack(s)).state.history.length, 12);
  var three = SV.unpack(SV.pack(s, {}, { keepHistory: 3 })).state.history;
  assert.deepStrictEqual(three.map(function (h) { return h.n; }), [9, 10, 11]);
  assert.strictEqual(SV.unpack(SV.pack(s, {}, { keepHistory: 0 })).state.history.length, 0);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
