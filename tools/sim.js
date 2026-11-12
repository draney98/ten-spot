/* Bot simulation of the ramp. Run from the repo root:
     node tools/sim.js [runs] [seed]        (default 100 runs, seed 1)
   A bot climbs from level 1 until it loses a level. On every move it plays the pair that
   leaves the most pairs open afterwards (two outlines or two solids break ties). With no
   pair, it Packs if that opens one, else Adds. It never uses Hint or Undo, so people with
   those can do better early, and most people do worse late.
   Prints how many runs reach each level, against the target curve exp(-(L/57)^4). */
'use strict';
var L = require('../game-logic.js');

function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function pairsAfter(s, i, j) {
  var cells = s.cells.map(function (c, k) { return (k === i || k === j) ? Object.assign({}, c, { done: true }) : c; });
  return L.allPairs(L.compact(cells, s.cols), true, 'pairs', s.cols).length;
}

function playLevel(s) {
  for (var steps = 0; s.status === 'playing' && steps < 4000; steps++) {
    var pairs = L.allPairs(s.cells, true, 'pairs', s.cols);
    if (pairs.length) {
      var best = null, bestV = -1;
      pairs.forEach(function (p) {
        var v = pairsAfter(s, p[0], p[1]) * 10 + (L.mixedShade(s.cells[p[0]].v, s.cells[p[1]].v) ? 0 : 3);
        if (v > bestV) { bestV = v; best = p; }
      });
      s = L.select(L.select(s, s.cells[best[0]].id).state, s.cells[best[1]].id).state;
      if (s.status === 'playing') s = L.compactBoard(s);
      continue;
    }
    if (L.canCompact(s)) {
      var packed = L.packBoard(s).state;
      if (L.allPairs(packed.cells, true, 'pairs', s.cols).length || !L.canAdd(s)) { s = packed; continue; }
    }
    if (L.canAdd(s)) { s = L.addNumbers(s).state; continue; }
    break;
  }
  return s;
}

/** One climb from level 1. Returns the level it lost on, and its score. */
function climb(seed, maxLevel) {
  var rng = mulberry(seed), score = 0, level = 1;
  for (; level <= maxLevel; level++) {
    var s = L.dealPuzzle({ diff: 'easy', level: level, seed: Math.floor(rng() * 4294967296) >>> 0, score: score });
    s = playLevel(s);
    if (s.status !== 'clear') break;
    score = s.score + s.bonus;
  }
  return { lost: level, score: score };
}

if (require.main === module) {
  var runs = Number(process.argv[2]) || 100, seed = Number(process.argv[3]) || 1;
  var lost = [];
  for (var r = 0; r < runs; r++) lost.push(climb(seed + r * 7919, 150).lost);
  console.log('runs: ' + runs + '   median level lost on: ' + lost.slice().sort(function (a, b) { return a - b; })[Math.floor(runs / 2)]);
  console.log('reach level   bot    target');
  [11, 21, 31, 41, 51, 61, 71, 81, 91].forEach(function (lv) {
    var share = lost.filter(function (x) { return x >= lv; }).length / runs;
    var target = Math.exp(-Math.pow((lv - 1) / 57, 4));
    console.log(('     ' + lv).slice(-5) + '        ' + ('   ' + Math.round(share * 100)).slice(-3) + '%    ' + ('   ' + Math.round(target * 100)).slice(-3) + '%');
  });
}

module.exports = { playLevel: playLevel, climb: climb };
