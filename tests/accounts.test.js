/* Run with:  node tests/accounts.test.js */
'use strict';
var assert = require('assert');
var crypto = require('crypto');
var scores = require('../server/scores.js');
var accounts = require('../server/accounts.js');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e.stack || e.message)); }
}
function fresh() { return scores.openScores(':memory:'); }
function status(fn) { try { fn(); return 'ok'; } catch (e) { return (e.status || 400) + ' ' + e.message; } }

test('making an account gives a device key and a recovery key, and stores neither', function () {
  var db = fresh();
  var r = accounts.createAccount(db, { name: '  Sam   the Ram ', label: 'iPhone' });
  assert.strictEqual(r.account.name, 'Sam the Ram');
  assert.ok(scores.normalizeCode(r.account.code));
  assert.strictEqual(r.key.length, 43);
  assert.strictEqual(r.recovery.length, 43);
  var dump = JSON.stringify(db.prepare('SELECT * FROM devices').all()) + JSON.stringify(db.prepare('SELECT * FROM accounts').all());
  assert.strictEqual(dump.indexOf(r.key), -1, 'the device key is not stored');
  assert.strictEqual(dump.indexOf(r.recovery), -1, 'the recovery key is not stored');
  assert.ok(dump.indexOf(crypto.createHash('sha256').update(r.key).digest('hex')) !== -1, 'only its hash is');
});

test('names: trimmed, 1 to 24 characters, no control characters', function () {
  assert.strictEqual(accounts.cleanName('Jo'), 'Jo');
  assert.strictEqual(accounts.cleanName('   '), null);
  assert.strictEqual(accounts.cleanName('x'.repeat(25)), null);
  assert.strictEqual(accounts.cleanName('a\u0007b'), null);
  assert.strictEqual(accounts.cleanName(7), null);
  assert.strictEqual(status(function () { accounts.createAccount(fresh(), { name: '' }); }), '400 invalid name');
});

test('the device key signs in; a wrong key does not', function () {
  var db = fresh();
  var r = accounts.createAccount(db, { name: 'Ana' });
  var w = accounts.signedIn(db, r.key);
  assert.strictEqual(w.account.name, 'Ana');
  assert.strictEqual(accounts.signedIn(db, r.key.slice(0, -1) + (r.key.slice(-1) === 'A' ? 'B' : 'A')), null);
  assert.strictEqual(accounts.signedIn(db, null), null);
  var me = accounts.describe(db, w);
  assert.deepStrictEqual(me.bests, { easy: 0, normal: 0, hard: 0 });
  assert.strictEqual(me.devices.length, 1);
  assert.strictEqual(me.devices[0].current, true);
});

test('a device with a score code brings it into the new account', function () {
  var db = fresh();
  var p = scores.createPlayer(db);
  scores.raiseBests(db, p.code, { easy: 4200 });
  var r = accounts.createAccount(db, { name: 'Ana', code: p.code });
  assert.strictEqual(r.account.code, p.code, 'the account takes over the code');
  assert.deepStrictEqual(accounts.describe(db, accounts.signedIn(db, r.key)).bests, { easy: 4200, normal: 0, hard: 0 });
  // a code already in an account is not taken over by a second one
  var r2 = accounts.createAccount(db, { name: 'Bo', code: p.code });
  assert.notStrictEqual(r2.account.code, p.code);
});

test('a link code adds a device once, within 10 minutes', function () {
  var db = fresh(), t = 1000000;
  var r = accounts.createAccount(db, { name: 'Ana' });
  var w = accounts.signedIn(db, r.key);
  var link = accounts.makeLink(db, w, t);
  assert.ok(/^[2-9a-z]{4}-[2-9a-z]{4}$/.test(link.code), link.code);
  assert.strictEqual(link.expiresAt, t + 10 * 60 * 1000);
  var joined = accounts.useLink(db, { code: link.code.toUpperCase().replace('-', ' '), label: 'iPad' }, t + 5000);
  assert.strictEqual(joined.account.name, 'Ana');
  assert.strictEqual(accounts.signedIn(db, joined.key).account.name, 'Ana');
  assert.strictEqual(status(function () { accounts.useLink(db, { code: link.code }, t + 6000); }), '404 link code not found or expired', 'only once');
  var late = accounts.makeLink(db, w, t);
  assert.strictEqual(status(function () { accounts.useLink(db, { code: late.code }, t + 10 * 60 * 1000); }), '404 link code not found or expired');
  assert.strictEqual(accounts.describe(db, w).devices.map(function (d) { return d.label; }).join(), 'A device,iPad');
});

test('at most 3 link codes are open at once', function () {
  var db = fresh(), t = 5;
  var w = accounts.signedIn(db, accounts.createAccount(db, { name: 'Ana' }).key);
  accounts.makeLink(db, w, t); accounts.makeLink(db, w, t); accounts.makeLink(db, w, t);
  assert.strictEqual(status(function () { accounts.makeLink(db, w, t); }), '400 too many open links');
  assert.strictEqual(status(function () { accounts.makeLink(db, w, t + 11 * 60 * 1000); }), 'ok', 'expired ones make room');
});

test('the recovery key signs a new device in and is then replaced', function () {
  var db = fresh();
  var r = accounts.createAccount(db, { name: 'Ana' });
  var back = accounts.recover(db, { recovery: r.recovery, label: 'New phone' });
  assert.strictEqual(back.account.name, 'Ana');
  assert.ok(accounts.signedIn(db, back.key));
  assert.notStrictEqual(back.recovery, r.recovery);
  assert.strictEqual(status(function () { accounts.recover(db, { recovery: r.recovery }); }), '404 recovery key not found', 'the old one is used up');
  var w = accounts.signedIn(db, back.key);
  var again = accounts.newRecovery(db, w).recovery;
  assert.strictEqual(status(function () { accounts.recover(db, { recovery: back.recovery }); }), '404 recovery key not found');
  assert.strictEqual(status(function () { accounts.recover(db, { recovery: again }); }), 'ok');
});

test('signing out removes only this device; another device can be removed too', function () {
  var db = fresh(), t = 1;
  var r = accounts.createAccount(db, { name: 'Ana' });
  var w = accounts.signedIn(db, r.key);
  var other = accounts.useLink(db, { code: accounts.makeLink(db, w, t).code }, t);
  var ow = accounts.signedIn(db, other.key);
  accounts.removeDevice(db, ow, 'current');
  assert.strictEqual(accounts.signedIn(db, other.key), null);
  assert.ok(accounts.signedIn(db, r.key));
  var third = accounts.useLink(db, { code: accounts.makeLink(db, w, t).code }, t);
  var thirdId = accounts.describe(db, w).devices.filter(function (d) { return !d.current; })[0].id;
  accounts.removeDevice(db, w, thirdId);
  assert.strictEqual(accounts.signedIn(db, third.key), null);
  // a device of another account can't be removed
  var bo = accounts.signedIn(db, accounts.createAccount(db, { name: 'Bo' }).key);
  assert.strictEqual(status(function () { accounts.removeDevice(db, bo, w.deviceId); }), '404 device not found');
});

test('bests: raised on the account, and a folded score code feeds the account', function () {
  var db = fresh();
  var r = accounts.createAccount(db, { name: 'Ana' });
  var w = accounts.signedIn(db, r.key);
  assert.deepStrictEqual(accounts.raiseBests(db, w, { easy: 100, version: 2, run: 'abcdefgh1234' }), { easy: 100, normal: 0, hard: 0 });
  var old = scores.createPlayer(db);
  scores.raiseBests(db, old.code, { easy: 300, hard: 50 });
  assert.deepStrictEqual(accounts.foldCode(db, w, old.code), { easy: 300, normal: 0, hard: 50 });
  // an old device that still uses the folded code now raises the account's bests, and reads them
  scores.raiseBests(db, old.code, { normal: 77 });
  assert.deepStrictEqual(accounts.describe(db, w).bests, { easy: 300, normal: 77, hard: 50 });
  var seen = scores.getPlayer(db, old.code);
  assert.deepStrictEqual(seen, { code: old.code, easy: 300, normal: 77, hard: 50 });
  // a code in someone else's account can't be folded in
  var bo = accounts.signedIn(db, accounts.createAccount(db, { name: 'Bo' }).key);
  assert.strictEqual(status(function () { accounts.foldCode(db, bo, old.code); }), '409 that code is in another account');
});

test('rename', function () {
  var db = fresh();
  var w = accounts.signedIn(db, accounts.createAccount(db, { name: 'Ana' }).key);
  assert.deepStrictEqual(accounts.rename(db, w, 'Ana B'), { name: 'Ana B' });
  assert.strictEqual(accounts.describe(db, accounts.signedIn(db, accounts.createAccount(db, { name: 'x' }).key)).name, 'x');
  assert.strictEqual(status(function () { accounts.rename(db, w, ''); }), '400 invalid name');
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
