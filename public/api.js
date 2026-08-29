/* Every network call the client makes, and the durable failure-reporting
   pipeline. Nothing here renders anything — that's the whole point of this
   file being separate. */

import { state } from './state.js';

export const API = '/api';

export async function api(method, path, body, auth = true) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth && state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // .status distinguishes "this token is genuinely dead" (401) from a
    // transient failure (network blip, 500) — the resume-on-load flow in
    // main.js must only ever destroy the saved session on the former.
    // Destroying it on ANY error is exactly what locked a real player out of
    // their own game after a back-button navigation (2026-08-29).
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

/* A toast is ephemeral — nothing durable was capturing what actually went
   wrong once it faded. Every user-visible failure also gets reported here so
   it's inspectable later in /dev.html, not just glimpsed by the player.
   Fire-and-forget: reporting a failure must never itself throw or block. */
export function reportClientError(context, err) {
  try {
    const payload = JSON.stringify({
      gameId: state.gameId, seat: state.seat, context,
      message: (err && err.message) || String(err),
      stack: err && err.stack,
      url: location.href,
    });
    fetch(API + '/client-errors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
    }).catch(() => {});
  } catch { /* never let error reporting become a new error */ }
}

// Catches failures the app's own try/catch never sees at all.
window.addEventListener('error', (e) => reportClientError('window.onerror', e.error || e.message));
window.addEventListener('unhandledrejection', (e) =>
  reportClientError('unhandledrejection', e.reason));
