export type ChallongeErrorPayload = {
  errors?: string[] | { detail?: string; title?: string } | Array<{ detail?: string; title?: string }>;
  error?: string;
  message?: string;
} | null;

export type {
  RecentTournament,
  ImportedPlayer,
  OAuthTokenResponse,
  OAuthMode,
} from '../util/types.js';
