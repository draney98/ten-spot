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
  /* A new device opens on the guided first level, never the Daily. Once a test marks the guide done and
     reloads, the game would open on today's Daily, so openPage marks today's Daily played (as the older
     tests expect Solitaire) unless asked for { daily: true }. Seeded after the page has loaded, not by
     an init script: one that touches storage before the page can read it stale across a reload. */
  function seedDailyPlayed(page) {
    return page.evaluate(function () {
      if (localStorage.getItem('numbermatch.daily')) return;
      var day = window.TenSpotDaily.dayOf(Date.now()), book = { results: {} };
      book.results[day] = { boards: [{ adds: 0, par: 0, perfect: true, lost: false }], at: Date.now() };
      localStorage.setItem('numbermatch.daily', JSON.stringify(book));
    });
  }
  async function openPage(url, opts) {
    var context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    var page = await context.newPage();
    // nothing leaves the computer: no score server, no fonts
    await page.route('**/*', function (r) { return r.request().url().startsWith('file:') ? r.continue() : r.abort(); });
    page.on('pageerror', function (e) { errors.push(url + ': ' + e.message); });
    await page.goto(url);
    await page.waitForTimeout(300);
    if (!(opts && opts.daily) && url.indexOf('index.html') >= 0) await seedDailyPlayed(page);
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
  /** Play the current level to the end the plain way: pairs, then Add, tapping Finish when it shows. */
  async function playOut(page) {
    for (var i = 0; i < 60; i++) {
      var s = await state(page);
      if (s.status !== 'playing') return s.status;
      if (await page.isVisible('#btnFinish')) { await page.click('#btnFinish'); await page.waitForTimeout(1100); continue; }
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
    await p.click('button[data-tiles="arcadehd"]');
    assert.strictEqual(await p.getAttribute('button[data-tiles="arcadehd"]', 'aria-pressed'), 'true');
    assert.strictEqual(await p.locator('button.c-tile svg.pixel image').count(), tiles, 'every tile shows its picture');
    await p.evaluate(function () { window.__nm.openSettings(true); });
    await p.click('button[data-tiles="gridiron"]');
    assert.strictEqual(await p.locator('button.c-tile svg.pixel').count(), 0);
    await p.context().close();
  });

  await test('Finish shows only when nothing is left to decide, never as a pop-up, and clears the board', async function () {
    // every mascot twice, each pair side by side: decided, and a clean sweep
    await page.evaluate(function () { window.__nm.load([1, 2, 3, 4, 5, 6], { cols: 5, level: 12, addsLeft: 1 }); window.__nm.openSettings(false); });
    await page.waitForTimeout(150);
    assert.ok(await page.isVisible('#btnFinish'), 'Finish shows');
    assert.ok(!(await page.isVisible('#confirm')), 'no pop-up');
    assert.strictEqual(await page.getAttribute('#btnFinish', 'aria-label'), 'Clean sweep: clear 3 pairs for a +158 bonus');
    // can be cleared, but a wrong pick loses: no Finish
    await page.evaluate(function () { window.__nm.load([1, 1, 2, 2, 6, 4, 5, 5, 6, 3], { cols: 5, level: 12, addsLeft: 0 }); window.__nm.openSettings(false); });
    await page.waitForTimeout(150);
    assert.ok(!(await page.isVisible('#btnFinish')), 'no Finish when the order matters');
    // decided but not a clean sweep (gaps): Finish clears it with no bonus
    await page.evaluate(function () { window.__nm.load([3, 1, 1, 3, 1, 1], { cols: 6, level: 12, addsLeft: 1 }); window.__nm.openSettings(false); });
    await page.waitForTimeout(150);
    assert.strictEqual(await page.textContent('#finishMain'), 'Finish');
    var before = (await state(page)).score;
    await page.click('#btnFinish');
    await page.waitForTimeout(300);
    var s = await state(page);
    assert.strictEqual(s.status, 'clear');
    assert.ok(s.score > before, 'each pair scores');
    assert.ok(/^Finished: 3 pairs, \+/.test(await page.textContent('#noteSr')));
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
    var broken = await built.evaluate(function () {   // every Arcade HD picture loads from the built site
      var urls = [];
      window.TenSpotArt.ARCADE_HD.forEach(function (t) { if (t) urls.push(t.day.img, t.night.img); });
      return Promise.all(urls.map(function (u) {
        return new Promise(function (ok) { var i = new Image(); i.onload = function () { ok(i.naturalWidth === 96 ? null : u + ' is ' + i.naturalWidth + ' wide'); }; i.onerror = function () { ok(u + ' did not load'); }; i.src = u; });
      })).then(function (r) { return r.filter(Boolean); });
    });
    assert.deepStrictEqual(broken, []);
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
      await seedDailyPlayed(p);
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

  await test('the board designer checks the key, deals a Daily board, measures it and saves it', async function () {
    var http = require('http'), scores = require('../server/scores.js'), api = require('../server/http.js');
    var TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };
    var KEY = 'browser-test-admin-key-0123456789';
    var web = http.createServer(function (q, r) {
      var f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
      if (f.indexOf(ROOT) !== 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    });
    await new Promise(function (ok) { web.listen(0, '127.0.0.1', ok); });
    var site = 'http://127.0.0.1:' + web.address().port;
    var srv = api.createScoresServer({ db: scores.openScores(':memory:'), origin: site, adminKey: KEY });
    await new Promise(function (ok) { srv.listen(0, '127.0.0.1', ok); });
    var apiUrl = 'http://127.0.0.1:' + srv.address().port;
    var context = await browser.newContext({ viewport: { width: 1000, height: 1000 } });
    var p = await context.newPage();
    p.on('pageerror', function (e) { errors.push('designer.html: ' + e.message); });
    await p.goto(site + '/tools/designer.html?api=' + apiUrl);
    await p.fill('#key', KEY);
    await p.click('#checkKey');
    await p.waitForFunction(function () { return /works|Not accepted/.test(document.getElementById('keyMsg').textContent); });
    assert.ok(/works/.test(await p.textContent('#keyMsg')));
    await p.selectOption('#dailyN', '3');
    await p.click('#deal');
    assert.strictEqual(await p.locator('#board .cell').count(), 49, 'a 7 x 7 board');
    assert.strictEqual(await p.locator('#board .cell.empty').count(), 1, 'with an empty centre');
    await p.selectOption('#plays', '20');
    await p.click('#measure');
    await p.waitForFunction(function () { return !document.getElementById('measureTable').hidden; });
    assert.ok(/Par \d+ Adds?\./.test(await p.textContent('#measureMsg')));
    await p.fill('#name', 'Browser test');
    await p.click('#save');
    await p.waitForFunction(function () { return /Saved|Not saved/.test(document.getElementById('saveMsg').textContent); });
    assert.ok(/^Saved to daily\/\d{4}-\d{2}-\d{2}\/3\.$/.test(await p.textContent('#saveMsg')), await p.textContent('#saveMsg'));
    var date = await p.inputValue('#date');
    var day = await new Promise(function (ok) { http.get(apiUrl + '/v1/daily/' + date, function (r) { var t = ''; r.on('data', function (c) { t += c; }); r.on('end', function () { ok(JSON.parse(t)); }); }); });
    assert.strictEqual(day.boards[2].name, 'Browser test');
    assert.ok(day.boards[2].par >= 0);
    await context.close();
    srv.close(); web.close();
  });

  await test('the tile sheet tool makes a 4 x 4 sheet and cuts it back into the same 16 tiles', async function () {
    // pictures read into a canvas need a real web address (a page opened from a file can't export them)
    var http = require('http'), TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };
    var web = http.createServer(function (q, r) {
      var f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
      if (f.indexOf(ROOT) !== 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    });
    await new Promise(function (ok) { web.listen(0, '127.0.0.1', ok); });
    var context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    var p = await context.newPage();
    p.on('pageerror', function (e) { errors.push('tiles.html: ' + e.message); });
    await p.goto('http://127.0.0.1:' + web.address().port + '/tools/tiles.html');
    var r = await p.evaluate(async function () {
      document.getElementById('set').value = document.getElementById('target').value = 'arcadehd';
      var cv = await window.__tiles.makeSheet();
      var blob = await new Promise(function (ok) { cv.toBlob(ok, 'image/png'); });
      await window.__tiles.useFile(new File([blob], 'sheet.png', { type: 'image/png' }));
      var ART = window.TenSpotArt, out = window.__tiles.results(), worst = 0, problems = [];
      for (var k = 0; k < out.length; k++) {
        var t = out[k], m = ART.SETS.arcadehd.list.findIndex(function (x) { return x && x.name === t.name; });
        var img = await new Promise(function (ok) { var i = new Image(); i.onload = function () { ok(i); }; i.src = '../' + ART.SETS.arcadehd.list[m][t.solid ? 'night' : 'day'].img; });
        var a = document.createElement('canvas'); a.width = a.height = 96; a.getContext('2d').drawImage(img, 0, 0);
        var A = a.getContext('2d').getImageData(0, 0, 96, 96).data, B = t.canvas.getContext('2d').getImageData(0, 0, 96, 96).data, d = 0;
        for (var i = 0; i < A.length; i += 4) d += (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])) * A[i + 3] / 255;
        worst = Math.max(worst, d / (A.length / 4) / 3);
        if (!t.solid && B[3] !== 0) problems.push(t.name + ' day corner is not see-through');
        if (t.solid && B[3] !== 255) problems.push(t.name + ' night corner is not solid');
      }
      var zip = await window.__tiles.zipResults();
      var names = window.TenSpotTiles.unzip(zip).map(function (f) { return f.name; }).sort();
      return { size: [cv.width, cv.height], tiles: out.length, worst: worst, problems: problems, names: names };
    });
    await context.close();
    web.close();
    assert.deepStrictEqual(r.size, [1776, 1776]);
    assert.strictEqual(r.tiles, 16);
    assert.deepStrictEqual(r.problems, []);
    assert.ok(r.worst < 2, 'tiles come back as they went in (average difference ' + r.worst.toFixed(2) + ' of 255)');
    assert.deepStrictEqual(r.names, ['bomb', 'clover', 'flame', 'gem', 'heart', 'potion', 'star', 'sword'].reduce(function (all, n) {
      return all.concat(['art/arcade-hd/' + n + '-day.png', 'art/arcade-hd/' + n + '-night.png']);
    }, []).sort());
  });

  await test('Daily: a new day opens on three zoom-out boards, and the result is a share grid', async function () {
    var p = await openPage(game, { daily: true });
    await p.evaluate(function () { localStorage.setItem('numbermatch.guide', 'done'); localStorage.setItem('numbermatch.reached', '12'); });
    var solo = await state(p);
    await p.reload();
    // no score server here: the boards are dealt from the date once the request fails
    await p.waitForFunction(function () { return window.__nm.mode() === 'daily'; }, null, { timeout: 6000 });
    await p.waitForTimeout(300);
    assert.ok(await p.isHidden('#home'));
    assert.ok(await p.evaluate(function () { return document.getElementById('btnNew').hidden; }), 'no New game in the Daily');
    assert.ok(/^Daily \d+ · board 1 of 3 · par /.test(await p.getAttribute('#captionText', 'data-text')));
    var sizes = [];
    for (var n = 1; n <= 3; n++) {
      var s = await state(p);
      sizes.push(s.cols);
      assert.strictEqual(s.cells[(s.cells.length - 1) / 2].v, 0, 'the centre is empty');
      var status = await playOut(p);
      assert.ok(status === 'clear' || status === 'lose');
      await p.waitForSelector('#overlay:not([hidden])');
      assert.ok(new RegExp('board ' + n + ' of 3').test(await p.textContent('#endKicker')));
      assert.strictEqual(await p.textContent('#btnEndPrimary'), n < 3 ? 'Next board' : 'See today’s result');
      await p.click('#btnEndPrimary');
      await p.waitForTimeout(400);
    }
    assert.deepStrictEqual(sizes, [3, 5, 7], 'each board zooms out');
    assert.strictEqual(await p.textContent('#endTitle'), 'Today’s boards done');
    assert.ok(/^⛳ /.test(await p.textContent('#endNumber')));
    var grid = (await p.textContent('#dailyGrid')).split('\n');
    assert.strictEqual(grid.length, 3);
    grid.forEach(function (r) { assert.ok(/^([⬜🟩🟥]+( ⭐)?|✖)$/u.test(r), r); });
    assert.strictEqual(await p.locator('#dailyCal .cal-played').count(), 1);
    var book = JSON.parse(await p.evaluate(function () { return localStorage.getItem('numbermatch.daily'); }));
    assert.strictEqual(Object.keys(book.results).length, 1, 'today is recorded');
    // Share: no clipboard in a test browser, so the text shows in a box to copy
    await p.click('#btnEndPrimary');
    await p.waitForTimeout(300);
    var shared = await p.evaluate(function () { return document.getElementById('dailyShareText').value; });
    assert.ok(/^ten-spot Daily \d+ ⛳ (E|[+−]\d+)\n/.test(shared), shared);
    assert.strictEqual(shared.split('\n').slice(1, 4).join('\n'), grid.join('\n'));
    // a reload comes back to today's result; Solitaire is where it was left
    await p.reload();
    await p.waitForTimeout(400);
    assert.strictEqual(await p.evaluate(function () { return window.__nm.mode(); }), 'daily');
    assert.strictEqual(await p.textContent('#endTitle'), 'Today’s boards done');
    await p.click('#btnEndSolo');
    await p.waitForTimeout(300);
    var back = await state(p);
    assert.strictEqual(back.runId, solo.runId, 'the same Solitaire game');
    assert.strictEqual(back.level, solo.level);
    assert.ok(!(await p.evaluate(function () { return document.getElementById('btnNew').hidden; })), 'New game is back in the menu');
    // a practice run never changes the result
    await p.click('#btnSettings');   // the ☰ menu
    await p.click('#btnHome');
    assert.ok(/^⛳ /.test(await p.textContent('#homeDailyLine')));
    await p.click('#homeDaily');
    await p.waitForTimeout(400);
    await p.click('#btnEndAgain');
    await p.waitForTimeout(300);
    assert.ok(/practice/.test(await p.getAttribute('#captionText', 'data-text')));
    assert.ok(await p.isHidden('#overlay'));
    var book2 = await p.evaluate(function () { return localStorage.getItem('numbermatch.daily'); });
    assert.strictEqual(book2, JSON.stringify(book));
    await p.context().close();
  });

  await test('Daily: the three boards share 3 hints, 2 undos and 1 pack; Solitaire keeps its own', async function () {
    var p = await openPage(game);
    var soloHints = (await state(p)).hintsLeft;
    await p.evaluate(function () {
      var L = window.NumberMatchLogic;
      var boards = L.DAILY_SHAPES.map(function (h) {
        var n = h.cols * h.rows, cells = []; for (var i = 0; i < n; i++) cells.push(i === (n - 1) / 2 ? 0 : 1);
        return { v: 1, level: h.level, cols: h.cols, cells: cells, adds: h.adds, par: 1 };
      });
      window.__nm.startDaily(boards);
    });
    await p.waitForTimeout(300);
    var s = await state(p);
    assert.deepStrictEqual([s.hintsLeft, s.undosLeft, s.compactsLeft], [3, 2, 1]);
    await p.click('#btnHint');
    await p.waitForTimeout(200);
    assert.strictEqual((await state(p)).hintsLeft, 2);
    await playOut(p);
    await p.click('#btnEndPrimary');
    await p.waitForTimeout(300);
    s = await state(p);
    assert.strictEqual(s.cols, 5);
    assert.strictEqual(s.hintsLeft, 2, 'the hint used on board 1 is gone on board 2');
    assert.strictEqual(s.addsLeft, 2, 'Adds are per board');
    await p.click('#btnSettings');   // the ☰ menu
    await p.click('#btnHome');
    await p.click('#homeSolo');
    await p.waitForTimeout(300);
    assert.strictEqual((await state(p)).hintsLeft, soloHints);
    await p.context().close();
  });

  await test('one line on top; the ☰ menu has the games, New game, High scores and the board code', async function () {
    var p = await openPage(game, { daily: true });
    // a first visit: the guide's pointer takes the status line's place, under the board
    assert.ok(await p.isVisible('#guide'));
    assert.ok(await p.isHidden('#note'));
    var g = await p.locator('#guide').boundingBox(), b = await p.locator('#board').boundingBox();
    assert.ok(g.y > b.y + b.height - 1, 'the guide sits under the board');
    await p.click('#guideSkip');
    assert.ok(await p.isVisible('#note'));
    // the header is one line: name, score, menu
    var h = await p.locator('header.a-head').boundingBox();
    assert.ok(h.height <= 56, 'one line: ' + h.height);
    assert.ok(await p.isHidden('#btnNew'), 'New game is in the menu');
    await p.click('#btnSettings');
    assert.ok(await p.isVisible('#btnNew'));
    assert.ok(await p.isVisible('#btnScores'));
    assert.ok(/^[a-z0-9]+-[a-z0-9]+/i.test(await p.textContent('#boardCodeNow')), 'the board code is in the menu');
    await p.click('#btnScores');
    assert.ok(await p.isVisible('#scores'));
    assert.ok(await p.isHidden('#settings'), 'the menu closes behind it');
    var rows = await p.locator('#scoresSolo tr').allTextContents();
    assert.strictEqual(rows.length, 4);
    assert.ok(/^Easy/.test(rows[0]) && /^Highest level1$/.test(rows[3]), rows.join('|'));
    assert.ok(/No Daily played yet/.test(await p.textContent('#scoresDailyLine')));
    await p.click('#scoresClose');
    assert.ok(await p.isHidden('#scores'));
    // the score turns gold once it passes your best
    await p.evaluate(function () { var s = window.__nm.state(); s.best[s.diff] = 0; });
    var pair = await p.evaluate(function () { var L = window.NumberMatchLogic, s = window.__nm.state(); var q = L.findPair(s.cells, true, s.rules, true, s.cols); return [s.cells[q[0]].id, s.cells[q[1]].id]; });
    await p.click('button.c[data-id="' + pair[0] + '"]');
    await p.click('button.c[data-id="' + pair[1] + '"]');
    await p.waitForTimeout(300);
    assert.ok(await p.evaluate(function () { return document.getElementById('scoreStat').classList.contains('is-passed'); }), 'gold past the best');
    await p.context().close();
  });

  await test('no page threw an error', async function () {
    assert.deepStrictEqual(errors, []);
  });

  await browser.close();
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.log('FAIL  harness\n      ' + e.stack); process.exit(1); });
