/* =====================================================================
   NUMBER MATCH — USER INTERFACE
   ---------------------------------------------------------------------
   Owns: the DOM, timers, animations, dialogs, what is saved and when.
   Does NOT own game rules — every rule lives in game-logic.js
   (window.NumberMatchLogic, called `L` below).
   Helpers loaded before it: storage.js (browser storage and its keys), sound.js (the ticks),
   art.js (mascot and wall drawings), save.js, scores-client.js, config.js.

   Data flow for every user action:
     1. call an action in L        -> { state, event }
     2. store the new state
     3. react to the event          (start animations, timers, notes)
     4. render()                    (make the DOM match state + ui)
   ===================================================================== */
(function () {
  'use strict';

  var L = window.NumberMatchLogic;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 1. SAFE STORAGE (never let a storage error break the game) ---------- */
  var store = window.TenSpotStorage.store;   // see storage.js
  var KEY = window.TenSpotStorage.KEYS;

  /** Show text that the browser can't select: it is drawn by CSS from data-text.
      label (optional) is what screen readers hear; it defaults to the text. */
  function drawText(el, text, label) {
    if (!el) return;
    text = String(text);
    if (el.getAttribute('data-text') !== text) el.setAttribute('data-text', text);
    el.setAttribute('aria-label', label == null ? text : label);
    if (el.firstChild) el.textContent = '';
  }
  function reached() { return Math.max(1, Number(store.get(KEY.reached)) || 1); }
  function unlocked(diff) { return reached() >= L.startLevel(diff); }
  var SV = window.NumberMatchSave;
  var S = window.NumberMatchScores;
  var SCORES_API = ((window.TENSPOT_CONFIG && window.TENSPOT_CONFIG.scoresApi) || '').replace(/\/$/, '');   // see config.js

  function loadBest() {
    var b = { easy: 0, normal: 0, hard: 0 };
    Object.keys(b).forEach(function (k) {
      var v = Number(store.get(KEY.best + k));
      if (v > 0) b[k] = v;
    });
    return b;
  }
  function saveBestIfHigher() {
    var d = state.diff, v = state.best[d] || 0;
    if (v > (Number(store.get(KEY.best + d)) || 0)) store.set(KEY.best + d, String(v));
    pushBests();
  }
  function scoreError(res) {
    if (!res || res.ok) return '';
    if (res.status === 0) return "Couldn't reach the score server.";
    if (res.status === 404) return 'That code was not found.';
    if (res.status === 400) return 'That code is not valid.';
    return "Couldn't reach the score server.";
  }
  function adoptBests(remote) {
    var merged = S.mergeBests(loadBest(), remote);
    Object.keys(merged).forEach(function (k) {
      if (merged[k] > 0) store.set(KEY.best + k, String(merged[k]));
    });
    state.best = merged;
    render();
  }
  /* Run ends. When a lost game is replaced by a new one, the level it ended on is sent to the
     score server (level, start point, rules version: nothing about the player). If the server
     can't be reached, it waits in storage and is tried again on the next visit. */
  var sendingEnds = false;
  function sendRunEnds() {
    if (!S || !SCORES_API || sendingEnds) return;
    var waiting = store.get(KEY.ends);
    if (!S.readRunEnds(waiting).length) return;
    sendingEnds = true;
    S.flushRunEnds(SCORES_API, waiting, fetch).then(function (left) {
      // anything added while we were sending is at the end of the stored list: keep it
      var now = S.readRunEnds(store.get(KEY.ends)), sent = S.readRunEnds(waiting).length - S.readRunEnds(left).length;
      store.set(KEY.ends, JSON.stringify(now.slice(sent)));
      sendingEnds = false;
    }, function () { sendingEnds = false; });
  }
  /** Call just before the current game is thrown away. Counts it only if it was lost,
      and only if it was a run (not a board played from a puzzle code). */
  function noteRunEnd() {
    if (!S || !state || state.status !== 'lose' || state.fromCode) return;
    if (L.runStats(state).retries > 0) return;   // this run was already counted, at its first loss
    store.set(KEY.ends, S.addRunEnd(store.get(KEY.ends), { start: state.diff, level: state.level, version: L.RULES_VERSION, run: state.runId }));
    sendRunEnds();
  }

  /* Bests go to the account when this device is signed in (account.js), otherwise to the
     device's old score code if it has one, otherwise nowhere (they stay on the device). */
  function pushBests() {
    if (account && account.isSignedIn()) { account.pushBests(loadBest()); return; }
    var code = store.get(KEY.player);
    if (!S || !S.shouldSync(SCORES_API, code)) return;
    // The run id says which run made the best. (If an earlier push failed, a best from an earlier run
    // can go up now and be logged with this run's id. Rare, and only the log is affected.)
    S.putBests(SCORES_API, code, loadBest(), fetch, { version: L.RULES_VERSION, run: state.runId }).then(function (res) {
      if (res.ok) adoptBests(res.body);
    });
  }
  var boardTok = 0;
  function openingCells(s) {
    var src = s.opening || s.cells;
    return src.map(function (c) {
      var tile = { v: c.v };
      if (typeof c.solid === 'boolean') tile.solid = c.solid;
      return tile;
    });
  }
  function publishBoard() {
    var token = ++boardTok;
    ui.boardCode = '';
    if (!S || !SCORES_API || state.seed == null) return;
    S.saveBoard(SCORES_API, {
      diff: state.diff,
      level: state.level,
      mode: 'teams',
      seed: state.seed >>> 0,
      cells: openingCells(state)
    }, fetch).then(function (res) {
      if (token !== boardTok || !res.ok || !res.body || !res.body.code) return;
      ui.boardCode = res.body.code;
      render();
    });
  }
  function pullBests() {
    if (account && account.isSignedIn()) { account.pull(); return; }
    var code = store.get(KEY.player);
    if (!S || !S.shouldSync(SCORES_API, code)) return;
    S.getPlayer(SCORES_API, code, fetch).then(function (res) {
      if (!res.ok) return;
      var merged = S.mergeBests(loadBest(), res.body);
      adoptBests(merged);
      S.putBests(SCORES_API, code, merged, fetch);
    });
  }
  function loadDark() {
    var t = store.get(KEY.theme);
    if (t === 'dark') return true;
    if (t === 'light') return false;
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
  }

  /* ---------- 2. STATE ---------- */
  // Pick up where the player left off: the saved game if there is a good one, else a new board at the last difficulty.
  var restored = SV ? SV.unpack(store.get(KEY.save)) : null;
  var startDiff = store.get(KEY.diff);
  if (['easy', 'normal', 'hard'].indexOf(startDiff) === -1 || !unlocked(startDiff)) startDiff = 'easy';
  var state = restored ? L.withRunId(restored.state)   // a game saved before run ids gets one now
    : L.dealPuzzle({ diff: startDiff, level: L.startLevel(startDiff), best: loadBest(), seed: L.randomSeed(), runId: L.newRunId() });
  if (restored) {   // bests have their own keys; keep whichever is higher
    var storedBest = loadBest();
    state.best = state.best || {};
    ['easy', 'normal', 'hard'].forEach(function (k) {
      state.best[k] = Math.max(state.best[k] || 0, storedBest[k] || 0);
    });
  }
  var saved = restored ? restored.extras : {};
  var account = null;   // the Account group in Settings, made at start-up (see account.js)
  var ui = {                                      // UI-only state
    dark: loadDark(),
    sound: store.get(KEY.sound) === 'on',
    settingsOpen: !!saved.settingsOpen,
    confirm: null, // the open confirmation dialog: { yes: function } or null
    flash: [],     // cell ids playing the match "pop"
    bad: [],       // cell ids playing the "shake"
    hint: [],      // cell ids circled as a hint
    guideIds: [],  // cell ids ringed by the first-level pointer
    born: [],      // cell ids just added (fade-in)
    gain: 0,       // last points earned, shown in the score tag
    streakMult: 0, // multiplier that goes with a positive score tag
    note: typeof saved.note === 'string' ? saved.note : '',      // status line text ('' = default text)
    puzzleError: '',
    boardCode: typeof saved.boardCode === 'string' ? saved.boardCode : '',  // short code from the server; empty until that answer arrives
    saveFailed: false  // true when this browser won't let us save
  };

  /* ---------- 2a. SAVE THE GAME ON THIS DEVICE ----------
     Saved shortly after every render, and at once when the page is hidden or closed. */
  var saveTimer = 0;
  function saveNow() {
    clearTimeout(saveTimer); saveTimer = 0;
    if (!SV) return;
    // Only a game played on this page counts as newer: a board just dealt or reopened, not yet
    // touched, must not hide a newer game saved from another device.
    if (gameSig(state) !== startSig) lastLocalSave = Date.now();
    var ok = store.set(KEY.save, SV.pack(state, { settingsOpen: ui.settingsOpen, boardCode: ui.boardCode, note: ui.note, playedAt: lastLocalSave }));
    store.set(KEY.diff, state.diff);
    if (state.level > reached()) store.set(KEY.reached, String(state.level));
    ui.saveFailed = !ok;
    var el = document.getElementById('saveError');
    if (el) el.hidden = ok;
    serverSaveSoon();
  }
  function saveSoon() {
    if (!saveTimer) saveTimer = setTimeout(saveNow, 300);
  }

  /* ---------- the saved game on the server ----------
     When this device is signed in, the game is also kept on the score server, so it follows the
     player to another device. The device save always comes first; the server copy is sent at most
     every 5 seconds, and straight away when the page is hidden or closed. It keeps only the undo
     steps the level still allows, so it stays small. On start-up and after signing in, a newer
     server copy is picked up, unless this device has already played since it opened. */
  var SERVER_SAVE_GAP = 5000;
  var startSig = gameSig(state);   // the game as this page opened it
  // When this device last played (not just saved): kept in the save's extras as playedAt.
  // A save from before this was added counts from when it was saved.
  var lastLocalSave = !restored ? 0
    : (restored.extras && typeof restored.extras.playedAt === 'number') ? restored.extras.playedAt : restored.savedAt;
  var serverTimer = 0, lastServerPush = 0, lastServerSig = '';
  function gameSig(s) {
    return JSON.stringify([s.runId, s.level, s.moves, s.cleared, s.nextId, s.status, s.score, s.addsLeft, (s.history || []).length]);
  }
  function serverSaveSoon() {
    if (!account || !account.isSignedIn() || serverTimer) return;
    serverTimer = setTimeout(function () { serverTimer = 0; serverSaveNow(false); },
      Math.max(0, SERVER_SAVE_GAP - (Date.now() - lastServerPush)));
  }
  function serverSaveNow(closing) {
    if (!SV || !account || !account.isSignedIn()) return;
    clearTimeout(serverTimer); serverTimer = 0;
    // A game never played on this device (just dealt, or just opened) is not sent: it would
    // otherwise look newer than a game played on another device.
    if (!lastLocalSave) return;
    var sig = gameSig(state);
    if (sig === lastServerSig) return;
    var undos = isFinite(state.undosLeft) ? Math.max(0, Math.min(5, state.undosLeft)) : 5;
    var data = SV.pack(state, { boardCode: ui.boardCode }, { keepHistory: undos });
    lastServerSig = sig;
    lastServerPush = Date.now();
    account.pushSave({ data: data, savedAt: lastLocalSave }, closing);
  }
  function pullServerSave() {
    if (!SV || !account || !account.isSignedIn()) return;
    account.pullSave().then(function (saved) {
      if (!saved || saved.savedAt <= lastLocalSave) return;   // this device's game is as new or newer
      if (gameSig(state) !== startSig) return;                // played here since opening: this game wins
      var r = SV.unpack(saved.data);
      if (!r) return;
      resetAll();
      var best = state.best;
      state = L.withRunId(r.state);
      state.best = S ? S.mergeBests(best, state.best) : best;
      ui.boardCode = (r.extras && r.extras.boardCode) || '';
      ui.note = 'Picked up your game from your other device: level ' + state.level + '.';
      lastLocalSave = saved.savedAt;
      lastServerSig = gameSig(state);
      startSig = lastServerSig;
      scheduleUpcoming();
      if (!ui.boardCode) publishBoard();
      saveNow();
      render();
    });
  }

  /* ---------- 2b. QUIET TICKS (see sound.js) ---------- */
  var sound = window.TenSpotSound.create(function () { return ui.sound; });
  function play(name) { sound.play(name); }
  function setSound(on) {
    var was = ui.sound;
    ui.sound = !!on;
    store.set(KEY.sound, ui.sound ? 'on' : 'off');
    render();
    if (ui.sound && !was) play('click');
  }

  /* ---------- 3. TIMERS ----------
     `tok` is bumped by every action that changes the board. A delayed
     callback that captured an old tok knows it is stale and does nothing. */
  var timers = [], tok = 0, gainTok = 0;   // gainTok: lets a newer score tag outlive an older timer
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function resetAll() {
    timers.forEach(clearTimeout); timers = []; tok++;
    $('fx').innerHTML = '';
    ui.flash = []; ui.bad = []; ui.hint = []; ui.born = []; ui.gain = 0; ui.streakMult = 0; ui.note = '';
    resetBoardNodes();
  }

  /* ---------- 4. TILE ART (see art.js) ---------- */
  var ART = window.TenSpotArt;
  var MASCOTS = ART.MASCOTS, WALL_NAME = ART.WALL_NAME, WALL_RULE = ART.WALL_RULE;
  function wallHTML(kind, bonus) {
    return ART.wallSVG(kind) + '<span class="wall-pts" aria-hidden="true">+' + fmt(bonus) + '</span>';
  }
  function cellInnerHTML(v, bonus) {
    if (v < 0) return wallHTML(L.wallKind({ v: v }), bonus || 0);
    if (v === L.BLANK) return '';   // the blank centre spot of an odd square board
    return ART.mascotSVG(L.mascotOf(v), L.isSolid(v));
  }

  function family(v) { return MASCOTS[L.mascotOf(v)].h; }
  function cellName(v) {
    if (v < 0) { var wk = L.wallKind({ v: v }); return WALL_NAME[wk] + '. ' + WALL_RULE[wk]; }
    if (v === L.BLANK) return 'Empty spot';
    return MASCOTS[L.mascotOf(v)].name + (L.isSolid(v) ? ', solid' : ', outline');
  }

  function cellClass(c) {
    var cls = 'c';
    if (c.v < 0) return cls + ' c-wall';
    if (c.v === L.BLANK) return cls + ' c-blank';
    cls += ' c-tile h' + family(c.v);
    if (c.done) cls += ' c-done';
    if (c.id === state.selected) cls += ' c-sel';
    if (ui.flash.indexOf(c.id) >= 0) cls += ' c-flash';
    if (ui.hint.indexOf(c.id) >= 0) cls += ' c-hint';
    if (ui.guideIds.indexOf(c.id) >= 0 && !c.done && c.id !== state.selected) cls += ' c-guide';
    if (ui.bad.indexOf(c.id) >= 0) cls += ' c-bad';
    if (ui.born.indexOf(c.id) >= 0) cls += ' c-born';
    return cls;
  }

  /* ---------- 6. BOARD SYNC ----------
     IMPORTANT: cell buttons are REUSED, keyed by cell id. Re-creating
     them on every render would restart every CSS animation and make
     the board flicker. Only create, remove or move what changed. */
  var nodes = new Map(); // cell id -> <button>

  function resetBoardNodes() { clearPackMotion(); nodes.clear(); $('grid').innerHTML = ''; }

  function motionOk() {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function clearPackMotion() {
    nodes.forEach(function (el) {
      el.getAnimations().forEach(function (a) { if (!a.animationName) a.cancel(); });
      el.style.transition = '';
      el.style.transform = '';
      el.style.zIndex = '';
    });
    document.querySelectorAll('.c-pack-ghost, .c-pack-laser, .c-pack-hold').forEach(function (el) { el.remove(); });
  }

  function holdPackRows(oldCount) {
    var grid = $('grid');
    var w = state.cols;   // the board is 5 to 9 across
    var oldRows = Math.ceil(oldCount / w);
    var live = state.cells.length;
    if (oldRows <= Math.ceil(live / w)) return;
    var need = oldRows * w - live;
    for (var i = 0; i < need; i++) {
      var hold = document.createElement('div');
      hold.className = 'c c-pack-hold';
      hold.setAttribute('aria-hidden', 'true');
      grid.appendChild(hold);
    }
  }

  /** Wide orange highlighter plus a thin orange beam, drawn while that tile slides. */
  function spawnPackLaser(stroke, delayMs, durationMs) {
    var fx = $('fx');
    var box = fx.getBoundingClientRect();
    var g = document.createElement('div');
    g.className = 'fx-group c-pack-laser';
    var timing = 'animation-delay:' + delayMs + 'ms;animation-duration:' + durationMs + 'ms';
    g.innerHTML = '<svg class="zap-svg" width="' + box.width + '" height="' + box.height + '">' +
      '<path class="zap zap-wide" d="' + stroke + '" pathLength="1" stroke-width="12" style="' + timing + '"/>' +
      '<path class="zap" d="' + stroke + '" pathLength="1" stroke-width="2.5" style="' + timing + '"/>' +
      '</svg>';
    fx.appendChild(g);
    later(function () { g.remove(); }, delayMs + durationMs + 40);
  }

  /** Each live tile slides one cell left into a blank, then the next tile follows.
      A laser traces that tile's path. The old last row stays until the move ends. */
  function playPack(from, oldCount) {
    if (!motionOk()) return;
    var myTok = tok;
    var w = state.cols;   // the board is 5 to 9 across
    var sample = state.cells.length ? nodes.get(state.cells[0].id) : null;
    if (!sample) return;
    var cellW = sample.getBoundingClientRect().width;
    var cellH = sample.getBoundingClientRect().height;
    var finals = {};
    state.cells.forEach(function (c, index) { finals[c.id] = index; });
    var visual = {};
    var occupied = {};
    state.cells.forEach(function (c) {
      var start = from[c.id];
      if (!start) return;
      visual[c.id] = start.index;
      occupied[start.index] = c.id;
    });
    var steps = [];
    var limit = 0;
    for (var id0 in visual) limit += visual[id0] - finals[id0];
    for (var guard = 0; guard < limit; guard++) {
      var mover = null;
      var moverAt = 0;
      for (var id in visual) {
        var at = visual[id];
        if (at <= finals[id] || occupied[at - 1]) continue;
        if (mover === null || at < moverAt) { mover = id; moverAt = at; }
      }
      if (mover === null) break;
      delete occupied[moverAt];
      visual[mover] = moverAt - 1;
      occupied[moverAt - 1] = mover;
      steps.push({ id: mover, index: moverAt - 1 });
    }
    if (!steps.length) return;
    holdPackRows(oldCount);
    var gridBox = $('grid').getBoundingClientRect();
    var fxBox = $('fx').getBoundingClientRect();
    var row0 = sample.getBoundingClientRect();
    var rowY0 = row0.top + row0.height / 2 - fxBox.top;
    function centerOf(el) {
      var r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - fxBox.left, y: r.top + r.height / 2 - fxBox.top };
    }
    function shift(index, finalIndex) {
      var dx = ((index % w) - (finalIndex % w)) * cellW;
      var dy = (Math.floor(index / w) - Math.floor(finalIndex / w)) * cellH;
      return 'translate(' + dx + 'px,' + dy + 'px)';
    }
    var tracks = {};
    var tileOrder = [];
    steps.forEach(function (step) {
      if (!tracks[step.id]) {
        tracks[step.id] = [];
        tileOrder.push(step.id);
      }
      tracks[step.id].push(step.index);
    });
    /* This click only. The first tile and its laser always take PACK_MS.
       Each later tile is faster, but only half as quickly as a 0.7 step
       (the same speedup takes twice as many tiles). Once the next tile
       would pass twenty times the opening speed, the rest are not animated:
       they stay where they were until the last slide ends, then appear in place.
       The next click starts over. */
    var PACK_MS = 360;
    var fastest = PACK_MS / 20;
    var tileDur = {};
    var tileStart = {};
    var clock = 0;
    tileOrder.forEach(function (id, i) {
      var raw = PACK_MS * Math.pow(0.7, i / 2);
      if (raw <= fastest) return;
      tileDur[id] = Math.round(raw);
      tileStart[id] = clock;
      clock += tileDur[id];
    });
    var releaseAt = clock;
    var tail = [];
    Object.keys(tracks).forEach(function (id) {
      var el = nodes.get(Number(id));
      var start = from[id];
      if (!el || !start) return;
      var endIndex = finals[id];
      if (tileDur[id] == null) {
        el.style.zIndex = '3';
        el.style.transform = shift(start.index, endIndex);
        tail.push(el);
        return;
      }
      var fromRow = Math.floor(start.index / w);
      var toRow = Math.floor(endIndex / w);
      var endPt = centerOf(el);
      var startPt = {
        x: endPt.x + ((start.index % w) - (endIndex % w)) * cellW,
        y: endPt.y + (fromRow - toRow) * cellH
      };
      var stroke;
      if (fromRow === toRow) {
        stroke = 'M ' + startPt.x + ' ' + startPt.y + ' L ' + endPt.x + ' ' + endPt.y;
      } else {
        var upper = toRow < fromRow ? endPt : startPt;
        var lower = toRow < fromRow ? startPt : endPt;
        var topRow = Math.min(fromRow, toRow);
        var botRow = Math.max(fromRow, toRow);
        var rowYs = [];
        for (var r = topRow; r <= botRow; r++) rowYs.push(rowY0 + r * cellH);
        stroke = L.wrapStroke(upper, lower, gridBox.left - fxBox.left, gridBox.right - fxBox.left, rowYs);
      }
      var durationMs = tileDur[id];
      spawnPackLaser(stroke, tileStart[id], durationMs);
      var nSteps = tracks[id].length;
      var cursor = start.index;
      var frames = [{ transform: shift(cursor, endIndex), offset: 0 }];
      tracks[id].forEach(function (next, i) {
        // A wrap is one index, but a straight slide would cut across the row.
        // Run out to the right edge, then up into the row above.
        if (cursor % w === 0 && Math.floor(next / w) < Math.floor(cursor / w)) {
          frames.push({ transform: shift(Math.floor(cursor / w) * w + (w - 1), endIndex), offset: (i + 0.5) / nSteps });
        }
        cursor = next;
        frames.push({ transform: shift(cursor, endIndex), offset: (i + 1) / nSteps });
      });
      el.style.zIndex = '3';
      var anim = el.animate(frames, { delay: tileStart[id], duration: durationMs, easing: 'linear', fill: 'both' });
      anim.onfinish = function () {
        anim.cancel();
        if (tok !== myTok) return;
        el.style.zIndex = '';
      };
    });
    later(function () {
      if (tok !== myTok) return;
      tail.forEach(function (el) {
        el.style.transform = '';
        el.style.zIndex = '';
      });
      document.querySelectorAll('.c-pack-hold').forEach(function (el) { el.remove(); });
    }, releaseAt);
  }

  function syncBoard() {
    var grid = $('grid');
    var alive = {};
    state.cells.forEach(function (c) { alive[c.id] = true; });
    nodes.forEach(function (el, id) { if (!alive[id]) { el.remove(); nodes.delete(id); } });

    state.cells.forEach(function (c, i) {
      var el = nodes.get(c.id);
      if (!el) {
        el = document.createElement('button');
        el.type = 'button';
        el.draggable = false;
        el.dataset.id = c.id;
        nodes.set(c.id, el);
      }
      if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
      var wallPts = c.v < 0 ? L.wallBonusAt(state) : 0;   // a wall shows what it would pay right now
      var key = c.v < 0 ? c.v + ':' + wallPts : String(c.v);
      if (el.dataset.key !== key) { el.innerHTML = cellInnerHTML(c.v, wallPts); el.dataset.key = key; }
      var cls = cellClass(c);
      if (el.className !== cls) el.className = cls;
      var name = cellName(c.v, c.solid);
      var label = c.done ? name + ', cleared' : (c.id === state.selected ? name + ', selected' : name);
      if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
    });
  }

  /* ---------- 7. MATCH EFFECTS (measured from the real DOM) ---------- */
  var SPARK_COLOURS = 5;
  function spawnFx(ev) {
    var fx = $('fx');
    var box = fx.getBoundingClientRect();
    var centre = function (el) {
      var r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
    };
    var a = nodes.get(ev.ids[0]), b = nodes.get(ev.ids[1]);
    if (!a || !b) return;
    var A = centre(a), B = centre(b);
    var upper = A.y <= B.y ? { p: A, el: a } : { p: B, el: b };
    var lower = A.y <= B.y ? { p: B, el: b } : { p: A, el: a };
    var stroke = 'M ' + A.x + ' ' + A.y + ' L ' + B.x + ' ' + B.y;
    if (ev.kind === 'wrap') {
      var gridBox = $('grid').getBoundingClientRect();
      var kids = $('grid').children;
      var cols = state.cols || L.colsFor(state.diff);
      var rowOf = function (el) {
        for (var i = 0; i < kids.length; i++) if (kids[i] === el) return Math.floor(i / cols);
        return 0;
      };
      var r0 = rowOf(upper.el), r1 = rowOf(lower.el);
      var rowYs = [];
      for (var r = r0; r <= r1; r++) {
        var cell = kids[r * cols] || upper.el;
        var rect = cell.getBoundingClientRect();
        rowYs.push(rect.top + rect.height / 2 - box.top);
      }
      stroke = L.wrapStroke(upper.p, lower.p, gridBox.left - box.left, gridBox.right - box.left, rowYs);
    }
    var g = document.createElement('div');
    // Score-up clears use blue FX; score-down clears keep the red/pink "pen" look.
    g.className = 'fx-group fx-gain';
    var html = '';

    // 1) row sweeps (behind everything else)
    ev.rowsCleared.forEach(function (r) {
      var first = $('grid').children[r * (state.cols || L.colsFor(state.diff))];
      if (!first) return;
      var rr = first.getBoundingClientRect();
      html += '<div class="sweep" style="top:' + (rr.top - box.top) + 'px;height:' + rr.height + 'px"></div>';
    });
    // 2) pencil line over a highlighter stroke (pathLength=1 lets the dash animation work at any length)
    html += '<svg class="zap-svg" width="' + box.width + '" height="' + box.height + '">' +
      '<path class="zap zap-wide" d="' + stroke + '" pathLength="1" stroke-width="12"/>' +
      '<path class="zap" d="' + stroke + '" pathLength="1" stroke-width="2.5"/>' +
      '</svg>';
    // 3) rings + 4) ten pencil flecks per cell
    [A, B].forEach(function (p, n) {
      html += '<div class="ring" style="left:' + p.x + 'px;top:' + p.y + 'px"></div>';
      for (var k = 0; k < 10; k++) {
        html += '<i class="spark s' + k + ' k' + ((k + n * 2) % SPARK_COLOURS) + '" style="left:' + p.x + 'px;top:' + p.y + 'px"></i>';
      }
    });
    // 5) floating points at the midpoint (blue for gains, red for losses via CSS)
    html += '<span class="floatpt" style="left:' + (A.x + B.x) / 2 + 'px;top:' + (A.y + B.y) / 2 + 'px">' + (ev.gain < 0 ? '−' + Math.abs(ev.gain) : '+' + ev.gain) + '</span>';

    g.innerHTML = html;
    fx.appendChild(g);
    setTimeout(function () { g.remove(); }, 1000); // every effect is finished by then
  }

  /* ---------- 8. RENDER ---------- */
  var fmt = function (n) { return Math.round(n).toLocaleString('en-US'); };
  var lim = function (n) { return isFinite(n) ? String(n) : '∞'; }; // ∞
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // Settings: where a run starts. Normal and Hard unlock once this device has reached them.
  function startInfo() {
    var n = L.startLevel('normal'), h = L.startLevel('hard');
    var lines = ['Every game climbs one ramp: Easy to level ' + (n - 1) + ', Normal from ' + n + ', Hard from ' + h +
      '. Boards grow, mascots and walls arrive, and your buttons shrink as you go.'];
    if (!unlocked('normal')) lines.push('Reach level ' + n + ' to start at Normal.');
    else if (!unlocked('hard')) lines.push('Reach level ' + h + ' to start at Hard.');
    lines.push('Changing where you start begins a new game.');
    return lines.join(' ');
  }

  function setPressed(selector, attr, value) {
    document.querySelectorAll(selector).forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute(attr) === value));
    });
  }

  /* ---------- GUIDED FIRST LEVEL ----------
     On a first visit, level 1 shows one pointer at a time above the board, with a blue ring on
     what it points at. Each pointer goes when the player does what it says. Skip ends them.
     They show once per device (KEY.guide), and never to someone who has been past level 1. */
  var GUIDE_TEXT = {
    match: 'Tap two tiles with the same mascot.',
    twin: 'An outline and its solid twin match too.',
    reach: "A pair doesn't have to touch. It can reach across crossed-out spots, around the end of a row, or on a diagonal.",
    add: 'No pairs left. Press Add: it copies the tiles that are left onto the bottom.'
  };
  var guide = { on: false, step: 0 };
  function guideWanted() {
    return store.get(KEY.guide) !== 'done' && reached() <= 1 &&
      state.level === 1 && state.diff === 'easy' && !state.fromCode;
  }
  function startGuide() { guide.on = guideWanted(); guide.step = 0; }
  function endGuide() { guide.on = false; store.set(KEY.guide, 'done'); }
  /** Called with every match while the pointers are on: move to the next pointer if this match did what the current one said. */
  function guideSaw(ev) {
    if (!guide.on || guide.step >= L.GUIDE_STEPS.length) return;
    if (L.guideDone(L.GUIDE_STEPS[guide.step], ev)) guide.step++;
  }
  function renderGuide() {
    var s = state, box = $('guide'), text = '', ids = [], ringAdd = false;
    if (guide.on && (s.level !== 1 || s.status === 'clear')) endGuide();   // level 1 is behind them
    if (guide.on && s.status === 'playing') {
      if (L.pairsOnBoard(s) === 0 && s.addsLeft > 0) { text = GUIDE_TEXT.add; ringAdd = true; }
      else if (guide.step < L.GUIDE_STEPS.length) {
        var step = L.GUIDE_STEPS[guide.step];
        ids = L.guideTarget(s, step) || [];
        text = GUIDE_TEXT[step] + (ids.length ? ' Try the two with the blue ring.' : '');
      }
    }
    ui.guideIds = ids;
    box.hidden = !text;
    $('btnAdd').classList.toggle('is-guide', ringAdd);
    if (text) {
      drawText($('guideText'), text);
      if ($('guideSr').textContent !== text) $('guideSr').textContent = text;
    }
  }

  function render() {
    var s = state;
    renderGuide();   // first: it decides which tiles get the blue ring
    var stageLabel = L.LEVELS[L.stageOf(s.level)].label;
    var mult = Math.round(L.pointMult(s.level) * 10) / 10;
    var left = L.remaining(s);

    // theme + settings
    document.documentElement.classList.toggle('dark', ui.dark);
    $('btnTheme').setAttribute('aria-pressed', String(ui.dark));
    $('settings').classList.toggle('open', ui.settingsOpen);
    $('btnSettings').setAttribute('aria-expanded', String(ui.settingsOpen));
    if (account) account.render();
    setPressed('[data-diff]', 'data-diff', s.diff);
    document.querySelectorAll('[data-diff]').forEach(function (b) {
      var open = unlocked(b.dataset.diff);
      b.disabled = !open;
      b.title = open ? '' : 'Reach level ' + L.startLevel(b.dataset.diff) + ' first';
    });
    setPressed('[data-theme]', 'data-theme', ui.dark ? 'dark' : 'light');
    setPressed('[data-sound]', 'data-sound', ui.sound ? 'on' : 'off');
    $('diffInfo').textContent = startInfo();
    $('grid').style.setProperty('--cols', String(s.cols || L.colsFor(s.diff)));

    // while settings (or a confirmation) are open, the board and its controls are switched off
    var off = ui.settingsOpen || !!ui.confirm;
    ['board', 'actions', 'note'].forEach(function (id) {
      $(id).inert = off;
      $(id).classList.toggle('is-off', off);
    });

    // header and tally: green while under par, red when the board cannot be finished
    var dead = !L.isBeatable(s);
    var under = !dead && Math.floor(s.cleared / 2) < Math.round(s.par || 0);
    function paintStanding(el) {
      el.classList.toggle('is-stuck', dead);
      el.classList.toggle('is-under', under);
    }
    paintStanding($('title'));
    document.querySelectorAll('.stat:not(.stat-best)').forEach(paintStanding);
    var record = s.best[s.diff] || 0;
    document.querySelector('.stat-best').classList.toggle('is-passed', s.score > record || !!s.newBest);
    var capText = 'Level ' + s.level + ' · ' + stageLabel + ', ×' + mult.toFixed(1) + ', ';
    var capCode = ui.boardCode || L.formatPuzzle({ diff: s.diff, level: s.level, seed: s.seed });
    drawText($('captionText'), capText);
    drawText($('captionCode'), capCode);
    $('captionSr').textContent = capText + 'board ' + capCode;
    $('puzzleError').textContent = ui.puzzleError || '';

    // scoreboard
    drawText($('score'), fmt(s.score), 'Score ' + fmt(s.score));
    drawText($('best'), fmt(s.best[s.diff] || 0), 'Best ' + fmt(s.best[s.diff] || 0));
    var tag = '';
    if (ui.gain < 0) tag = '−' + fmt(Math.abs(ui.gain));
    else if ((s.streak || 0) >= 2) tag = '(' + L.streakMult(s.streak).toFixed(1) + 'x)';
    drawText($('scoreTag'), tag);
    $('scoreTag').hidden = !tag;
    $('scoreTag').classList.toggle('is-loss', ui.gain < 0);
    var pct = s.total ? Math.floor(s.cleared / s.total * 100) : 0;   // floor: 100% only when the board is clear
    $('progressFill').style.width = pct + '%';
    $('progress').setAttribute('aria-valuenow', String(pct));

    // board + status line
    syncBoard();
    var noteText = ui.note || 'Select two tiles with the same mascot.';
    drawText($('note'), noteText, '');
    if ($('noteSr').textContent !== noteText) $('noteSr').textContent = noteText;

    // bottom bar
    $('btnUndo').disabled = !L.canUndo(s);
    $('btnHint').disabled = !L.canHint(s);
    $('btnCompact').disabled = !L.canCompact(s);
    var addWhy = L.addBlock(s);
    // Easy: greyed out until few enough pairs are left. Normal and Hard: it can be pressed, but too early is a mistake.
    var addGrey = addWhy === 'tooManyPairs' && !L.toolsAt(s.level).mistake;
    $('btnAdd').disabled = (addWhy === 'noAdds' || addWhy === 'notPlaying' || addGrey);
    $('btnAdd').classList.toggle('is-blocked', addGrey);
    $('btnAdd').setAttribute('aria-disabled', $('btnAdd').disabled ? 'true' : 'false');
    $('undoCount').textContent = lim(s.undosLeft) + ' left';
    $('hintCount').textContent = lim(s.hintsLeft) + ' left';
    var packLocked = s.level < L.PACK_FROM;
    $('compactCount').textContent = packLocked ? 'at level ' + L.PACK_FROM : lim(s.compactsLeft) + ' left';
    $('btnUndo').setAttribute('aria-label', 'Undo, ' + lim(s.undosLeft) + ' left');
    $('btnHint').setAttribute('aria-label', 'Hint, ' + lim(s.hintsLeft) + ' left');
    $('btnCompact').setAttribute('aria-label', packLocked ? 'Pack, unlocks at level ' + L.PACK_FROM : 'Pack, ' + lim(s.compactsLeft) + ' left');
    $('addMain').textContent = 'Add';
    $('addSub').textContent = (addWhy === 'tooManyPairs')
      ? 'Clear pairs first'
      : s.addsLeft + ' of ' + L.addsFor(s.level) + ' left';

    renderOverlay();
    saveSoon();
  }

  /* Game over winds down: the board dims row by row with a falling four-note sound, then the
     Game over card fades in. Tapping skips to the card. With reduced motion the card shows as before. */
  var lastStatus = state.status;   // a game restored already over does not wind down again
  function startWindDown() {
    play('end');
    if (!motionOk()) return;
    var cols = state.cols || L.colsFor(state.diff);
    var rows = Math.max(1, Math.ceil(state.cells.length / cols));
    var step = Math.min(120, Math.round(900 / rows));
    Array.prototype.forEach.call($('grid').children, function (el, i) {
      el.style.setProperty('--wd', (Math.floor(i / cols) * step) + 'ms');
    });
    $('board').classList.add('winding');
    $('overlay').classList.remove('ov-now');
    $('overlay').classList.add('ov-late');
  }
  function skipWindDown() {
    var ov = $('overlay');
    if (ov.classList.contains('ov-late')) { ov.classList.remove('ov-late'); ov.classList.add('ov-now'); }
  }
  function stopWindDown() {
    $('board').classList.remove('winding');
    $('overlay').classList.remove('ov-late', 'ov-now');
  }

  function renderOverlay() {
    var s = state, ov = $('overlay');
    if (s.status === 'lose' && lastStatus === 'playing') startWindDown();
    if (s.status !== 'lose') stopWindDown();
    lastStatus = s.status;
    $('board').classList.toggle('ended', s.status !== 'playing');
    $('board').classList.toggle('lost', s.status === 'lose');
    if (s.status === 'playing') { ov.hidden = true; ui.shareOpen = false; return; }
    var clear = s.status === 'clear';
    $('endKicker').hidden = clear;
    $('endKicker').textContent = clear ? '' : 'Out of moves on level ' + s.level;
    var stageUp = clear && L.stageOf(s.level + 1) !== L.stageOf(s.level);
    $('endTitle').textContent = !clear ? 'Game over' : stageUp ? L.LEVELS[L.stageOf(s.level + 1)].label + ' reached!' : 'Level ' + s.level + ' clear!';
    $('endNumber').textContent = clear ? '+' + fmt(s.bonus) : fmt(s.final);
    $('endDetail').textContent = clear
      ? clearDetail(s) + (stageUp ? '\nLevel ' + (s.level + 1) + ' starts ' + L.LEVELS[L.stageOf(s.level + 1)].label + '. You can now start a new game there.' : '')
      : 'No adds left and no pairs to clear.';
    $('endBest').hidden = clear;
    $('endBest').textContent = s.newBest ? 'New best score!' : 'Best: ' + fmt(s.best[s.diff] || 0);
    $('btnEndPrimary').textContent = clear ? 'Next level' : 'New game';
    $('btnEndPrimary').classList.toggle('btn-primary', clear);
    $('btnEndRetry').hidden = clear;
    $('btnEndShare').hidden = clear;
    renderRunSummary(s, clear);
    $('btnEndUndo').hidden = !(s.status === 'lose' && L.canUndo(s));
    if (ov.hidden) ov.hidden = false; // un-hiding restarts the fade-in animation
  }

  /* ---------- 9. CONFIRMING ANYTHING THAT RESETS THE BOARD ----------
     New game, a difficulty change, and a tile-style change that switches
     rule set all start over. If a game is under way, ask first. */
  function gameInProgress() {
    var T = L.toolsAt(state.level);
    return state.status === 'playing' &&
      (state.moves > 0 || state.level > L.startLevel(state.diff) || state.score > 0 || (state.penalties || 0) > 0 ||
       (isFinite(T.hints) && state.hintsLeft < T.hints) ||
       (isFinite(T.packs) && state.compactsLeft < T.packs));
  }
  function progressLine() {
    return 'You’re on level ' + state.level + ' with ' + plural(state.score, 'point', 'points') + '.';
  }
  function confirmReset(title, text, yesLabel, action) {
    if (!gameInProgress()) { action(); return; }
    ui.confirm = { yes: action, returnFocus: document.activeElement };
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text + ' ' + progressLine();
    $('confirmYes').textContent = yesLabel;
    $('confirm').hidden = false;
    render();
    $('confirmNo').focus();
  }
  /** Ask before doing something (the same dialog as confirmReset, but always shown). */
  function ask(title, text, yesLabel, action) {
    ui.confirm = { yes: action, returnFocus: document.activeElement };
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmYes').textContent = yesLabel;
    $('confirmNo').textContent = 'Cancel';
    $('confirm').hidden = false;
    render();
    $('confirmNo').focus();
  }
  function closeConfirm(run) {
    var c = ui.confirm;
    if (!c) return;
    ui.confirm = null;
    $('confirm').hidden = true;
    $('confirmNo').textContent = 'Keep playing';   // ask() changes it; the game's own dialogs use this
    if (run) c.yes(); else render();
    if (!run && c.returnFocus && c.returnFocus.focus) c.returnFocus.focus();
  }

  /* ---------- 10. ACTIONS ---------- */
  function onCell(id) {
    var r = L.select(state, id);
    state = r.state;
    var ev = r.event;
    var cell = state.cells[L.indexOfId(state.cells, id)];
    if (!ev && cell && cell.v < 0 && state.status === 'playing') {
      var tapped = L.wallKind(cell);
      ui.note = WALL_NAME[tapped] + ". It can't be cleared. " + WALL_RULE[tapped] + ' Right now it would pay +' + fmt(L.wallBonusAt(state)) + '.';
      play('bad');
      render();
      return;
    }
    if (!ev) return;

    if (ev.type === 'select' || ev.type === 'deselect') {
      ui.hint = []; ui.note = '';
      play('click');
    } else if (ev.type === 'bad') {
      ui.hint = [];
      ui.bad = [ev.id];
      ui.note = ev.reason === 'value' ? 'Pick two tiles with the same mascot.' : 'Not reachable: only crossed-out cells can sit between a pair.';
      if (ev.penalty) {
        var penTok = ++gainTok;
        ui.note += ' −' + ev.penalty + ' points.';
        ui.gain = -ev.penalty;
        ui.streakMult = 0;
        later(function () { if (gainTok === penTok) { ui.gain = 0; render(); } }, 1400);
      }
      later(function () { ui.bad = []; render(); }, 360);
      play('bad');
    } else if (ev.type === 'match') {
      clearPackMotion();
      guideSaw(ev);
      var myTok = ++tok;
      spawnFx(ev);                 // measure BEFORE anything moves
      ui.flash = ev.ids.slice();
      ui.hint = [];
      ui.gain = ev.gain;
      ui.streakMult = ev.streakMult;
      ui.note = matchNote(ev);
      later(function () { ui.flash = []; render(); }, 620);
      // collapse finished rows — but NOT when the level just ended (keep the crossed-out board under the card)
      later(function () { if (tok === myTok && state.status === 'playing') { state = L.compactBoard(state); render(); } }, 900);
      var myGain = ++gainTok;
      later(function () { if (gainTok === myGain) { ui.gain = 0; render(); } }, 1400);
      if (ev.status !== 'playing') saveBestIfHigher();
      play(ev.status === 'clear' ? 'clear' : (ev.rowsCleared.length ? 'row' : 'match'));   // game over plays its own sound
    }
    render();
  }

  function onPack() {
    clearPackMotion();
    var r = L.packBoard(state);
    if (!r.event) return;
    var oldCount = state.cells.length;
    var from = {};
    if (motionOk()) {
      state.cells.forEach(function (c, index) {
        if (!c.done) from[c.id] = { index: index };
      });
    }
    tok++;
    state = r.state;
    ui.hint = []; ui.born = []; ui.gain = 0;
    var left = r.event.compactsLeft;
    ui.note = 'Tiles slid together. ' +
      (left ? (isFinite(left) ? plural(left, 'pack', 'packs') + ' left this level.' : 'Packs are unlimited.') : 'That was your last pack for this level.');
    play('click');
    render();
    playPack(from, oldCount);
    trySweep(700);   // after the tiles have slid into place
  }

  // Clean sweep: right after an Add or a Pack, if the tiles left sit together with no gaps and every
  // one has its match beside it, OFFER to finish the board. Nothing clears unless the player says yes.
  // Saying no leaves the board alone; the offer comes back only after the next Add or Pack.
  function trySweep(delay) {
    later(function () {
      if (state.status !== 'playing' || ui.confirm) return;
      var offer = L.sweepOffer(state);
      if (!offer) return;
      ui.confirm = { yes: doSweep, returnFocus: document.activeElement };
      $('confirmTitle').textContent = 'Finish the board?';
      $('confirmText').textContent = 'Every tile left sits next to its match. Clear all ' + offer.pairs +
        ' pairs at once for a clean sweep bonus of +' + fmt(offer.bonus) + '?';
      $('confirmYes').textContent = 'Finish the board';
      $('confirm').hidden = false;
      ui.note = 'Every tile left sits next to its match.';
      render();
      $('confirmYes').focus();
    }, delay);
  }
  function doSweep() {
    if (state.status !== 'playing') return;
    var r = L.cleanSweep(state);
    if (!r.event) { render(); return; }
    r.event.matches.forEach(spawnFx);   // measure while the tiles are still in place
    state = r.state;
    ui.flash = [].concat.apply([], r.event.pairs);
    ui.hint = []; ui.born = [];
    ui.gain = r.event.gain;
    ui.note = 'Clean sweep! +' + fmt(r.event.gain) + ', including a sweep bonus of +' + fmt(r.event.bonus) + '.';
    later(function () { ui.flash = []; render(); }, 620);
    saveBestIfHigher();
    play('sweep');
    render();
  }

  function onAdd() {
    clearPackMotion();
    var r = L.addNumbers(state);
    if (r.event && r.event.type === 'addBlocked') {
      state = r.state;
      ui.hint = [];
      if (!L.toolsAt(state.level).mistake) {
        ui.note = 'Add unlocks at ' + r.event.max + ' pair' + (r.event.max === 1 ? '' : 's') +
          ' or fewer. ' + r.event.pairs + ' left to find.';
      } else {
        // Normal says how many matches are left; Hard only says that there are some.
        // While a pair is still allowed, say how many are left; once none is allowed, only that some are.
        var lead = r.event.max > 0 ? plural(r.event.pairs, 'match', 'matches') + ' left.' : 'Matches are left.';
        ui.note = lead + ' Clear them before adding' +
          (r.event.penalty ? ': −' + fmt(r.event.penalty) + ', streak lost.' : '. Streak lost.');
        if (r.event.penalty) {
          var addTok = ++gainTok;
          ui.gain = -r.event.penalty;
          ui.streakMult = 0;
          later(function () { if (gainTok === addTok) { ui.gain = 0; render(); } }, 1400);
        }
        var btn = $('btnAdd');           // red shake on the Add button, like a wrong tile
        btn.classList.remove('is-wrong');
        void btn.offsetWidth;            // restart the animation if pressed again quickly
        btn.classList.add('is-wrong');
        setTimeout(function () { btn.classList.remove('is-wrong'); }, 420);   // not later(): a reset must not leave it red
      }
      play('bad');
      render();
      return;
    }
    if (!r.event) return;
    tok++;
    state = r.state;
    ui.born = r.event.ids; ui.hint = []; ui.gain = 0;
    ui.note = 'Added ' + r.event.count + ' mascots. ' +
      (r.event.addsLeft ? plural(r.event.addsLeft, 'add', 'adds') + ' left this level.' : 'That was your last add for this level.');
    later(function () { ui.born = []; render(); }, 700);
    if (r.event.status !== 'playing') saveBestIfHigher();
    play('click');   // game over plays its own sound
    render();
    if (r.event.status === 'playing') trySweep(450);
  }

  /** The run's story on the Game over card. */
  function renderRunSummary(s, clear) {
    var box = $('endStats');
    box.hidden = clear;
    $('endShare').hidden = clear || !ui.shareOpen;
    if (clear) return;
    var r = L.runStats(s);
    var rows = [
      ['Reached', 'Level ' + s.level + ' · ' + L.LEVELS[L.stageOf(s.level)].label],
      ['Best streak', fmt(r.streak)],
      ['Clean sweeps', fmt(r.sweeps)],
      ['Walls removed', fmt(r.walls)],
      ['Mistakes', fmt(r.mistakes)],
      ['Hints used', fmt(r.hints)],
      ['Undos used', fmt(r.undos)]
    ];
    if (r.retries > 0) rows.push(['Boards tried again', fmt(r.retries)]);
    box.textContent = '';
    rows.forEach(function (row) {
      var dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = row[0]; dd.textContent = row[1];
      box.appendChild(dt); box.appendChild(dd);
    });
    if (ui.shareOpen) {
      var p = shareParts();
      $('shareText').value = p.text + ' ' + p.url;
    }
  }

  function onUndo() {
    var r = L.undo(state);
    if (!r.event) return;
    timers.forEach(clearTimeout); timers = []; tok++;
    clearPackMotion();
    $('fx').innerHTML = '';
    state = r.state;
    ui.flash = []; ui.bad = []; ui.hint = []; ui.born = []; ui.streakMult = 0;
    ui.gain = r.event.cost ? -r.event.cost : 0;
    ui.note = r.event.cost > 0 ? 'Undone (−' + r.event.cost + ' points).' : 'Undone.';
    play('click');
    if (ui.gain) {
      var undoTok = ++gainTok;
      later(function () { if (gainTok === undoTok) { ui.gain = 0; render(); } }, 1400);
    }
    render();
  }

  function onHint() {
    var r = L.hint(state);
    if (!r.event) return;
    state = r.state;
    if (r.event.type === 'nohint') {
      ui.note = state.addsLeft > 0 ? 'No pairs left. Try Add mascots.' : 'No pairs left.';
      play('bad');
    } else {
      ui.hint = r.event.ids;
      ui.streakMult = 0;
      ui.note = r.event.cost > 0
        ? 'Select two tiles with the same mascot. (−' + r.event.cost + ' points)'
        : '';
      play('click');
      if (r.event.cost) {
        var hintTok = ++gainTok;
        ui.gain = -r.event.cost;
        later(function () { if (gainTok === hintTok) { ui.gain = 0; render(); } }, 1400);
      }
      later(function () { ui.hint = []; render(); }, 2200);
    }
    render();
  }

  function matchNote(ev) {
    if (ev.wallBonus) return (ev.wallsGone > 1 ? ev.wallsGone + ' walls gone! +' : 'Wall gone! +') + fmt(ev.wallBonus) +
      (ev.lastStand ? ' (doubled: it stood to the last pair)' : '') + (ev.rowBonus ? ', and the row +' + ev.rowBonus : '') + '.';
    var rows = ev.rowsCleared.length;
    if (rows >= 2) return rows + ' rows at once! +' + ev.rowBonus;
    if (rows === 1) return 'Row cleared! +' + ev.rowBonus;
    var shown = Math.round(ev.streakMult * 10) / 10;
    if (shown === 2) return 'Streak ×2!';
    if (shown === 1.5) return 'Streak ×1.5!';
    if (ev.same) return (ev.shade === 'solid' ? 'Both shaded' : 'Both outlines') + ': double points.';
    if (ev.gaps >= 3) return 'Long pair: +' + ev.gain + '.';
    return '';
  }
  function clearDetail(s) {
    var p = L.bonusParts(s);
    var gap = p.par - p.used;
    var par = gap > 0 ? gap + ' under par.' : (gap < 0 ? -gap + ' over par.' : 'Even par.');
    return plural(p.used, 'match.', 'matches.') + '\n' + par;
  }
  // The caption already shows the level, difficulty and multiplier, and the Add button shows the adds,
  // so the start-of-level note only says what is new. '' means the normal prompt.
  // Milestones: one line for each thing that changes on this level (see RAMP and TOOLS).
  function levelNote() {
    var lv = state.level;
    if (lv <= 1) return '';
    var parts = [];
    var stage = L.stageOf(lv);
    if (stage !== L.stageOf(lv - 1)) parts.push(L.LEVELS[stage].label + ' starts here.');
    if (L.widthAt(lv) > L.widthAt(lv - 1)) parts.push('Wider board: ' + L.widthAt(lv) + ' across.');
    var now = L.mascots(lv), before = L.mascots(lv - 1);
    if (now > before && MASCOTS[now]) parts.push('New mascot: ' + MASCOTS[now].name + '.');
    var walls = L.wallCount(lv), wallsBefore = L.wallCount(lv - 1);
    var firstWall = walls > 0 && !L.RAMP.some(function (r) { return r.from < lv && r.walls > 0; });
    if (firstWall) parts.push("A wall! It can't be cleared and blocks the way. Clear the rest of its row and it goes too. The longer it stands, the more it pays.");
    else if (walls > wallsBefore) parts.push(walls === 2 ? 'Two walls now.' : walls + ' walls now.');
    else if (walls < wallsBefore) parts.push('One wall fewer.');
    // a kind of wall that has not been on the ramp before gets its own line
    var seenKinds = {};
    L.RAMP.forEach(function (r) { if (r.from < lv) L.wallKinds(r.from).forEach(function (k) { seenKinds[k] = true; }); });
    L.wallKinds(lv).forEach(function (k) {
      if (k === 'row' || seenKinds[k]) return;
      seenKinds[k] = true;
      parts.push('New: a ' + WALL_NAME[k].toLowerCase() + '. ' + WALL_RULE[k]);
    });
    var adds = L.addsFor(lv), addsBefore = L.addsFor(lv - 1);
    if (adds < addsBefore) parts.push('Adds: ' + adds + ' a level from now.');
    var T = L.toolsAt(lv), P = L.toolsAt(lv - 1);
    function count(n, one, many) { return isFinite(n) ? (n ? plural(n, one, many) : 'no ' + many) : 'unlimited ' + many; }
    if (lv === L.PACK_FROM) parts.push('Pack unlocked: it slides the tiles together.');
    else if (T.packs !== P.packs) parts.push('Packs: ' + count(T.packs, 'pack', 'packs') + ' a level.');
    if (T.hints !== P.hints) parts.push('Hints: ' + count(T.hints, 'hint', 'hints') + ' a level.');
    if (T.undos !== P.undos) parts.push('Undo: ' + count(T.undos, 'undo', 'undos') + ' a level.');
    if (T.addAt !== P.addAt) parts.push(T.addAt ? 'Add now waits until ' + plural(T.addAt, 'pair', 'pairs') + ' or fewer are left.' : 'Add now waits until no pairs are left.');
    if (T.mistake && !P.mistake) parts.push('Pressing Add too soon now counts as a wrong pick.');
    return parts.join(' ');
  }

  // The next board is random, so deal it during this level. Par is ready when Next level is pressed.
  var upcoming = null;
  var prepareTimer = 0;
  function scheduleUpcoming() {
    clearTimeout(prepareTimer);
    var spec = {
      diff: state.diff,
      level: state.level + 1,
      rules: state.rules,
      best: state.best,
      seed: L.randomSeed()
    };
    var key = spec.diff + '|' + spec.rules + '|' + spec.level;
    upcoming = { key: key };
    prepareTimer = setTimeout(function () {
      if (!upcoming || upcoming.key !== key) return;
      try {
        var board = L.dealPuzzle(spec);
        if (upcoming && upcoming.key === key) upcoming.state = board;
      } catch (e) {
        if (upcoming && upcoming.key === key) upcoming = null;
      }
    }, 0);
  }

  function onNextLevel() {
    var prev = state;
    var key = prev.diff + '|' + prev.rules + '|' + (prev.level + 1);
    var prepared = upcoming && upcoming.key === key && upcoming.state;
    resetAll();
    // The next level is either the one dealt ahead of time or a fresh deal. Either way the rules
    // carry the score, the run story and the rest over (see carryOver in game-logic.js).
    state = L.carryOver(prepared || L.dealPuzzle({ diff: prev.diff, level: prev.level + 1, rules: prev.rules, seed: L.randomSeed() }), prev);
    ui.note = levelNote();
    if (L.stageOf(state.level) !== L.stageOf(state.level - 1)) play('stage');
    scheduleUpcoming();
    publishBoard();
    render();
  }

  function newGame(diff) {
    noteRunEnd();
    resetAll();
    diff = diff || state.diff;
    if (!unlocked(diff)) diff = 'easy';
    state = L.dealPuzzle({ diff: diff, level: L.startLevel(diff), best: state.best, seed: L.randomSeed(), runId: L.newRunId() });
    startGuide();
    scheduleUpcoming();
    publishBoard();
    render();
  }

  /** Game over card: deal the board that beat you again, with the score you arrived with. */
  function onRetry() {
    if (state.status !== 'lose') return;
    noteRunEnd();   // a run is counted once, at its first loss
    var r = L.retryLevel(state);
    if (!r.event) return;
    resetAll();
    state = r.state;
    ui.shareOpen = false;
    ui.note = 'Same board, from the top.';
    scheduleUpcoming();
    publishBoard();
    render();
  }

  /** What Share sends: the level and stage reached, the score, and a link to the board that ended the run. */
  function shareParts() {
    var s = state;
    var link = window.location.origin + window.location.pathname + '?board=' +
      encodeURIComponent(L.formatPuzzle({ diff: s.diff, level: s.level, seed: s.seed }));
    var text = 'ten-spot: I reached level ' + s.level + ' (' + L.LEVELS[L.stageOf(s.level)].label + ') with ' +
      fmt(s.final) + ' points. Try the board that beat me:';
    return { text: text, url: link };
  }
  function showShareBox() { ui.shareOpen = true; render(); }
  function onShare() {
    if (state.status !== 'lose') return;
    var p = shareParts();
    if (navigator.share) {
      navigator.share({ title: 'ten-spot', text: p.text, url: p.url }).catch(function (e) {
        if (!e || e.name !== 'AbortError') showShareBox();   // closing the share sheet is not an error
      });
      return;
    }
    showShareBox();
  }
  function onShareCopy() {
    var box = $('shareText');
    function done(ok) { ui.note = ok ? 'Copied.' : 'Press and hold the message to copy it.'; render(); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(box.value).then(function () { done(true); }, function () { box.select(); done(false); });
    } else { box.select(); done(false); }
  }

  function setTheme(dark) { ui.dark = dark; store.set(KEY.theme, dark ? 'dark' : 'light'); render(); }

  function setDifficulty(diff) {
    if (diff === state.diff || !unlocked(diff)) return;
    var label = L.LEVELS[diff].label;
    confirmReset('Start at ' + label + '?', 'This starts a new game at level ' + L.startLevel(diff) + '.', 'Start at ' + label,
      function () { ui.settingsOpen = false; newGame(diff); });
  }

  function askNewGame() {
    confirmReset('Start a new game?', 'A new game starts over at level ' + L.startLevel(state.diff) + '.', 'Start new game',
      function () { ui.settingsOpen = false; newGame(); });
  }

  /* ---------- 11. WIRING ---------- */
  $('grid').addEventListener('click', function (e) {
    if (window.getSelection) window.getSelection().removeAllRanges();
    var btn = e.target.closest('button.c');
    if (btn) onCell(Number(btn.dataset.id));
  });
  // A long-press was opening the mobile selection bar anywhere on the page.
  ['selectstart', 'contextmenu', 'dragstart'].forEach(function (t) {
    document.addEventListener(t, function (e) {
      var node = e.target && e.target.closest ? e.target : (e.target && e.target.parentElement);
      if (!node || !node.closest('.how, .credits, input, textarea')) e.preventDefault();
    });
  });
  // iPhone Firefox can still select a word. Clear any selection the moment it appears,
  // except inside How to play, the credits and text fields.
  document.addEventListener('selectionchange', function () {
    var sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed || !sel.anchorNode) return;
    var node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    if (node && node.closest && node.closest('.how, .credits, input, textarea')) return;
    sel.removeAllRanges();
  });
  // A quick double tap can select a word without a selectstart event.
  document.addEventListener('dblclick', function (e) {
    var node = e.target && e.target.closest ? e.target : (e.target && e.target.parentElement);
    if (!node || !node.closest('.how, .credits, input, textarea')) e.preventDefault();
  }, { passive: false });
  ['selectstart', 'dragstart', 'copy', 'cut', 'paste', 'contextmenu'].forEach(function (type) {
    $('grid').addEventListener(type, function (e) { e.preventDefault(); });
  });
  $('btnAdd').addEventListener('click', onAdd);
  $('board').addEventListener('pointerdown', skipWindDown);   // tap during the game-over fade = show the card now
  $('btnCompact').addEventListener('click', onPack);
  $('btnUndo').addEventListener('click', onUndo);
  $('btnHint').addEventListener('click', onHint);
  $('btnNew').addEventListener('click', askNewGame);
  $('btnTheme').addEventListener('click', function () { setTheme(!ui.dark); });
  $('btnSettings').addEventListener('click', function () { ui.settingsOpen = !ui.settingsOpen; render(); });
  function startPuzzle(spec) {
    if (spec && spec.old) {
      ui.puzzleError = 'That board code is from an older version of the game.';
      render();
      return;
    }
    if (!spec || spec.mode !== 'teams') {
      ui.puzzleError = 'That puzzle code is not valid.';
      render();
      return;
    }
    var best = state.best;
    ui.settingsOpen = false;
    ui.puzzleError = '';
    noteRunEnd();
    resetAll();
    state = L.dealPuzzle({ diff: L.stageOf(spec.level), level: spec.level, best: best, seed: spec.seed, fromCode: true, runId: L.newRunId() });
    scheduleUpcoming();
    publishBoard();
    render();
  }
  $('puzzleForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var typed = $('puzzleInput').value;
    var spec = L.parsePuzzle(typed);
    var short = S && S.parseBoardCode(typed);
    if (!spec && !short) { ui.puzzleError = 'That puzzle code is not valid.'; render(); return; }
    confirmReset('Play this puzzle?', 'This starts that puzzle over from its first deal.', 'Play this puzzle', function () {
      $('puzzleInput').value = '';
      if (spec) { startPuzzle(spec); return; }
      if (!SCORES_API) { ui.puzzleError = "Couldn't reach the score server."; render(); return; }
      S.getBoard(SCORES_API, short, fetch).then(function (res) {
        if (!res.ok || !res.body) { ui.puzzleError = scoreError(res); render(); return; }
        startPuzzle(res.body);
      });
    });
  });
  $('btnEndPrimary').addEventListener('click', function () { if (state.status === 'clear') onNextLevel(); else newGame(); });
  $('btnEndUndo').addEventListener('click', onUndo);
  $('btnEndRetry').addEventListener('click', onRetry);
  $('guideSkip').addEventListener('click', function () { endGuide(); render(); });
  $('btnEndShare').addEventListener('click', onShare);
  $('btnShareCopy').addEventListener('click', onShareCopy);
  document.querySelectorAll('[data-diff]').forEach(function (b) {
    b.addEventListener('click', function () { setDifficulty(b.dataset.diff); });
  });
  document.querySelectorAll('[data-theme]').forEach(function (b) {
    b.addEventListener('click', function () { setTheme(b.dataset.theme === 'dark'); });
  });
  document.querySelectorAll('[data-sound]').forEach(function (b) {
    b.addEventListener('click', function () { setSound(b.dataset.sound === 'on'); });
  });
  $('confirmYes').addEventListener('click', function () { closeConfirm(true); });
  $('confirmNo').addEventListener('click', function () { closeConfirm(false); });
  $('confirm').addEventListener('click', function (e) { if (e.target === $('confirm')) closeConfirm(false); });
  $('confirm').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); closeConfirm(false); }
    if (e.key === 'Tab') { // keep focus inside the dialog
      var f = [$('confirmNo'), $('confirmYes')], i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
    }
  });

  window.addEventListener('pagehide', function () { saveNow(); serverSaveNow(true); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { saveNow(); serverSaveNow(true); }
  });
  // Leaving is always safe because the game is saved. Only warn if this browser won't save.
  window.addEventListener('beforeunload', function (e) {
    if (ui.saveFailed && state.status === 'playing') { e.preventDefault(); e.returnValue = ''; }
  });

  /* The Account group in Settings (account.js). */
  account = window.TenSpotAccount ? window.TenSpotAccount.create({
    api: SCORES_API, S: S, store: store, KEY: KEY, $: $, drawText: drawText,
    loadBest: loadBest, adoptBests: adoptBests,
    about: function () { return { version: L.RULES_VERSION, run: state.runId }; },
    ask: ask, note: function (text) { ui.note = text; },
    openSettings: function () { ui.settingsOpen = true; },
    afterSignIn: function () { pullServerSave(); },
    render: function () { render(); }
  }) : null;

  startGuide();
  scheduleUpcoming();
  if (!ui.boardCode) publishBoard();   // a restored game already has its board code
  render();
  pullBests();
  pullServerSave();
  sendRunEnds();

  /* A shared link (?board=41-1a2b3c4d) deals that board. The code is taken off the address
     so a reload goes back to the saved game. */
  (function () {
    var linked = null;
    try { linked = new URLSearchParams(window.location.search).get('board'); } catch (e) { linked = null; }
    if (!linked) return;
    try { window.history.replaceState(null, '', window.location.pathname); } catch (e) { /* ignore */ }
    var spec = L.parsePuzzle(linked);
    if (!spec) { ui.note = 'That board link is not valid.'; render(); return; }
    confirmReset('Play this board?', 'This link deals one board from its first deal.', 'Play this board', function () { startPuzzle(spec); });
  })();
  if (account) account.handleIncoming();   // ?link=… and ?recover=… (see account.js)

  /* ---------- 12. OPTIONAL TEST HOOK ----------
     Lets automated tests and screenshots set up exact boards.
     window.__nm.load([3,7], { addsLeft: 0 }) replaces the board.  */
  window.__nm = {
    state: function () { return state; },
    ui: ui,
    load: function (values, extra) {
      resetAll();
      var s = L.newGame(state.diff, state.best, Math.random, state.rules);
      s.cells = values.map(function (v, i) {
        var cell = { id: i + 1, v: (v && typeof v === 'object') ? v.v : v, done: false };
        if (v && typeof v === 'object' && typeof v.solid === 'boolean') cell.solid = v.solid;
        return cell;
      });
      s.nextId = values.length + 1;
      s.total = values.length;
      s.opening = s.cells.map(function (c) {
        var tile = { v: c.v };
        if (typeof c.solid === 'boolean') tile.solid = c.solid;
        return tile;
      });
      for (var k in (extra || {})) s[k] = extra[k];
      s.seed = s.seed || 0;
      state = s;
      scheduleUpcoming();
      publishBoard();
      render();
    },
    setTheme: setTheme,
    openSettings: function (open) { ui.settingsOpen = open; render(); },
    beatable: function () { return L.isBeatable(state); }
  };
})();
