/* Run with:  node tests/limits.test.js */
'use strict';
var assert = require('assert');
var limits = require('../server/limits.js');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e.stack || e.message)); }
}

test('the default limits', function () {
  assert.deepStrictEqual(limits.DEFAULT_RULES, {
    runs: { max: 30, windowMs: 60000 }, boards: { max: 20, windowMs: 60000 },
    bests: { max: 60, windowMs: 60000 }, players: { max: 10, windowMs: 3600000 },
    accounts: { max: 10, windowMs: 3600000 }, links: { max: 20, windowMs: 3600000 }, signin: { max: 10, windowMs: 60000 }
  });
});

test('an address may post up to the limit, then waits until the window ends', function () {
  var t = 1000000;
  var lim = limits.createLimiter({ runs: { max: 3, windowMs: 60000 } }, function () { return t; });
  assert.ok(lim.check('runs', 'a').ok); assert.ok(lim.check('runs', 'a').ok); assert.ok(lim.check('runs', 'a').ok);
  assert.deepStrictEqual(lim.check('runs', 'a'), { ok: false, retryAfter: 60 });
  assert.ok(lim.check('runs', 'b').ok, 'another address is not held back');
  t += 45000;
  assert.deepStrictEqual(lim.check('runs', 'a'), { ok: false, retryAfter: 15 });
  t += 15000;
  assert.ok(lim.check('runs', 'a').ok, 'a new window');
  assert.ok(lim.check('unknown-route', 'a').ok, 'routes without a rule are not limited');
});

test('old addresses are forgotten', function () {
  var t = 0;
  var lim = limits.createLimiter({ runs: { max: 1, windowMs: 1000 } }, function () { return t; });
  for (var i = 0; i < 999; i++) lim.check('runs', 'addr' + i);
  assert.strictEqual(lim.size(), 999);
  t = 5000;
  lim.check('runs', 'new');   // the 1000th check sweeps
  assert.strictEqual(lim.size(), 1);
});

test('the address comes first in x-forwarded-for, else from the socket', function () {
  assert.strictEqual(limits.clientAddress({ headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }, socket: {} }), '203.0.113.9');
  assert.strictEqual(limits.clientAddress({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
  assert.strictEqual(limits.clientAddress({ headers: { 'x-forwarded-for': '  ' }, socket: {} }), 'unknown');
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
