// API surface. Every action is its own endpoint.
// Seat-scoped routes require the caller's seat token (Authorization: Bearer …).

const express = require('express');
const GameController = require('../controllers/GameController');
const ChallengeController = require('../controllers/ChallengeController');
const DebugController = require('../controllers/DebugController');
const ClientErrorController = require('../controllers/ClientErrorController');

const router = express.Router();

// ---- client error reporting (public — see CLAUDE.md standard #4) ---------
router.post('/client-errors', ClientErrorController.report);

// ---- developer inspection (UNREDACTED — not for player clients) -----------
router.get('/debug/games', DebugController.list);
router.get('/debug/games/:id', DebugController.dump);
router.get('/debug/games/:id/export', DebugController.exportJson);
router.get('/debug/client-errors', ClientErrorController.list);
router.get('/debug/games/:id/client-errors', ClientErrorController.forGame);

// ---- lobby: the game id IS the room --------------------------------------
router.post('/games', GameController.create);            // host creates + is seated
router.post('/games/join', GameController.join);         // opponent claims the open seat
router.get('/games/:id/lobby', GameController.lobby);    // pollable, no token needed
router.get('/games', GameController.list);

// ---- seat-scoped reads (token required) ----------------------------------
router.get('/games/:id/me', GameController.getSeatView);
router.get('/games/:id/me/hand', GameController.getHand);
router.get('/games/:id/me/legal-actions', GameController.getLegalActions);
router.get('/games/:id/me/attack-preview', GameController.previewAttack);
router.get('/games/:id/challenge', ChallengeController.current);

// ---- open reads (no card information) -------------------------------------
router.get('/games/:id/events', GameController.getEvents);
router.get('/games/:id/pending', GameController.getPending);
router.get('/games/:id/turns', GameController.getTurns);
router.get('/games/:id/opening-deal', GameController.getOpeningDeal);
router.get('/games/:id/challenges', ChallengeController.history);
router.get('/games/:id', GameController.getState);       // referee/debug view

// ---- turn actions (token required) ---------------------------------------
router.post('/games/:id/burn', GameController.burn);
router.post('/games/:id/swap', GameController.swap);
router.post('/games/:id/attack', GameController.attack);

// ---- challenge: three steps, four endpoints -------------------------------
router.post('/games/:id/challenge', ChallengeController.declare);
router.post('/games/:id/challenge/accept', ChallengeController.accept);
router.post('/games/:id/challenge/decline', ChallengeController.decline);
router.post('/games/:id/challenge/giveback', ChallengeController.giveback);

module.exports = router;
