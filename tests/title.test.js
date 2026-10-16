/* Run with:  node tests/title.test.js */
'use strict';
var assert = require('assert');
var fs = require('fs');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + e.message); }
}

var page = fs.readFileSync('index.html', 'utf8');
var bundle = fs.readFileSync('number-match.html', 'utf8');

test('the page title and heading say ten-spot', function () {
  assert.ok(page.indexOf('<title>ten-spot</title>') !== -1);
  assert.ok(page.indexOf('<h1 id="title">ten-spot</h1>') !== -1);
  assert.ok(page.indexOf('Number Match') === -1);
});

test('the bundled page title and heading say ten-spot', function () {
  assert.ok(bundle.indexOf('<title>ten-spot</title>') !== -1);
  assert.ok(bundle.indexOf('>ten-spot</h1>') !== -1);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
