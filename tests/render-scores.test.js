/* Run with:  node tests/render-scores.test.js */
'use strict';
var assert = require('assert');
var fs = require('fs');
var yaml = fs.readFileSync('render.yaml', 'utf8');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + e.message); }
}

test('the static site is still published from the repo root', function () {
  assert.ok(yaml.indexOf('runtime: static') !== -1);
  assert.ok(yaml.indexOf('staticPublishPath: .') !== -1);
});

test('the score service uses the paid instance disk and the node server', function () {
  assert.ok(yaml.indexOf('runtime: node') !== -1);
  assert.ok(yaml.indexOf('node server/index.js') !== -1);
  assert.ok(yaml.indexOf('mountPath: /var/data') !== -1);
  assert.ok(yaml.indexOf('sizeGB: 1') !== -1);
  assert.ok(yaml.indexOf('SCORES_DB') !== -1);
  assert.ok(yaml.indexOf('/var/data/scores.sqlite') !== -1);
  assert.ok(yaml.indexOf('SCORES_ORIGIN') !== -1);
  assert.ok(yaml.indexOf('NODE_VERSION') !== -1);
  assert.ok(yaml.indexOf('22.22.1') !== -1);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
