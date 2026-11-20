/* Run with:  node tests/sound.test.js
   The sounds (sound.js) in a pretend browser: every sound plays without an error, stays quiet while
   sound is off, keeps its notes in hearing range and below full volume, and the big ones run longer. */
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e.stack || e.message)); }
}

/** A pretend Web Audio that records every note: { freq, start, stop, gain }. */
function fakeAudio(log) {
  function param(owner, key) {
    return {
      value: 0,
      setValueAtTime: function (v, t) { this.value = v; owner[key + 'At'] = t; },
      exponentialRampToValueAtTime: function (v) { owner.peak = Math.max(owner.peak || 0, key === 'gain' ? v : 0); }
    };
  }
  function node(kind) {
    var n = { kind: kind, connect: function () {}, start: function (t) { n.start_ = t; }, stop: function (t) { n.stop_ = t; log.push(n); } };
    n.frequency = param(n, 'freq'); n.gain = param(n, 'gain'); n.Q = param(n, 'q');
    n.threshold = param(n, 'th'); n.knee = param(n, 'kn'); n.ratio = param(n, 'ra');
    return n;
  }
  function Ctx() { this.currentTime = 0; this.sampleRate = 8000; this.state = 'running'; this.destination = {}; }
  Ctx.prototype.createOscillator = function () { return node('osc'); };
  Ctx.prototype.createGain = function () { return node('gain'); };
  Ctx.prototype.createBiquadFilter = function () { return node('filter'); };
  Ctx.prototype.createDynamicsCompressor = function () { return node('comp'); };
  Ctx.prototype.createBufferSource = function () { return node('noise'); };
  Ctx.prototype.createBuffer = function (c, len) { var d = new Float32Array(len); return { getChannelData: function () { return d; } }; };
  Ctx.prototype.resume = function () {};
  return Ctx;
}
function load(on) {
  var log = [];
  var win = { AudioContext: fakeAudio(log) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sound.js'), 'utf8'), { window: win, Math: Math });
  return { snd: win.TenSpotSound.create(function () { return on; }), NAMES: win.TenSpotSound.NAMES, log: log };
}
function lengthOf(log) { return log.reduce(function (m, n) { return Math.max(m, n.stop_ || 0); }, 0); }

test('every sound plays, with notes in hearing range and below full volume', function () {
  var x = load(true);
  assert.ok(x.NAMES.length >= 16);
  x.NAMES.forEach(function (name) {
    x.log.length = 0;
    x.snd.play(name, { streak: 5, bonus: 2400, pairs: 6 });
    assert.ok(x.log.length > 0, name + ' made no sound');
    x.log.forEach(function (n) {
      if (n.kind === 'osc') assert.ok(n.frequency.value > 60 && n.frequency.value < 12000, name + ' pitch ' + n.frequency.value);
      assert.ok(!(n.peak > 0.2), name + ' too loud');
    });
  });
});

test('nothing plays while sound is off', function () {
  var x = load(false);
  x.NAMES.forEach(function (name) { x.snd.play(name); });
  assert.strictEqual(x.log.length, 0);
});

test('the match bell climbs with the streak; the big moments last longer', function () {
  var x = load(true);
  function pitch(streak) { x.log.length = 0; x.snd.play('match', { streak: streak }); return x.log[0].frequency.value; }
  assert.ok(pitch(4) > pitch(1) * 1.3, 'higher for a longer streak');
  function len(name) { x.log.length = 0; x.snd.play(name, { pairs: 6, bonus: 500 }); return lengthOf(x.log); }
  assert.ok(len('tap') < 0.1 && len('match') < 0.5, 'everyday sounds are short');
  assert.ok(len('sweep') > 1 && len('sweep') > len('clear'), 'the jackpot is the longest');
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
