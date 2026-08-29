/* Shared state, session persistence, and the tiny DOM helpers everything
   else needs. This is the module every other file imports from — kept
   deliberately small so it never becomes a place logic accumulates. */

export const STORE = 'redblack.session';

export const state = {
  gameId: null,
  token: null,
  seat: null,
  view: null,
  mode: null,           // null | 'burn' | 'swap' | 'challenge' | 'giveback'
  chosen: null,
  poll: null,
  busy: false,           // an action is in flight — see act() in actions.js.
                          // Drives the instant click-feedback loader so a
                          // click never looks like it silently did nothing.
};

export const $ = (id) => document.getElementById(id);
export const initials = (n) => (n || '?').trim().slice(0, 2).toUpperCase();

/* ── session persistence (survives a refresh) ─────────── */
export function saveSession() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      gameId: state.gameId, token: state.token, seat: state.seat }));
  } catch { /* private mode */ }
}
export function loadSession() {
  try { return JSON.parse(localStorage.getItem(STORE) || 'null'); }
  catch { return null; }
}
export function clearSession() {
  try { localStorage.removeItem(STORE); } catch { /* ignore */ }
}
