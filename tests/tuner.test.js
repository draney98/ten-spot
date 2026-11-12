/* Run with:  node tests/tuner.test.js */
'use strict';
var assert = require('assert');
var L = require('../game-logic.js');
var T = require('../tools/tuner-core.js');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e.stack || e.message)); }
}
var ORIGINAL = T.readConfig(L);
function restore() { T.applyConfig(L, ORIGINAL); }

test('readConfig gives the game\'s numbers, and applying them back changes nothing', function () {
  assert.strictEqual(ORIGINAL.ramp[0].from, 1);
  assert.deepStrictEqual(ORIGINAL.tiles, { base: 10, step: 2, every: 2, max: 80, maxWidth: 9 });
  assert.strictEqual(ORIGINAL.tools[0].hints, 'inf');
  assert.deepStrictEqual(T.checkConfig(ORIGINAL), []);
  var before = [1, 14, 15, 40, 53, 59, 76].map(function (l) { return [L.boardSize(l), L.widthAt(l), L.wallKinds(l).join(), L.addsFor('easy', l), L.toolsAt(l).undos]; });
  T.applyConfig(L, ORIGINAL);
  var after = [1, 14, 15, 40, 53, 59, 76].map(function (l) { return [L.boardSize(l), L.widthAt(l), L.wallKinds(l).join(), L.addsFor('easy', l), L.toolsAt(l).undos]; });
  assert.deepStrictEqual(after, before);
  assert.deepStrictEqual(T.readConfig(L), ORIGINAL);
});

test('applyConfig changes what the game deals', function () {
  var cfg = JSON.parse(JSON.stringify(ORIGINAL));
  cfg.ramp = [{ from: 1, kinds: 3, adds: 2, walls: ['col'] }];
  cfg.tiles = { base: 20, step: 4, every: 1, max: 40, maxWidth: 7 };
  cfg.normalStart = 5; cfg.hardStart = 9;
  T.applyConfig(L, cfg);
  try {
    assert.strictEqual(L.boardSize(1), 24);
    assert.strictEqual(L.boardSize(30), 40);
    assert.strictEqual(L.addsFor('easy', 50), 2);
    assert.deepStrictEqual(L.wallKinds(3), ['col']);
    assert.strictEqual(L.stageOf(6), 'normal');
    assert.ok(L.widthAt(30) <= 7);
    var s = L.dealPuzzle({ diff: 'easy', level: 2, seed: 11 });
    assert.strictEqual(s.cells.filter(L.isWall).length, 1);
  } finally { restore(); }
  assert.strictEqual(L.boardSize(1), 12);
});

test('checkConfig explains bad numbers', function () {
  var cfg = JSON.parse(JSON.stringify(ORIGINAL));
  cfg.ramp[0].from = 2;
  cfg.ramp[1].kinds = 9;
  cfg.ramp[2].walls = ['brick'];
  cfg.tiles.base = 11;
  cfg.hardStart = cfg.normalStart;
  var problems = T.checkConfig(cfg);
  assert.strictEqual(problems.length, 5);
  assert.throws(function () { T.applyConfig(L, cfg); });
  assert.deepStrictEqual(T.readConfig(L), ORIGINAL);   // a refused config changes nothing
});

test('the bot clears easy boards in every style, and a run plays level by level', function () {
  ['careful', 'casual', 'random'].forEach(function (style) {
    var climb = T.makeClimb(L, 7, { style: style, pack: true, undos: 0 }, 1, 6);
    var guard = 0;
    while (climb.step() && guard++ < 50) { /* next level */ }
    assert.ok(climb.result.done);
    assert.ok(climb.result.lost >= 2, style + ' got past level 1');
    assert.strictEqual(climb.result.moves.length, Math.min(climb.result.lost, 6));
    assert.ok(climb.result.moves[0] >= 6, 'level 1 has 6 pairs');
  });
  var a = T.makeClimb(L, 3, { style: 'careful', pack: true, undos: 0 }, 1, 4), b = T.makeClimb(L, 3, { style: 'careful', pack: true, undos: 0 }, 1, 4);
  while (a.step()) { /* run */ } while (b.step()) { /* run */ }
  assert.deepStrictEqual(a.result, b.result);   // same seed, same run
});

test('undos let the bot step back from a dead board', function () {
  var lostNo = 0, lostYes = 0;
  for (var i = 0; i < 40; i++) {
    var s = L.dealPuzzle({ diff: 'easy', level: 70, seed: 500 + i * 13 });
    if (T.playLevel(L, s, { style: 'careful', pack: true, undos: 0 }, Math.random).state.status !== 'clear') lostNo++;
    s.undosLeft = 99;
    if (T.playLevel(L, s, { style: 'careful', pack: true, undos: 99 }, Math.random).state.status !== 'clear') lostYes++;
  }
  assert.ok(lostYes <= lostNo, lostYes + ' <= ' + lostNo);
});

test('summarize: reach, bands, stages and the report', function () {
  var runs = [
    { start: 1, lost: 3, moves: [10, 10, 10], done: true },
    { start: 1, lost: 7, moves: [10, 10, 10, 10, 20, 20, 20], done: true },
    { start: 1, lost: 12, moves: [10, 10, 10, 10, 20, 20, 20, 20, 30, 30, 30, 30], done: true },
    { start: 1, lost: 12, moves: [10, 10, 10, 10, 20, 20, 20, 20, 30, 30, 30, 30], done: true }
  ];
  var cfg = JSON.parse(JSON.stringify(ORIGINAL)); cfg.normalStart = 5; cfg.hardStart = 9;
  var sum = T.summarize(runs, cfg, 6);
  assert.strictEqual(sum.runs, 4);
  assert.strictEqual(sum.median, 12);
  assert.strictEqual(T.reachAt(sum, 1), 1);
  assert.strictEqual(T.reachAt(sum, 4), 0.75);
  assert.strictEqual(T.reachAt(sum, 8), 0.5);
  assert.strictEqual(T.reachAt(sum, 13), 0);
  assert.deepStrictEqual(sum.bands.map(function (b) { return [b.from, b.entered, b.lost]; }), [[1, 4, 0.25], [6, 3, 1 / 3], [11, 2, 1]]);
  assert.deepStrictEqual(sum.stages.map(function (s) { return [s.name, s.runs]; }), [['Easy', 4], ['Normal', 3], ['Hard', 2]]);
  assert.strictEqual(sum.stages[0].levels, (3 + 4 + 4 + 4) / 4);
  assert.strictEqual(sum.stages[0].minutes, (30 + 40 + 40 + 40) * 6 / 60 / 4);
  assert.strictEqual(sum.stages[0].finished, 0.75);
  assert.strictEqual(sum.stages[2].finished, null);
  var text = T.reportText('walls at 35', cfg, { style: 'casual', pack: false, undos: 2 }, sum);
  assert.ok(text.indexOf('walls at 35') !== -1 && text.indexOf('BOT: casual, no Pack, 2 undos a level') !== -1 && text.indexOf('1-5: 25%') !== -1);
});

test('realReach turns run-end counts into a reach curve', function () {
  var rows = [{ version: 2, start: 'easy', level: 2, n: 1 }, { version: 2, start: 'easy', level: 4, n: 3 }, { version: 2, start: 'hard', level: 60, n: 5 }];
  var real = T.realReach(rows, 'easy');
  assert.strictEqual(real.runs, 4);
  assert.deepStrictEqual(real.reach, [1, 1, 0.75, 0.75]);
  assert.strictEqual(T.realReach(rows, 'normal'), null);
});

test('the tuner page loads the game rules and the core', function () {
  var html = require('fs').readFileSync('tools/tuner.html', 'utf8');
  assert.ok(html.indexOf('<script src="../game-logic.js"></script>') !== -1);
  assert.ok(html.indexOf('<script src="tuner-core.js"></script>') !== -1);
  var inline = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  new Function(inline);   // the page script parses
});

restore();
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
