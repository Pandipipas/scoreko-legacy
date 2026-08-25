import {
  requestChallonge,
  parseRecentTournaments,
  parseImportedPlayers,
  parseMatches,
  RECENT_TOURNAMENTS_LIMIT,
} from './api.js';
import { nodecg } from '../util/nodecg.js';
import { globalRequestCache } from '../util/request-cache.js';
import { challongeParticipantsMapReplicant } from '../util/replicants.js';
import type {
  ImportedPlayer,
  RecentTournament,
  CreateTournamentParams,
  TournamentStateAction,
  BulkParticipantInput,
} from '../util/types.js';

export async function fetchRecentTournaments(token: string) {

  return globalRequestCache.wrap('challonge:tournaments', 5 * 60 * 1000, async () => {
    const raw = await requestChallonge('/tournaments.json', token);
    return parseRecentTournaments(raw)
      .sort((a, b) => (b.startAt ?? 0) - (a.startAt ?? 0))
      .slice(0, RECENT_TOURNAMENTS_LIMIT);
  });
}

export async function fetchTournamentPlayers(slug: string, token: string) {
  return globalRequestCache.wrap(`challonge:players:${slug}`, 10 * 60 * 1000, async () => {
    try {
      const raw = await requestChallonge(
        `/tournaments/${encodeURIComponent(slug)}/participants.json`,
        token,
      );
      const players = parseImportedPlayers(raw);
      if (challongeParticipantsMapReplicant.value) {
        for (const p of players) {
          challongeParticipantsMapReplicant.value[p.id] = p as unknown as Record<string, unknown>;
        }
      }
      return players;
    } catch (err) {
      const rep = challongeParticipantsMapReplicant.value ?? {};
      const fallbackPlayers = Object.values(rep) as unknown as ImportedPlayer[];
      if (fallbackPlayers.length > 0) return fallbackPlayers;
      throw err;
    }
  });
}

export async function fetchMatches(slug: string, token: string) {
  return globalRequestCache.wrap(`challonge:matches:${slug}`, 30 * 1000, async () => {
    const [matchesRes, participantsRes] = await Promise.allSettled([
      requestChallonge(`/tournaments/${encodeURIComponent(slug)}/matches.json`, token),
      requestChallonge(`/tournaments/${encodeURIComponent(slug)}/participants.json`, token),
    ]);

    if (matchesRes.status === 'rejected') {
      throw matchesRes.reason;
    }
    const rawMatches = matchesRes.value;

    let rawParticipants: unknown;
    if (participantsRes.status === 'fulfilled') {
      rawParticipants = participantsRes.value;
    } else {
      const msg = participantsRes.reason instanceof Error ? participantsRes.reason.message : String(participantsRes.reason);
      nodecg.log.warn(`[challonge] Failed to fetch participants for "${slug}": ${msg}. Using cached data.`);
    }

    const players = rawParticipants ? parseImportedPlayers(rawParticipants) : [];
    if (challongeParticipantsMapReplicant.value && players.length > 0) {
      for (const p of players) {
        challongeParticipantsMapReplicant.value[p.id] = p as unknown as Record<string, unknown>;
      }
    }
    
    const playersMap = new Map<string, { gamertag: string }>();
    if (challongeParticipantsMapReplicant.value) {
      for (const [id, pData] of Object.entries(challongeParticipantsMapReplicant.value)) {
        if (pData && typeof pData.gamertag === 'string') {
          playersMap.set(id, { gamertag: pData.gamertag });
        }
      }
    }
    for (const p of players) {
      playersMap.set(p.id, p);
    }
    
    const parsedMatches = parseMatches(rawMatches);
    for (const match of parsedMatches) {
      if (match.player1 && playersMap.has(match.player1.id)) {
        match.player1.gamertag = playersMap.get(match.player1.id)!.gamertag;
      }
      if (match.player2 && playersMap.has(match.player2.id)) {
        match.player2.gamertag = playersMap.get(match.player2.id)!.gamertag;
      }
    }
    return parsedMatches;
  });
}

export async function reportMatch(slug: string, matchId: string, winnerId: string, scoresCsv: string, token: string) {
  const v1Match: Record<string, string> = { winner_id: winnerId };
  if (scoresCsv) v1Match.scores_csv = scoresCsv;

  const v2Match: Record<string, string | boolean> = { participant_id: winnerId, advancing: true };
  if (scoresCsv) v2Match.score_set = scoresCsv;

  const body = {
    v1: {
      match: v1Match,
    },
    v2: {
      data: {
        type: "Match",
        attributes: {
          match: [v2Match]
        }
      }
    }
  };
  
  await requestChallonge(
    `/tournaments/${encodeURIComponent(slug)}/matches/${encodeURIComponent(matchId)}.json`,
    token,
    'PUT',
    body,
  );
  
  globalRequestCache.invalidateExact(`challonge:matches:${slug}`);
  return { success: true };
}

export async function changeMatchState(
  slug: string,
  matchId: string,
  action: 'reopen' | 'mark_underway' | 'unmark_underway' | 'mark_as_underway' | 'unmark_as_underway',
  token: string,
) {
  let endpointAction = action;
  if (action === 'mark_underway') endpointAction = 'mark_as_underway';
  if (action === 'unmark_underway') endpointAction = 'unmark_as_underway';

  try {
    await requestChallonge(
      `/tournaments/${encodeURIComponent(slug)}/matches/${encodeURIComponent(matchId)}/${endpointAction}.json`,
      token,
      'POST',
    );
  } catch (err) {
    if (endpointAction === 'reopen') {
      try {
        await requestChallonge(
          `/tournaments/${encodeURIComponent(slug)}/matches/${encodeURIComponent(matchId)}/unmark_as_underway.json`,
          token,
          'POST',
        );
      } catch {
        throw err;
      }
    } else {
      throw err;
    }
  }

  globalRequestCache.invalidateExact(`challonge:matches:${slug}`);
  return { success: true };
}

export async function createTournament(params: CreateTournamentParams, token: string): Promise<RecentTournament> {
  const v1Tournament: Record<string, unknown> = {
    name: params.name.trim(),
    tournament_type: params.tournamentType || 'double elimination',
  };
  if (params.url?.trim()) v1Tournament.url = params.url.trim();
  if (params.gameName?.trim()) v1Tournament.game_name = params.gameName.trim();
  if (params.description?.trim()) v1Tournament.description = params.description.trim();
  if (typeof params.openSignup === 'boolean') v1Tournament.open_signup = params.openSignup;

  const v2Attributes: Record<string, unknown> = {
    name: params.name.trim(),
    tournament_type: params.tournamentType || 'double elimination',
  };
  if (params.url?.trim()) v2Attributes.url = params.url.trim();
  if (params.gameName?.trim()) v2Attributes.game_name = params.gameName.trim();
  if (params.description?.trim()) v2Attributes.description = params.description.trim();
  if (typeof params.openSignup === 'boolean') v2Attributes.open_signup = params.openSignup;

  const body = {
    v1: {
      tournament: v1Tournament,
    },
    v2: {
      data: {
        type: 'Tournament',
        attributes: v2Attributes,
      },
    },
  };

  const raw = await requestChallonge('/tournaments.json', token, 'POST', body);
  const parsed = parseRecentTournaments(raw);
  if (!parsed.length) {
    throw new Error('Failed to parse created Challonge tournament');
  }

  globalRequestCache.invalidateExact('challonge:tournaments');
  return parsed[0];
}

export async function changeTournamentState(
  slug: string,
  stateAction: TournamentStateAction,
  token: string,
) {
  await requestChallonge(
    `/tournaments/${encodeURIComponent(slug)}/${stateAction}.json`,
    token,
    'POST',
  );
  globalRequestCache.invalidateExact(`challonge:matches:${slug}`);
  globalRequestCache.invalidateExact(`challonge:players:${slug}`);
  globalRequestCache.invalidateExact('challonge:tournaments');
  return { success: true };
}

export async function createParticipant(
  slug: string,
  data: { name: string; seed?: number; misc?: string },
  token: string,
): Promise<ImportedPlayer[]> {
  const v1Participant: Record<string, unknown> = {
    name: data.name.trim(),
  };
  if (typeof data.seed === 'number') v1Participant.seed = data.seed;
  if (data.misc?.trim()) v1Participant.misc = data.misc.trim();

  const v2Attributes: Record<string, unknown> = {
    name: data.name.trim(),
  };
  if (typeof data.seed === 'number') v2Attributes.seed = data.seed;
  if (data.misc?.trim()) v2Attributes.misc = data.misc.trim();

  const body = {
    v1: { participant: v1Participant },
    v2: {
      data: {
        type: 'Participant',
        attributes: v2Attributes,
      },
    },
  };

  await requestChallonge(
    `/tournaments/${encodeURIComponent(slug)}/participants.json`,
    token,
    'POST',
    body,
  );
  globalRequestCache.invalidateExact(`challonge:players:${slug}`);
  globalRequestCache.invalidateExact(`challonge:matches:${slug}`);
  return fetchTournamentPlayers(slug, token);
}

export async function bulkCreateParticipants(
  slug: string,
  participants: BulkParticipantInput[],
  token: string,
): Promise<ImportedPlayer[]> {
  const mappedParticipants = participants.map((p) => {
    const item: Record<string, unknown> = { name: p.name.trim() };
    if (typeof p.seed === 'number') item.seed = p.seed;
    if (p.misc?.trim()) item.misc = p.misc.trim();
    return item;
  });

  const body = {
    v1: {
      participants: mappedParticipants,
    },
    v2: {
      data: {
        type: 'Participants',
        attributes: {
          participants: mappedParticipants,
        },
      },
    },
  };

  await requestChallonge(
    `/tournaments/${encodeURIComponent(slug)}/participants/bulk_add.json`,
    token,
    'POST',
    body,
  );
  globalRequestCache.invalidateExact(`challonge:players:${slug}`);
  globalRequestCache.invalidateExact(`challonge:matches:${slug}`);
  return fetchTournamentPlayers(slug, token);
}

export async function randomizeParticipants(slug: string, token: string): Promise<ImportedPlayer[]> {
  await requestChallonge(
    `/tournaments/${encodeURIComponent(slug)}/participants/randomize.json`,
    token,
    'POST',
  );
  globalRequestCache.invalidateExact(`challonge:players:${slug}`);
  globalRequestCache.invalidateExact(`challonge:matches:${slug}`);
  return fetchTournamentPlayers(slug, token);
}

export async function deleteParticipant(
  slug: string,
  participantId: string,
  token: string,
): Promise<ImportedPlayer[]> {
  await requestChallonge(
    `/tournaments/${encodeURIComponent(slug)}/participants/${encodeURIComponent(participantId)}.json`,
    token,
    'DELETE',
  );
  if (challongeParticipantsMapReplicant.value && challongeParticipantsMapReplicant.value[participantId]) {
    delete challongeParticipantsMapReplicant.value[participantId];
  }
  globalRequestCache.invalidateExact(`challonge:players:${slug}`);
  globalRequestCache.invalidateExact(`challonge:matches:${slug}`);
  return fetchTournamentPlayers(slug, token);
}




