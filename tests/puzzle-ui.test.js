/* Run with:  node tests/puzzle-ui.test.js */
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
var app = fs.readFileSync('app.js', 'utf8');

test('the beatability label is gone', function () {
  assert.ok(html.indexOf('id="beatability"') === -1);
  assert.ok(html.indexOf('Beatable') === -1);
  assert.ok(html.indexOf('Not beatable') === -1);
  assert.ok(app.indexOf('beatability') === -1);
  assert.ok(css.indexOf('.beatability') === -1);
});

test('the puzzle code sits under the board and can be entered in settings', function () {
  assert.ok(html.indexOf('id="puzzleCode"') !== -1);
  assert.ok(html.indexOf('id="puzzleInput"') !== -1);
  assert.ok(html.indexOf('id="puzzleForm"') !== -1);
  assert.ok(app.indexOf('formatPuzzle') !== -1);
  assert.ok(app.indexOf('dealPuzzle') !== -1);
  assert.ok(app.indexOf('parsePuzzle') !== -1);
});

test('the title turns red only when the board is not beatable', function () {
  assert.ok(css.indexOf('h1.is-stuck') !== -1);
  assert.ok(css.indexOf('var(--strike)') !== -1);
  assert.ok(app.indexOf('is-stuck') !== -1);
  assert.ok(app.indexOf('isBeatable') !== -1);
});

test('under par is green and a dead board turns the tally red', function () {
  assert.ok(css.indexOf('.subline.is-under') !== -1);
  assert.ok(css.indexOf('.stat.is-stuck') !== -1);
  assert.ok(css.indexOf('var(--h2i)') !== -1);
  assert.ok(app.indexOf('is-under') !== -1);
  assert.ok(app.indexOf('paintStanding') !== -1);
});

test('a wrap match follows the row and a short code can be entered', function () {
  assert.ok(app.indexOf("ev.kind === 'wrap'") !== -1);
  assert.ok(app.indexOf('wrapStroke') !== -1);
  assert.ok(html.indexOf('placeholder="xy7-fg9"') !== -1);
  assert.ok(app.indexOf('parseBoardCode') !== -1);
  assert.ok(app.indexOf('saveBoard') !== -1);
});

test('the clear card names the matches and a whole-number par, and Pack sits beside Add', function () {
  assert.ok(app.indexOf('You made ') !== -1);
  assert.ok(app.indexOf(' matches. Par was ') !== -1);
  assert.ok(html.indexOf('id="btnCompact"') !== -1);
  assert.ok(html.indexOf('>Pack<') !== -1);
  assert.ok(html.indexOf('id="btnAdd"') > html.indexOf('id="btnCompact"'));
  assert.ok(app.indexOf('packBoard') !== -1);
  assert.ok(app.indexOf('playPack') !== -1);
  assert.ok(app.indexOf('spawnPackLaser') !== -1);
  assert.ok(app.indexOf('c-pack-hold') !== -1);
  assert.ok(app.indexOf('wrapStroke') !== -1);
  assert.ok(css.indexOf('nmPackOut') !== -1);
  assert.ok(css.indexOf('.c-pack-laser .zap { stroke: var(--h3i);') !== -1);
  assert.ok(css.indexOf('minmax(0, 1fr) auto minmax(0, 1fr)') !== -1);
  assert.ok(css.indexOf('.stat-best { justify-self: center;') !== -1);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
