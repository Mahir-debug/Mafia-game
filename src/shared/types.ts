export type Role = 'mafia' | 'detective' | 'doctor' | 'civilian';

export type GamePhase =
  | 'LOBBY'
  | 'NIGHT'
  | 'DAWN'
  | 'DAY_DISCUSSION'
  | 'DAY_VOTING'
  | 'EXECUTION'
  | 'GAME_OVER';

export type ModerationLevel = 'strict' | 'standard' | 'relaxed';
export type DoctorSelfSaveMode = 'once' | 'unlimited' | 'never';
export type ChatChannel = 'public' | 'mafia' | 'ghost' | 'system';

export interface GameModifiers {
  mafiaCount: number;
  detectiveCount: number;
  doctorCount: number;
  nightDurationSec: number;
  dayDurationSec: number;
  votingDurationSec: number;
  doctorSelfSave: DoctorSelfSaveMode;
  anonymousVoting: boolean;
  revealRoleOnDeath: boolean;
  ghostChatEnabled: boolean;
  moderationLevel: ModerationLevel;
  slowModeSec: number;
}

export interface PublicPlayer {
  id: string;
  name: string;
  alive: boolean;
  connected: boolean;
  isHost: boolean;
  mutedUntil: number | null;
  strikes: number;
  revealedRole: Role | null;
  votesAgainst: number;
  votedByNames: string[];
  hasActedNight: boolean;
}

export interface DeathEvent {
  id: string;
  playerId: string;
  playerName: string;
  role: Role | 'unknown';
  cause: 'mafia_kill' | 'town_execution';
  round: number;
}

export interface NightOutcome {
  round: number;
  wasSaved: boolean;
  savedTargetSelf: boolean;
  death: DeathEvent | null;
}

export interface EncryptedChatMessage {
  id: string;
  channel: ChatChannel;
  senderId: string;
  senderName: string;
  iv?: string;
  ciphertext?: string;
  systemText?: string;
  timestamp: number;
  reportsCount: number;
  flagged?: boolean;
}

export interface RoomSummary {
  roomId: string;
  name: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  isPrivate: boolean;
  phase: GamePhase;
  modifiers: GameModifiers;
}

export interface InvestigationResult {
  round: number;
  targetId: string;
  targetName: string;
  alignment: 'mafia' | 'innocent';
}

export interface ClientGameState {
  roomId: string;
  roomName: string;
  isPrivate: boolean;
  maxPlayers: number;
  phase: GamePhase;
  round: number;
  phaseEndsAt: number | null;
  serverTime: number;
  modifiers: GameModifiers;
  players: PublicPlayer[];
  selfId: string;
  selfRole: Role | null;
  selfAlive: boolean;
  selfHasSelfSaved: boolean;
  selfNightTargetId: string | null;
  selfVoteTargetId: string | null;
  mafiaTeammateIds: string[];
  mafiaNightVotes: Record<string, string>;
  investigations: InvestigationResult[];
  lastNightOutcome: NightOutcome | null;
  lastExecution: DeathEvent | null;
  winner: 'town' | 'mafia' | null;
  publicRoomKeyB64: string;
  mafiaRoomKeyB64: string | null;
  messages: EncryptedChatMessage[];
  readyToVoteIds: string[];
}

export type ClientToServerMessage =
  | { type: 'lobby:subscribe' }
  | {
      type: 'room:create';
      roomName: string;
      playerName: string;
      password?: string;
      maxPlayers: number;
      modifiers: GameModifiers;
    }
  | {
      type: 'room:join';
      roomId: string;
      playerName: string;
      password?: string;
      sessionToken?: string;
    }
  | { type: 'room:leave' }
  | {
      type: 'room:update_modifiers';
      modifiers: GameModifiers;
      password?: string | null;
      isPrivate?: boolean;
      maxPlayers?: number;
    }
  | { type: 'game:start' }
  | { type: 'game:night_action'; targetId: string }
  | { type: 'game:skip_to_vote' }
  | { type: 'game:vote'; targetId: string | 'skip' }
  | { type: 'game:reset' }
  | {
      type: 'chat:send';
      channel: 'public' | 'mafia' | 'ghost';
      iv: string;
      ciphertext: string;
    }
  | { type: 'chat:strike'; reason: string }
  | { type: 'chat:report'; messageId: string }
  | {
      type: 'host:moderate';
      targetPlayerId: string;
      action: 'mute' | 'unmute' | 'kick';
    };

export type ServerToClientMessage =
  | { type: 'lobby:list'; rooms: RoomSummary[] }
  | {
      type: 'room:joined';
      sessionToken: string;
      state: ClientGameState;
    }
  | { type: 'room:state'; state: ClientGameState }
  | { type: 'chat:message'; message: EncryptedChatMessage }
  | { type: 'chat:report_updated'; messageId: string; reportsCount: number }
  | { type: 'error'; code: string; message: string }
  | { type: 'kicked'; reason: string };
