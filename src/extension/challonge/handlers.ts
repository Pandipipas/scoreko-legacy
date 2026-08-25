import { createHandler } from '../util/message-handler.js';
import { nodecg } from '../util/nodecg.js';
import type { OAuthConfig } from '../util/oauth-server.js';
import { oauthServer, getOAuthMode } from './oauth.js';
import { tokenStore } from '../util/token-store.js';
import { normalizeTournamentSlug } from './api.js';
import { getStringProp, sendAck } from '../util/helpers.js';
import type {
  CreateTournamentParams,
  TournamentStateAction,
  BulkParticipantInput,
} from '../util/types.js';
import {
  fetchRecentTournaments,
  fetchTournamentPlayers,
  fetchMatches,
  reportMatch,
  changeMatchState,
  createTournament,
  changeTournamentState,
  createParticipant,
  bulkCreateParticipants,
  randomizeParticipants,
  deleteParticipant,
} from './service.js';


export function setupHandlers() {

  nodecg.listenFor('challonge:createOAuthSession', createHandler({
    handler: async (_payload: unknown, ack) => {
      const mode = getOAuthMode();
      let serverConfig: OAuthConfig;

      if (mode.type === 'dev') {
        serverConfig = {
          clientId: mode.clientId,
        };
      } else {
        try {
          const res = await fetch(`${mode.proxyBaseUrl}/oauth/challonge/client-id`);
          if (!res.ok) throw new Error(`Proxy responded with ${res.status}`);
          const data = await res.json() as { clientId?: string };
          const clientId = String(data.clientId ?? '').trim();
          if (!clientId) throw new Error('Proxy did not return a clientId');
          serverConfig = { clientId };
        } catch (err) {
          sendAck(
            ack,
            err instanceof Error ? err.message : 'Could not fetch OAuth config from proxy',
          );
          return;
        }
      }

      try {
        await oauthServer.ensureServer(serverConfig);
      } catch (err) {
        sendAck(ack, err instanceof Error ? err.message : 'Could not start the OAuth callback server');
        return;
      }

      sendAck(ack, null, oauthServer.createSession(serverConfig));
    }
  }));

  nodecg.listenFor('challonge:getOAuthSessionStatus', createHandler({
    handler: (payload: unknown, ack) => {
      const sessionId = getStringProp(payload, 'sessionId');
      if (!sessionId) {
        sendAck(ack, 'Missing OAuth session id');
        return;
      }

      const status = oauthServer.getSessionStatus(sessionId);
      if (!status) {
        sendAck(ack, 'OAuth session not found');
        return;
      }

      if (status.status === 'completed' && status.token) {
        tokenStore.setToken('challonge', status.token);
        status.token = undefined;
      }

      sendAck(ack, null, status);
    }
  }));

  nodecg.listenFor('challonge:fetchRecentTournaments', createHandler({
    requiresToken: 'challonge',
    handler: async (payload: unknown, ack, { token }) => {
      if (!token) {
        sendAck(ack, 'Missing Challonge API token');
        return;
      }

      try {
        const tournaments = await fetchRecentTournaments(token);
        sendAck(ack, null, tournaments);
      } catch (error) {
        sendAck(ack, error instanceof Error ? error.message : 'Unknown error while loading tournaments');
      }
    }
  }));

  nodecg.listenFor('challonge:fetchTournamentPlayers', createHandler({
    requiresToken: 'challonge',
    handler: async (payload: unknown, ack, { token }) => {
      const slug = normalizeTournamentSlug(getStringProp(payload, 'slug'));
      if (!slug) { sendAck(ack, 'Missing tournament slug'); return; }

      try {
        const players = await fetchTournamentPlayers(slug, token);
        sendAck(ack, null, players);
      } catch (error) {
        sendAck(ack, error instanceof Error ? error.message : 'Unknown error while importing players');
      }
    }
  }));

  nodecg.listenFor('challonge:setManualToken', createHandler({
    handler: (payload: unknown, ack) => {
      const token = getStringProp(payload, 'token');
      if (!token) {
        sendAck(ack, 'Token cannot be empty');
        return;
      }
      tokenStore.setToken('challonge', token);
      sendAck(ack, null);
    }
  }));

  nodecg.listenFor('challonge:fetchMatches', createHandler({
    requiresToken: 'challonge',
    handler: async (payload: unknown, ack, { token }) => {
      const slug = normalizeTournamentSlug(getStringProp(payload, 'slug'));
      if (!slug) { sendAck(ack, 'Missing tournament slug'); return; }

      try {
        const matches = await fetchMatches(slug, token);
        sendAck(ack, null, matches);
      } catch (error) {
        sendAck(ack, error instanceof Error ? error.message : 'Unknown error while fetching matches');
      }
    }
  }));

  nodecg.listenFor('challonge:reportMatch', createHandler({
    requiresToken: 'challonge',
    handler: async (payload: unknown, ack, { token }) => {
      const slug = normalizeTournamentSlug(getStringProp(payload, 'slug'));
      const matchId = String((payload as Record<string, unknown>).matchId ?? '').trim();
      const winnerId = String((payload as Record<string, unknown>).winnerId ?? '').trim();
      const scoresCsv = String((payload as Record<string, unknown>).scoresCsv ?? '').trim();

      if (!slug) { sendAck(ack, 'Missing tournament slug'); return; }
      if (!matchId) { sendAck(ack, 'Missing match ID'); return; }
      if (!winnerId) { sendAck(ack, 'Missing winner ID'); return; }

      try {
        const result = await reportMatch(slug, matchId, winnerId, scoresCsv, token);
        sendAck(ack, null, result);
      } catch (error) {
        sendAck(ack, error instanceof Error ? error.message : 'Unknown error while reporting match');
      }
    }
  }));

  nodecg.listenFor('challonge:changeMatchState', createHandler({
    requiresToken: 'challonge',
    handler: async (payload: unknown, ack, { token }) => {
      const slug = normalizeTournamentSlug(getStringProp(payload, 'slug'));
      const matchId = String((payload as Record<string, unknown>).matchId ?? '').trim();
      const action = String((payload as Record<string, unknown>).action ?? '').trim() as 'reopen' | 'mark_underway' | 'unmark_underway' | 'mark_as_underway' | 'unmark_as_underway';

      if (!slug) { sendAck(ack, 'Missing tournament slug'); return; }
      if (!matchId) { sendAck(ack, 'Missing match ID'); return; }
      if (!['reopen', 'mark_underway', 'unmark_underway', 'mark_as_underway', 'unmark_as_underway'].includes(action)) {
        sendAck(ack, 'Invalid match action');
        return;
      }

      try {
        const result = await changeMatchState(slug, matchId, action, token);
        sendAck(ack, null, result);
      } catch (error) {
        sendAck(ack, error instanceof Error ? error.message : 'Unknown error while changing match state');
      }
    }
  }));

  nodecg.listenFor('challonge:createTournament', createHandler({
    requiresToken: 'challonge',
    handler: async (payload: unknown, ack, { token }) => {
      const params = payload as CreateTournamentParams;
      if (!params || typeof params.name !== 'string' || !params.name.trim()) {
        sendAck(ack, 'Tournament name is required');
        return;
      }

      try {
        const tournament = await createTournament(params, token);
        sendAck(ack, null, tournament);
      } catch (error) {
        sendAck(ack, error instanceof Error ? error.message : 'Unknown error while creating tournament');
      }
    }
  }));

  nodecg.listenFor('challonge:changeTournamentState', createHandler({
    requiresToken: 'challonge',
    handler: async (payload: unknown, ack, { token }) => {
      const slug = normalizeTournamentSlug(getStringProp(payload, 'slug'));
      const action = String((payload as Record<string, unknown>).action ?? '').trim() as TournamentStateAction;

      if (!slug) { sendAck(ack, 'Missing tournament slug'); return; }
      if (!['start', 'finalize', 'reset'].includes(action)) {
        sendAck(ack, 'Invalid tournament state action');
        return;
      }

      try {
        const result = await changeTournamentState(slug, action, token);
        sendAck(ack, null, result);
      } catch (error) {
        sendAck(ack, error instanceof Error ? error.message : 'Unknown error while changing tournament state');
      }
    }
  }));

  nodecg.listenFor('challonge:createParticipant', createHandler({
    requiresToken: 'challonge',
    handler: async (payload: unknown, ack, { token }) => {
      const slug = normalizeTournamentSlug(getStringProp(payload, 'slug'));
      const p = payload as Record<string, unknown>;
      const name = String(p.name ?? '').trim();
      const seed = typeof p.seed === 'number' && Number.isFinite(p.seed) ? p.seed : undefined;
      const misc = typeof p.misc === 'string' ? p.misc.trim() : undefined;

      if (!slug) { sendAck(ack, 'Missing tournament slug'); return; }
      if (!name) { sendAck(ack, 'Participant name is required'); return; }

      try {
        const players = await createParticipant(slug, { name, seed, misc }, token);
        sendAck(ack, null, players);
      } catch (error) {
        sendAck(ack, error instanceof Error ? error.message : 'Unknown error while creating participant');
      }
    }
  }));

  nodecg.listenFor('challonge:bulkCreateParticipants', createHandler({
    requiresToken: 'challonge',
    handler: async (payload: unknown, ack, { token }) => {
      const slug = normalizeTournamentSlug(getStringProp(payload, 'slug'));
      const p = payload as Record<string, unknown>;
      const participants = (Array.isArray(p.participants) ? p.participants : []) as BulkParticipantInput[];

      if (!slug) { sendAck(ack, 'Missing tournament slug'); return; }
      if (!participants.length) { sendAck(ack, 'No participants provided'); return; }

      try {
        const players = await bulkCreateParticipants(slug, participants, token);
        sendAck(ack, null, players);
      } catch (error) {
        sendAck(ack, error instanceof Error ? error.message : 'Unknown error while bulk adding participants');
      }
    }
  }));

  nodecg.listenFor('challonge:randomizeParticipants', createHandler({
    requiresToken: 'challonge',
    handler: async (payload: unknown, ack, { token }) => {
      const slug = normalizeTournamentSlug(getStringProp(payload, 'slug'));
      if (!slug) { sendAck(ack, 'Missing tournament slug'); return; }

      try {
        const players = await randomizeParticipants(slug, token);
        sendAck(ack, null, players);
      } catch (error) {
        sendAck(ack, error instanceof Error ? error.message : 'Unknown error while randomizing seeds');
      }
    }
  }));

  nodecg.listenFor('challonge:deleteParticipant', createHandler({
    requiresToken: 'challonge',
    handler: async (payload: unknown, ack, { token }) => {
      const slug = normalizeTournamentSlug(getStringProp(payload, 'slug'));
      const participantId = String((payload as Record<string, unknown>).participantId ?? '').trim();

      if (!slug) { sendAck(ack, 'Missing tournament slug'); return; }
      if (!participantId) { sendAck(ack, 'Missing participant ID'); return; }

      try {
        const players = await deleteParticipant(slug, participantId, token);
        sendAck(ack, null, players);
      } catch (error) {
        sendAck(ack, error instanceof Error ? error.message : 'Unknown error while deleting participant');
      }
    }
  }));
}
