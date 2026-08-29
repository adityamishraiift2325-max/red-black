/* Entry point: wires every static button/input to the functions the other
   modules export, then tries to resume a session that was already in
   progress (a refresh, a back-button nav, or just reopening the tab). */

import { state, $, saveSession, loadSession, clearSession } from './state.js';
import { api, reportClientError } from './api.js';
import {
  toast, askName, closeDrawer, showWaitRoom, stopWaitRoomPoll, closeAttackConfirm,
} from './dialogs.js';
import { act, enterTable } from './actions.js';

$('newGameBtn').onclick = async () => {
  const name = await askName({ title: 'What should they call you?',
    sub: 'Your opponent sees this. Nothing else about you.', cta: 'Deal me in' });
  if (!name) return;
  try {
    localStorage.setItem('redblack.name', name);
    const g = await api('POST', '/games', { name }, false);
    state.gameId = g.gameId; state.token = g.token; state.seat = g.seat;
    saveSession();
    showWaitRoom(g.joinCode);
  } catch (e) { toast(e.message); reportClientError('create-game', e); }
};

$('joinBtn').onclick = async () => {
  const code = $('joinCode').value.trim();
  if (!code) return toast('Enter a room code first.');
  const name = await askName({ title: 'What should they call you?',
    sub: 'Your opponent sees this. Nothing else about you.', cta: 'Deal me in' });
  if (!name) return;
  try {
    localStorage.setItem('redblack.name', name);
    const g = await api('POST', '/games/join', { code, name }, false);
    state.gameId = g.gameId; state.token = g.token; state.seat = g.seat;
    saveSession();
    await enterTable();
  } catch (e) { toast(e.message); reportClientError('join-game', e); }
};

$('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
$('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('nameGo').click(); });
$('nameGo').onclick = () => {
  const v = $('nameInput').value.trim();
  if (!v) return toast('Please enter a name.');
  closeDrawer(v);
};
$('nameCancel').onclick = () => closeDrawer(null);

$('copyCode').onclick = async () => {
  try { await navigator.clipboard.writeText($('roomCode').textContent); toast('Copied.'); }
  catch { toast('Select the code above to copy it.'); }
};
$('waitCancel').onclick = () => {
  stopWaitRoomPoll();
  $('waitRoom').hidden = true;
  clearSession();
  state.gameId = state.token = state.seat = null;
};

$('acCancel').onclick = closeAttackConfirm;
$('acGo').onclick = () => {
  closeAttackConfirm();
  act(() => api('POST', `/games/${state.gameId}/attack`, {}));
};

$('backBtn').onclick = () => {
  clearInterval(state.poll);
  clearSession();
  state.gameId = state.token = state.seat = state.view = null;
  $('table').hidden = true;
  $('identity').hidden = true;
  $('lobby').hidden = false;
  $('overlay').hidden = true;
};

$('reviewBtn').onclick = () => window.open(`/dev.html#${state.gameId}`, '_blank');

$('againBtn').onclick = () => {
  $('overlay').hidden = true;
  $('backBtn').click();
};

/* Resume an interrupted session on refresh, a browser-back navigation, or
   simply reopening the tab. This used to wipe the saved session on ANY
   error here — including a plain network blip — which is exactly what
   locked a real player out permanently after a back-button press: the seat
   stays occupied server-side forever, so re-joining just reports the room
   "full," and there was no way back in. Only a genuine 401 (this token no
   longer holds that seat — e.g. it was reclaimed elsewhere) means the
   session is actually dead. Anything else should be retried, not destroyed. */
(async () => {
  const s = loadSession();
  if (!s?.gameId || !s?.token) return;
  state.gameId = s.gameId; state.token = s.token; state.seat = s.seat;
  try {
    const lob = await api('GET', `/games/${s.gameId}/lobby`, null, false);
    if (!lob.ready) { showWaitRoom(lob.joinCode); return; }
    await enterTable();
  } catch (e) {
    if (e.status === 401) {
      clearSession();
      state.gameId = state.token = state.seat = null;
    } else {
      toast('Could not reconnect — check your connection and reload.');
    }
  }
})();
