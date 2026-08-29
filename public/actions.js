/* The main game screen: rendering the table, the turn actions, and the
   act()/refresh() flow every action funnels through. */

import { state, $, initials } from './state.js';
import { api, reportClientError } from './api.js';
import { cardEl, prettyCard } from './cards.js';
import { toast, confirmAttack, showResult } from './dialogs.js';

/* ── hands ────────────────────────────────────────────── */
function renderHands() {
  const v = state.view;

  // The opponent has no card row — nothing about their hand is ever visible.
  $('oppSeat').textContent = v.opponentName || 'waiting…';
  $('oppCount').textContent = v.opponentCardCount;
  $('oppPrep').innerHTML = `<b>${v.prepTurns.opponent}</b>/3 prep turns`;
  $('oppTurnNote').textContent = v.status === 'finished' ? ''
    : v.status === 'lobby' ? 'not joined yet'
    : (v.yourTurn ? 'waiting on you' : 'their turn');
  document.querySelector('.opp-strip')
    .classList.toggle('their-turn', !v.yourTurn && v.status === 'preparing');

  // Your own hand is always face up — seat isolation is enforced server-side
  // (the opponent's view is redacted regardless), so hiding a player's cards
  // from THEMSELVES was pure friction with no security value.
  const you = $('youHand');
  you.innerHTML = '';
  const pickable = state.mode !== null && state.mode !== 'swap';
  v.yourHand.forEach((c) => {
    const el = cardEl(c, { pickable, isNew: c.isNew });
    if (state.chosen === c.id) el.classList.add('chosen');
    you.appendChild(el);
  });
  $('youSeat').textContent = v.yourName || `P${state.seat}`;
  $('youTotals').innerHTML =
    `<span class="off">offense <b>${v.yourTotals.offense}</b></span> · ` +
    `<span class="def">defense <b>${v.yourTotals.defense}</b></span>`;
}

/* ── the round-cap countdown strip ────────────────────── */
/* Only shown once it's near — noise for most of the game otherwise. <=3
   turns left on EITHER side is close enough to matter. Shows both sides'
   counts rather than synthesizing one "in N turns" figure: turns alternate,
   so a single combined number would be misleading whenever it isn't
   currently your turn. */
function renderCapWarning() {
  const v = state.view;
  const strip = $('capWarning');
  const close = v.turnsUntilCap
    && v.status === 'preparing'
    && Math.min(v.turnsUntilCap.you, v.turnsUntilCap.opponent) <= 3;
  strip.classList.toggle('show', !!close);
  if (!close) return;
  $('capWarningText').innerHTML = v.isFinalPrepTurn
    ? `<b>Last turn.</b> After this you both attack at once, whether you're ready or not.`
    : `<b>${v.turnsUntilCap.you}</b> of your turns, <b>${v.turnsUntilCap.opponent}</b> of ` +
      `theirs left — then it settles itself.`;
}

/* ── the prompt ───────────────────────────────────────── */
function describePrompt() {
  const v = state.view;
  if (v.status === 'lobby') return '<span class="wait">Waiting for an opponent to join…</span>';
  if (v.status === 'finished') return v.youWon ? '<span class="hl">Called it.</span>' : 'Not this time.';

  const ch = v.pendingChallenge;
  if (ch) {
    if (ch.awaiting === 'your_response') {
      return `${v.opponentName} played a <span class="warn">${ch.challengeCardType}</span> card, ` +
             `face down. They want your highest ${ch.requiredType}. Accept and you both flip — ` +
             `highest wins, and a tie goes to you. Decline and you hand it over without ever ` +
             `seeing what they had.`;
    }
    if (ch.awaiting === 'opponent_response') {
      return `<span class="wait">${v.opponentName}'s deciding…</span>`;
    }
    if (v.legalActions.includes('challenge.giveback')) {
      return giveback_prompt(v, ch);
    }
    return `<span class="wait">Waiting on ${v.opponentName}…</span>`;
  }

  if (!v.yourTurn) return `<span class="wait">${v.opponentName}'s thinking. This is the part ` +
                          `where you wonder what they're holding.</span>`;
  if (v.isFinalPrepTurn) {
    return 'Last chance to prepare — <span class="hl">after this you both attack at once</span>, ' +
           'whether you\'re ready or not.';
  }
  if (v.canAttack) return 'Your turn. You may now <span class="hl">attack</span> — or keep preparing.';
  return '<span class="hl">Your move.</span>';
}

/* Split out for clarity: the giveback prompt names the actual cards
   involved when the resolution came from a real comparison ("Your J♣ held.
   Their K♠ is yours.") — but a decline or auto-surrender never compared
   anything, so that framing would overclaim. Only reach for it when it's
   actually true. */
function giveback_prompt(v, ch) {
  const winnerIsChallenger = ch.winnerSeat === ch.challengerSeat;
  const ownCard = winnerIsChallenger ? ch.challengerCard : ch.defenderCard;
  const wonCard = ch.contestedCard;

  if (ch.response === 'accepted' && ownCard && wonCard) {
    return `Your ${prettyCard(ownCard)} held. <span class="hl">Their ${prettyCard(wonCard)} is ` +
           `yours.</span> Now give one back — anything you like. They have to take it.`;
  }
  return `You won the challenge. <span class="hl">Choose a card to give back</span> — ` +
         `they have to take it.`;
}

/* ── action buttons ───────────────────────────────────── */
function renderActions() {
  const v = state.view;
  const box = $('actions');
  const sel = $('selection');
  box.innerHTML = '';
  sel.hidden = true;
  sel.innerHTML = '';

  // Your move was sent — this is the entire point: the instant you click,
  // the actual buttons are gone from the DOM (replaced by this), so a second
  // click on the same spot physically cannot resubmit. Clears the instant
  // act() gets a response, success or failure — see act().
  if (state.busy) {
    sel.hidden = false;
    sel.innerHTML = '<div class="hint busy-hint">' +
      '<span class="spinner inline"></span> Sending…</div>';
    return;
  }

  if (v.status === 'finished' || v.status === 'lobby') return;
  const acts = v.legalActions || [];

  if (state.mode === 'burn' || state.mode === 'challenge' || state.mode === 'giveback') {
    sel.hidden = false;
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = state.mode === 'burn' ? 'Pick a card to discard.'
      : state.mode === 'challenge' ? 'Which one goes face down?'
      : 'Pick a card to hand over.';
    sel.appendChild(hint);

    // Buttons go in their own flex row, separate from the hint — appending
    // them straight into #selection left them with no gap at all (no
    // whitespace text nodes between DOM-created siblings the way there
    // would be between hand-written HTML tags), so adjacent pill buttons
    // rendered edge-to-edge. See CSS .selection-actions.
    const row = document.createElement('div');
    row.className = 'selection-actions';
    const go = document.createElement('button');
    go.className = 'primary';
    go.disabled = !state.chosen;
    go.textContent = state.mode === 'burn' ? 'Burn it'
                   : state.mode === 'challenge' ? 'Send it' : 'Give this one';
    go.onclick = doModeAction;
    const cancel = document.createElement('button');
    cancel.className = 'ghost';
    cancel.textContent = 'Never mind';
    cancel.onclick = () => { state.mode = null; state.chosen = null; render(); };
    row.append(go, cancel);
    sel.appendChild(row);
    return;
  }

  if (state.mode === 'swap') {
    sel.hidden = false;
    sel.innerHTML = '<div class="hint">Which colour are you giving up? You\'ll take their ' +
                    'highest of the other colour — they don\'t get a say.</div>';
    const row = document.createElement('div');
    row.className = 'selection-actions';
    for (const t of ['red', 'black']) {
      const b = document.createElement('button');
      b.className = 'primary';
      b.textContent = `My highest ${t}`;
      b.onclick = () => act(() => api('POST', `/games/${state.gameId}/swap`, { type: t }));
      row.appendChild(b);
    }
    const cancel = document.createElement('button');
    cancel.className = 'ghost';
    cancel.textContent = 'Never mind';
    cancel.onclick = () => { state.mode = null; render(); };
    row.appendChild(cancel);
    sel.appendChild(row);
    return;
  }

  const add = (label, cls, fn) => {
    const b = document.createElement('button');
    b.className = cls; b.textContent = label; b.onclick = fn;
    box.appendChild(b);
  };

  if (acts.includes('challenge.accept')) {
    add('Flip them', 'primary',
        () => act(() => api('POST', `/games/${state.gameId}/challenge/accept`, {})));
    add('Hand it over', 'danger',
        () => act(() => api('POST', `/games/${state.gameId}/challenge/decline`, {})));
    return;
  }
  if (acts.includes('challenge.giveback')) {
    add('Give this one', 'primary',
        () => { state.mode = 'giveback'; state.chosen = null; render(); });
    return;
  }
  if (acts.includes('burn'))      add('Burn one', 'ghost', () => { state.mode = 'burn'; state.chosen = null; render(); });
  if (acts.includes('swap'))      add('Force a swap', 'ghost', () => { state.mode = 'swap'; render(); });
  if (acts.includes('challenge')) add('Challenge', 'ghost', () => { state.mode = 'challenge'; state.chosen = null; render(); });
  if (acts.includes('attack'))    add('⚔ Attack', 'danger', confirmAttack);
}

function doModeAction() {
  const id = state.chosen;
  if (!id) return;
  const g = state.gameId;
  if (state.mode === 'burn')       act(() => api('POST', `/games/${g}/burn`, { cardId: id }));
  else if (state.mode === 'challenge') act(() => api('POST', `/games/${g}/challenge`, { cardId: id }));
  else if (state.mode === 'giveback')  act(() => api('POST', `/games/${g}/challenge/giveback`, { cardId: id }));
}

/* ── feed ─────────────────────────────────────────────── */
function describeEvent(e) {
  const p = e.payload || {};
  const v = state.view;
  const who = (s) => (s === state.seat ? 'You' : (v.opponentName || 'Opponent'));
  switch (e.type) {
    case 'game_created':  return `<b>${p.hostName}</b> created the room.`;
    case 'player_joined': return `<b>${p.name}</b> joined. Game on.`;
    case 'game_started':  return 'Cards dealt. 6 each.';
    case 'burn_draw':     return `<b>${who(p.player)}</b> burned a card and drew.`;
    case 'swap_executed': return `<b>${who(p.initiator)}</b> forced a swap: ` +
                                 `${prettyCard(p.gave)} out, ${prettyCard(p.received)} in.`;
    case 'challenge_declared':
      return `<b>${who(p.challenger)}</b> challenged with a <b>${p.challengeCardType}</b> card ` +
             `— demanding the highest ${p.requiredType}.`;
    case 'challenge_resolved':
      return `Revealed: ${prettyCard(p.challengerCard)} vs ${prettyCard(p.defenderCard)}` +
             (p.tie ? ' — a tie, so the defender takes it. ' : ' — ') +
             `<b>${who(p.winner)}</b> won the challenge.`;
    case 'challenge_declined':
      return `<b>${who(p.defender)}</b> declined without looking and forfeited ${prettyCard(p.surrenderedCard)}.`;
    case 'challenge_auto_surrender':
      return `<b>${who(p.defender)}</b> held no ${p.requiredType} card — ` +
             `${prettyCard(p.surrenderedCard)} surrendered outright.`;
    case 'giveback':      return `<b>${who(p.winner)}</b> handed back ${prettyCard(p.given)}.`;
    case 'attack':
      return `<b>${who(p.attacker)}</b> attacked — offense ${p.offenseTotal} vs defense ${p.defenseTotal}. ` +
             `<b>${who(p.winner)}</b> won.`;
    case 'round_cap_resolved':
      return `Neither of you attacked — the ${p.maxPrepTurns}-turn limit settled it. ` +
             `<b>${who(p.winner)}</b> won${p.tie ? ' on the tie-break' : ''}.`;
    default: return e.type;
  }
}

async function renderFeed() {
  const events = await api('GET', `/games/${state.gameId}/events?seat=${state.seat}`);
  const ul = $('feed');
  ul.innerHTML = '';
  events.forEach((e) => {
    const li = document.createElement('li');
    li.innerHTML = describeEvent(e);
    ul.appendChild(li);
  });
}

/* ── render ───────────────────────────────────────────── */
export function render() {
  const v = state.view;
  if (!v) return;

  $('deckCount').textContent = v.deckCount;
  $('prepInfo').innerHTML =
    `Preparation turns<br>you <b>${v.prepTurns.you}</b>/3 · them <b>${v.prepTurns.opponent}</b>/3` +
    (v.canAttack ? '<br><span style="color:var(--ok)">attack unlocked</span>' : '');
  $('meta').textContent = `room ${v.joinCode || ''} · ${v.status}`;
  $('prompt').innerHTML = describePrompt();
  renderCapWarning();

  $('youName').textContent = v.yourName || 'You';
  $('oppName').textContent = v.opponentName || 'waiting…';
  $('youAvatar').textContent = initials(v.yourName);
  $('oppAvatar').textContent = v.opponentName ? initials(v.opponentName) : '?';

  renderHands();
  renderActions();
  if (v.status === 'finished') showResult(v);
}

/* ── flow ─────────────────────────────────────────────── */
export async function act(fn) {
  // Set BEFORE the await, synchronously, so the loader appears on the very
  // click that triggered it — not after the network round trip. That's the
  // whole fix: previously a player had no signal their click registered
  // until the state actually changed (2.5s poll or the request finishing),
  // so an action under any latency looked exactly like a dead click.
  state.busy = true;
  renderActions();
  try {
    await fn();
    state.mode = null;
    state.chosen = null;
    state.busy = false;
    await refresh(); // re-renders with the new turn state — busy is already false
  } catch (e) {
    state.busy = false;
    toast(e.message);
    reportClientError('action:' + (state.mode || 'unknown'), e);
    renderActions(); // clear the loader on failure too; refresh() never ran on this path
  }
}

export async function refresh() {
  state.view = await api('GET', `/games/${state.gameId}/me`);
  render();
  await renderFeed();
}

export function startPolling() {
  clearInterval(state.poll);
  state.poll = setInterval(() => {
    if (state.gameId && !state.mode && state.view?.status !== 'finished') {
      refresh().catch(() => {});
    }
  }, 2500);
}

export async function enterTable() {
  $('lobby').hidden = true;
  $('table').hidden = false;
  $('identity').hidden = false;
  $('overlay').hidden = true;
  $('waitRoom').hidden = true;
  await refresh();
  startPolling();
}
