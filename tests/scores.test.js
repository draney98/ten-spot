/* Run with:  node tests/scores.test.js */
'use strict';
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var scores = require('../server/scores.js');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + e.message); }
}

test('createPlayer returns zeros and a dashed code from the alphabet', function () {
  var db = scores.openScores(':memory:');
  var row = scores.createPlayer(db);
  assert.deepStrictEqual({ easy: row.easy, normal: row.normal, hard: row.hard }, { easy: 0, normal: 0, hard: 0 });
  assert.match(row.code, /^[23456789abcdefghjkmnpqrstuvwxyz]{4}(-[23456789abcdefghjkmnpqrstuvwxyz]{4}){3}$/);
});

test('getPlayer finds a code typed with dashes and capitals', function () {
  var db = scores.openScores(':memory:');
  var row = scores.createPlayer(db);
  var typed = row.code.slice(0, 4).toUpperCase() + ' ' + row.code.slice(5);
  var found = scores.getPlayer(db, typed);
  assert.strictEqual(found.code, row.code);
});

test('raiseBests on an unknown code returns null and inserts nothing', function () {
  var db = scores.openScores(':memory:');
  var missing = scores.raiseBests(db, '2345-6789-abcd-efgh', { normal: 10 });
  assert.strictEqual(missing, null);
  assert.strictEqual(scores.getPlayer(db, '2345-6789-abcd-efgh'), null);
});

test('lower score does not replace a higher one', function () {
  var db = scores.openScores(':memory:');
  var row = scores.createPlayer(db);
  var raised = scores.raiseBests(db, row.code, { normal: 40, easy: 5 });
  assert.strictEqual(raised.normal, 40);
  assert.strictEqual(raised.easy, 5);
  var again = scores.raiseBests(db, row.code, { normal: 10 });
  assert.strictEqual(again.normal, 40);
  assert.strictEqual(again.easy, 5);
  assert.strictEqual(again.hard, 0);
});

test('invalid scores throw and change nothing', function () {
  var db = scores.openScores(':memory:');
  var row = scores.createPlayer(db);
  assert.throws(function () { scores.raiseBests(db, row.code, { hard: -1 }); }, /invalid score/);
  assert.throws(function () { scores.raiseBests(db, row.code, { hard: 1.5 }); }, /invalid score/);
  assert.throws(function () { scores.raiseBests(db, row.code, { hard: 1000000001 }); }, /invalid score/);
  assert.throws(function () { scores.raiseBests(db, 'not-a-code', { hard: 1 }); }, /invalid code/);
  assert.strictEqual(scores.getPlayer(db, row.code).hard, 0);
});

test('normalizeCode rejects a short code and a zero', function () {
  assert.strictEqual(scores.normalizeCode('2345-6789-abcd-efg'), null);
  assert.strictEqual(scores.normalizeCode('0234-5678-9abc-defg'), null);
  assert.strictEqual(scores.normalizeCode('2345-6789-abcd-efgh'), '23456789abcdefgh');
});

test('a file database survives a second open', function () {
  var file = path.join(os.tmpdir(), 'ten-spot-scores-' + process.pid + '.sqlite');
  try { fs.unlinkSync(file); } catch (e) { /* absent */ }
  var first = scores.openScores(file);
  var row = scores.createPlayer(first);
  scores.raiseBests(first, row.code, { hard: 12 });
  first.close();
  var second = scores.openScores(file);
  assert.strictEqual(scores.getPlayer(second, row.code).hard, 12);
  second.close();
  fs.unlinkSync(file);
});

function sampleBoard(v, mode) {
  return { diff: 'normal', level: 1, mode: mode || 'icons', seed: 5, cells: [{ v: v }, { v: 9, solid: false }] };
}

test('the same opening board keeps one code', function () {
  var db = scores.openScores(':memory:');
  var first = scores.saveBoard(db, sampleBoard(1), ['aaaaaa']);
  assert.strictEqual(first.code, 'aaa-aaa');
  var again = scores.saveBoard(db, sampleBoard(1), ['zzzzzz']);
  assert.strictEqual(again.code, 'aaa-aaa');
  assert.strictEqual(again.seed, 5);
});

test('a code that already exists is skipped', function () {
  var db = scores.openScores(':memory:');
  scores.saveBoard(db, sampleBoard(1), ['aaaaaa']);
  var second = scores.saveBoard(db, sampleBoard(2), ['aaaaaa', 'xy7fg9']);
  assert.strictEqual(second.code, 'xy7-fg9');
  assert.notStrictEqual(second.code, 'aaa-aaa');
});

test('a board code is case insensitive', function () {
  var db = scores.openScores(':memory:');
  scores.saveBoard(db, sampleBoard(3), ['xy7fg9']);
  var found = scores.getBoard(db, 'XY7-FG9');
  assert.strictEqual(found.code, 'xy7-fg9');
  assert.strictEqual(found.mode, 'icons');
  assert.strictEqual(scores.getBoard(db, 'nope'), null);
  assert.notStrictEqual(scores.saveBoard(db, sampleBoard(3, 'num'), ['bbbbbb']).code, 'xy7-fg9');
});

test('an invalid board is rejected', function () {
  var db = scores.openScores(':memory:');
  assert.throws(function () { scores.saveBoard(db, { diff: 'nope', level: 1, mode: 'num', seed: 1, cells: [{ v: 1 }] }); }, /invalid board/);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
