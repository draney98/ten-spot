/* Run with:  node tests/browser.test.js
   Opens the real game in a headless browser and presses the buttons: the tests that would have
   caught a page that doesn't load. Needs Playwright with its Chromium. Where Playwright is not
   installed (for example on a computer that only runs the other tests), it says SKIP and passes. */
'use strict';
var assert = require('assert');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawnSync = require('child_process').spawnSync;

var playwright = null;
try { playwright = require('playwright'); } catch (e) { playwright = null; }
if (!playwright) {
  console.log('SKIP  Playwright is not installed here; these tests run where it is');
  console.log('0 passed, 0 failed');
  process.exit(0);
}

var ROOT = path.join(__dirname, '..');
var passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); }
}

(async function main() {
  var browser;
  try { browser = await playwright.chromium.launch(); }
  catch (e) {
    console.log('SKIP  Playwright is installed but its browser is not (' + e.message.split('\n')[0] + ')');
    console.log('0 passed, 0 failed');
    process.exit(0);
  }
  var errors = [];
  async function openPage(url) {
    var context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    var page = await context.newPage();
    // nothing leaves the computer: no score server, no fonts
    await page.route('**/*', function (r) { return r.request().url().startsWith('file:') ? r.continue() : r.abort(); });
    page.on('pageerror', function (e) { errors.push(url + ': ' + e.message); });
    await page.goto(url);
    await page.waitForTimeout(300);
    return page;
  }
  var game = 'file://' + path.join(ROOT, 'index.html');
  function state(page) { return page.evaluate(function () { return window.__nm.state(); }); }
  function pairIds(page) {
    return page.evaluate(function () {
      var L = window.NumberMatchLogic, s = window.__nm.state();
      var p = L.findPair(s.cells, true, s.rules, true, s.cols);
      return p ? [s.cells[p[0]].id, s.cells[p[1]].id] : null;
    });
  }
  async function tap(page, id) { await page.click('button.c[data-id="' + id + '"]'); }
  async function matchOne(page) {
    var ids = await pairIds(page);
    await tap(page, ids[0]); await tap(page, ids[1]);
    await page.waitForTimeout(1000);
  }
  /** Play the current level to the end the plain way: pairs, then Add, saying yes to a sweep. */
  async function playOut(page) {
    for (var i = 0; i < 60; i++) {
      var s = await state(page);
      if (s.status !== 'playing') return s.status;
      if (await page.isVisible('#confirm')) { await page.click('#confirmYes'); await page.waitForTimeout(1100); continue; }
      var ids = await pairIds(page);
      if (ids) { await tap(page, ids[0]); await tap(page, ids[1]); await page.waitForTimeout(950); continue; }
      await page.click('#btnAdd'); await page.waitForTimeout(1100);
    }
    return (await state(page)).status;
  }

  var page = await openPage(game);

  await test('a first visit loads a 5 x 5 board of 12 tiles with the first-level pointer', async function () {
    var info = await page.evaluate(function () {
      return { tiles: document.querySelectorAll('button.c-tile').length, drawn: document.querySelectorAll('.c-tile svg.mascot').length,
        guide: !document.getElementById('guide').hidden, rings: document.querySelectorAll('.c-guide').length };
    });
    assert.deepStrictEqual(info, { tiles: 12, drawn: 12, guide: true, rings: 2 });
    var s = await state(page);
    assert.strictEqual(s.level, 1);
    assert.strictEqual(s.cols, 5);
    assert.ok(/^[0-9a-z]{12}$/.test(s.runId));
  });

  await test('tapping the ringed pair clears it and scores', async function () {
    var ring = await page.$$eval('.c-guide', function (els) { return els.map(function (e) { return Number(e.dataset.id); }); });
    await tap(page, ring[0]); await tap(page, ring[1]);
    await page.waitForTimeout(1000);
    var s = await state(page);
    assert.ok(s.score > 0, 'score ' + s.score);
    assert.strictEqual(s.cleared, 2);
  });

  await test('Skip ends the pointers for good', async function () {
    await page.click('#guideSkip');
    assert.strictEqual(await page.isVisible('#guide'), false);
    assert.strictEqual(await page.evaluate(function () { return localStorage.getItem('numbermatch.guide'); }), 'done');
  });

  await test('Hint rings a pair, and Undo takes back a match', async function () {
    await page.click('#btnHint');
    assert.strictEqual(await page.locator('.c-hint').count(), 2);
    var before = await state(page);
    await matchOne(page);
    assert.strictEqual((await state(page)).cleared, before.cleared + 2);
    await page.click('#btnUndo');
    await page.waitForTimeout(400);
    assert.strictEqual((await state(page)).cleared, before.cleared);
  });

  await test('level 1 can be played to the end, and Next level carries the score on', async function () {
    assert.strictEqual(await playOut(page), 'clear');
    assert.ok(await page.isVisible('#btnEndPrimary'));
    var s1 = await state(page);
    await page.click('#btnEndPrimary');
    await page.waitForTimeout(600);
    var s2 = await state(page);
    assert.strictEqual(s2.level, 2);
    assert.strictEqual(s2.status, 'playing');
    assert.strictEqual(s2.score, s1.score);   // the level bonus is already in the score at a clear
    assert.strictEqual(s2.runId, s1.runId);
  });

  await test('a reload picks up the same game', async function () {
    await matchOne(page);
    var before = await state(page);
    await page.reload();
    await page.waitForTimeout(500);
    var after = await state(page);
    assert.strictEqual(after.level, before.level);
    assert.strictEqual(after.score, before.score);
    assert.strictEqual(after.cleared, before.cleared);
    assert.strictEqual(after.runId, before.runId);
  });

  await test('a lost board shows the run summary, and Try that board again deals it again', async function () {
    // one pair, nothing else to match, no adds and no packs: matching it loses the level
    await page.evaluate(function () { window.__nm.load([1, 1, 3, 5, 7], { addsLeft: 0, compactsLeft: 0, cols: 5 }); });
    await page.waitForTimeout(200);
    await tap(page, 1); await tap(page, 2);
    await page.waitForTimeout(2600);   // the game-over wind-down
    assert.strictEqual((await state(page)).status, 'lose');
    assert.ok(await page.isVisible('#endStats'));
    var rows = await page.$$eval('#endStats dt', function (els) { return els.map(function (e) { return e.textContent; }); });
    assert.ok(rows.indexOf('Best streak') !== -1 && rows.indexOf('Reached') !== -1, rows.join(', '));
    assert.ok(await page.isVisible('#btnEndRetry'));
    assert.ok(await page.isVisible('#btnEndShare'));
    await page.click('#btnEndRetry');
    await page.waitForTimeout(400);
    var s = await state(page);
    assert.strictEqual(s.status, 'playing');
    assert.strictEqual(s.run.retries, 1);
  });

  await test('Pack slides tiles together on a 5-wide board', async function () {
    await page.evaluate(function () {
      window.__nm.load([1, 3, 5, 7, 9, 3, 1, 9, 7, 5, 11, 1, 3, 5, 7], { compactsLeft: 2, cols: 5, level: 12 });   // Pack opens at level 10
      var s = window.__nm.state();
      [1, 3, 6, 8, 12].forEach(function (i) { s.cells[i].done = true; });
      window.__nm.openSettings(false);   // draws the board again with its gaps
    });
    await page.click('#btnCompact');
    await page.waitForTimeout(2500);
    var s = await state(page);
    assert.strictEqual(s.cells.filter(function (c) { return c.done; }).length, 0, 'no gaps left');
    assert.strictEqual(s.compactsLeft, 1);
    assert.strictEqual(await page.locator('.c-pack-hold').count(), 0, 'the space held open during the slide is gone');
  });

  await test('Appearance › Pixel switches every tile to the pixel set, and is remembered', async function () {
    var p = await openPage(game);
    await p.evaluate(function () { localStorage.setItem('numbermatch.guide', 'done'); window.__nm.openSettings(true); });
    await p.click('button[data-tiles="pixel"]');
    assert.strictEqual(await p.getAttribute('button[data-tiles="pixel"]', 'aria-pressed'), 'true');
    var tiles = await p.locator('button.c-tile').count();
    assert.strictEqual(await p.locator('button.c-tile svg.pixel').count(), tiles);
    assert.ok(/, (day|night)$/.test(await p.getAttribute('button.c-tile', 'aria-label')));
    await p.reload();
    await p.waitForTimeout(300);
    assert.strictEqual(await p.locator('button.c-tile svg.pixel').count(), tiles);
    await p.evaluate(function () { window.__nm.openSettings(true); });
    var before = await p.locator('button.c-tile').first().innerHTML();
    await p.click('button[data-tiles="arcade"]');
    assert.strictEqual(await p.getAttribute('button[data-tiles="arcade"]', 'aria-pressed'), 'true');
    assert.strictEqual(await p.getAttribute('button[data-tiles="pixel"]', 'aria-pressed'), 'false');
    assert.strictEqual(await p.locator('button.c-tile svg.pixel').count(), tiles);
    assert.notStrictEqual(await p.locator('button.c-tile').first().innerHTML(), before, 'the drawings changed');
    assert.ok(/^(Heart|Star|Gem|Potion|Clover|Bomb|Sword|Flame), (day|night)/.test(await p.getAttribute('button.c-tile', 'aria-label')));
    await p.reload();
    await p.waitForTimeout(300);
    assert.ok(/^(Heart|Star|Gem|Potion|Clover|Bomb|Sword|Flame), /.test(await p.getAttribute('button.c-tile', 'aria-label')), 'Arcade is remembered');
    await p.evaluate(function () { window.__nm.openSettings(true); });
    await p.click('button[data-tiles="gridiron"]');
    assert.strictEqual(await p.locator('button.c-tile svg.pixel').count(), 0);
    await p.context().close();
  });

  await test('a board code from a shared link deals that board, walls and all', async function () {
    var linked = await openPage(game + '?board=60-1a2b3c4d');
    if (await linked.isVisible('#confirm')) { await linked.click('#confirmYes'); await linked.waitForTimeout(300); }
    var walls = await linked.$$eval('.c-wall', function (els) { return els.map(function (e) { return e.getAttribute('aria-label').split('.')[0]; }); });
    assert.deepStrictEqual(walls.sort(), ['Column wall', 'Row-or-column wall']);
    assert.strictEqual((await state(linked)).level, 60);
    await linked.context().close();
  });

  await test('the tuner page loads with the game\'s numbers', async function () {
    var tuner = await openPage('file://' + path.join(ROOT, 'tools', 'tuner.html'));
    assert.ok((await tuner.locator('#rampTable tr').count()) > 5);
    assert.strictEqual(await tuner.isDisabled('#run'), false);
    await tuner.context().close();
  });

  await test('the built site (what Render publishes) loads and plays', async function () {
    var out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tenspot-browser-')), 'public');
    var r = spawnSync('sh', ['tools/build-site.sh'], { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { OUT: out }) });
    if (r.error) { console.log('      (no sh here; built site not checked)'); return; }
    var built = await openPage('file://' + path.join(out, 'index.html'));
    assert.strictEqual(await built.locator('button.c-tile').count(), 12);
    await built.context().close();
  });

  await test('accounts: make one, add devices with codes, share bests, and the saved game follows', async function () {
    // a real score server in this process, with an empty database; pages opened from files send Origin: null
    var scores = require('../server/scores.js'), api = require('../server/http.js');
    var server = api.createScoresServer({ db: scores.openScores(':memory:'), origin: 'null' });
    await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
    var apiUrl = 'http://127.0.0.1:' + server.address().port;
    async function device() {
      var context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      var p = await context.newPage();
      await p.route('**/*', function (r) {
        var u = r.request().url();
        if (/config\.js/.test(u)) return r.fulfill({ contentType: 'text/javascript', body: "window.TENSPOT_CONFIG = { scoresApi: '" + apiUrl + "' };" });
        return (u.startsWith('file:') || u.startsWith(apiUrl)) ? r.continue() : r.abort();
      });
      p.on('pageerror', function (e) { errors.push('account device: ' + e.message); });
      await p.goto(game);
      await p.evaluate(function () { localStorage.setItem('numbermatch.guide', 'done'); localStorage.setItem('numbermatch.best3.easy', '640'); });
      await p.reload();
      await p.waitForTimeout(300);
      await p.evaluate(function () { window.__nm.openSettings(true); });
      return p;
    }
    try {
      var a = await device();
      await a.fill('#acctName', 'Ana');
      await a.click('#btnAcctCreate');
      await a.waitForSelector('#acctIn:not([hidden])');
      assert.ok(await a.isVisible('#acctRecoveryBox'), 'the recovery link is shown once');
      assert.ok(/[?]recover=/.test(await a.inputValue('#acctRecoveryLink')));
      await a.click('#btnAcctRecoveryDone');
      await a.click('#btnAcctAddDevice');
      await a.waitForSelector('#acctLinkBox:not([hidden])');
      var code = await a.textContent('#acctLinkCode');
      var b = await device();
      await b.evaluate(function () { localStorage.setItem('numbermatch.best3.easy', '90'); });
      await b.fill('#acctLinkInput', code);
      await b.click('#btnAcctLink');
      await b.waitForSelector('#acctIn:not([hidden])');
      assert.strictEqual(await b.getAttribute('#acctNameShown', 'data-text'), 'Ana');
      assert.strictEqual((await state(b)).best.easy, 640, 'the second device gets the account\'s best');
      assert.strictEqual(await b.locator('#acctDevices li').count(), 2);
      // the saved game follows the account: A plays a pair and hides the page; a fresh device C picks it up
      await a.evaluate(function () { window.__nm.openSettings(false); });   // Settings covers the board
      var ids = await pairIds(a);
      await tap(a, ids[0]); await tap(a, ids[1]);
      await a.waitForTimeout(900);
      var aGame = await state(a);
      await a.evaluate(function () { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); });
      await a.waitForTimeout(500);
      await a.evaluate(function () { window.__nm.openSettings(true); });
      await a.click('#btnAcctAddDevice');   // a second code for device C
      await a.waitForTimeout(400);
      var code2 = await a.textContent('#acctLinkCode');
      var c = await device();
      await c.fill('#acctLinkInput', code2);
      await c.click('#btnAcctLink');
      await c.waitForSelector('#acctIn:not([hidden])');
      // signing in takes a few calls (account, bests, then the saved game): wait for the pick-up
      await c.waitForFunction(function () { return /Picked up your game/.test(document.getElementById('note').getAttribute('data-text') || ''); }, null, { timeout: 10000 });
      var cGame = await state(c);
      assert.strictEqual(cGame.runId, aGame.runId, 'C picked up A\'s game');
      assert.strictEqual(cGame.cleared, aGame.cleared);
      await c.context().close();
      await b.click('#btnAcctSignOut');
      await b.click('#confirmYes');
      await b.waitForSelector('#acctOut:not([hidden])');
      assert.strictEqual(await b.evaluate(function () { return localStorage.getItem('numbermatch.account'); }), null);
      await a.context().close(); await b.context().close();
    } finally { server.close(); }
  });

  await test('no page threw an error', async function () {
    assert.deepStrictEqual(errors, []);
  });

  await browser.close();
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.log('FAIL  harness\n      ' + e.stack); process.exit(1); });
