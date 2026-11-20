/* sound.js: ten-spot's sounds, in the spirit of a slot machine: bells that climb with a streak, coin
   chings, a reel spin for Add, and a jackpot for the big moments. All made in the browser with Web Audio;
   no sound files. Everyday sounds are short and quiet; the loud, long ones are kept for rare moments.
   Each sound varies its pitch a little every time so repeats don't grate.

   window.TenSpotSound.create(isOn) -> { play(name, opts) }. isOn() says whether sound is turned on;
   it is off until the player turns it on (app.js remembers the choice).
   window.TenSpotSound.NAMES lists every sound, in the order the sound board (tools/sounds.html) shows them.

   Names and options:
     tap                  a tile picked or put back: a soft tick
     match   {streak}     a pair cleared: a bell, one note higher for each pair in the streak (a scale, like reels landing)
     row     {streak}     a pair that also emptied a row: the bell and a coin
     streak               the streak multiplier went up: a quick rising chime
     wall    {bonus}      a wall went: ka-ching, with more coins for a bigger bonus
     bad                  a wrong pick or a button that can't be used yet: a soft low bonk
     hint                 a sparkle
     undo                 a falling sweep, the bell played backwards
     add                  a reel spin that slows and lands
     pack                 a coin-slide shh as the tiles close up
     finish  {pairs}      the rest cleared: a payout run of rising bells
     clear                a level cleared: a small win, rising notes ending on a chord
     sweep                a clean sweep (or a Daily under par): the jackpot, a fanfare and a rain of coins
     best                 the score passed your best: a bonus-round chime (once a game)
     stage                a new stage, or the next Daily board: a level-up fanfare
     end                  game over: the reels wind down to one soft low note
   Anything else is a soft tick. */
(function () {
  'use strict';
  var NAMES = ['tap', 'match', 'row', 'streak', 'wall', 'bad', 'hint', 'undo', 'add', 'pack', 'finish', 'clear', 'sweep', 'best', 'stage', 'end'];
  var PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];   // major pentatonic steps: every run sounds sweet
  function hz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
  function vary(f) { return f * (1 + (Math.random() - 0.5) * 0.024); }   // about a quarter of a semitone either way

  function create(isOn) {
    var ctx = null, out = null, noiseBuf = null;
    function audio() {
      if (!isOn()) return null;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!ctx) {
        ctx = new AC();
        // everything goes through one gain and a gentle compressor, so stacked coins never clip
        var comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4;
        out = ctx.createGain();
        out.gain.value = 0.9;
        out.connect(comp);
        comp.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    /** One note: a quick attack, then a fall away. o: { type, to (glide to this pitch), attack } */
    function tone(f, t, dur, gain, o) {
      o = o || {};
      var osc = ctx.createOscillator(), amp = ctx.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(f, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      var a = o.attack || 0.004;
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(gain, t + a);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
      osc.connect(amp); amp.connect(out);
      osc.start(t); osc.stop(t + a + dur + 0.03);
    }
    /** A bell: a pure note with two bright overtones that die first. */
    function bell(f, t, dur, gain) {
      tone(f, t, dur, gain);
      if (f * 2.76 < 9000) tone(f * 2.76, t, dur * 0.45, gain * 0.32);   // overtones above 9 kHz only hiss
      if (f * 5.4 < 9000) tone(f * 5.4, t, dur * 0.22, gain * 0.14);
    }
    /** A coin: the classic two-step ching, high and bright, softened by a filter. */
    function coin(t, gain) {
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 5200; lp.connect(out);
      [[vary(hz(83)), 0, 0.06], [vary(hz(88)), 0.06, 0.32]].forEach(function (n) {
        var osc = ctx.createOscillator(), amp = ctx.createGain();
        osc.type = 'square'; osc.frequency.value = n[0];
        amp.gain.setValueAtTime(0.0001, t + n[1]);
        amp.gain.exponentialRampToValueAtTime(gain, t + n[1] + 0.004);
        amp.gain.exponentialRampToValueAtTime(0.0001, t + n[1] + n[2]);
        osc.connect(amp); amp.connect(lp);
        osc.start(t + n[1]); osc.stop(t + n[1] + n[2] + 0.03);
      });
    }
    /** A burst of filtered noise: clicks, shh, the "ka" of ka-ching. The filter can sweep from f to f2. */
    function noise(t, dur, gain, f, f2, q) {
      if (!noiseBuf) {
        noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.6), ctx.sampleRate);
        var d = noiseBuf.getChannelData(0);
        for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      var src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), amp = ctx.createGain();
      src.buffer = noiseBuf;
      bp.type = 'bandpass'; bp.Q.value = q || 1.2;
      bp.frequency.setValueAtTime(f, t);
      if (f2) bp.frequency.exponentialRampToValueAtTime(f2, t + dur);
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(gain, t + 0.003);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp); bp.connect(amp); amp.connect(out);
      src.start(t, Math.random() * 0.2); src.stop(t + dur + 0.02);
    }
    /** The bell for a pair: one pentatonic step higher for each pair in the streak. */
    function streakBell(t, streak, gain) {
      var step = Math.max(0, Math.min(PENTA.length - 1, (streak || 1) - 1));
      bell(vary(hz(76 + PENTA[step])), t, 0.32, gain);
    }

    var SOUNDS = {
      tap: function (t) { tone(vary(1320), t, 0.03, 0.022, { type: 'triangle' }); },
      match: function (t, o) { streakBell(t, o.streak, 0.06); },
      row: function (t, o) { streakBell(t, o.streak, 0.06); coin(t + 0.07, 0.03); },
      streak: function (t) { [88, 91, 96].forEach(function (m, k) { bell(hz(m), t + 0.09 + k * 0.05, 0.16, 0.035); }); },
      wall: function (t, o) {
        noise(t, 0.05, 0.12, 2600, 1800, 0.9);            // ka
        bell(hz(98), t + 0.05, 0.5, 0.04);                 // -ching
        bell(hz(103), t + 0.05, 0.4, 0.025);
        var more = Math.max(1, Math.min(5, Math.floor(Math.log(Math.max(10, o.bonus || 10)) / Math.LN10)));
        for (var k = 0; k < more; k++) coin(t + 0.12 + k * 0.08, 0.028);
      },
      bad: function (t) {
        tone(vary(220), t, 0.11, 0.07, { type: 'triangle', to: 175 });
        tone(vary(165), t + 0.1, 0.16, 0.06, { type: 'triangle', to: 125 });
      },
      hint: function (t) {
        for (var k = 0; k < 5; k++) tone(hz(96 + PENTA[Math.floor(Math.random() * 7)]), t + k * 0.045, 0.14, 0.022);
      },
      undo: function (t) { tone(1250, t, 0.2, 0.04, { to: 380 }); tone(2500, t, 0.1, 0.012, { to: 760 }); },
      add: function (t) {   // the reels spin, slow and land
        var at = t, gap = 0.022;
        for (var k = 0; k < 16; k++) {
          noise(at, 0.012, 0.05, 3200, null, 2);
          tone(vary(1700), at, 0.012, 0.012, { type: 'triangle' });
          at += gap; gap *= 1.13;
        }
        tone(hz(64), at + 0.02, 0.14, 0.05, { type: 'triangle' });   // clunk
      },
      pack: function (t) { noise(t, 0.26, 0.07, 900, 4200, 1.6); tone(hz(84), t + 0.25, 0.05, 0.02, { type: 'triangle' }); },
      finish: function (t, o) {
        var n = Math.max(3, Math.min(12, o.pairs || 4));
        for (var k = 0; k < n; k++) bell(hz(79 + PENTA[k]), t + k * 0.06, 0.2, 0.04);
        coin(t + n * 0.06, 0.03);
      },
      clear: function (t) {
        [72, 76, 79, 84].forEach(function (m, k) { bell(hz(m), t + k * 0.08, 0.22, 0.045); });
        [72, 76, 79, 84].forEach(function (m) { tone(hz(m), t + 0.34, 0.6, 0.02, { type: 'triangle', attack: 0.02 }); });
        coin(t + 0.36, 0.028);
      },
      sweep: function (t) {   // the jackpot
        for (var k = 0; k < 12; k++) bell(hz(72 + PENTA[k]), t + k * 0.045, 0.18, 0.04);
        var at = t + 12 * 0.045;
        [72, 76, 79, 84, 88].forEach(function (m) {
          tone(hz(m), at, 1.0, 0.018, { type: 'triangle', attack: 0.02 });
          tone(hz(m) * 1.004, at, 1.0, 0.012, { type: 'sine', attack: 0.02 });   // a slight shimmer
        });
        for (var c = 0; c < 10; c++) coin(at + Math.random() * 1.1, 0.022);
      },
      best: function (t) {
        bell(hz(91), t, 0.6, 0.045); bell(hz(96), t + 0.07, 0.7, 0.045);
        for (var k = 0; k < 4; k++) tone(hz(103 + PENTA[k]), t + 0.15 + k * 0.05, 0.2, 0.012);
      },
      stage: function (t) {
        [72, 76, 79].forEach(function (m, k) { tone(hz(m), t + k * 0.11, 0.1, 0.04, { type: 'triangle' }); });
        bell(hz(84), t + 0.33, 0.5, 0.05);
      },
      end: function (t) {   // the reels wind down
        var at = t, gap = 0.05;
        for (var k = 0; k < 8; k++) { noise(at, 0.014, 0.04, 2400, null, 2); at += gap; gap *= 1.22; }
        [72, 69, 65].forEach(function (m, k) { tone(hz(m), t + 0.15 + k * 0.22, 0.2, 0.04, { type: 'triangle' }); });
        tone(hz(60), t + 0.85, 0.6, 0.05, { type: 'triangle' });
      }
    };

    function play(name, opts) {
      if (!audio()) return;
      var t = ctx.currentTime + 0.005;
      (SOUNDS[name] || SOUNDS.tap)(t, opts || {});
    }
    return { play: play };
  }
  window.TenSpotSound = { create: create, NAMES: NAMES };
})();
