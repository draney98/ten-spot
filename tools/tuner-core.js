/* tuner-core.js: the parts of the difficulty configurator that don't touch the page.
   Works in the browser (window.TenSpotTuner) and in node (tests).
   - readConfig(L) / applyConfig(L, cfg): the difficulty numbers, read from and written into game-logic.js.
   - checkConfig(cfg): a list of problems, empty when the numbers can be used.
   - makeClimb(L, seed, bot): one bot run, played one level at a time so the page stays responsive.
   - summarize(runs, cfg, secondsPerMove): the figures the page shows.
   - reportText(...): the "Copy for Claude" text. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TenSpotTuner = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WALLS = ['row', 'col', 'either', 'both'];
  var STYLES = ['careful', 'casual', 'random'];

  function num(n) { return n === Infinity ? 'inf' : n; }
  function unnum(n) { return n === 'inf' ? Infinity : n; }

  /** The difficulty numbers as plain data (Infinity is written as "inf" so it survives JSON). */
  function readConfig(L) {
    return {
      ramp: L.RAMP.map(function (r) { return { from: r.from, kinds: r.kinds, adds: r.adds, walls: L.wallKinds(r.from) }; }),
      tools: L.TOOLS.map(function (t) {
        return { from: t.from, hints: num(t.hints), undos: num(t.undos), packs: num(t.packs), addAt: t.addAt, mistake: !!t.mistake };
      }),
      tiles: { base: L.TUNE.tilesBase, step: L.TUNE.tilesStep, every: L.TUNE.tilesEvery, max: L.TUNE.tilesMax, maxWidth: L.TUNE.maxWidth },
      normalStart: L.LEVELS.normal.start,
      hardStart: L.LEVELS.hard.start
    };
  }

  function isInt(n, lo, hi) { return typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi; }
  function isCount(n, hi) { return n === 'inf' || isInt(n, 0, hi); }

  /** Problems with a set of numbers, in plain words. An empty list means it can be run. */
  function checkConfig(cfg) {
    var out = [];
    if (!cfg || !Array.isArray(cfg.ramp) || !cfg.ramp.length) return ['The ramp table is empty.'];
    if (!Array.isArray(cfg.tools) || !cfg.tools.length) return ['The buttons table is empty.'];
    [['ramp', 'Ramp'], ['tools', 'Buttons']].forEach(function (t) {
      var rows = cfg[t[0]];
      if (rows[0].from !== 1) out.push(t[1] + ': the first row must start at level 1.');
      for (var i = 0; i < rows.length; i++) {
        if (!isInt(rows[i].from, 1, 999)) out.push(t[1] + ' row ' + (i + 1) + ': "From level" must be a whole number from 1 to 999.');
        if (i && rows[i].from <= rows[i - 1].from) out.push(t[1] + ' row ' + (i + 1) + ': levels must go up from row to row.');
      }
    });
    cfg.ramp.forEach(function (r, i) {
      if (!isInt(r.kinds, 2, 8)) out.push('Ramp row ' + (i + 1) + ': mascots must be 2 to 8.');
      if (!isInt(r.adds, 0, 20)) out.push('Ramp row ' + (i + 1) + ': adds must be 0 to 20.');
      if (!Array.isArray(r.walls) || r.walls.length > 4 || r.walls.some(function (k) { return WALLS.indexOf(k) === -1; })) {
        out.push('Ramp row ' + (i + 1) + ': walls must be up to four of row, col, either, both.');
      }
    });
    cfg.tools.forEach(function (t, i) {
      if (!isCount(t.hints, 99) || !isCount(t.undos, 99) || !isCount(t.packs, 99)) out.push('Buttons row ' + (i + 1) + ': hints, undos and packs must be 0 to 99, or inf.');
      if (!isInt(t.addAt, 0, 20)) out.push('Buttons row ' + (i + 1) + ': "Add at" must be 0 to 20.');
    });
    var T = cfg.tiles || {};
    if (!isInt(T.base, 2, 80) || T.base % 2) out.push('Tiles: the base must be an even number from 2 to 80.');
    if (!isInt(T.step, 0, 20) || T.step % 2) out.push('Tiles: the step must be an even number from 0 to 20.');
    if (!isInt(T.every, 1, 50)) out.push('Tiles: "every" must be 1 to 50 levels.');
    if (!isInt(T.max, 4, 120) || T.max % 2) out.push('Tiles: the most tiles must be an even number from 4 to 120.');
    if (!isInt(T.maxWidth, 5, 12)) out.push('Tiles: the widest board must be 5 to 12 across.');
    if (!isInt(cfg.normalStart, 2, 998)) out.push('Normal must start at level 2 or later.');
    if (!isInt(cfg.hardStart, 3, 999) || cfg.hardStart <= cfg.normalStart) out.push('Hard must start after Normal.');
    return out;
  }

  /** Write the numbers into game-logic.js (the tables are changed in place). Throws on a bad config. */
  function applyConfig(L, cfg) {
    var problems = checkConfig(cfg);
    if (problems.length) throw new Error(problems[0]);
    L.RAMP.length = 0;
    cfg.ramp.forEach(function (r) {
      var row = { from: r.from, kinds: r.kinds, adds: r.adds, walls: r.walls.length };
      if (r.walls.some(function (k) { return k !== 'row'; })) row.wk = r.walls.slice();
      L.RAMP.push(row);
    });
    L.TOOLS.length = 0;
    cfg.tools.forEach(function (t) {
      L.TOOLS.push({ from: t.from, hints: unnum(t.hints), undos: unnum(t.undos), packs: unnum(t.packs), addAt: t.addAt, mistake: !!t.mistake });
    });
    L.TUNE.tilesBase = cfg.tiles.base; L.TUNE.tilesStep = cfg.tiles.step; L.TUNE.tilesEvery = cfg.tiles.every;
    L.TUNE.tilesMax = cfg.tiles.max; L.TUNE.maxWidth = cfg.tiles.maxWidth;
    L.LEVELS.normal.start = cfg.normalStart;
    L.LEVELS.hard.start = cfg.hardStart;
  }

  function mulberry(a) {
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  /* ---- the bot ----
     bot = { style, pack, undos }
       style 'careful': the pair that leaves the most pairs open (two the same breaks ties). The strongest play.
             'casual' : the first pair in reading order, two the same if there is one. Like following Hint.
             'random' : any legal pair.
       pack  true: with no pair left it Packs if that opens one, before it Adds.
       undos how many undos a level it may use (never more than the level allows). When a board dies it
             steps back to its latest choice and tries its next pick there; each step back costs one undo. */
  function choices(L, s, bot, rng) {
    var pairs = L.allPairs(s.cells, true, 'pairs', s.cols);
    if (!pairs.length) return [];
    var list;
    if (bot.style === 'random') {
      list = pairs.slice();
      for (var i = list.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = list[i]; list[i] = list[j]; list[j] = t; }
    } else if (bot.style === 'casual') {
      list = pairs.filter(function (p) { return !L.mixedShade(s.cells[p[0]].v, s.cells[p[1]].v); })
        .concat(pairs.filter(function (p) { return L.mixedShade(s.cells[p[0]].v, s.cells[p[1]].v); }));
    } else {
      list = pairs.map(function (p) {
        var cells = s.cells.map(function (c, k) { return (k === p[0] || k === p[1]) ? { id: c.id, v: c.v, done: true } : c; });
        var v = L.allPairs(L.compact(cells, s.cols), true, 'pairs', s.cols).length * 10 + (L.mixedShade(s.cells[p[0]].v, s.cells[p[1]].v) ? 0 : 3);
        return { p: p, v: v };
      }).sort(function (a, b) { return b.v - a.v; }).map(function (x) { return x.p; });
    }
    return list.slice(0, 3).map(function (p) { return [s.cells[p[0]].id, s.cells[p[1]].id]; });
  }
  function takePair(L, s, ids) {
    var n = L.select(L.select(s, ids[0]).state, ids[1]).state;
    return n.status === 'playing' ? L.compactBoard(n) : n;
  }

  /** Play one dealt level. Returns { state, moves } (moves = pairs, adds and packs, undone ones included). */
  function playLevel(L, s, bot, rng) {
    var path = [], moves = 0, guard = 0;
    var undos = Math.min(bot.undos || 0, isFinite(s.undosLeft) ? s.undosLeft : 99);
    while (guard++ < 20000) {
      if (s.status === 'clear') break;
      if (s.status === 'playing') {
        var opts = choices(L, s, bot, rng);
        if (opts.length) { path.push({ state: s, opts: opts, k: 0 }); s = takePair(L, s, opts[0]); moves++; continue; }
        if (bot.pack && L.canCompact(s)) {
          var packed = L.packBoard(s).state;
          if (L.allPairs(packed.cells, true, 'pairs', s.cols).length || !L.canAdd(s)) { path.push({ state: s }); s = packed; moves++; continue; }
        }
        if (L.canAdd(s)) { path.push({ state: s }); s = L.addNumbers(s).state; moves++; continue; }
      }
      // the board is dead: step back to the latest choice that has an untried pick
      var back = 0, found = -1;
      for (var p = path.length - 1; p >= 0; p--) { back++; if (path[p].opts && path[p].k + 1 < path[p].opts.length) { found = p; break; } }
      if (found < 0 || back > undos) break;
      undos -= back;
      var d = path[found];
      path.length = found;
      d.k++;
      path.push(d);
      s = takePair(L, d.state, d.opts[d.k]);
      moves++;
    }
    return { state: s, moves: moves };
  }

  /** One run. step() plays the next level and returns true while the run is still going.
      result = { lost: the level it ended on, moves: [moves on each level played, the first is startLevel] }. */
  function makeClimb(L, seed, bot, startLevel, maxLevel) {
    var rng = mulberry(seed), level = startLevel || 1, score = 0;
    var result = { start: level, lost: level, moves: [], done: false };
    maxLevel = maxLevel || 150;
    return {
      result: result,
      step: function () {
        if (result.done) return false;
        var s = L.dealPuzzle({ diff: 'easy', level: level, seed: Math.floor(rng() * 4294967296) >>> 0, score: score });
        var played = playLevel(L, s, bot, rng);
        result.moves.push(played.moves);
        result.lost = level;
        if (played.state.status !== 'clear' || level >= maxLevel) {
          if (played.state.status === 'clear') result.lost = level + 1;   // never lost: counts as past the last level
          result.done = true;
          return false;
        }
        score = played.state.score + played.state.bonus;
        level++;
        return true;
      }
    };
  }

  /** The target curve the ramp was tuned to: the share of runs that should reach a level. */
  function targetReach(level) { return Math.exp(-Math.pow((level - 1) / 57, 4)); }

  /** Figures for a batch of finished runs. */
  function summarize(runs, cfg, secondsPerMove) {
    var n = runs.length, start = n ? runs[0].start : 1, sec = secondsPerMove || 3;
    var lost = runs.map(function (r) { return r.lost; }).sort(function (a, b) { return a - b; });
    var top = n ? lost[n - 1] : start;
    var reach = [];   // reach[i] = share of runs that got to level start + i
    for (var lv = start; lv <= top; lv++) reach.push(runs.filter(function (r) { return r.lost >= lv; }).length / n);
    var bands = [];   // of the runs that got to a band of 5 levels, the share that ended in it
    for (var b = Math.floor((start - 1) / 5) * 5 + 1; b <= top; b += 5) {
      var entered = runs.filter(function (r) { return r.lost >= b; }).length;
      var ended = runs.filter(function (r) { return r.lost >= b && r.lost <= b + 4; }).length;
      if (entered) bands.push({ from: b, to: b + 4, entered: entered, lost: ended / entered });
    }
    var edges = [['Easy', 1, cfg.normalStart - 1], ['Normal', cfg.normalStart, cfg.hardStart - 1], ['Hard', cfg.hardStart, Infinity]];
    var stages = edges.map(function (e) {
      var inStage = runs.filter(function (r) { return r.lost >= e[1] && r.start <= e[2]; });
      var levels = 0, moves = 0;
      inStage.forEach(function (r) {
        for (var i = 0; i < r.moves.length; i++) {
          var lvl = r.start + i;
          if (lvl >= e[1] && lvl <= e[2]) { levels++; moves += r.moves[i]; }
        }
      });
      return {
        name: e[0], from: e[1], to: e[2], runs: inStage.length,
        levels: inStage.length ? levels / inStage.length : 0,
        minutes: inStage.length ? moves * sec / 60 / inStage.length : 0,
        finished: isFinite(e[2]) && inStage.length ? runs.filter(function (r) { return r.lost > e[2]; }).length / inStage.length : null
      };
    });
    return { runs: n, start: start, median: n ? lost[Math.floor(n / 2)] : start, top: top, reach: reach, bands: bands, stages: stages };
  }
  function reachAt(sum, level) {
    var i = level - sum.start;
    return i < 0 ? 1 : i >= sum.reach.length ? 0 : sum.reach[i];
  }

  function pct(x) { return Math.round(x * 100) + '%'; }
  /** Plain text for pasting to Claude: the numbers, the bot, and what happened. */
  function reportText(name, cfg, bot, sum) {
    var lines = ['ten-spot tuner run' + (name ? ': ' + name : ''), ''];
    lines.push('RAMP (from level: mascots, adds, walls)');
    cfg.ramp.forEach(function (r) { lines.push('  ' + r.from + ': ' + r.kinds + ', ' + r.adds + ', ' + (r.walls.length ? r.walls.join('+') : 'none')); });
    lines.push('BUTTONS (from level: hints, undos, packs, add at, early add is a mistake)');
    cfg.tools.forEach(function (t) { lines.push('  ' + t.from + ': ' + t.hints + ', ' + t.undos + ', ' + t.packs + ', ' + t.addAt + ', ' + (t.mistake ? 'yes' : 'no')); });
    lines.push('TILES: ' + cfg.tiles.base + ' + ' + cfg.tiles.step + ' every ' + cfg.tiles.every + ' levels, at most ' + cfg.tiles.max + '; widest board ' + cfg.tiles.maxWidth);
    lines.push('STAGES: Normal from ' + cfg.normalStart + ', Hard from ' + cfg.hardStart);
    lines.push('BOT: ' + bot.style + ', ' + (bot.pack ? 'uses Pack' : 'no Pack') + ', ' + (bot.undos || 0) + ' undos a level');
    lines.push('');
    lines.push('RESULT: ' + sum.runs + ' runs from level ' + sum.start + ', median run ended on level ' + sum.median);
    lines.push('Reached level (bot / target): ' + [11, 21, 31, 41, 51, 61, 71, 81, 91].filter(function (l) { return l > sum.start; })
      .map(function (l) { return l + ': ' + pct(reachAt(sum, l)) + ' / ' + pct(targetReach(l)); }).join(', '));
    lines.push('Lost per 5 levels: ' + sum.bands.map(function (b) { return b.from + '-' + b.to + ': ' + pct(b.lost); }).join(', '));
    lines.push('Stages: ' + sum.stages.filter(function (s) { return s.runs; })
      .map(function (s) { return s.name + ' ' + s.levels.toFixed(1) + ' levels, about ' + Math.round(s.minutes) + ' min'; }).join('; '));
    return lines.join('\n');
  }

  /** Real play: turn the server's run-end counts into a reach curve for runs that started at `start`. */
  function realReach(rows, start) {
    var mine = (rows || []).filter(function (r) { return r.start === start; });
    var total = mine.reduce(function (a, r) { return a + r.n; }, 0);
    if (!total) return null;
    var top = mine.reduce(function (a, r) { return Math.max(a, r.level); }, 1), from = mine.reduce(function (a, r) { return Math.min(a, r.level); }, 999);
    var reach = [];
    for (var lv = 1; lv <= top; lv++) reach.push(mine.reduce(function (a, r) { return a + (r.level >= lv ? r.n : 0); }, 0) / total);
    return { runs: total, start: 1, reach: reach, lowest: from };
  }

  return {
    WALLS: WALLS, STYLES: STYLES,
    readConfig: readConfig, checkConfig: checkConfig, applyConfig: applyConfig,
    playLevel: playLevel, makeClimb: makeClimb, targetReach: targetReach,
    summarize: summarize, reachAt: reachAt, reportText: reportText, realReach: realReach
  };
});
