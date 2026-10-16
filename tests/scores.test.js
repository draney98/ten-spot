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

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
