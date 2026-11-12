/* Bot simulation of the ramp. Run from the repo root:
     node tools/sim.js [runs] [seed]        (default 100 runs, seed 1)
   A bot climbs from level 1 until it loses a level. It is the "careful" bot from tools/tuner-core.js:
   on every move it plays the pair that leaves the most pairs open afterwards (two outlines or two
   solids break ties). With no pair, it Packs if that opens one, else Adds. It never uses Hint or Undo,
   so people with those can do better early, and most people do worse late.
   Prints how many runs reach each level, against the target curve exp(-(L/57)^4).
   For other bots and other numbers, use tools/tuner.html. */
'use strict';
var L = require('../game-logic.js');
var T = require('./tuner-core.js');

var BOT = { style: 'careful', pack: true, undos: 0 };

/** Play one dealt level to the end. Returns the final state. */
function playLevel(s) { return T.playLevel(L, s, BOT, Math.random).state; }

/** One climb from level 1. Returns the level it lost on. */
function climb(seed, maxLevel) {
  var run = T.makeClimb(L, seed, BOT, 1, maxLevel);
  while (run.step()) { /* next level */ }
  return { lost: run.result.lost };
}

if (require.main === module) {
  var runs = Number(process.argv[2]) || 100, seed = Number(process.argv[3]) || 1;
  var lost = [];
  for (var r = 0; r < runs; r++) lost.push(climb(seed + r * 7919, 150).lost);
  console.log('runs: ' + runs + '   median level lost on: ' + lost.slice().sort(function (a, b) { return a - b; })[Math.floor(runs / 2)]);
  console.log('reach level   bot    target');
  [11, 21, 31, 41, 51, 61, 71, 81, 91].forEach(function (lv) {
    var share = lost.filter(function (x) { return x >= lv; }).length / runs;
    console.log(('     ' + lv).slice(-5) + '        ' + ('   ' + Math.round(share * 100)).slice(-3) + '%    ' + ('   ' + Math.round(T.targetReach(lv) * 100)).slice(-3) + '%');
  });
}

module.exports = { playLevel: playLevel, climb: climb };
