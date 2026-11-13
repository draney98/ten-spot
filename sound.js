/* sound.js: the game's quiet ticks. Short sine clicks made in the browser, no sound files.
   window.TenSpotSound.create(isOn) -> { play(name) }. isOn() says whether sound is turned on;
   it is off until the player turns it on (app.js remembers the choice).
   Names: match, row, clear, bad, stage, sweep, end; anything else is a soft click. */
(function () {
  'use strict';
  function create(isOn) {
    var audioCtx = null;
    function audio() {
      if (!isOn()) return null;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return audioCtx;
    }
    function blip(freq, dur, gain, when) {
      var ctx = audio();
      if (!ctx) return;
      var t = when == null ? ctx.currentTime : when;
      var osc = ctx.createOscillator();
      var amp = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      amp.gain.setValueAtTime(gain, t);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(amp);
      amp.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
    function play(name) {
      var ctx = audio();
      if (!ctx) return;
      var t = ctx.currentTime;
      if (name === 'match') blip(1180, 0.024, 0.045, t);
      else if (name === 'row') { blip(1180, 0.02, 0.04, t); blip(1480, 0.028, 0.04, t + 0.05); }
      else if (name === 'clear') { blip(880, 0.028, 0.04, t); blip(1320, 0.036, 0.045, t + 0.08); }
      else if (name === 'bad') blip(180, 0.04, 0.05, t);
      else if (name === 'stage') {   // reached Normal or Hard: three rising notes
        blip(523, 0.09, 0.04, t); blip(659, 0.09, 0.04, t + 0.12); blip(784, 0.22, 0.045, t + 0.24);
      }
      else if (name === 'sweep') {   // clean sweep: a quick run up
        for (var k = 0; k < 6; k++) blip(880 + k * 120, 0.03, 0.035, t + k * 0.05);
      }
      else if (name === 'end') {   // game over: four soft falling notes
        blip(523, 0.16, 0.04, t); blip(440, 0.16, 0.04, t + 0.2);
        blip(349, 0.18, 0.04, t + 0.4); blip(262, 0.4, 0.045, t + 0.62);
      }
      else blip(660, 0.016, 0.032, t);
    }
    return { play: play };
  }
  window.TenSpotSound = { create: create };
})();
