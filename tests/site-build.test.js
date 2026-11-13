/* Run with:  node tests/site-build.test.js
   Builds the site into a temporary folder with tools/build-site.sh and checks it. */
'use strict';
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var spawnSync = require('child_process').spawnSync;

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e.stack || e.message)); }
}

var out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tenspot-site-')), 'public');
var run = spawnSync('sh', ['tools/build-site.sh'], { encoding: 'utf8', env: Object.assign({}, process.env, { OUT: out, RENDER_GIT_COMMIT: 'abc1234' }) });

if (run.error && run.error.code === 'ENOENT') {
  // No sh on this computer (Windows without Git Bash). Render has it; skip rather than fail.
  console.log('SKIP  sh is not available here; the build is checked on Render');
  console.log('0 passed, 0 failed');
  process.exit(0);
}

test('the build script runs', function () {
  assert.strictEqual(run.status, 0, run.stderr);
  assert.ok(/Built .*abc1234/.test(run.stdout));
});

function localRefs(file) {
  var text = fs.readFileSync(file, 'utf8');
  var refs = [], re = /(?:src|href)="([^"]+)"/g, m;
  while ((m = re.exec(text))) {
    var ref = m[1].split('?')[0].split('#')[0];
    if (!ref || /^(https?:|mailto:|data:|\/\/)/.test(ref)) continue;
    refs.push(path.normalize(path.join(path.dirname(file), ref)));
  }
  return refs;
}

test('every file the game and the tuner load is in the build', function () {
  var missing = [];
  [path.join(out, 'index.html'), path.join(out, 'tools', 'tuner.html')].forEach(function (page) {
    localRefs(page).forEach(function (ref) {
      var target = fs.existsSync(ref) && fs.statSync(ref).isDirectory() ? path.join(ref, 'index.html') : ref;
      if (!fs.existsSync(target)) missing.push(path.relative(out, page) + ' -> ' + path.relative(out, ref));
    });
  });
  assert.deepStrictEqual(missing, []);
});

test('index.html is stamped with the commit', function () {
  var html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.strictEqual(html.indexOf('__V__'), -1);
  assert.ok(html.indexOf('app.js?v=abc1234') !== -1);
  assert.ok(fs.readFileSync('index.html', 'utf8').indexOf('__V__') !== -1, 'the repo copy is not changed');
});

test('design notes, the old game, tests and the server are not published', function () {
  ['number-match.html', 'design-info', 'docs', 'tests', 'server', 'README.md', 'render.yaml', 'package.json', 'tools/sim.js', 'tools/build-site.sh'].forEach(function (f) {
    assert.strictEqual(fs.existsSync(path.join(out, f)), false, f + ' should not be published');
  });
});

test('every script in the repo root that the page loads is in the build list', function () {
  var html = fs.readFileSync('index.html', 'utf8');
  var script = fs.readFileSync('tools/build-site.sh', 'utf8');
  (html.match(/src="([^"?]+)\?v=__V__"/g) || []).forEach(function (m) {
    var f = m.slice(5, m.indexOf('?'));
    assert.ok(script.indexOf(' ' + f) !== -1 || script.indexOf('"' + f) !== -1, f + ' is loaded by index.html but not copied');
  });
});

test('Render builds the static site with the script and publishes public/', function () {
  var yaml = fs.readFileSync('render.yaml', 'utf8');
  assert.ok(yaml.indexOf('buildCommand: sh tools/build-site.sh') !== -1);
  assert.ok(yaml.indexOf('staticPublishPath: public') !== -1);
  assert.ok(fs.readFileSync('.gitignore', 'utf8').indexOf('public/') !== -1);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
