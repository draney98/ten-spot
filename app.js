/* =====================================================================
   NUMBER MATCH — USER INTERFACE
   ---------------------------------------------------------------------
   Owns: the DOM, timers, animations, dialogs, saving to localStorage.
   Does NOT own game rules — every rule lives in game-logic.js
   (window.NumberMatchLogic, called `L` below).

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
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };
  var KEY_BEST = 'numbermatch.best.';   // + easy|normal|hard
  var KEY_THEME = 'numbermatch.theme';  // 'light'|'dark'
  var KEY_MODE = 'numbermatch.mode';    // 'num'|'tiles'|'icons'|'teams'
  var MODES = ['num', 'tiles', 'icons', 'teams'];
  // Tile style -> rule set. Numbers and Icons share the classic rules (only the look differs).
  // 'tiles' (shown as "Mahjong") uses the 'mahjong' rules; 'teams' (shown as "Gridiron") uses 'pairs'.
  function rulesFor(mode) { return mode === 'teams' ? 'pairs' : (mode === 'tiles' ? 'mahjong' : 'classic'); }

  function loadBest() {
    var b = { easy: 0, normal: 0, hard: 0 };
    Object.keys(b).forEach(function (k) {
      var v = Number(store.get(KEY_BEST + k));
      if (v > 0) b[k] = v;
    });
    return b;
  }
  function saveBestIfHigher() {
    var d = state.diff, v = state.best[d] || 0;
    if (v > (Number(store.get(KEY_BEST + d)) || 0)) store.set(KEY_BEST + d, String(v));
  }
  function loadDark() {
    var t = store.get(KEY_THEME);
    if (t === 'dark') return true;
    if (t === 'light') return false;
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
  }

  /* ---------- 2. STATE ---------- */
  var savedMode = MODES.indexOf(store.get(KEY_MODE)) >= 0 ? store.get(KEY_MODE) : 'icons';
  var state = L.newGame('normal', loadBest(), Math.random, rulesFor(savedMode));   // game state — see game-logic.js
  var ui = {                                      // UI-only state
    mode: savedMode,
    dark: loadDark(),
    settingsOpen: false,
    confirm: null, // the open confirmation dialog: { yes: function } or null
    flash: [],     // cell ids playing the match "pop"
    flashPen: false, // true while that pop is for a score-losing clear
    bad: [],       // cell ids playing the "shake"
    hint: [],      // cell ids circled as a hint
    born: [],      // cell ids just added (fade-in)
    gain: 0,       // last points earned, shown in the score tag
    note: ''       // status line text ('' = default text)
  };

  /* ---------- 3. TIMERS ----------
     `tok` is bumped by every action that changes the board. A delayed
     callback that captured an old tok knows it is stale and does nothing. */
  var timers = [], tok = 0, gainTok = 0;   // gainTok: lets a newer score tag outlive an older timer
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function resetAll() {
    timers.forEach(clearTimeout); timers = []; tok++;
    $('fx').innerHTML = '';
    ui.flash = []; ui.bad = []; ui.hint = []; ui.born = []; ui.gain = 0; ui.note = '';
    resetBoardNodes();
  }

  /* ---------- 4. WORDS THAT DEPEND ON THE TILE STYLE ---------- */
  var MODE_NAME = { num: 'Numbers', tiles: 'Mahjong', icons: 'Icons', teams: 'Gridiron' };
  var NOUN = { num: 'numbers', tiles: 'tiles', icons: 'icons', teams: 'mascots' };          // "Add icons", "Added 27 icons"
  var PICK_NOUN = { num: 'numbers', tiles: 'tiles', icons: 'icons', teams: 'tiles' };       // "Select two icons to clear them."
  var BAD_VALUE = {
    num: 'Pick two equal numbers, or two that add up to 10.',
    tiles: 'Pick two identical tiles, or circle tiles that add up to 10.',
    icons: 'Pick two identical icons, or an icon and its mirror image.',
    teams: 'Pick two tiles with the same mascot.'
  };
  var MODE_HELP = {
    num: 'Digits in boxes: 1 to 5 in an outlined box, 6 to 9 in a shaded box.',
    tiles: 'Mahjong tiles. Circle tiles match like numbers: the same count, or two that add up to 10. 1 to 5 are rings, 6 to 9 are shaded discs. Winds and dragons only match an identical tile. Level 1 has 2 kinds of winds and dragons; each level adds one, up to all 7. Switching to or from Mahjong starts a new game.',
    icons: 'Identical icons match, and so do mirror images. The lower value is an outline and its partner is filled in. The small number is the value.',
    teams: 'Any two tiles with the same mascot match: an outline and its solid twin, or two the same. Level 1 has 5 mascots; each level adds one, up to 8 (longhorn, paw, helmet, shamrock, football, then bone, feather, claws). Switching to or from Gridiron starts a new game.'
  };

  /* ---------- 5. CELL ARTWORK ---------- */
  // Circle-tile dot positions on a 3x3 grid (0 = top-left, 8 = bottom-right) for values 1..9.
  var PIPS = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8], [0, 2, 3, 4, 5, 6, 8], [0, 1, 2, 3, 5, 6, 7, 8], [0, 1, 2, 3, 4, 5, 6, 7, 8]];

  // Mahjong honour tiles, values 11..17. h0 = graphite ink.
  var HONOURS = {
    11: { name: 'East wind', ch: '東', h: 0, letter: 'E' },
    12: { name: 'South wind', ch: '南', h: 0, letter: 'S' },
    13: { name: 'West wind', ch: '西', h: 0, letter: 'W' },
    14: { name: 'North wind', ch: '北', h: 0, letter: 'N' },
    15: { name: 'Red dragon', ch: '中', h: 4 },
    16: { name: 'Green dragon', ch: '發', h: 2 },
    17: { name: 'White dragon', ch: '', h: 1 }   // drawn as a framed blank tile
  };
  var WHITE_DRAGON = '<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="5" y="3" width="14" height="18" rx="1.5" stroke-width="2"/><rect x="8.2" y="6.2" width="7.6" height="11.6" rx="1" stroke-width="1.4"/></svg>';

  // Icons: values that add to 10 are the SAME closed shape, mirrored left-right.
  // EVERY icon is either a pure outline (values 1-4, and 5) or completely filled (values 6-9).
  var MIR = 'matrix(-1 0 0 1 24 0)';  // flips a 24x24 icon horizontally
  var CHEV = 'M16 2.5 6.5 12 16 21.5 20 17.5 14.5 12 20 6.5Z';   // thick "<" arrowhead (closed, so it can be filled)
  var BOLT = 'M14.5 2 5 13.5h6.2L9.5 22 19 10h-6.3L14.5 2Z';   // lightning bolt
  var MOON = 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z';
  var LEAF = 'M5 19C5 10 10 5 20 4c0 10-5 15-14 15Z';
  var RING = 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17Z';
  var ICONS = [
    null,
    { d: CHEV, tf: '', fo: 0 },    // 1  outline "<"
    { d: BOLT, tf: '', fo: 0 },    // 2  outline lightning bolt
    { d: MOON, tf: '', fo: 0 },    // 3  outline crescent
    { d: LEAF, tf: '', fo: 0 },    // 4  outline leaf
    { d: RING, tf: '', fo: 0 },    // 5  outline circle (5 pairs with itself)
    { d: LEAF, tf: MIR, fo: 1 },   // 6  filled leaf, mirrored
    { d: MOON, tf: MIR, fo: 1 },   // 7  filled crescent, mirrored
    { d: BOLT, tf: MIR, fo: 1 },   // 8  filled lightning bolt, mirrored
    { d: CHEV, tf: MIR, fo: 1 }    // 9  filled ">"
  ];

  // Gridiron mascots. Value v -> mascot L.mascotOf(v) (1..8); odd = outline, even = solid.
  // Mascots are introduced in this order: 5 on level 1, then bone, feather, claws on levels 2, 3, 4.
  // h = which pencil colour to use. knock = detail re-drawn in the paper colour on the SOLID version.
  var SHAMROCK = 'M12.0 10.2C11.1 8.85 7.5 6.78 7.5 4.26C7.5 2.46 8.76 1.38 10.02 1.38C11.1 1.38 11.73 2.1 12.0 3.0C12.27 2.1 12.9 1.38 13.98 1.38C15.24 1.38 16.5 2.46 16.5 4.26C16.5 6.78 12.9 8.85 12.0 10.2ZM12.0 10.2C13.62 10.1 17.21 8.01 19.39 9.27C20.95 10.17 21.26 11.8 20.63 12.9C20.09 13.83 19.15 14.02 18.24 13.8C18.88 14.48 19.19 15.39 18.65 16.32C18.02 17.42 16.45 17.97 14.89 17.07C12.71 15.81 12.72 11.65 12.0 10.2ZM12.0 10.2C11.28 11.65 11.29 15.81 9.11 17.07C7.55 17.97 5.98 17.42 5.35 16.32C4.81 15.39 5.12 14.48 5.76 13.8C4.85 14.02 3.91 13.83 3.37 12.9C2.74 11.8 3.05 10.17 4.61 9.27C6.79 8.01 10.38 10.1 12.0 10.2ZM12.4 11.6C12.8 15.4 13.6 18.6 15.4 21.6';
  var MASCOTS = [
    null,
    { name: 'Longhorn', h: 3, knock: '',
      d: 'M1 4.5C2 10.5 6 12 9 11.8L9.8 17.2C10.2 19.6 11 21 12 21C13 21 13.8 19.6 14.2 17.2L15 11.8C18 12 22 10.5 23 4.5C20.5 6.8 17.6 7.2 15 7C13.5 6.6 10.5 6.6 9 7C6.4 7.2 3.5 6.8 1 4.5Z' },
    { name: 'Tiger paw', h: 5, knock: '',
      d: 'M12 20.8c-3.3 0-5.6-1.7-5.6-3.9 0-2.4 2.6-5 5.6-5s5.6 2.6 5.6 5c0 2.2-2.3 3.9-5.6 3.9ZM2.2 10.4a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0ZM6.6 4.6a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0ZM13.8 4.6a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0ZM18.2 10.4a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0Z' },
    { name: 'Trojan helmet', h: 4, knock: '',
      d: 'M9 21.5V14.5C9 10 11.6 7.6 15 7.6C18.6 7.6 21.5 10.2 21.5 13.8V16H18V21.5ZM16.2 11.2H20.4V14.6H16.2ZM3.2 14.2C2.8 7.6 7 2 13.6 2C15.2 2 16.5 2.4 17.6 3C16.4 3.5 15.4 4.1 14.6 4.7C13.9 4.6 13.2 4.6 12.6 4.7C8.8 5.2 6.3 9 6.2 14.2Z' },
    { name: 'Shamrock', h: 2, knock: '', d: SHAMROCK },
    { name: 'Football', h: 8, knock: 'M9 12H15M10.5 10V14M13.5 10V14',
      d: 'M2.5 12C5 6.3 19 6.3 21.5 12C19 17.7 5 17.7 2.5 12ZM9 12H15M10.5 10V14M13.5 10V14' },
    { name: 'Bone', h: 7, knock: '',
      d: 'M6.84 10.4H17.16A2.9 2.9 0 1 1 20.555 12A2.9 2.9 0 1 1 17.16 13.6H6.84A2.9 2.9 0 1 1 3.445 12A2.9 2.9 0 1 1 6.84 10.4Z' },
    { name: 'Feather', h: 6, knock: 'M6.6 17.4L16.4 6.8',
      d: 'M6 18C5.6 11.2 10.2 4.8 19.6 3C19.4 4.8 19 6.2 18.4 7.4L16.2 8.1L17.9 8.8C16.3 13.3 12.5 17.2 6 18ZM6.6 17.4L16.4 6.8M6 18L2.6 21.4' },
    { name: 'Claw marks', h: 1, knock: '',
      d: 'M8.6 2.5C6.0 7.5 3.4 14 2.6 21.5C6.4 15.5 9.6 9 8.6 2.5ZM15.1 2.5C12.5 7.5 9.9 14 9.1 21.5C12.9 15.5 16.1 9 15.1 2.5ZM21.6 2.5C19.0 7.5 16.4 14 15.6 21.5C19.4 15.5 22.6 9 21.6 2.5Z' }
  ];

  function cellInnerHTML(v, mode) {
    // Numbers: 1-5 in an outlined box, 6-9 reversed out of a shaded box.
    if (mode === 'num') return '<span class="numbox' + (v >= 6 ? ' solid' : '') + '" aria-hidden="true">' + v + '</span>';
    if (mode === 'teams') {
      var M = MASCOTS[L.mascotOf(v)], solid = L.isSolid(v);
      return '<svg class="glyph" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' +
        '<path d="' + M.d + '" fill-opacity="' + (solid ? 1 : 0) + '"/>' +
        (solid && M.knock ? '<path class="knock" d="' + M.knock + '" fill="none" stroke-width="1.5"/>' : '') +
        '</svg>';
    }
    if (mode === 'tiles') {
      if (L.isHonour(v)) {
        var H = HONOURS[v];
        return (H.ch ? '<span class="honour" aria-hidden="true">' + H.ch + '</span>' : WHITE_DRAGON) +
          (H.letter ? '<span class="corner" aria-hidden="true">' + H.letter + '</span>' : '');
      }
      // Circle tiles: 1-5 are rings (outline), 6-9 are shaded discs.
      var html = '<span class="pips' + (v >= 6 ? ' solid' : '') + '" aria-hidden="true">';
      for (var k = 0; k < 9; k++) html += '<i class="pip' + (PIPS[v].indexOf(k) >= 0 ? ' on' : '') + '"></i>';
      return html + '</span>';
    }
    var I = ICONS[v];
    return '<svg class="glyph" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' +
      '<path d="' + I.d + '"' + (I.tf ? ' transform="' + I.tf + '"' : '') + ' fill-opacity="' + I.fo + '"/>' +
      '</svg><span class="corner" aria-hidden="true">' + v + '</span>';
  }

  // Pencil colour family. Classic and circle tiles: 1&9→1, 2&8→2, 3&7→3, 4&6→4, 5→5.
  // Honour tiles and Gridiron mascots have their own colour.
  function family(v) {
    if (ui.mode === 'teams') return MASCOTS[L.mascotOf(v)].h;
    if (ui.mode === 'tiles' && L.isHonour(v)) return HONOURS[v].h;
    return Math.min(v, 10 - v);
  }
  function cellName(v) {
    if (ui.mode === 'teams') return MASCOTS[L.mascotOf(v)].name + (L.isSolid(v) ? ', solid' : ', outline');
    if (ui.mode === 'tiles') return L.isHonour(v) ? HONOURS[v].name : plural(v, 'circle', 'circles');
    return String(v);
  }

  function cellClass(c) {
    var cls = 'c';
    cls += ' c-tile h' + family(c.v);
    if (c.done) cls += ' c-done';
    if (c.id === state.selected) cls += ' c-sel';
    if (ui.flash.indexOf(c.id) >= 0) cls += ui.flashPen ? ' c-flash c-flash-pen' : ' c-flash';
    if (ui.hint.indexOf(c.id) >= 0) cls += ' c-hint';
    if (ui.bad.indexOf(c.id) >= 0) cls += ' c-bad';
    if (ui.born.indexOf(c.id) >= 0) cls += ' c-born';
    return cls;
  }

  /* ---------- 6. BOARD SYNC ----------
     IMPORTANT: cell buttons are REUSED, keyed by cell id. Re-creating
     them on every render would restart every CSS animation and make
     the board flicker. Only create, remove or move what changed. */
  var nodes = new Map(); // cell id -> <button>

  function resetBoardNodes() { nodes.clear(); $('grid').innerHTML = ''; }

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
        el.dataset.id = c.id;
        nodes.set(c.id, el);
      }
      if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
      var key = c.v + '|' + ui.mode;
      if (el.dataset.key !== key) { el.innerHTML = cellInnerHTML(c.v, ui.mode); el.dataset.key = key; }
      var cls = cellClass(c);
      if (el.className !== cls) el.className = cls;
      var name = cellName(c.v);
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
    var g = document.createElement('div');
    // Score-up clears use blue FX; score-down clears keep the red/pink "pen" look.
    g.className = 'fx-group' + (ev.gain < 0 ? ' fx-pen' : ' fx-gain');
    var html = '';

    // 1) row sweeps (behind everything else)
    ev.rowsCleared.forEach(function (r) {
      var first = $('grid').children[r * L.COLS];
      if (!first) return;
      var rr = first.getBoundingClientRect();
      html += '<div class="sweep" style="top:' + (rr.top - box.top) + 'px;height:' + rr.height + 'px"></div>';
    });
    // 2) pencil line over a highlighter stroke (pathLength=1 lets the dash animation work at any length)
    html += '<svg class="zap-svg" width="' + box.width + '" height="' + box.height + '">' +
      '<line class="zap zap-wide" x1="' + A.x + '" y1="' + A.y + '" x2="' + B.x + '" y2="' + B.y + '" pathLength="1" stroke-width="12"/>' +
      '<line class="zap" x1="' + A.x + '" y1="' + A.y + '" x2="' + B.x + '" y2="' + B.y + '" pathLength="1" stroke-width="2.5"/>' +
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

  // Diagonals are allowed on every difficulty, so they are not listed here.
  function diffInfo(diff) {
    var D = L.LEVELS[diff];
    return [
      D.adds + ' adds per level, dropping to ' + D.minAdds,
      isFinite(D.hints) ? (D.hints ? D.hints + ' hints' : 'no hints') : 'unlimited hints',
      isFinite(D.undos) ? plural(D.undos, 'undo', 'undos') : 'unlimited undo',
      '×' + D.mult + ' points, +20% each level'
    ].join(', ') + '. Changing difficulty starts a new game.';
  }

  function setPressed(selector, attr, value) {
    document.querySelectorAll(selector).forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute(attr) === value));
    });
  }

  function render() {
    var s = state;
    var D = L.LEVELS[s.diff];
    var mult = Math.round(L.pointMult(s.diff, s.level) * 10) / 10;
    var left = L.remaining(s);

    // theme + settings
    document.documentElement.classList.toggle('dark', ui.dark);
    $('btnTheme').setAttribute('aria-pressed', String(ui.dark));
    $('settings').classList.toggle('open', ui.settingsOpen);
    $('btnSettings').setAttribute('aria-expanded', String(ui.settingsOpen));
    setPressed('[data-diff]', 'data-diff', s.diff);
    setPressed('[data-mode]', 'data-mode', ui.mode);
    setPressed('[data-theme]', 'data-theme', ui.dark ? 'dark' : 'light');
    $('diffInfo').textContent = diffInfo(s.diff);
    $('styleInfo').textContent = MODE_HELP[ui.mode];

    // while settings (or a confirmation) are open, the board and its controls are switched off
    var off = ui.settingsOpen || !!ui.confirm;
    ['board', 'actions', 'note'].forEach(function (id) {
      $(id).inert = off;
      $(id).classList.toggle('is-off', off);
    });

    // header
    $('subline').textContent = 'Level ' + s.level + ' on ' + D.label + ', points ×' + mult;

    // scoreboard
    $('score').textContent = fmt(s.score);
    $('best').textContent = fmt(s.best[s.diff] || 0);
    var gainTxt = ui.gain ? (ui.gain > 0 ? '+' : '−') + fmt(Math.abs(ui.gain)) : '';
    var tag = gainTxt + (s.combo > 1 ? (gainTxt ? ', ' : '') + 'combo ×' + s.combo : '');
    $('scoreTag').textContent = tag;
    $('scoreTag').hidden = !tag;
    $('scoreTag').classList.toggle('is-loss', ui.gain < 0);
    var pct = s.total ? Math.floor(s.cleared / s.total * 100) : 0;   // floor: 100% only when the board is clear
    $('pct').textContent = pct + '%';
    $('progressFill').style.width = pct + '%';
    $('progress').setAttribute('aria-valuenow', String(pct));

    // board + status line
    syncBoard();
    $('note').textContent = ui.note || ('Select two ' + PICK_NOUN[ui.mode] + ' to clear them.');

    // beatability indicator (API search; skip when the level has already ended)
    var beat = $('beatability');
    if (s.status === 'clear') {
      beat.textContent = 'Cleared';
      beat.dataset.state = 'clear';
    } else if (s.status === 'lose') {
      beat.textContent = 'Not beatable';
      beat.dataset.state = 'no';
    } else {
      var ok = L.isBeatable(s);
      beat.textContent = ok ? 'Beatable' : 'Not beatable';
      beat.dataset.state = ok ? 'yes' : 'no';
    }

    // bottom bar
    $('btnUndo').disabled = !L.canUndo(s);
    $('btnHint').disabled = !L.canHint(s);
    $('btnAdd').disabled = !L.canAdd(s);
    $('undoCount').textContent = lim(s.undosLeft) + ' left';
    $('hintCount').textContent = lim(s.hintsLeft) + ' left';
    $('btnUndo').setAttribute('aria-label', 'Undo, ' + lim(s.undosLeft) + ' left');
    $('btnHint').setAttribute('aria-label', 'Hint, ' + lim(s.hintsLeft) + ' left');
    $('addMain').textContent = 'Add ' + NOUN[ui.mode];
    $('addSub').textContent = s.addsLeft + ' of ' + L.addsFor(s.diff, s.level) + ' left this level';

    renderOverlay();
  }

  function renderOverlay() {
    var s = state, ov = $('overlay');
    $('board').classList.toggle('ended', s.status !== 'playing');
    if (s.status === 'playing') { ov.hidden = true; return; }
    var clear = s.status === 'clear';
    var nextAdds = L.addsFor(s.diff, s.level + 1);
    $('endKicker').textContent = clear ? 'Level ' + s.level + ' cleared' : 'Out of moves on level ' + s.level;
    $('endTitle').textContent = clear ? 'Board clear!' : 'Game over';
    $('endNumber').textContent = clear ? '+' + fmt(s.bonus) : fmt(s.final);
    $('endDetail').textContent = clear
      ? 'Bonus for unused adds and hints, plus a level bonus. Score ' + fmt(s.score) + '.'
      : 'No adds left and no pairs to clear. You reached level ' + s.level + '.';
    $('endBest').textContent = s.newBest ? 'New best score!'
      : (clear ? 'Next: level ' + (s.level + 1) + ' with ' + plural(nextAdds, 'add', 'adds') : 'Best: ' + fmt(s.best[s.diff] || 0));
    $('btnEndPrimary').textContent = clear ? 'Next level' : 'Play again';
    $('btnEndUndo').hidden = !(s.status === 'lose' && L.canUndo(s));
    if (ov.hidden) ov.hidden = false; // un-hiding restarts the fade-in animation
  }

  /* ---------- 9. CONFIRMING ANYTHING THAT RESETS THE BOARD ----------
     New game, a difficulty change, and a tile-style change that switches
     rule set all start over. If a game is under way, ask first. */
  function gameInProgress() {
    var D = L.LEVELS[state.diff];
    return state.status === 'playing' &&
      (state.moves > 0 || state.level > 1 || state.score > 0 || (state.penalties || 0) > 0 ||
       (isFinite(D.hints) && state.hintsLeft < D.hints));
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
  function closeConfirm(run) {
    var c = ui.confirm;
    if (!c) return;
    ui.confirm = null;
    $('confirm').hidden = true;
    if (run) c.yes(); else render();
    if (!run && c.returnFocus && c.returnFocus.focus) c.returnFocus.focus();
  }

  /* ---------- 10. ACTIONS ---------- */
  function onCell(id) {
    var r = L.select(state, id);
    state = r.state;
    var ev = r.event;
    if (!ev) return;

    if (ev.type === 'select' || ev.type === 'deselect') {
      ui.hint = []; ui.note = '';
    } else if (ev.type === 'bad') {
      ui.hint = [];
      ui.bad = [ev.id];
      ui.note = ev.reason === 'value' ? BAD_VALUE[ui.mode] : 'Not reachable: only crossed-out cells can sit between a pair.';
      if (ev.penalty) {
        var penTok = ++gainTok;
        ui.note += ' −' + plural(ev.penalty, 'point.', 'points.');
        ui.gain = -ev.penalty;
        later(function () { if (gainTok === penTok) { ui.gain = 0; render(); } }, 1400);
      }
      later(function () { ui.bad = []; render(); }, 360);
    } else if (ev.type === 'match') {
      var myTok = ++tok;
      spawnFx(ev);                 // measure BEFORE anything moves
      ui.flash = ev.ids.slice();
      ui.flashPen = ev.gain < 0;   // pink pop only when the clear costs points
      ui.hint = [];
      ui.gain = ev.gain;
      ui.note = ev.mixed
        ? (ev.rowsCleared.length ? 'Row cleared! +' + ev.rowBonus + ', but outline + shaded ' + (ev.penalty ? '−' + plural(ev.penalty, 'point.', 'points.') : 'scores nothing.')
                                 : 'Outline + shaded: cleared, but ' + (ev.penalty ? '−' + plural(ev.penalty, 'point.', 'points.') : 'no points.'))
        : ev.rowsCleared.length ? 'Row cleared! +' + ev.rowBonus
        : ev.styleBonus ? (ev.shade === 'solid' ? 'Both shaded' : 'Both outlines') + ': style bonus +' + ev.styleBonus + '.'
        : (ev.combo > 2 ? ev.combo + ' in a row!' : '');
      later(function () { ui.flash = []; render(); }, 620);
      // collapse finished rows — but NOT when the level just ended (keep the crossed-out board under the card)
      later(function () { if (tok === myTok && state.status === 'playing') { state = L.compactBoard(state); render(); } }, 900);
      var myGain = ++gainTok;
      later(function () { if (gainTok === myGain) { ui.gain = 0; render(); } }, 1400);
      if (ev.status !== 'playing') saveBestIfHigher();
    }
    render();
  }

  function onAdd() {
    var r = L.addNumbers(state);
    if (!r.event) return;
    tok++;
    state = r.state;
    ui.born = r.event.ids; ui.hint = []; ui.gain = 0;
    ui.note = 'Added ' + r.event.count + ' ' + NOUN[ui.mode] + '. ' +
      (r.event.addsLeft ? plural(r.event.addsLeft, 'add', 'adds') + ' left this level.' : 'That was your last add for this level.');
    later(function () { ui.born = []; render(); }, 700);
    if (r.event.status !== 'playing') saveBestIfHigher();
    render();
  }

  function onUndo() {
    var r = L.undo(state);
    if (!r.event) return;
    timers.forEach(clearTimeout); timers = []; tok++;
    $('fx').innerHTML = '';
    state = r.state;
    ui.flash = []; ui.bad = []; ui.hint = []; ui.born = []; ui.gain = 0; ui.note = '';
    render();
  }

  function onHint() {
    var r = L.hint(state);
    if (!r.event) return;
    state = r.state;
    if (r.event.type === 'nohint') {
      ui.note = state.addsLeft > 0 ? 'No pairs left. Try Add ' + NOUN[ui.mode] + '.' : 'No pairs left.';
    } else {
      ui.hint = r.event.ids; ui.note = '';
      later(function () { ui.hint = []; render(); }, 2200);
    }
    render();
  }

  function levelNote() {
    var extra = state.rules === 'pairs' ? ' tiles, ' + L.mascots(state.level) + ' mascots, '
      : (state.rules === 'mahjong' ? ' tiles, ' + L.honoursInPlay(state.level) + ' kinds of winds and dragons, ' : ' numbers, ');
    return 'Level ' + state.level + ': ' + state.total + extra + plural(state.addsLeft, 'add.', 'adds.');
  }

  function onNextLevel() {
    var r = L.nextLevel(state, Math.random);
    if (!r.event) return;
    resetAll();
    state = r.state;
    ui.note = levelNote();
    render();
  }

  function newGame(diff) {
    resetAll();
    state = L.newGame(diff || state.diff, state.best, Math.random, rulesFor(ui.mode));
    render();
  }

  function setTheme(dark) { ui.dark = dark; store.set(KEY_THEME, dark ? 'dark' : 'light'); render(); }

  // Numbers and Icons only change the look. Mahjong and Gridiron have their own rules,
  // so switching between rule sets starts a new game (after confirming).
  function setMode(mode) {
    if (mode === ui.mode) return;
    if (rulesFor(mode) === rulesFor(ui.mode)) {
      ui.mode = mode; store.set(KEY_MODE, mode); render();
      return;
    }
    confirmReset('Switch to ' + MODE_NAME[mode] + '?',
      MODE_NAME[mode] + ' uses different tiles, so switching starts a new game.',
      'Switch to ' + MODE_NAME[mode],
      function () { ui.mode = mode; store.set(KEY_MODE, mode); ui.settingsOpen = false; newGame(); });
  }

  function setDifficulty(diff) {
    if (diff === state.diff) return;
    var label = L.LEVELS[diff].label;
    confirmReset('Switch to ' + label + '?', 'Changing difficulty starts a new game.', 'Switch to ' + label,
      function () { ui.settingsOpen = false; newGame(diff); });
  }

  function askNewGame() {
    confirmReset('Start a new game?', 'A new game starts over at level 1.', 'Start new game',
      function () { ui.settingsOpen = false; newGame(); });
  }

  /* ---------- 11. WIRING ---------- */
  $('grid').addEventListener('click', function (e) {
    var btn = e.target.closest('button.c');
    if (btn) onCell(Number(btn.dataset.id));
  });
  $('btnAdd').addEventListener('click', onAdd);
  $('btnUndo').addEventListener('click', onUndo);
  $('btnHint').addEventListener('click', onHint);
  $('btnNew').addEventListener('click', askNewGame);
  $('btnTheme').addEventListener('click', function () { setTheme(!ui.dark); });
  $('btnSettings').addEventListener('click', function () { ui.settingsOpen = !ui.settingsOpen; render(); });
  $('btnEndPrimary').addEventListener('click', function () { if (state.status === 'clear') onNextLevel(); else newGame(); });
  $('btnEndUndo').addEventListener('click', onUndo);
  document.querySelectorAll('[data-diff]').forEach(function (b) {
    b.addEventListener('click', function () { setDifficulty(b.dataset.diff); });
  });
  document.querySelectorAll('[data-mode]').forEach(function (b) {
    b.addEventListener('click', function () { setMode(b.dataset.mode); });
  });
  document.querySelectorAll('[data-theme]').forEach(function (b) {
    b.addEventListener('click', function () { setTheme(b.dataset.theme === 'dark'); });
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

  render();

  /* ---------- 12. OPTIONAL TEST HOOK ----------
     Lets automated tests and screenshots set up exact boards.
     window.__nm.load([3,7], { addsLeft: 0 }) replaces the board.  */
  window.__nm = {
    state: function () { return state; },
    ui: ui,
    load: function (values, extra) {
      resetAll();
      var s = L.newGame(state.diff, state.best, Math.random, state.rules);
      s.cells = values.map(function (v, i) { return { id: i + 1, v: v, done: false }; });
      s.nextId = values.length + 1;
      s.total = values.length;
      for (var k in (extra || {})) s[k] = extra[k];
      state = s;
      render();
    },
    setTheme: setTheme,
    setMode: function (mode) { // test helper: switch style with no confirmation
      ui.mode = mode; store.set(KEY_MODE, mode);
      if (rulesFor(mode) !== state.rules) newGame(); else render();
    },
    openSettings: function (open) { ui.settingsOpen = open; render(); },
    beatable: function () { return L.isBeatable(state); }
  };
})();
