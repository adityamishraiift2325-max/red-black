/* Every overlay that isn't the main game screen: toasts, the name drawer,
   the waiting room, the attack confirmation, and the end-of-game result. */

import { state, $ } from './state.js';
import { api } from './api.js';
import { cardEl } from './cards.js';
// Circular import, deliberate — see cards.js's note. enterTable is only
// called inside a setInterval callback in showWaitRoom, never at module
// load, so this is safe under ES module circular-import semantics.
import { enterTable } from './actions.js';

/* ── toast ────────────────────────────────────────────── */
export function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 3800);
}

/* ── name drawer ──────────────────────────────────────── */
let drawerResolve = null;
export function askName({ title, sub, cta }) {
  $('drawerTitle').textContent = title;
  $('drawerSub').textContent = sub;
  $('nameGo').textContent = cta || 'Continue';
  $('nameInput').value = localStorage.getItem('redblack.name') || '';
  $('nameDrawer').hidden = false;
  setTimeout(() => $('nameInput').focus(), 60);
  return new Promise((resolve) => { drawerResolve = resolve; });
}
export function closeDrawer(value) {
  $('nameDrawer').hidden = true;
  const r = drawerResolve; drawerResolve = null;
  if (r) r(value);
}

/* ── waiting room ─────────────────────────────────────── */
let waitPoll = null;
export function showWaitRoom(code) {
  $('roomCode').textContent = code;
  $('waitRoom').hidden = false;
  clearInterval(waitPoll);
  waitPoll = setInterval(async () => {
    try {
      const s = await api('GET', `/games/${state.gameId}/lobby`, null, false);
      $('waitPlayers').innerHTML = s.players.map((p) =>
        `<div class="p ${p.joined ? 'in' : ''}">${p.joined ? '✓' : '○'} ${p.name || 'open seat'}</div>`
      ).join('');
      if (s.ready) { clearInterval(waitPoll); $('waitRoom').hidden = true; await enterTable(); }
    } catch { /* keep waiting */ }
  }, 1500);
}
export function stopWaitRoomPoll() { clearInterval(waitPoll); }

/* ── attack confirmation ──────────────────────────────── */
/* Deliberately NOT window.confirm(): embedded and sandboxed contexts
   suppress native dialogs and silently return false. */
export async function confirmAttack() {
  let p;
  try { p = await api('GET', `/games/${state.gameId}/me/attack-preview`); }
  catch (e) { return toast(e.message); }
  $('acOff').textContent = p.offenseTotal;
  $('attackConfirm').hidden = false;
}
export const closeAttackConfirm = () => { $('attackConfirm').hidden = true; };

/* ── end-of-game result ───────────────────────────────── */
export function showResult(v) {
  $('overlay').hidden = false;
  const won = v.youWon;
  // "Called it" credits the read, not luck — this is a bluffing game, so
  // winning means you judged the opponent correctly. "Not this time" instead
  // of a bare verdict, because losing a bluffing game shouldn't read like a
  // system reporting on you.
  $('resultTitle').textContent = won ? 'Called it' : 'Not this time';
  $('resultTitle').className = 'result-title ' + (won ? 'win' : 'lose');

  const r = v.finalReveal;
  if (!r || !r.attack) {
    $('resultDetail').textContent = `Player ${v.winnerSeat} takes the duel.`;
    return;
  }
  const a = r.attack;

  if (a.kind === 'round_cap') {
    // No attacker here — both sides hit the 8-turn ceiling and were scored
    // simultaneously. youAttacked is false for BOTH players in this case, so
    // the declared-attack narration below would be wrong for everyone.
    const rc = a.roundCap;
    $('resultDetail').innerHTML = rc.wasTie
      ? `Neither of you blinked — the tie broke to ${won ? 'you' : v.opponentName}.`
      : (won ? `Neither of you attacked. Your hand held up better.`
             : `Neither of you attacked. ${v.opponentName}'s hand held up better.`);

    $('showdown').innerHTML =
      `<div class="sd ${won ? 'winner' : ''}">
         <div class="sd-label">Your total</div>
         <div class="sd-num off">${rc.yourTotal}</div><div class="sd-note">offense + defense</div>
       </div>
       <div class="sd ${!won ? 'winner' : ''}">
         <div class="sd-label">Their total</div>
         <div class="sd-num def">${rc.theirTotal}</div>
         <div class="sd-note">offense + defense${rc.wasTie ? ' — tie' : ''}</div>
       </div>`;
  } else {
    // "You went for it with 8. Aditya was sitting on 36." — the approved
    // phrasing states the actual numbers a person would say out loud, rather
    // than a generic "attack broke through / fell short."
    const mine = a.youAttacked ? a.offenseTotal : a.defenseTotal;
    const theirs = a.youAttacked ? a.defenseTotal : a.offenseTotal;
    $('resultDetail').innerHTML = a.youAttacked
      ? `You went for it with <b>${mine}</b>. ${v.opponentName} was sitting on <b>${theirs}</b>.`
      : `${v.opponentName} went for it with <b>${theirs}</b>. You were sitting on <b>${mine}</b>.`;

    $('showdown').innerHTML =
      `<div class="sd ${a.winnerSeat === a.attackerSeat ? 'winner' : ''}">
         <div class="sd-label">${a.youAttacked ? 'Your' : 'Their'} offense</div>
         <div class="sd-num off">${a.offenseTotal}</div><div class="sd-note">attacker</div>
       </div>
       <div class="sd ${a.winnerSeat !== a.attackerSeat ? 'winner' : ''}">
         <div class="sd-label">${a.youAttacked ? 'Their' : 'Your'} defense</div>
         <div class="sd-num def">${a.defenseTotal}</div>
         <div class="sd-note">defender${a.offenseTotal === a.defenseTotal ? ' — tie holds' : ''}</div>
       </div>`;
  }

  const box = $('oppRevealHand');
  box.innerHTML = '';
  r.opponentHand.forEach((c) => box.appendChild(cardEl(c)));
  document.querySelector('.reveal-label').textContent =
    `What ${v.opponentName || 'they'} was holding`;
  $('oppRevealTotals').innerHTML =
    `Their offense <b>${r.opponentTotals.offense}</b> · their defense <b>${r.opponentTotals.defense}</b><br>` +
    `<span style="opacity:.7">Yours: offense <b>${r.yourTotals.offense}</b> · defense <b>${r.yourTotals.defense}</b></span>`;
}
