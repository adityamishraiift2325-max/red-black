/* Everything about rendering a single card, and the small text-formatting
   helpers that turn a raw card id like "10S" into a coloured glyph. */

import { state } from './state.js';
// Circular import, deliberate: render() lives in actions.js, and actions.js
// imports cardEl from here. Safe because render is only ever CALLED inside a
// click handler — never at module-evaluation time — so by the time it runs
// both modules have finished loading. See the Phase 2 module-split notes in
// docs/BACKLOG.md.
import { render } from './actions.js';

export const SUIT = { H: '♥', D: '♦', S: '♠', C: '♣' };

export function cardEl(card, { faceDown = false, pickable = false, isNew = false } = {}) {
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

const CARD_RE = /\b((?:[2-9]|10|[JQKA])[HDSC])\b/g;
export const prettyCard = (t) => String(t).replace(CARD_RE, (m) => {
  const s = m.slice(-1);
  return `<span class="cardref ${s === 'H' || s === 'D' ? 'red' : 'black'}">${m.slice(0, -1)}${SUIT[s]}</span>`;
});
