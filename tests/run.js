/* Runs every tests/*.test.js file and prints one line for each.
     node tests/run.js        (or: npm test)
   Exits with 1 if any file has a failure, so it can be used as a check before a push. */
'use strict';
var fs = require('fs');
var path = require('path');
var spawnSync = require('child_process').spawnSync;

var dir = __dirname;
var files = fs.readdirSync(dir).filter(function (f) { return /\.test\.js$/.test(f); }).sort();
var bad = 0;
files.forEach(function (f) {
  var r = spawnSync(process.execPath, [path.join(dir, f)], { cwd: path.join(dir, '..'), encoding: 'utf8' });
  var lines = String(r.stdout || '').trim().split('\n');
  var last = lines[lines.length - 1] || '(no output)';
  var ok = r.status === 0;
  if (!ok) bad++;
  console.log((ok ? 'ok    ' : 'FAIL  ') + f + '  ' + last);
  if (!ok) lines.filter(function (l) { return /^FAIL/.test(l); }).forEach(function (l) { console.log('        ' + l); });
});
console.log(bad ? '\n' + bad + ' of ' + files.length + ' test files failed.' : '\nAll ' + files.length + ' test files passed.');
process.exit(bad ? 1 : 0);
