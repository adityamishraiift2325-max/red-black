/* Developer inspector. Reads the unredacted /api/debug endpoints, so it shows
   both hands and the hidden challenge cards — things a player never sees. */

const SUIT = { H: '♥', D: '♦', S: '♠', C: '♣' };
const $ = (id) => document.getElementById(id);
let selected = null;

const api = async (p) => {
  const r = await fetch('/api' + p);
  if (!r.ok) throw new Error((await r.json()).error || r.status);
  return r.json();
};

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** Render a card id as a coloured chip. */
function cid(id) {
  if (!id) return '<span class="muted">—</span>';
  const suit = id.slice(-1);
  const red = suit === 'H' || suit === 'D';
  return `<span class="cid ${red ? 'red' : 'black'}">${id.slice(0, -1)}${SUIT[suit] || suit}</span>`;
}
const cids = (arr) => (arr && arr.length ? arr.map(cid).join(' ') : '<span class="muted">none</span>');
const seat = (n) => (n === null || n === undefined ? '<span class="muted">—</span>'
                                                  : `<span class="seat${n}">P${n}</span>`);

/* ── game index ───────────────────────────────────────── */
async function loadList() {
  const games = await api('/debug/games?limit=50');
  const ul = $('games');
  ul.innerHTML = '';
  if (!games.length) { ul.innerHTML = '<li class="muted">No games recorded.</li>'; return; }

  games.forEach((g) => {
    const li = document.createElement('li');
    if (g.id === selected) li.classList.add('active');
    li.innerHTML =
      `<div class="gid">${g.id.slice(0, 8)}</div>
       <div class="row2">
         <span class="pill ${g.status}">${g.status}</span>
         <span>${g.turn_count} turns</span>
         ${g.challenge_count ? `<span>${g.challenge_count} chal</span>` : ''}
         ${g.swap_count ? `<span>${g.swap_count} swap</span>` : ''}
         ${g.winner_seat !== null ? `<span>won by P${g.winner_seat}</span>` : ''}
       </div>`;
    li.onclick = () => { selected = g.id; loadList(); showGame(g.id); };
    ul.appendChild(li);
  });
}

/* ── detail ───────────────────────────────────────────── */
function timelineRow(t) {
  const d = t.detail || {};
  let detail = '<span class="muted">—</span>';

  if (t.action === 'burn_draw') {
    detail = `discarded ${cid(d.discarded)} → drew ${cid(d.drawn)}` +
             (d.reshuffled ? ' <span class="muted">(deck reshuffled)</span>' : '');
  } else if (t.action === 'swap') {
    detail = `gave ${cid(d.gave)} → received ${cid(d.received)} ` +
             `<span class="muted">(declared ${d.declaredType})</span>` +
             (d.opponentFallback ? ' <span class="hidden-card">fallback used</span>' : '');
  } else if (t.action === 'challenge') {
    const hidden = d.response === 'declined' || d.response === null;
    detail =
      `declared with ${cid(d.challengerCard)}` +
      (hidden ? ' <span class="hidden-card">← never shown to defender</span>' : '') +
      `<br><span class="muted">response:</span> <b>${d.response || 'pending'}</b>` +
      (d.defenderCard ? ` · defender put up ${cid(d.defenderCard)}` : '') +
      (d.values && d.values[0] !== null
        ? ` · ${d.values[0]} vs ${d.values[1]}${d.wasTie ? ' <b>(tie → defender)</b>' : ''}`
        : ' <span class="muted">· no comparison</span>') +
      `<br><span class="muted">winner</span> ${seat(d.winnerSeat)}` +
      ` · took ${cid(d.contested)} · gave back ${cid(d.giveback)}`;
  } else if (t.action === 'attack') {
    detail = `offense <b>${d.offenseTotal}</b> vs defense <b>${d.defenseTotal}</b> → ` +
             `winner ${seat(d.winnerSeat)}` +
             (d.offenseTotal === d.defenseTotal ? ' <b>(tie → defender)</b>' : '');
  }

  return `<tr>
    <td>${t.turnNo}</td>
    <td>${seat(t.seat)}</td>
    <td><span class="act ${t.action}">${t.action}</span></td>
    <td>${detail}</td>
    <td class="muted">${t.status}</td>
  </tr>`;
}

async function showGame(id) {
  const el = $('detail');
  el.innerHTML = '<div class="placeholder">Loading…</div>';
  let g;
  try { g = await api(`/debug/games/${id}`); }
  catch (e) { el.innerHTML = `<div class="placeholder">${esc(e.message)}</div>`; return; }

  const integrity = g.integrity.ok
    ? '<span class="ok-badge">52/52 accounted for</span>'
    : `<span class="bad-badge">BROKEN: ${esc(g.integrity.errors.join('; '))}</span>`;

  el.innerHTML = `
    <div class="dev-head">
      <h1>${g.game.id}</h1>
      <span class="pill ${g.game.status}">${g.game.status}</span>
      <div class="spacer"></div>
      <a class="ghost small" href="/api/debug/games/${g.game.id}/export">Download JSON</a>
    </div>

    <div class="sec">
      <h3>Summary</h3>
      <div class="kv">
        <div><div class="k">Turns played</div><div class="v">${g.timeline.length}</div></div>
        <div><div class="k">Started by</div><div class="v">P${g.game.startingSeat}</div></div>
        <div><div class="k">Winner</div><div class="v">${g.game.winnerSeat === null ? '—' : 'P' + g.game.winnerSeat}</div></div>
        <div><div class="k">Deck left</div><div class="v">${g.piles.deckCount}</div></div>
        <div><div class="k">Prep turns</div><div class="v">${g.seats.map((s) => s.prepTurns).join(' / ')}</div></div>
        <div><div class="k">Integrity</div><div class="v" style="font-size:12px">${integrity}</div></div>
      </div>
    </div>

    <div class="sec">
      <h3>Hands — opening vs final</h3>
      <table class="grid">
        <tr><th>Seat</th><th>Dealt</th><th>Final</th><th>Offense</th><th>Defense</th></tr>
        ${g.hands.map((h, i) => `
          <tr>
            <td>${seat(h.seat)}</td>
            <td>${cids(g.openingDeal[i] ? g.openingDeal[i].cards : [])}</td>
            <td>${cids(h.cards)}</td>
            <td><b>${h.offense}</b></td>
            <td><b>${h.defense}</b></td>
          </tr>`).join('')}
      </table>
    </div>

    <div class="sec">
      <h3>Turn-by-turn</h3>
      ${g.timeline.length ? `<table class="grid">
        <tr><th>#</th><th>Seat</th><th>Action</th><th>Detail</th><th>Status</th></tr>
        ${g.timeline.map(timelineRow).join('')}
      </table>` : '<div class="muted">No turns yet.</div>'}
    </div>

    <div class="sec">
      <h3>Event stream (${g.events.length})</h3>
      <table class="grid">
        <tr><th>#</th><th>Type</th><th>Payload</th></tr>
        ${g.events.map((e) => `<tr>
          <td>${e.seq}</td><td><span class="act">${e.type}</span></td>
          <td class="muted" style="font-family:ui-monospace,monospace;font-size:11px">${esc(JSON.stringify(e.payload))}</td>
        </tr>`).join('')}
      </table>
    </div>

    <div class="sec">
      <h3>Hand history</h3>
      <table class="grid">
        <tr><th>Turn</th><th>P0</th><th>P1</th></tr>
        ${[...new Set(g.handHistory.map((h) => h.turnNo))].map((tn) => {
          const p0 = g.handHistory.find((h) => h.turnNo === tn && h.seat === 0);
          const p1 = g.handHistory.find((h) => h.turnNo === tn && h.seat === 1);
          return `<tr><td>${tn}</td><td>${cids(p0 && p0.cards)}</td><td>${cids(p1 && p1.cards)}</td></tr>`;
        }).join('')}
      </table>
    </div>

    <div class="sec">
      <h3>Raw</h3>
      <details><summary>Full JSON dump</summary><pre class="raw">${esc(JSON.stringify(g, null, 2))}</pre></details>
    </div>
  `;
}

/* ── client errors ────────────────────────────────────── */
function timeAgo(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso + 'Z')) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  return Math.round(s / 3600) + 'h ago';
}

async function loadClientErrors() {
  const box = $('clientErrors');
  let rows;
  try { rows = await api('/debug/client-errors?limit=100'); }
  catch (e) { box.innerHTML = `<div class="placeholder">${esc(e.message)}</div>`; return; }

  $('ceCount').textContent = rows.length;
  if (!rows.length) { box.innerHTML = '<div class="muted" style="padding:8px">No client errors reported. Good sign.</div>'; return; }

  box.innerHTML = `<table class="grid">
    <tr><th>When</th><th>Context</th><th>Game</th><th>Seat</th><th>Message</th><th>Page</th></tr>
    ${rows.map((r) => `<tr>
      <td class="muted" title="${esc(r.created_at)}">${timeAgo(r.created_at)}</td>
      <td><span class="act">${esc(r.context || 'unspecified')}</span></td>
      <td class="muted" style="font-family:ui-monospace,monospace">${r.game_id ? esc(r.game_id.slice(0, 8)) : '—'}</td>
      <td>${r.seat === null ? '<span class="muted">—</span>' : seat(r.seat)}</td>
      <td>${esc(r.message)}</td>
      <td class="muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.url || '')}">${esc((r.url || '').replace(/^https?:\/\/[^/]+/, ''))}</td>
    </tr>`).join('')}
  </table>`;
}

$('ceReload').onclick = loadClientErrors;

$('reloadBtn').onclick = loadList;
loadList();
loadClientErrors();
setInterval(loadClientErrors, 15000);

// Deep link: /dev.html#<gameId>
if (location.hash.length > 1) {
  selected = location.hash.slice(1);
  showGame(selected).then(loadList);
}
