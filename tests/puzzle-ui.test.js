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
// The page code: app.js and the helpers split out of it (Nov 12).
var app = ['app.js', 'storage.js', 'sound.js', 'art.js'].map(function (f) { return fs.readFileSync(f, 'utf8'); }).join('\n');

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
  assert.ok(css.indexOf('h1.is-under') !== -1);
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
  assert.ok(app.indexOf(' clear!') !== -1);
  assert.ok(app.indexOf(' under par.') !== -1);
  assert.ok(app.indexOf(' over par.') !== -1);
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
  assert.ok(css.indexOf('grid-template-columns: 1fr 1fr;') !== -1);
  assert.ok(css.indexOf('.stat-best { align-items: flex-end; text-align: right;') !== -1);
  assert.ok(html.indexOf('>Cleared<') === -1);
  assert.ok(html.indexOf('id="pct"') === -1);
  assert.ok(app.indexOf('is-passed') !== -1);
  assert.ok(css.indexOf('.stat-best.is-passed') !== -1);
  assert.ok(css.indexOf('-webkit-touch-callout: none') !== -1);
  assert.ok(app.indexOf("'paste'") !== -1);
});

test('sound is a quiet tick and starts off', function () {
  assert.ok(html.indexOf('aria-label="Sound"') !== -1);
  assert.ok(html.indexOf('data-sound="off"') !== -1);
  assert.ok(html.indexOf('data-sound="on"') !== -1);
  assert.ok(app.indexOf("store.get(KEY.sound) === 'on'") !== -1);
  assert.ok(app.indexOf("play('click')") !== -1);
  assert.ok(app.indexOf("play('bad')") !== -1);
  assert.ok(app.indexOf("'clear'") !== -1);
  assert.ok(app.indexOf("'row'") !== -1);
  assert.ok(app.indexOf("'match'") !== -1);
});

test('FIX2 selection is cleared the moment it appears', function () {
  assert.ok(app.indexOf("'selectionchange'") !== -1);
  assert.ok(app.indexOf('removeAllRanges') !== -1);
  assert.ok(app.indexOf("'dblclick'") !== -1);
});

test('FIX3 local files carry a version placeholder', function () {
  ['styles.css', 'scores-client.js', 'game-logic.js', 'app.js'].forEach(function (f) {
    assert.ok(html.indexOf(f + '?v=__V__') !== -1, f + ' should have ?v=__V__');
  });
});

test('top-of-page text is drawn by CSS so it cannot be selected', function () {
  assert.ok(css.indexOf('.drawn::before { content: attr(data-text); }') !== -1);
  ['id="title" class="drawn"', 'id="score" data-text', 'id="best" data-text', 'id="note" data-text', 'id="noteSr"'].forEach(function (bit) {
    assert.ok(html.indexOf(bit) !== -1, bit);
  });
  assert.ok(app.indexOf('function drawText(') !== -1);
});

test('the game is saved on this device and picked up again after a reload', function () {
  assert.ok(html.indexOf('<script src="save.js?v=__V__"></script>\n<script src="app.js?v=__V__"></script>') !== -1);
  assert.ok(html.indexOf('id="saveError"') !== -1);
  assert.ok(app.indexOf("'numbermatch.save1'") !== -1);
  assert.ok(app.indexOf("window.addEventListener('pagehide', saveNow)") !== -1);
  assert.ok(app.indexOf('SV.unpack(store.get(KEY.save))') !== -1);
  assert.ok(app.indexOf('saveSoon();') !== -1);
});

test('the start-of-level note only names a new mascot', function () {
  assert.ok(app.indexOf("'New mascot: ' + MASCOTS[now].name") !== -1);
  assert.ok(app.indexOf("' tiles, ' + L.mascots(") === -1, 'old note removed');
});
test('Add is greyed out before level 30; from 30 too early is a mistake', function () {
  assert.ok(app.indexOf("var addGrey = addWhy === 'tooManyPairs' && !L.toolsAt(s.level).mistake;") !== -1);
  assert.ok(app.indexOf("'Matches are left.'") !== -1);
  assert.ok(css.indexOf('#btnAdd.is-wrong') !== -1);
  assert.ok(html.indexOf('from level 30, pressing it too soon counts as a wrong pick') !== -1);
});
test('game over winds down with a sound before the card', function () {
  assert.ok(app.indexOf('function startWindDown()') !== -1);
  assert.ok(app.indexOf("name === 'end'") !== -1);
  assert.ok(css.indexOf('#board.winding .c') !== -1);
  assert.ok(css.indexOf('.overlay.ov-late') !== -1);
});

test('walls are drawn, named, explained and announced', function () {
  assert.ok(app.indexOf('if (v < 0) return wallHTML(') !== -1);
  ['row', 'col', 'either', 'both'].forEach(function (k) { assert.ok(app.indexOf('    ' + k + ": '<path") !== -1, k + ' wall icon'); });
  assert.ok(app.indexOf('L.wallBonusAt(state)') !== -1);
  assert.ok(app.indexOf("class=\"wall-pts\"") !== -1);
  assert.ok(css.indexOf('.wall-pts') !== -1);
  assert.ok(app.indexOf("'New: a '") !== -1);
  assert.ok(html.indexOf('doubles if the wall lasts to the level') !== -1);
  assert.ok(app.indexOf("return cls + ' c-wall';") !== -1);
  assert.ok(app.indexOf("'Wall gone! +'") !== -1);
  assert.ok(app.indexOf('L.wallCount(lv)') !== -1);
  assert.ok(css.indexOf('.c-wall {') !== -1);
  assert.ok(html.indexOf('brick walls appear') !== -1);
});

test('the ramp on screen: stage in the caption, Start at, milestones, sweep, fresh bests', function () {
  assert.ok(app.indexOf("'Level ' + s.level + ' · ' + stageLabel") !== -1);
  assert.ok(html.indexOf('<h2 class="set-title">Start at</h2>') !== -1);
  assert.ok(app.indexOf('function unlocked(diff)') !== -1);
  assert.ok(app.indexOf("'Wider board: '") !== -1);
  assert.ok(app.indexOf("' reached!'") !== -1);
  assert.ok(app.indexOf('function trySweep(delay)') !== -1);
  assert.ok(app.indexOf("'Finish the board?'") !== -1);
  assert.ok(app.indexOf('L.sweepOffer(state)') !== -1);
  assert.ok(html.indexOf('the game offers to finish the board for you') !== -1);
  assert.ok(app.indexOf("'numbermatch.best3.'") !== -1);
  assert.ok(app.indexOf("'That board code is from an older version of the game.'") !== -1);
});

test('the Game over card has the run summary, retry and share', function () {
  ['id="endStats"', 'id="btnEndRetry"', 'id="btnEndShare"', 'id="endShare"', 'id="shareText"', 'id="btnShareCopy"'].forEach(function (id) {
    assert.ok(html.indexOf(id) !== -1, id);
  });
  assert.ok(html.indexOf('Try that board again') !== -1);
  assert.ok(css.indexOf('.end-stats') !== -1);
  assert.ok(app.indexOf('retryLevel') !== -1);
  assert.ok(app.indexOf('navigator.share') !== -1);
  assert.ok(app.indexOf("'?board='") !== -1);
  assert.ok(app.indexOf("get('board')") !== -1);
});

test('the guided first level has its pointer, Skip and blue ring', function () {
  ['id="guide"', 'id="guideText"', 'id="guideSkip"'].forEach(function (id) { assert.ok(html.indexOf(id) !== -1, id); });
  assert.ok(css.indexOf('.c-guide') !== -1);
  assert.ok(css.indexOf('#btnAdd.is-guide') !== -1);
  assert.ok(app.indexOf("'numbermatch.guide'") !== -1);
  assert.ok(app.indexOf('function renderGuide()') !== -1);
  assert.ok(app.indexOf('L.guideTarget(s, step)') !== -1);
});

test('the page never writes game fields itself, and Pack does not assume a 9-wide board', function () {
  var writes = app.match(/\bstate\.[a-zA-Z]+ = /g) || [];
  assert.deepStrictEqual(writes.filter(function (w) { return w !== 'state.best = '; }), []);
  var pack = app.slice(app.indexOf('function holdPackRows'), app.indexOf('function playPack') + 6000);
  assert.strictEqual(/[%\/*] 9\b/.test(pack), false);
});

test('the score server address is written only in config.js', function () {
  var tuner = fs.readFileSync('tools/tuner.html', 'utf8');
  [['app.js', app], ['index.html', html], ['tools/tuner.html', tuner], ['scores-client.js', fs.readFileSync('scores-client.js', 'utf8')]].forEach(function (f) {
    assert.strictEqual(f[1].indexOf('onrender.com'), -1, f[0] + ' has the address typed in');
  });
  assert.ok(app.indexOf('window.TENSPOT_CONFIG') !== -1);
  assert.ok(tuner.indexOf('<script src="../config.js"></script>') !== -1);
  assert.ok(app.indexOf('run: state.runId') !== -1, 'run ends carry the run id');
  assert.ok(app.indexOf('{ version: L.RULES_VERSION, run: state.runId }') !== -1, 'bests carry the rules version and run id');
});

test('app.js and game-logic.js parse as scripts', function () {
  new Function(app);
  new Function(fs.readFileSync('game-logic.js', 'utf8'));
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
