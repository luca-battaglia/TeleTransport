// ==UserScript==
// @name         LeFrecce session restore
// @namespace    teletransport
// @version      1.1.0
// @description  Keep a LeFrecce login usable in a freshly opened tab, so TeleTransport booking links do not land logged out.
// @match        https://www.lefrecce.it/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

// LeFrecce splits its login across two storages. The credential (b2c.jwttoken and
// aurelia_authentication) goes to localStorage, so every tab already has it. The
// signed-in state the UI actually reads - the Aurelia store, user profile included -
// is persisted to sessionStorage under "session", which is per tab and starts empty
// in a tab opened from somewhere else. The app never rebuilds the store from the
// credential, so a new tab shows you logged out while holding a valid token.
//
// This script mirrors that store into localStorage and seeds it back when a tab
// starts without one. It only ever restores what the app itself wrote.

(function () {
  'use strict';

  const BACKUP_KEY = '__tt_lefrecce_session';
  const STORE_KEY = 'session';
  const CREDENTIAL_KEY = 'b2c.jwttoken';
  // The app wipes its own data after 30 minutes of inactivity. Restoring anything
  // older would resurrect a state the site had already decided to discard.
  const MAX_AGE_MS = 30 * 60 * 1000;

  const readJson = (storage, key) => {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  // Seconds since the epoch at which the stored token stops being accepted, or null
  // when there is no token or its payload cannot be read.
  const tokenExpiry = () => {
    const token = localStorage.getItem(CREDENTIAL_KEY);
    if (!token) return null;
    const payload = token.split('.')[1];
    if (!payload) return null;
    try {
      const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      const exp = JSON.parse(json).exp;
      return typeof exp === 'number' ? exp : null;
    } catch {
      return null;
    }
  };

  const credentialIsUsable = () => {
    if (!localStorage.getItem(CREDENTIAL_KEY)) return false;
    const exp = tokenExpiry();
    // A token whose payload we cannot read is left to the app to judge.
    return exp === null || exp * 1000 > Date.now();
  };

  const dropBackup = () => localStorage.removeItem(BACKUP_KEY);

  const restore = () => {
    // Logged out, or the token died on its own: never resurrect either.
    if (!credentialIsUsable()) {
      dropBackup();
      return;
    }
    if (sessionStorage.getItem(STORE_KEY)) return;

    const backup = readJson(localStorage, BACKUP_KEY);
    if (!backup || typeof backup.savedAt !== 'number' || !backup.state) return;
    if (Date.now() - backup.savedAt > MAX_AGE_MS) {
      dropBackup();
      return;
    }
    sessionStorage.setItem(STORE_KEY, backup.state);
  };

  // Once solutions are loaded the store runs to several hundred KB, and localStorage
  // writes block the main thread, so an unchanged state is never rewritten.
  let lastSaved = null;

  const save = () => {
    if (!credentialIsUsable()) {
      dropBackup();
      lastSaved = null;
      return;
    }
    const state = sessionStorage.getItem(STORE_KEY);
    if (!state || state === lastSaved) return;
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify({ savedAt: Date.now(), state }));
      lastSaved = state;
    } catch {
      // Out of quota: a partial or stale backup is worse than none, and retrying
      // every tick would just throw again.
      dropBackup();
      lastSaved = null;
    }
  };

  restore();

  // The store is rewritten throughout the session, so the backup is refreshed on the
  // events that mark a tab going away as well as on a slow timer, which also keeps
  // savedAt moving while the tab is genuinely in use.
  addEventListener('pagehide', save);
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });
  setInterval(save, 60 * 1000);
})();
