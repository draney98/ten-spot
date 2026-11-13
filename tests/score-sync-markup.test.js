/* Run with:  node tests/score-sync-markup.test.js */
'use strict';
var assert = require('assert');
var fs = require('fs');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + e.message); }
}

var html = fs.readFileSync('index.html', 'utf8');
var css = fs.readFileSync('styles.css', 'utf8');
// The page code: app.js and the helpers split out of it (Nov 12).
var app = ['app.js', 'storage.js', 'sound.js', 'art.js'].map(function (f) { return fs.readFileSync(f, 'utf8'); }).join('\n');

test('the page loads the score client and points it at the score service', function () {
  assert.ok(html.indexOf('scores-client.js') !== -1);
  assert.ok(html.indexOf('<script src="config.js?v=__V__"></script>') !== -1);
  assert.ok(html.indexOf('config.js') < html.indexOf('app.js'), 'config.js loads before app.js');
  var config = fs.readFileSync('config.js', 'utf8');
  assert.ok(config.indexOf("scoresApi: 'https://ten-spot-scores.onrender.com'") !== -1);
  var clientAt = html.indexOf('scores-client.js');
  var appAt = html.indexOf('app.js');
  assert.ok(clientAt !== -1 && clientAt < appAt);
});

test('settings has a score code group and the scoreboard still has Best', function () {
  assert.ok(html.indexOf('id="scoreCode"') !== -1);
  assert.ok(html.indexOf('id="btnScoreCreate"') !== -1);
  assert.ok(html.indexOf('id="btnScoreCopy"') !== -1);
  assert.ok(html.indexOf('id="btnScoreForget"') !== -1);
  assert.ok(html.indexOf('id="scoreCodeInput"') !== -1);
  assert.ok(html.indexOf('id="scoreSyncError"') !== -1);
  assert.ok(html.indexOf('id="best"') !== -1);
});

test('styles keep the score code readable on the paper theme', function () {
  assert.ok(css.indexOf('.score-code') !== -1);
  assert.ok(css.indexOf('.score-sync-row') !== -1);
});

test('saveBestIfHigher still writes localStorage and app.js calls putBests', function () {
  assert.ok(app.indexOf("'numbermatch.best3.'") !== -1);   // bests started fresh with the ramp
  assert.ok(app.indexOf('numbermatch.player') !== -1);
  assert.ok(app.indexOf('putBests') !== -1);
  assert.ok(app.indexOf('mergeBests') !== -1);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
