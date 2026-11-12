/* Run with:  node tests/migrations.test.js */
'use strict';
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var { DatabaseSync } = require('node:sqlite');
var migrations = require('../server/migrations.js');
var scores = require('../server/scores.js');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e.stack || e.message)); }
}
function tmpFile(name) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenspot-mig-'));
  return path.join(dir, name);
}
function tables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(function (r) { return r.name; });
}
/** A database exactly as the live one was before numbered changes (user_version 0). */
function liveLikeFile() {
  var file = tmpFile('scores.sqlite');
  var db = new DatabaseSync(file);
  db.exec('CREATE TABLE players (code TEXT PRIMARY KEY, easy INTEGER NOT NULL DEFAULT 0, normal INTEGER NOT NULL DEFAULT 0, hard INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)');
  db.exec('ALTER TABLE players ADD COLUMN ramp_easy INTEGER NOT NULL DEFAULT 0');
  db.exec('ALTER TABLE players ADD COLUMN ramp_normal INTEGER NOT NULL DEFAULT 0');
  db.exec('ALTER TABLE players ADD COLUMN ramp_hard INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE TABLE boards (code TEXT PRIMARY KEY, board_key TEXT NOT NULL UNIQUE, diff TEXT NOT NULL, level INTEGER NOT NULL, mode TEXT NOT NULL, seed INTEGER NOT NULL)');
  db.exec('CREATE TABLE run_ends (version INTEGER NOT NULL, start TEXT NOT NULL, level INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (version, start, level))');
  db.prepare("INSERT INTO players VALUES ('abcdefghjkmnpqrs', 900, 0, 0, '2026-10-01', '2026-11-10', 4200, 0, 1300)").run();
  db.prepare("INSERT INTO players VALUES ('2345678923456789', 0, 0, 0, '2026-10-02', '2026-10-02', 0, 0, 0)").run();
  db.prepare("INSERT INTO boards VALUES ('abc123', 'k', 'easy', 5, 'teams', 77)").run();
  db.prepare("INSERT INTO run_ends VALUES (2, 'easy', 41, 3)").run();
  db.close();
  return file;
}

test('the changes are numbered 1, 2, 3 … with no gaps', function () {
  migrations.CHANGES.forEach(function (c, i) { assert.strictEqual(c.n, i + 1); assert.ok(c.name); });
  assert.strictEqual(migrations.LATEST, migrations.CHANGES.length);
});

test('a new database is built from nothing', function () {
  var db = scores.openScores(':memory:');
  assert.strictEqual(migrations.versionOf(db), migrations.LATEST);
  assert.deepStrictEqual(db.migrated, { from: 0, to: migrations.LATEST, backup: null });
  assert.deepStrictEqual(tables(db), ['best_log', 'boards', 'players', 'run_ends', 'run_seen']);
});

test('the live database keeps everything, gets the new tables, and is backed up first', function () {
  var file = liveLikeFile();
  var db = scores.openScores(file);
  assert.deepStrictEqual(db.migrated, { from: 0, to: migrations.LATEST, backup: file + '.before-change-1' });
  assert.deepStrictEqual(scores.getPlayer(db, 'abcd-efgh-jkmn-pqrs'), { code: 'abcd-efgh-jkmn-pqrs', easy: 4200, normal: 0, hard: 1300 });
  assert.deepStrictEqual(scores.getBoard(db, 'abc-123'), { code: 'abc-123', diff: 'easy', level: 5, mode: 'teams', seed: 77 });
  assert.deepStrictEqual(scores.runEnds(db, 2), [{ version: 2, start: 'easy', level: 41, n: 3 }]);
  // bests already there are copied into the log as rules version 1; zeros are not
  assert.deepStrictEqual(scores.bestLog(db, 'abcdefghjkmnpqrs').sort(function (a, b) { return a.start < b.start ? -1 : 1; }),
    [{ start: 'easy', score: 4200, version: 1, run: null }, { start: 'hard', score: 1300, version: 1, run: null }]);
  assert.deepStrictEqual(scores.bestLog(db, '2345678923456789'), []);
  db.close();
  // the copy is the database as it was: no new tables, version 0
  var old = new DatabaseSync(file + '.before-change-1');
  assert.strictEqual(migrations.versionOf(old), 0);
  assert.deepStrictEqual(tables(old), ['boards', 'players', 'run_ends']);
  old.close();
  // a second start does nothing and makes no new copy
  var again = scores.openScores(file);
  assert.deepStrictEqual(again.migrated, { from: migrations.LATEST, to: migrations.LATEST, backup: null });
  again.close();
});

test('a database part of the way along only gets the changes it is missing', function () {
  var file = tmpFile('scores.sqlite');
  var db = new DatabaseSync(file);
  migrations.migrate(db, { changes: migrations.CHANGES.slice(0, 1) });
  assert.strictEqual(migrations.versionOf(db), 1);
  var r = migrations.migrate(db, { backupBase: file });
  assert.deepStrictEqual(r, { from: 1, to: migrations.LATEST, backup: file + '.before-change-2' });
  assert.ok(fs.existsSync(file + '.before-change-2'));
  db.close();
});

test('a change that fails is rolled back, later ones are not tried, and the error names it', function () {
  var db = new DatabaseSync(':memory:');
  var ran = [];
  var changes = [
    { n: 1, name: 'one', up: function (d) { d.exec('CREATE TABLE a (x)'); ran.push(1); } },
    { n: 2, name: 'two', up: function (d) { d.exec('CREATE TABLE b (x)'); d.exec('THIS IS NOT SQL'); } },
    { n: 3, name: 'three', up: function () { ran.push(3); } }
  ];
  assert.throws(function () { migrations.migrate(db, { changes: changes }); }, /database change 2 \(two\) failed/);
  assert.strictEqual(migrations.versionOf(db), 1);
  assert.deepStrictEqual(tables(db), ['a']);   // b was rolled back
  assert.deepStrictEqual(ran, [1]);
});

test('a copy left by an earlier failed start is replaced', function () {
  var file = tmpFile('scores.sqlite');
  fs.writeFileSync(file + '.before-change-1', 'left over');
  var db = scores.openScores(file);
  assert.strictEqual(db.migrated.backup, file + '.before-change-1');
  assert.notStrictEqual(fs.readFileSync(file + '.before-change-1', 'utf8').slice(0, 9), 'left over');
  db.close();
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
