/* Red & Black — browser client.
   Every rule decision comes from the server. The client holds a seat token
   that fixes which player it is; it can never request the other seat, so no
   hidden card ever reaches this browser. */

const API = '/api';
const SUIT = { H: '♥', D: '♦', S: '♠', C: '♣' };
const STORE = 'redblack.session';

const state = {
  gameId: null,
  token: null,
  seat: null,
  view: null,
  mode: null,           // null | 'burn' | 'swap' | 'challenge' | 'giveback'
  chosen: null,
  poll: null,
  busy: false,           // an action is in flight — see act(). Drives the
                          // instant click-feedback loader so a click never
                          // looks like it silently did nothing.
};

const $ = (id) => document.getElementById(id);

/* ── session persistence (survives a refresh) ─────────── */
function saveSession() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      gameId: state.gameId, token: state.token, seat: state.seat }));
  } catch { /* private mode */ }
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem(STORE) || 'null'); }
  catch { return null; }
}
function clearSession() {
  try { localStorage.removeItem(STORE); } catch { /* ignore */ }
}

/* ── api ──────────────────────────────────────────────── */
async function api(method, path, body, auth = true) {
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
    // transient failure (network blip, 500) — the resume-on-load flow below
    // must only ever destroy the saved session on the former. Destroying it
    // on ANY error is exactly what locked a real player out of their own
    // game after a back-button navigation (2026-08-29).
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 3800);
}

/* A toast is ephemeral — nothing durable was capturing what actually went
   wrong once it faded. Every user-visible failure also gets reported here so
   it's inspectable later in /dev.html, not just glimpsed by the player.
   Fire-and-forget: reporting a failure must never itself throw or block. */
function reportClientError(context, err) {
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

const initials = (n) => (n || '?').trim().slice(0, 2).toUpperCase();

/* ── cards ────────────────────────────────────────────── */
function cardEl(card, { faceDown = false, pickable = false, isNew = false } = {}) {
  const el = document.createElement('div');
  if (faceDown || !card || !card.id) { el.className = 'card back'; return el; }
  const rank = card.rank || card.id.slice(0, -1);
  const suit = card.suit || card.id.slice(-1);
  const isRed = suit === 'H' || suit === 'D';
  el.className = `card ${isRed ? 'red' : 'black'}${pickable ? ' pick' : ''}${isNew ? ' fresh' : ''}`;
  el.dataset.id = card.id;
  el.innerHTML =
    `<div class="r">${rank}<br>${SUIT[suit]}</div>` +
    `<div class="s">${SUIT[suit]}</div>` +
    `<div class="r flip">${rank}<br>${SUIT[suit]}</div>`;
  if (pickable) {
    el.onclick = () => { state.chosen = state.chosen === card.id ? null : card.id; render(); };
  }
  return el;
}

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

function describePrompt() {
  const v = state.view;
  if (v.status === 'lobby') return '<span class="wait">Waiting for an opponent to join…</span>';
  if (v.status === 'finished') {
    return v.youWon ? '<span class="hl">You won.</span>' : 'You lost this one.';
  }
  const ch = v.pendingChallenge;
  if (ch) {
    if (ch.awaiting === 'your_response') {
      return `${v.opponentName} challenged you with a <span class="hl">${ch.challengeCardType}</span> ` +
             `card — value hidden. Accept to reveal both, or decline and forfeit your highest ` +
             `<span class="hl">${ch.requiredType}</span>.`;
    }
    if (ch.awaiting === 'opponent_response') {
      return `<span class="wait">Waiting for ${v.opponentName} to accept or decline…</span>`;
    }
    if (v.legalActions.includes('challenge.giveback')) {
      return 'You won the challenge. <span class="hl">Choose a card to give back</span> — they must accept it.';
    }
    return '<span class="wait">Waiting on your opponent…</span>';
  }
  if (!v.yourTurn) return `<span class="wait">${v.opponentName}'s turn…</span>`;
  // Functional warning only — the styled countdown strip from the redesign
  // mockups is Phase 2 scope (docs/BACKLOG.md item 2); this just makes sure
  // the information reaches the player correctly in the meantime.
  if (v.isFinalPrepTurn) {
    return 'Last chance to prepare — <span class="hl">after this you both attack at once</span>, ' +
           'whether you\'re ready or not.';
  }
  if (v.canAttack) return 'Your turn. You may now <span class="hl">attack</span> — or keep preparing.';
  return 'Your turn. Prepare your hand.';
}

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
      '<span class="spinner inline"></span> Sending your move…</div>';
    return;
  }

  if (v.status === 'finished' || v.status === 'lobby') return;
  const acts = v.legalActions || [];

  if (state.mode === 'burn' || state.mode === 'challenge' || state.mode === 'giveback') {
    sel.hidden = false;
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = state.mode === 'burn' ? 'Pick a card to discard.'
      : state.mode === 'challenge' ? 'Pick the card to challenge with — it stays face down.'
      : 'Pick a card to hand over.';
    sel.appendChild(hint);

    const go = document.createElement('button');
    go.className = 'primary';
    go.disabled = !state.chosen;
    go.textContent = state.mode === 'burn' ? 'Discard & draw'
                   : state.mode === 'challenge' ? 'Declare challenge' : 'Give this card';
    go.onclick = doModeAction;
    const cancel = document.createElement('button');
    cancel.className = 'ghost';
    cancel.textContent = 'Cancel';
    cancel.onclick = () => { state.mode = null; state.chosen = null; render(); };
    sel.append(go, cancel);
    return;
  }

  if (state.mode === 'swap') {
    sel.hidden = false;
    sel.innerHTML = '<div class="hint">Which of your cards goes out? You will receive their ' +
                    'highest of the opposite colour — they cannot refuse.</div>';
    for (const t of ['red', 'black']) {
      const b = document.createElement('button');
      b.className = 'primary';
      b.textContent = `Give my highest ${t}`;
      b.onclick = () => act(() => api('POST', `/games/${state.gameId}/swap`, { type: t }));
      sel.appendChild(b);
    }
    const cancel = document.createElement('button');
    cancel.className = 'ghost';
    cancel.textContent = 'Cancel';
    cancel.onclick = () => { state.mode = null; render(); };
    sel.appendChild(cancel);
    return;
  }

  const add = (label, cls, fn) => {
    const b = document.createElement('button');
    b.className = cls; b.textContent = label; b.onclick = fn;
    box.appendChild(b);
  };

  if (acts.includes('challenge.accept')) {
    add('Accept — reveal both', 'primary',
        () => act(() => api('POST', `/games/${state.gameId}/challenge/accept`, {})));
    add('Decline — forfeit blind', 'danger',
        () => act(() => api('POST', `/games/${state.gameId}/challenge/decline`, {})));
    return;
  }
  if (acts.includes('challenge.giveback')) {
    add('Choose a card to give back', 'primary',
        () => { state.mode = 'giveback'; state.chosen = null; render(); });
    return;
  }
  if (acts.includes('burn'))      add('Burn & draw', 'ghost', () => { state.mode = 'burn'; state.chosen = null; render(); });
  if (acts.includes('swap'))      add('Swap', 'ghost', () => { state.mode = 'swap'; render(); });
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

/* Attack confirmation. Deliberately NOT window.confirm(): embedded and
   sandboxed contexts suppress native dialogs and silently return false. */
async function confirmAttack() {
  let p;
  try { p = await api('GET', `/games/${state.gameId}/me/attack-preview`); }
  catch (e) { return toast(e.message); }
  $('acOff').textContent = p.offenseTotal;
  $('attackConfirm').hidden = false;
}
const closeAttackConfirm = () => { $('attackConfirm').hidden = true; };

/* ── feed ─────────────────────────────────────────────── */
const CARD_RE = /\b((?:[2-9]|10|[JQKA])[HDSC])\b/g;
const prettyCard = (t) => String(t).replace(CARD_RE, (m) => {
  const s = m.slice(-1);
  return `<span class="cardref ${s === 'H' || s === 'D' ? 'red' : 'black'}">${m.slice(0, -1)}${SUIT[s]}</span>`;
});

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
function render() {
  const v = state.view;
  if (!v) return;

  $('deckCount').textContent = v.deckCount;
  // Cap countdown only shown once it's near — otherwise it's noise for most
  // of the game. <=3 turns left on EITHER side is close enough to matter.
  // Deliberately shows both sides' counts rather than synthesizing one "in N
  // turns" figure — turns alternate, so a single number would be misleading
  // whenever it isn't currently your turn.
  const capClose = v.turnsUntilCap && Math.min(v.turnsUntilCap.you, v.turnsUntilCap.opponent) <= 3;
  $('prepInfo').innerHTML =
    `Preparation turns<br>you <b>${v.prepTurns.you}</b>/3 · them <b>${v.prepTurns.opponent}</b>/3` +
    (v.canAttack ? '<br><span style="color:var(--ok)">attack unlocked</span>' : '') +
    (capClose ? `<br><span style="color:var(--warn)">forced attack looming — ` +
      `${v.turnsUntilCap.you} of your turns, ${v.turnsUntilCap.opponent} of theirs left</span>` : '');
  $('meta').textContent = `room ${v.joinCode || ''} · ${v.status}`;
  $('prompt').innerHTML = describePrompt();

  $('youName').textContent = v.yourName || 'You';
  $('oppName').textContent = v.opponentName || 'waiting…';
  $('youAvatar').textContent = initials(v.yourName);
  $('oppAvatar').textContent = v.opponentName ? initials(v.opponentName) : '?';

  renderHands();
  renderActions();
  if (v.status === 'finished') showResult(v);
}

function showResult(v) {
  $('overlay').hidden = false;
  const won = v.youWon;
  $('resultTitle').textContent = won ? 'VICTORY' : 'DEFEAT';
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
    $('resultDetail').innerHTML = a.youAttacked
      ? (won ? 'Your attack broke through.' : 'Your attack fell short.')
      : (won ? `${v.opponentName} attacked and failed.` : `${v.opponentName} attacked and broke through.`);

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

/* ── flow ─────────────────────────────────────────────── */
async function act(fn) {
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

async function refresh() {
  state.view = await api('GET', `/games/${state.gameId}/me`);
  render();
  await renderFeed();
}

function startPolling() {
  clearInterval(state.poll);
  state.poll = setInterval(() => {
    if (state.gameId && !state.mode && state.view?.status !== 'finished') {
      refresh().catch(() => {});
    }
  }, 2500);
}

async function enterTable() {
  $('lobby').hidden = true;
  $('table').hidden = false;
  $('identity').hidden = false;
  $('overlay').hidden = true;
  $('waitRoom').hidden = true;
  await refresh();
  startPolling();
}

/* ── name drawer ──────────────────────────────────────── */
let drawerResolve = null;
function askName({ title, sub, cta }) {
  $('drawerTitle').textContent = title;
  $('drawerSub').textContent = sub;
  $('nameGo').textContent = cta || 'Continue';
  $('nameInput').value = localStorage.getItem('redblack.name') || '';
  $('nameDrawer').hidden = false;
  setTimeout(() => $('nameInput').focus(), 60);
  return new Promise((resolve) => { drawerResolve = resolve; });
}
function closeDrawer(value) {
  $('nameDrawer').hidden = true;
  const r = drawerResolve; drawerResolve = null;
  if (r) r(value);
}

/* ── waiting room ─────────────────────────────────────── */
let waitPoll = null;
function showWaitRoom(code) {
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

/* ── wiring ───────────────────────────────────────────── */
$('newGameBtn').onclick = async () => {
  const name = await askName({ title: 'What should we call you?',
    sub: 'Your opponent will see this name.', cta: 'Create room' });
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
  const name = await askName({ title: 'What should we call you?',
    sub: 'Your opponent will see this name.', cta: 'Join game' });
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
  try { await navigator.clipboard.writeText($('roomCode').textContent); toast('Room code copied.'); }
  catch { toast('Select the code above to copy it.'); }
};
$('waitCancel').onclick = () => {
  clearInterval(waitPoll);
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
