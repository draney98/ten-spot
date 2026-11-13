/* account.js: the Account group in Settings, and signing this device in and out.
   No passwords, emails, texts or passkeys (see server/accounts.js):
   - Make an account: a name. The server sends back a device key (kept in browser storage) and a
     recovery key (shown once, as a link, then forgotten by this page).
   - Add a device: a signed-in device gets a code like ab3k-9mxq (one use, 10 minutes) and a link.
   - Sign in: type that code, open that link, or open the recovery link.
   - A score code this device already had is brought into the account, then forgotten here.
   Loaded after scores-client.js and before app.js. app.js calls TenSpotAccount.create(deps). */
(function () {
  'use strict';

  /**
   * deps: {
   *   api, S (scores-client), store, KEY, $, drawText,
   *   loadBest() -> bests on this device,  adoptBests(bests) -> merges into this device and redraws,
   *   about() -> { version, run } for the bests being sent,
   *   ask(title, text, yesLabel, action),  note(text),  openSettings(),  render(),
 *   afterSignIn() -> called once this device has signed in (app.js picks up the saved game)
   * }
   */
  function create(d) {
    var S = d.S, $ = d.$;
    var ui = { error: '', me: null, link: null, recovery: '', renaming: false, busy: false };
    var linkTimer = null;

    function account() { return S.readAccount(d.store.get(d.KEY.account)); }
    function isSignedIn() { return !!(d.api && account()); }
    function setAccount(a) { d.store.set(d.KEY.account, S.writeAccount(a)); }
    function forgetAccount() {
      d.store.set(d.KEY.account, '');
      try { window.localStorage.removeItem(d.KEY.account); } catch (e) { /* ignore */ }
      ui.me = null; ui.link = null; ui.renaming = false;
    }
    function forgetScoreCode() {
      d.store.set(d.KEY.player, '');
      try { window.localStorage.removeItem(d.KEY.player); } catch (e) { /* ignore */ }
    }
    function pageLink(param, value) {
      return window.location.origin + window.location.pathname + '?' + param + '=' + encodeURIComponent(value);
    }
    function problem(res, what) {
      if (!res || res.ok) return '';
      if (res.status === 0) return "Couldn't reach the score server. Try again in a moment.";
      if (res.status === 429) return 'Too many tries. Wait a minute and try again.';
      if (what === 'name' && res.status === 400) return 'Names are 1 to 24 characters.';
      if (what === 'link') return "That code didn't work. Codes work once, for 10 minutes.";
      if (what === 'recover') return 'That recovery link has been used already, or is not right.';
      if (res.status === 409) return 'That score code belongs to another account.';
      return 'Something went wrong. Try again in a moment.';
    }
    function fail(res, what) { ui.busy = false; ui.error = problem(res, what); d.render(); }

    /* ---- bests ---- */
    /** Raise the account's bests. Resolves true when the server took them. */
    function pushBests(bests) {
      var a = account();
      if (!a || !d.api) return Promise.resolve(false);
      return S.putMeBests(d.api, a.key, bests, fetch, d.about()).then(function (res) {
        if (res.status === 401) { signedOutElsewhere(); return false; }
        if (res.ok) d.adoptBests(res.body);
        return res.ok;
      });
    }
    /** Fetch the account: name, bests (merged both ways with this device) and devices. */
    function pull() {
      var a = account();
      if (!a || !d.api) return Promise.resolve();
      return S.getMe(d.api, a.key, fetch).then(function (res) {
        if (res.status === 401) { signedOutElsewhere(); return; }
        if (!res.ok) return;
        ui.me = res.body;
        if (res.body.name !== a.name) setAccount({ key: a.key, name: res.body.name });
        var mine = d.loadBest(), merged = S.mergeBests(mine, res.body.bests);
        d.adoptBests(merged);
        if (merged.easy > res.body.bests.easy || merged.normal > res.body.bests.normal || merged.hard > res.body.bests.hard) pushBests(merged);
        d.render();
      });
    }
    function signedOutElsewhere() {
      forgetAccount();
      d.note('This device was signed out of its account. Your bests here are kept.');
      d.render();
    }

    /* ---- signing in ---- */
    /** After any sign-in: keep the account, bring in this device's score code, and sync. */
    function signedIn(body, recovery) {
      setAccount({ key: body.key, name: body.account.name });
      var code = d.store.get(d.KEY.player);
      var folding = code ? S.foldCode(d.api, body.key, code, fetch) : Promise.resolve({ ok: true });
      return folding.then(function (res) {
        if (res.ok) forgetScoreCode();
        ui.busy = false; ui.error = '';
        if (recovery) { ui.recovery = recovery; if (d.openSettings) d.openSettings(); }
        return pull().then(function () { if (d.afterSignIn) d.afterSignIn(); });
      });
    }
    function makeAccount(name) {
      if (!d.api) { ui.error = "Couldn't reach the score server."; d.render(); return; }
      ui.busy = true; ui.error = ''; d.render();
      S.createAccount(d.api, { name: name, label: S.deviceLabel(navigator.userAgent), code: d.store.get(d.KEY.player) || undefined }, fetch).then(function (res) {
        if (!res.ok) return fail(res, 'name');
        forgetScoreCode();   // the account took it over
        return signedIn(res.body, res.body.recovery).then(function () {
          d.note('Account made. Save your recovery link (in Settings) before you go.');
        });
      });
    }
    function useLinkCode(code) {
      ui.busy = true; ui.error = ''; d.render();
      S.useLink(d.api, { code: code, label: S.deviceLabel(navigator.userAgent) }, fetch).then(function (res) {
        if (!res.ok) return fail(res, 'link');
        return signedIn(res.body).then(function () { d.note('Signed in as ' + res.body.account.name + '.'); });
      });
    }
    function useRecovery(key) {
      ui.busy = true; ui.error = ''; d.render();
      S.recover(d.api, { recovery: key, label: S.deviceLabel(navigator.userAgent) }, fetch).then(function (res) {
        if (!res.ok) return fail(res, 'recover');
        // the old recovery link is used up: show the new one straight away
        return signedIn(res.body, res.body.recovery).then(function () {
          d.note('Welcome back, ' + res.body.account.name + '. Your old recovery link is used up: save the new one in Settings.');
        });
      });
    }
    /** The box on a signed-out device: a link code, or a recovery link or key. */
    function signInWith(text) {
      if (!d.api) { ui.error = "Couldn't reach the score server."; d.render(); return; }
      var code = S.normalizeLink(text), recovery = !code && S.normalizeRecovery(text);
      if (code) useLinkCode(code);
      else if (recovery) useRecovery(recovery);
      else { ui.error = 'Type the 8-character code from your other device (like ab3k-9mxq), or paste your recovery link.'; d.render(); }
    }
    /** A link opened from outside: ?link=ab3k-9mxq or ?recover=<key>. Removed from the address after. */
    function handleIncoming() {
      var q;
      try { q = new URLSearchParams(window.location.search); } catch (e) { return; }
      var link = q.get('link'), rec = q.get('recover');
      if (!link && !rec) return;
      try { window.history.replaceState(null, '', window.location.pathname); } catch (e) { /* ignore */ }
      var a = account();
      if (a) { d.note('This device is already signed in as ' + a.name + '.'); d.render(); return; }
      var code = link && S.normalizeLink(link), key = rec && S.normalizeRecovery(rec);
      if (!code && !key) { d.note("That link isn't right. Ask your other device for a new one."); d.render(); return; }
      d.ask(code ? 'Sign in on this device?' : 'Get your account back?',
        code ? 'This adds this device to the account the link came from. Your bests here are kept.'
             : 'This signs this device in with your recovery link, then gives you a new one.',
        'Sign in', function () { if (code) useLinkCode(code); else useRecovery(key); });
    }

    /* ---- signed in: add a device, rename, devices, recovery, sign out ---- */
    function addDevice() {
      var a = account();
      ui.error = '';
      S.makeLink(d.api, a.key, fetch).then(function (res) {
        if (res.status === 401) return signedOutElsewhere();
        if (!res.ok) return fail(res, res.status === 400 ? 'links' : '');
        ui.link = res.body;
        startLinkTimer();
        d.render();
      });
    }
    function startLinkTimer() {
      if (linkTimer) clearInterval(linkTimer);
      linkTimer = setInterval(function () {
        if (!ui.link || Date.now() >= ui.link.expiresAt) { ui.link = null; clearInterval(linkTimer); linkTimer = null; }
        drawLink();
      }, 1000);
    }
    function rename(name) {
      var a = account();
      S.renameMe(d.api, a.key, name, fetch).then(function (res) {
        if (res.status === 401) return signedOutElsewhere();
        if (!res.ok) return fail(res, 'name');
        setAccount({ key: a.key, name: res.body.name });
        ui.renaming = false; ui.error = '';
        pull();
      });
    }
    function removeDevice(dev) {
      d.ask('Remove ' + dev.label + '?', 'That device will be signed out. Its bests stay on it.', 'Remove', function () {
        S.removeDevice(d.api, account().key, dev.id, fetch).then(function (res) {
          if (!res.ok && res.status !== 404) return fail(res);
          pull();
        });
      });
    }
    function newRecovery() {
      d.ask('Make a new recovery link?', 'Your old recovery link will stop working.', 'Make a new one', function () {
        S.newRecovery(d.api, account().key, fetch).then(function (res) {
          if (res.status === 401) return signedOutElsewhere();
          if (!res.ok) return fail(res);
          ui.recovery = res.body.recovery;
          d.render();
        });
      });
    }
    function signOut() {
      d.ask('Sign out on this device?', 'Your bests here are kept. To sign in again, use Add a device on another device, or your recovery link.', 'Sign out', function () {
        var a = account();
        S.removeDevice(d.api, a.key, 'current', fetch).then(function (res) {
          if (res.status === 0) return fail(res);   // offline: stay signed in, so the key isn't left working on the server
          forgetAccount();
          ui.recovery = '';
          d.note('Signed out. Your bests here are kept.');
          d.render();
        });
      });
    }

    /* ---- drawing ---- */
    function drawLink() {
      var box = $('acctLinkBox');
      box.hidden = !ui.link;
      if (!ui.link) return;
      $('acctLinkCode').textContent = ui.link.code;
      var left = Math.max(0, Math.ceil((ui.link.expiresAt - Date.now()) / 1000));
      $('acctLinkTime').textContent = 'Works for ' + Math.floor(left / 60) + ':' + ('0' + (left % 60)).slice(-2) + ' more.';
    }
    function render() {
      var a = isSignedIn() ? account() : null;
      $('acctOut').hidden = !!a;
      $('acctIn').hidden = !a;
      var code = d.store.get(d.KEY.player) || '';
      $('scoreSync').hidden = !!a || !code;   // a score code shows only on a signed-out device that has one
      $('scoreCode').textContent = code;
      ['btnAcctCreate', 'btnAcctLink'].forEach(function (id) { $(id).disabled = ui.busy; });
      if (a) {
        d.drawText($('acctNameShown'), a.name);
        $('acctRenameForm').hidden = !ui.renaming;
        drawLink();
        var list = $('acctDevices');
        list.textContent = '';
        ((ui.me && ui.me.devices) || []).forEach(function (dev) {
          var li = document.createElement('li');
          var name = document.createElement('span');
          name.className = 'drawn';
          d.drawText(name, dev.label + (dev.current ? ' (this device)' : ''));
          li.appendChild(name);
          if (!dev.current) {
            var b = document.createElement('button');
            b.type = 'button'; b.className = 'btn'; b.textContent = 'Remove';
            b.setAttribute('aria-label', 'Remove ' + dev.label);
            b.addEventListener('click', function () { removeDevice(dev); });
            li.appendChild(b);
          }
          list.appendChild(li);
        });
      }
      $('acctRecoveryBox').hidden = !ui.recovery;
      if (ui.recovery) $('acctRecoveryLink').value = pageLink('recover', ui.recovery);
      $('scoreSyncError').textContent = ui.error;
    }

    /* ---- buttons ---- */
    function shareOrCopy(text, title) {
      if (navigator.share) {
        navigator.share({ title: title, url: text }).catch(function () { /* closed the share sheet */ });
        return;
      }
      copy(text);
    }
    function copy(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { d.note('Copied.'); d.render(); }, function () { /* ignore */ });
      }
    }
    $('acctCreateForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('acctName').value.replace(/\s+/g, ' ').trim();
      if (!name) { ui.error = 'Type a name first.'; d.render(); return; }
      makeAccount(name);
    });
    $('acctLinkForm').addEventListener('submit', function (e) {
      e.preventDefault();
      signInWith($('acctLinkInput').value);
    });
    $('btnAcctAddDevice').addEventListener('click', addDevice);
    $('btnAcctLinkShare').addEventListener('click', function () { if (ui.link) shareOrCopy(pageLink('link', ui.link.code), 'Sign in to ten-spot'); });
    $('btnAcctLinkCopy').addEventListener('click', function () { if (ui.link) copy(pageLink('link', ui.link.code)); });
    $('btnAcctRename').addEventListener('click', function () {
      ui.renaming = !ui.renaming;
      $('acctRenameInput').value = (account() || {}).name || '';
      d.render();
      if (ui.renaming) $('acctRenameInput').focus();
    });
    $('acctRenameForm').addEventListener('submit', function (e) {
      e.preventDefault();
      rename($('acctRenameInput').value.replace(/\s+/g, ' ').trim());
    });
    $('btnAcctRecovery').addEventListener('click', newRecovery);
    $('btnAcctSignOut').addEventListener('click', signOut);
    $('btnAcctRecoveryShare').addEventListener('click', function () { shareOrCopy($('acctRecoveryLink').value, 'ten-spot recovery link'); });
    $('btnAcctRecoveryCopy').addEventListener('click', function () { copy($('acctRecoveryLink').value); });
    $('btnAcctRecoveryDone').addEventListener('click', function () { ui.recovery = ''; d.render(); });
    $('btnScoreCopy').addEventListener('click', function () { copy(d.store.get(d.KEY.player) || ''); });
    $('btnScoreForget').addEventListener('click', function () {
      d.ask('Forget this score code?', 'Its bests stay on this device. The code itself is not kept.', 'Forget it', function () { forgetScoreCode(); d.render(); });
    });

    /* ---- the saved game on the server (app.js decides when) ---- */
    /** Send a saved game: { data, savedAt }. Resolves with the server's answer body, or null. */
    function pushSave(save, keepalive) {
      var a = account();
      if (!a || !d.api) return Promise.resolve(null);
      return S.putSave(d.api, a.key, save, fetch, keepalive).then(function (res) {
        if (res.status === 401) { signedOutElsewhere(); return null; }
        return res.ok ? res.body : null;
      });
    }
    /** The account's saved game { data, savedAt }, or null (none, offline, or signed out). */
    function pullSave() {
      var a = account();
      if (!a || !d.api) return Promise.resolve(null);
      return S.getSave(d.api, a.key, fetch).then(function (res) {
        if (res.status === 401) { signedOutElsewhere(); return null; }
        return res.ok && res.body && typeof res.body.data === 'string' ? res.body : null;
      });
    }

    return { isSignedIn: isSignedIn, pushBests: pushBests, pull: pull, render: render, handleIncoming: handleIncoming,
      pushSave: pushSave, pullSave: pullSave };
  }

  window.TenSpotAccount = { create: create };
})();
