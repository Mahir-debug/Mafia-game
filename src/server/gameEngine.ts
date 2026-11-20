import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import type {
  ChatChannel,
  ClientGameState,
  ClientToServerMessage,
  DeathEvent,
  EncryptedChatMessage,
  GameModifiers,
  GamePhase,
  InvestigationResult,
  NightOutcome,
  PublicPlayer,
  Role,
  RoomSummary,
  ServerToClientMessage,
} from '../shared/types.ts';
import {
  generateAes256KeyB64,
  generateId,
  generateRoomCode,
  hashRoomPassword,
  verifyRoomPassword,
} from './moderation.ts';

interface ServerPlayer {
  id: string;
  sessionToken: string;
  name: string;
  ws: WebSocket | null;
  connected: boolean;
  isHost: boolean;
  role: Role | null;
  alive: boolean;
  hasSelfSaved: boolean;
  mutedUntil: number | null;
  strikes: number;
  lastMessageAt: number;
  investigations: InvestigationResult[];
}

interface InternalMessage extends EncryptedChatMessage {
  reporters: Set<string>;
}

interface Room {
  roomId: string;
  name: string;
  passwordHash: string | null;
  maxPlayers: number;
  phase: GamePhase;
  round: number;
  phaseEndsAt: number | null;
  timer: NodeJS.Timeout | null;
  cleanupTimer: NodeJS.Timeout | null;
  modifiers: GameModifiers;
  players: Map<string, ServerPlayer>;
  publicRoomKeyB64: string;
  mafiaRoomKeyB64: string;
  messages: InternalMessage[];
  nightMafiaTargets: Map<string, string>;
  nightDetectiveTargets: Map<string, string>;
  nightDoctorTargets: Map<string, string>;
  dayVotes: Map<string, string>;
  readyToVoteIds: Set<string>;
  lastNightOutcome: NightOutcome | null;
  lastExecution: DeathEvent | null;
  winner: 'town' | 'mafia' | null;
}

const DEFAULT_MODIFIERS: GameModifiers = {
  mafiaCount: 1,
  detectiveCount: 1,
  doctorCount: 1,
  nightDurationSec: 30,
  dayDurationSec: 45,
  votingDurationSec: 30,
  doctorSelfSave: 'once',
  anonymousVoting: false,
  revealRoleOnDeath: true,
  ghostChatEnabled: true,
  moderationLevel: 'standard',
  slowModeSec: 0,
};

export class MafiaGameServer {
  private rooms = new Map<string, Room>();
  private socketIndex = new Map<WebSocket, { roomId: string; playerId: string }>();
  private lobbySubscribers = new Set<WebSocket>();

  handleDisconnect(ws: WebSocket) {
    this.lobbySubscribers.delete(ws);
    const loc = this.socketIndex.get(ws);
    if (!loc) return;
    this.socketIndex.delete(ws);

    const room = this.rooms.get(loc.roomId);
    if (!room) return;
    const player = room.players.get(loc.playerId);
    if (!player) return;

    if (player.ws === ws) {
      player.ws = null;
      player.connected = false;
    }

    if (room.phase === 'LOBBY') {
      // Give brief grace or keep slot? In lobby, if disconnected > 15s remove, or keep for refresh
      this.scheduleRoomCleanupIfEmpty(room);
    } else {
      this.scheduleRoomCleanupIfEmpty(room);
    }

    this.broadcastRoomState(room);
    this.broadcastLobbyList();
  }

  handleMessage(ws: WebSocket, raw: string) {
    let msg: ClientToServerMessage;
    try {
      msg = JSON.parse(raw) as ClientToServerMessage;
    } catch {
      this.send(ws, { type: 'error', code: 'BAD_JSON', message: 'Invalid message payload.' });
      return;
    }

    switch (msg.type) {
      case 'lobby:subscribe': {
        this.lobbySubscribers.add(ws);
        this.send(ws, { type: 'lobby:list', rooms: this.getRoomSummaries() });
        break;
      }
      case 'room:create': {
        this.createRoom(ws, msg);
        break;
      }
      case 'room:join': {
        this.joinRoom(ws, msg);
        break;
      }
      case 'room:leave': {
        this.leaveRoom(ws);
        break;
      }
      case 'room:update_modifiers': {
        this.updateModifiers(ws, msg);
        break;
      }
      case 'game:start': {
        this.startGame(ws);
        break;
      }
      case 'game:night_action': {
        this.submitNightAction(ws, msg.targetId);
        break;
      }
      case 'game:skip_to_vote': {
        this.skipToVote(ws);
        break;
      }
      case 'game:vote': {
        this.submitVote(ws, msg.targetId);
        break;
      }
      case 'game:reset': {
        this.resetGame(ws);
        break;
      }
      case 'chat:send': {
        this.handleChatSend(ws, msg);
        break;
      }
      case 'chat:strike': {
        this.handleChatStrike(ws, msg.reason);
        break;
      }
      case 'chat:report': {
        this.handleChatReport(ws, msg.messageId);
        break;
      }
      case 'host:moderate': {
        this.handleHostModerate(ws, msg.targetPlayerId, msg.action);
        break;
      }
    }
  }

  private send(ws: WebSocket | null, payload: ServerToClientMessage) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify(payload));
  }

  private sanitizeModifiers(input: Partial<GameModifiers>, maxPlayers: number): GameModifiers {
    const mafiaCount = Math.max(1, Math.min(5, Math.floor(input.mafiaCount ?? DEFAULT_MODIFIERS.mafiaCount)));
    const detectiveCount = Math.max(0, Math.min(4, Math.floor(input.detectiveCount ?? DEFAULT_MODIFIERS.detectiveCount)));
    const doctorCount = Math.max(0, Math.min(3, Math.floor(input.doctorCount ?? DEFAULT_MODIFIERS.doctorCount)));
    const nightDurationSec = [20, 30, 45, 60].includes(Number(input.nightDurationSec))
      ? Number(input.nightDurationSec)
      : 30;
    const dayDurationSec = [30, 45, 60, 90, 120].includes(Number(input.dayDurationSec))
      ? Number(input.dayDurationSec)
      : 45;
    const votingDurationSec = [20, 30, 45, 60].includes(Number(input.votingDurationSec))
      ? Number(input.votingDurationSec)
      : 30;
    const slowModeSec = [0, 3, 5, 10].includes(Number(input.slowModeSec)) ? Number(input.slowModeSec) : 0;

    return {
      mafiaCount: Math.min(mafiaCount, Math.max(1, Math.floor((maxPlayers - 1) / 2))),
      detectiveCount,
      doctorCount,
      nightDurationSec,
      dayDurationSec,
      votingDurationSec,
      doctorSelfSave:
        input.doctorSelfSave === 'unlimited' || input.doctorSelfSave === 'never' ? input.doctorSelfSave : 'once',
      anonymousVoting: Boolean(input.anonymousVoting),
      revealRoleOnDeath: input.revealRoleOnDeath !== false,
      ghostChatEnabled: input.ghostChatEnabled !== false,
      moderationLevel:
        input.moderationLevel === 'strict' || input.moderationLevel === 'relaxed'
          ? input.moderationLevel
          : 'standard',
      slowModeSec,
    };
  }

  private createRoom(
    ws: WebSocket,
    msg: Extract<ClientToServerMessage, { type: 'room:create' }>
  ) {
    this.detachSocket(ws);

    const cleanRoomName = msg.roomName.trim().slice(0, 32) || 'Midnight Parlor';
    const cleanPlayerName = msg.playerName.trim().slice(0, 20) || 'Host';
    const maxPlayers = Math.max(4, Math.min(16, Math.floor(msg.maxPlayers || 10)));

    let roomId = generateRoomCode();
    while (this.rooms.has(roomId)) {
      roomId = generateRoomCode();
    }

    const playerId = generateId('p_');
    const sessionToken = generateId('tok_');

    const hostPlayer: ServerPlayer = {
      id: playerId,
      sessionToken,
      name: cleanPlayerName,
      ws,
      connected: true,
      isHost: true,
      role: null,
      alive: true,
      hasSelfSaved: false,
      mutedUntil: null,
      strikes: 0,
      lastMessageAt: 0,
      investigations: [],
    };

    const room: Room = {
      roomId,
      name: cleanRoomName,
      passwordHash: msg.password && msg.password.trim() ? hashRoomPassword(msg.password.trim()) : null,
      maxPlayers,
      phase: 'LOBBY',
      round: 0,
      phaseEndsAt: null,
      timer: null,
      cleanupTimer: null,
      modifiers: this.sanitizeModifiers(msg.modifiers, maxPlayers),
      players: new Map([[playerId, hostPlayer]]),
      publicRoomKeyB64: generateAes256KeyB64(),
      mafiaRoomKeyB64: generateAes256KeyB64(),
      messages: [],
      nightMafiaTargets: new Map(),
      nightDetectiveTargets: new Map(),
      nightDoctorTargets: new Map(),
      dayVotes: new Map(),
      readyToVoteIds: new Set(),
      lastNightOutcome: null,
      lastExecution: null,
      winner: null,
    };

    this.rooms.set(roomId, room);
    this.socketIndex.set(ws, { roomId, playerId });
    this.lobbySubscribers.delete(ws);

    this.pushSystemMessage(room, `${cleanPlayerName} opened the table (${roomId}).`);
    this.send(ws, {
      type: 'room:joined',
      sessionToken,
      state: this.buildClientState(room, hostPlayer),
    });
    this.broadcastLobbyList();
  }

  private joinRoom(
    ws: WebSocket,
    msg: Extract<ClientToServerMessage, { type: 'room:join' }>
  ) {
    const code = msg.roomId.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      this.send(ws, { type: 'error', code: 'ROOM_NOT_FOUND', message: `Lobby "${code}" does not exist.` });
      return;
    }

    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }

    // Check reconnection via sessionToken first
    if (msg.sessionToken) {
      const existing = Array.from(room.players.values()).find(
        (p) => p.sessionToken === msg.sessionToken
      );
      if (existing) {
        this.detachSocket(ws);
        existing.ws = ws;
        existing.connected = true;
        this.socketIndex.set(ws, { roomId: room.roomId, playerId: existing.id });
        this.lobbySubscribers.delete(ws);
        this.send(ws, {
          type: 'room:joined',
          sessionToken: existing.sessionToken,
          state: this.buildClientState(room, existing),
        });
        this.broadcastRoomState(room);
        this.broadcastLobbyList();
        return;
      }
    }

    // Password check for private rooms
    if (room.passwordHash) {
      const provided = msg.password?.trim() || '';
      if (!provided || !verifyRoomPassword(provided, room.passwordHash)) {
        this.send(ws, {
          type: 'error',
          code: 'INVALID_PASSWORD',
          message: provided ? 'Incorrect match password.' : 'This private match requires a password.',
        });
        return;
      }
    }

    if (room.phase !== 'LOBBY') {
      this.send(ws, {
        type: 'error',
        code: 'MATCH_IN_PROGRESS',
        message: 'This match is already underway.',
      });
      return;
    }

    if (room.players.size >= room.maxPlayers) {
      this.send(ws, { type: 'error', code: 'ROOM_FULL', message: 'This lobby is full.' });
      return;
    }

    const baseName = msg.playerName.trim().slice(0, 20) || 'Player';
    const existingNames = new Set(Array.from(room.players.values()).map((p) => p.name.toLowerCase()));
    let finalName = baseName;
    let suffix = 2;
    while (existingNames.has(finalName.toLowerCase())) {
      finalName = `${baseName.slice(0, 16)} ${suffix++}`;
    }

    this.detachSocket(ws);
    const playerId = generateId('p_');
    const sessionToken = generateId('tok_');
    const player: ServerPlayer = {
      id: playerId,
      sessionToken,
      name: finalName,
      ws,
      connected: true,
      isHost: room.players.size === 0,
      role: null,
      alive: true,
      hasSelfSaved: false,
      mutedUntil: null,
      strikes: 0,
      lastMessageAt: 0,
      investigations: [],
    };

    room.players.set(playerId, player);
    this.socketIndex.set(ws, { roomId: room.roomId, playerId });
    this.lobbySubscribers.delete(ws);

    this.pushSystemMessage(room, `${finalName} joined the table.`);
    this.send(ws, {
      type: 'room:joined',
      sessionToken,
      state: this.buildClientState(room, player),
    });
    this.broadcastRoomState(room);
    this.broadcastLobbyList();
  }

  private detachSocket(ws: WebSocket) {
    const prev = this.socketIndex.get(ws);
    if (!prev) return;
    this.socketIndex.delete(ws);
    const room = this.rooms.get(prev.roomId);
    if (!room) return;
    const player = room.players.get(prev.playerId);
    if (player && player.ws === ws) {
      player.ws = null;
      player.connected = false;
    }
  }

  private leaveRoom(ws: WebSocket) {
    const loc = this.socketIndex.get(ws);
    if (!loc) return;
    this.socketIndex.delete(ws);

    const room = this.rooms.get(loc.roomId);
    if (!room) return;
    const player = room.players.get(loc.playerId);
    if (!player) return;

    room.players.delete(player.id);
    this.pushSystemMessage(room, `${player.name} left the table.`);

    if (player.isHost && room.players.size > 0) {
      const nextHost = Array.from(room.players.values()).find((p) => p.connected) || Array.from(room.players.values())[0];
      if (nextHost) {
        nextHost.isHost = true;
        this.pushSystemMessage(room, `${nextHost.name} is now the host.`);
      }
    }

    if (room.players.size === 0) {
      this.destroyRoom(room);
    } else {
      if (room.phase !== 'LOBBY' && room.phase !== 'GAME_OVER') {
        this.checkWinCondition(room);
      }
      this.broadcastRoomState(room);
    }

    this.lobbySubscribers.add(ws);
    this.send(ws, { type: 'lobby:list', rooms: this.getRoomSummaries() });
    this.broadcastLobbyList();
  }

  private updateModifiers(
    ws: WebSocket,
    msg: Extract<ClientToServerMessage, { type: 'room:update_modifiers' }>
  ) {
    const ctx = this.getPlayerContext(ws);
    if (!ctx || !ctx.player.isHost || ctx.room.phase !== 'LOBBY') return;

    if (typeof msg.maxPlayers === 'number') {
      ctx.room.maxPlayers = Math.max(
        Math.max(4, ctx.room.players.size),
        Math.min(16, Math.floor(msg.maxPlayers))
      );
    }

    if (typeof msg.isPrivate === 'boolean') {
      if (!msg.isPrivate) {
        ctx.room.passwordHash = null;
      } else if (msg.password && msg.password.trim()) {
        ctx.room.passwordHash = hashRoomPassword(msg.password.trim());
      }
    } else if (msg.password && msg.password.trim()) {
      ctx.room.passwordHash = hashRoomPassword(msg.password.trim());
    }

    ctx.room.modifiers = this.sanitizeModifiers(msg.modifiers, ctx.room.maxPlayers);
    this.broadcastRoomState(ctx.room);
    this.broadcastLobbyList();
  }

  private startGame(ws: WebSocket) {
    const ctx = this.getPlayerContext(ws);
    if (!ctx || !ctx.player.isHost || ctx.room.phase !== 'LOBBY') return;

    const { room } = ctx;
    const players = Array.from(room.players.values());

    if (players.length < 4) {
      this.send(ws, {
        type: 'error',
        code: 'MIN_PLAYERS',
        message: 'At least 4 players are required to start a Mafia match.',
      });
      return;
    }

    const { mafiaCount, detectiveCount, doctorCount } = room.modifiers;
    const specialTotal = mafiaCount + detectiveCount + doctorCount;
    if (specialTotal > players.length) {
      this.send(ws, {
        type: 'error',
        code: 'ROLE_OVERFLOW',
        message: `Assigned roles (${specialTotal}) exceed connected players (${players.length}). Adjust role counts first.`,
      });
      return;
    }

    if (mafiaCount >= players.length - mafiaCount) {
      this.send(ws, {
        type: 'error',
        code: 'UNBALANCED_ROLES',
        message: 'Town players must outnumber Mafia at the start of the match.',
      });
      return;
    }

    // Build and cryptographically shuffle role deck
    const roles: Role[] = [];
    for (let i = 0; i < mafiaCount; i++) roles.push('mafia');
    for (let i = 0; i < detectiveCount; i++) roles.push('detective');
    for (let i = 0; i < doctorCount; i++) roles.push('doctor');
    while (roles.length < players.length) roles.push('civilian');

    for (let i = roles.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }

    players.forEach((p, idx) => {
      p.role = roles[idx];
      p.alive = true;
      p.hasSelfSaved = false;
      p.investigations = [];
      p.mutedUntil = null;
    });

    room.mafiaRoomKeyB64 = generateAes256KeyB64();
    room.round = 1;
    room.winner = null;
    room.lastNightOutcome = null;
    room.lastExecution = null;
    this.enterNightPhase(room);
    this.broadcastLobbyList();
  }

  private enterNightPhase(room: Room) {
    this.clearRoomTimer(room);
    room.phase = 'NIGHT';
    room.nightMafiaTargets.clear();
    room.nightDetectiveTargets.clear();
    room.nightDoctorTargets.clear();
    room.dayVotes.clear();
    room.readyToVoteIds.clear();

    const durationMs = room.modifiers.nightDurationSec * 1000;
    room.phaseEndsAt = Date.now() + durationMs;
    this.pushSystemMessage(room, `Night ${room.round} falls over the city. Special roles act under cover of darkness.`);

    room.timer = setTimeout(() => {
      this.resolveNightPhase(room);
    }, durationMs);

    this.broadcastRoomState(room);
  }

  private submitNightAction(ws: WebSocket, targetId: string) {
    const ctx = this.getPlayerContext(ws);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.phase !== 'NIGHT' || !player.alive || !player.role) return;

    const target = room.players.get(targetId);
    if (!target || !target.alive) {
      this.send(ws, { type: 'error', code: 'INVALID_TARGET', message: 'Select a living player.' });
      return;
    }

    if (player.role === 'mafia') {
      if (target.role === 'mafia') {
        this.send(ws, { type: 'error', code: 'INVALID_TARGET', message: 'Mafia cannot target a syndicate ally.' });
        return;
      }
      room.nightMafiaTargets.set(player.id, targetId);
    } else if (player.role === 'detective') {
      if (target.id === player.id) {
        this.send(ws, { type: 'error', code: 'INVALID_TARGET', message: 'You cannot investigate yourself.' });
        return;
      }
      if (room.nightDetectiveTargets.has(player.id)) {
        this.send(ws, {
          type: 'error',
          code: 'ALREADY_INVESTIGATED',
          message: 'You have already filed your investigation for this night.',
        });
        return;
      }
      room.nightDetectiveTargets.set(player.id, targetId);
      player.investigations.push({
        round: room.round,
        targetId: target.id,
        targetName: target.name,
        alignment: target.role === 'mafia' ? 'mafia' : 'innocent',
      });
    } else if (player.role === 'doctor') {
      if (target.id === player.id) {
        if (room.modifiers.doctorSelfSave === 'never') {
          this.send(ws, {
            type: 'error',
            code: 'SELF_SAVE_DISABLED',
            message: 'Self-protection is disabled by match modifiers.',
          });
          return;
        }
        if (room.modifiers.doctorSelfSave === 'once' && player.hasSelfSaved) {
          this.send(ws, {
            type: 'error',
            code: 'SELF_SAVE_USED',
            message: 'You already used your single self-save in this match.',
          });
          return;
        }
      }
      room.nightDoctorTargets.set(player.id, targetId);
    } else {
      return;
    }

    this.broadcastRoomState(room);

    // Check if all living special roles have submitted their actions
    const livingPlayers = Array.from(room.players.values()).filter((p) => p.alive);
    const livingMafia = livingPlayers.filter((p) => p.role === 'mafia');
    const livingDetectives = livingPlayers.filter((p) => p.role === 'detective');
    const livingDoctors = livingPlayers.filter((p) => p.role === 'doctor');

    const allMafiaActed = livingMafia.every((p) => room.nightMafiaTargets.has(p.id));
    const allDetectivesActed = livingDetectives.every((p) => room.nightDetectiveTargets.has(p.id));
    const allDoctorsActed = livingDoctors.every((p) => room.nightDoctorTargets.has(p.id));

    if (allMafiaActed && allDetectivesActed && allDoctorsActed) {
      this.clearRoomTimer(room);
      room.timer = setTimeout(() => {
        this.resolveNightPhase(room);
      }, 900);
    }
  }

  private resolveNightPhase(room: Room) {
    if (room.phase !== 'NIGHT') return;
    this.clearRoomTimer(room);

    // Commit doctor self-save flags if chosen
    for (const [docId, targetId] of room.nightDoctorTargets.entries()) {
      const doc = room.players.get(docId);
      if (doc && docId === targetId) {
        doc.hasSelfSaved = true;
      }
    }

    // Tally Mafia votes
    const targetCounts = new Map<string, number>();
    for (const targetId of room.nightMafiaTargets.values()) {
      targetCounts.set(targetId, (targetCounts.get(targetId) || 0) + 1);
    }

    let chosenTargetId: string | null = null;
    if (targetCounts.size > 0) {
      let maxVotes = 0;
      let tied: string[] = [];
      for (const [tid, count] of targetCounts.entries()) {
        if (count > maxVotes) {
          maxVotes = count;
          tied = [tid];
        } else if (count === maxVotes) {
          tied.push(tid);
        }
      }
      chosenTargetId = tied[crypto.randomInt(0, tied.length)];
    }

    const savedSet = new Set(room.nightDoctorTargets.values());
    let outcome: NightOutcome;

    if (!chosenTargetId) {
      outcome = {
        round: room.round,
        wasSaved: false,
        savedTargetSelf: false,
        death: null,
      };
      this.pushSystemMessage(room, `Dawn breaks on Round ${room.round}. The night passed without bloodshed.`);
    } else if (savedSet.has(chosenTargetId)) {
      const savedTarget = room.players.get(chosenTargetId);
      const savedSelf = Array.from(room.nightDoctorTargets.entries()).some(
        ([docId, tid]) => docId === tid && tid === chosenTargetId
      );
      outcome = {
        round: room.round,
        wasSaved: true,
        savedTargetSelf: savedSelf,
        death: null,
      };
      this.pushSystemMessage(
        room,
        `Dawn breaks on Round ${room.round}. An attack was carried out in the night, but the Doctor intervened in time${savedTarget ? '!' : '!'}`
      );
    } else {
      const victim = room.players.get(chosenTargetId)!;
      victim.alive = false;
      const revealedRole: Role | 'unknown' = room.modifiers.revealRoleOnDeath ? victim.role || 'civilian' : 'unknown';
      const death: DeathEvent = {
        id: generateId('death_'),
        playerId: victim.id,
        playerName: victim.name,
        role: revealedRole,
        cause: 'mafia_kill',
        round: room.round,
      };
      outcome = {
        round: room.round,
        wasSaved: false,
        savedTargetSelf: false,
        death,
      };
      this.pushSystemMessage(
        room,
        `Dawn breaks on Round ${room.round}. ${victim.name} was eliminated during the night${
          revealedRole !== 'unknown' ? ` (${revealedRole.toUpperCase()})` : ''
        }.`
      );
    }

    room.lastNightOutcome = outcome;
    room.lastExecution = null;
    room.phase = 'DAWN';
    const dawnDuration = outcome.death || outcome.wasSaved ? 6500 : 3200;
    room.phaseEndsAt = Date.now() + dawnDuration;

    room.timer = setTimeout(() => {
      if (this.checkWinCondition(room)) return;
      this.enterDayDiscussion(room);
    }, dawnDuration);

    this.broadcastRoomState(room);
  }

  private enterDayDiscussion(room: Room) {
    this.clearRoomTimer(room);
    room.phase = 'DAY_DISCUSSION';
    room.readyToVoteIds.clear();
    const durationMs = room.modifiers.dayDurationSec * 1000;
    room.phaseEndsAt = Date.now() + durationMs;
    this.pushSystemMessage(room, `Day ${room.round} discussion has begun. Share findings in encrypted Town chat.`);

    room.timer = setTimeout(() => {
      this.enterDayVoting(room);
    }, durationMs);

    this.broadcastRoomState(room);
  }

  private skipToVote(ws: WebSocket) {
    const ctx = this.getPlayerContext(ws);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.phase !== 'DAY_DISCUSSION' || !player.alive) return;

    if (room.readyToVoteIds.has(player.id)) {
      room.readyToVoteIds.delete(player.id);
    } else {
      room.readyToVoteIds.add(player.id);
    }

    const livingCount = Array.from(room.players.values()).filter((p) => p.alive).length;
    if (room.readyToVoteIds.size > livingCount / 2) {
      this.enterDayVoting(room);
      return;
    }

    this.broadcastRoomState(room);
  }

  private enterDayVoting(room: Room) {
    this.clearRoomTimer(room);
    room.phase = 'DAY_VOTING';
    room.dayVotes.clear();
    const durationMs = room.modifiers.votingDurationSec * 1000;
    room.phaseEndsAt = Date.now() + durationMs;
    this.pushSystemMessage(room, `Town voting is now open. Cast your ballot to accuse a suspect or skip.`);

    room.timer = setTimeout(() => {
      this.resolveDayVoting(room);
    }, durationMs);

    this.broadcastRoomState(room);
  }

  private submitVote(ws: WebSocket, targetId: string | 'skip') {
    const ctx = this.getPlayerContext(ws);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.phase !== 'DAY_VOTING' || !player.alive) return;

    if (targetId !== 'skip') {
      const target = room.players.get(targetId);
      if (!target || !target.alive) {
        this.send(ws, { type: 'error', code: 'INVALID_VOTE', message: 'You can only vote for a living player.' });
        return;
      }
    }

    room.dayVotes.set(player.id, targetId);
    this.broadcastRoomState(room);

    const livingPlayers = Array.from(room.players.values()).filter((p) => p.alive);
    if (livingPlayers.every((p) => room.dayVotes.has(p.id))) {
      this.clearRoomTimer(room);
      room.timer = setTimeout(() => {
        this.resolveDayVoting(room);
      }, 800);
    }
  }

  private resolveDayVoting(room: Room) {
    if (room.phase !== 'DAY_VOTING') return;
    this.clearRoomTimer(room);

    const counts = new Map<string, number>();
    let skipCount = 0;

    for (const vote of room.dayVotes.values()) {
      if (vote === 'skip') {
        skipCount++;
      } else {
        counts.set(vote, (counts.get(vote) || 0) + 1);
      }
    }

    let topTargetId: string | null = null;
    let topVotes = 0;
    let isTie = false;

    for (const [tid, count] of counts.entries()) {
      if (count > topVotes) {
        topVotes = count;
        topTargetId = tid;
        isTie = false;
      } else if (count === topVotes) {
        isTie = true;
      }
    }

    if (!topTargetId || isTie || topVotes <= skipCount) {
      room.lastExecution = null;
      room.phase = 'EXECUTION';
      room.phaseEndsAt = Date.now() + 3000;
      this.pushSystemMessage(
        room,
        isTie
          ? 'The town vote ended in a tie. No suspect was executed today.'
          : 'The town chose to withhold judgment today. No execution took place.'
      );
      room.timer = setTimeout(() => {
        if (this.checkWinCondition(room)) return;
        room.round += 1;
        this.enterNightPhase(room);
      }, 3000);
    } else {
      const executed = room.players.get(topTargetId)!;
      executed.alive = false;
      const revealedRole: Role | 'unknown' = room.modifiers.revealRoleOnDeath
        ? executed.role || 'civilian'
        : 'unknown';
      const death: DeathEvent = {
        id: generateId('exec_'),
        playerId: executed.id,
        playerName: executed.name,
        role: revealedRole,
        cause: 'town_execution',
        round: room.round,
      };
      room.lastExecution = death;
      room.phase = 'EXECUTION';
      room.phaseEndsAt = Date.now() + 6500;
      this.pushSystemMessage(
        room,
        `The town voted to execute ${executed.name}${
          revealedRole !== 'unknown' ? ` (${revealedRole.toUpperCase()})` : ''
        }.`
      );
      room.timer = setTimeout(() => {
        if (this.checkWinCondition(room)) return;
        room.round += 1;
        this.enterNightPhase(room);
      }, 6500);
    }

    this.broadcastRoomState(room);
  }

  private checkWinCondition(room: Room): boolean {
    const living = Array.from(room.players.values()).filter((p) => p.alive);
    const livingMafia = living.filter((p) => p.role === 'mafia').length;
    const livingTown = living.length - livingMafia;

    if (livingMafia === 0) {
      this.finishGame(room, 'town');
      return true;
    }
    if (livingMafia >= livingTown) {
      this.finishGame(room, 'mafia');
      return true;
    }
    return false;
  }

  private finishGame(room: Room, winner: 'town' | 'mafia') {
    this.clearRoomTimer(room);
    room.phase = 'GAME_OVER';
    room.winner = winner;
    room.phaseEndsAt = null;
    this.pushSystemMessage(
      room,
      winner === 'town'
        ? 'Victory for the Town! Every syndicate operative has been uncovered.'
        : 'Syndicate Victory! The Mafia now controls the city.'
    );
    this.broadcastRoomState(room);
    this.broadcastLobbyList();
  }

  private resetGame(ws: WebSocket) {
    const ctx = this.getPlayerContext(ws);
    if (!ctx || !ctx.player.isHost) return;
    const { room } = ctx;
    this.clearRoomTimer(room);
    room.phase = 'LOBBY';
    room.round = 0;
    room.phaseEndsAt = null;
    room.winner = null;
    room.lastNightOutcome = null;
    room.lastExecution = null;
    room.nightMafiaTargets.clear();
    room.nightDetectiveTargets.clear();
    room.nightDoctorTargets.clear();
    room.dayVotes.clear();
    room.readyToVoteIds.clear();

    for (const p of room.players.values()) {
      p.role = null;
      p.alive = true;
      p.hasSelfSaved = false;
      p.investigations = [];
      p.mutedUntil = null;
      p.strikes = 0;
    }

    this.pushSystemMessage(room, 'Host reset the table for a new match.');
    this.broadcastRoomState(room);
    this.broadcastLobbyList();
  }

  private handleChatSend(
    ws: WebSocket,
    msg: Extract<ClientToServerMessage, { type: 'chat:send' }>
  ) {
    const ctx = this.getPlayerContext(ws);
    if (!ctx) return;
    const { room, player } = ctx;
    const now = Date.now();

    if (player.mutedUntil && player.mutedUntil > now) {
      const rem = Math.ceil((player.mutedUntil - now) / 1000);
      this.send(ws, {
        type: 'error',
        code: 'MUTED',
        message: `You are muted by moderation for ${rem}s.`,
      });
      return;
    }

    if (room.modifiers.slowModeSec > 0 && now - player.lastMessageAt < room.modifiers.slowModeSec * 1000) {
      const rem = Math.ceil((room.modifiers.slowModeSec * 1000 - (now - player.lastMessageAt)) / 1000);
      this.send(ws, {
        type: 'error',
        code: 'SLOW_MODE',
        message: `Slow mode active. Wait ${rem}s before sending another message.`,
      });
      return;
    }

    // Enforce channel access rules
    if (msg.channel === 'mafia') {
      if (player.role !== 'mafia' || !player.alive || room.phase !== 'NIGHT') {
        this.send(ws, {
          type: 'error',
          code: 'CHANNEL_DENIED',
          message: 'Syndicate night channel is only open to living Mafia during the Night phase.',
        });
        return;
      }
    } else if (msg.channel === 'ghost') {
      if (!room.modifiers.ghostChatEnabled || player.alive) {
        this.send(ws, {
          type: 'error',
          code: 'CHANNEL_DENIED',
          message: 'Spectator ghost chat is reserved for eliminated players.',
        });
        return;
      }
    } else if (msg.channel === 'public') {
      if (room.phase === 'NIGHT') {
        this.send(ws, {
          type: 'error',
          code: 'NIGHT_SILENCE',
          message: 'Town chat is silent during the Night phase.',
        });
        return;
      }
      if (!player.alive && room.phase !== 'LOBBY' && room.phase !== 'GAME_OVER') {
        this.send(ws, {
          type: 'error',
          code: 'DEAD_SILENCE',
          message: 'Eliminated players cannot speak in Town chat. Use Ghost chat if enabled.',
        });
        return;
      }
    }

    if (!msg.iv || !msg.ciphertext || msg.ciphertext.length > 4000) return;

    player.lastMessageAt = now;
    const chatMsg: InternalMessage = {
      id: generateId('msg_'),
      channel: msg.channel,
      senderId: player.id,
      senderName: player.name,
      iv: msg.iv,
      ciphertext: msg.ciphertext,
      timestamp: now,
      reportsCount: 0,
      reporters: new Set(),
    };

    room.messages.push(chatMsg);
    if (room.messages.length > 200) {
      room.messages.shift();
    }

    const publicPayload: EncryptedChatMessage = {
      id: chatMsg.id,
      channel: chatMsg.channel,
      senderId: chatMsg.senderId,
      senderName: chatMsg.senderName,
      iv: chatMsg.iv,
      ciphertext: chatMsg.ciphertext,
      timestamp: chatMsg.timestamp,
      reportsCount: 0,
    };

    for (const recipient of room.players.values()) {
      if (!recipient.connected || !recipient.ws) continue;
      if (!this.canSeeMessage(room, recipient, chatMsg)) continue;
      this.send(recipient.ws, { type: 'chat:message', message: publicPayload });
    }
  }

  private handleChatStrike(ws: WebSocket, reason: string) {
    const ctx = this.getPlayerContext(ws);
    if (!ctx) return;
    const { room, player } = ctx;
    player.strikes += 1;

    if (player.strikes >= 3) {
      player.mutedUntil = Date.now() + 60_000;
      this.pushSystemMessage(
        room,
        `Moderation: ${player.name} reached 3 toxicity strikes and was muted for 60s.`
      );
    } else {
      this.send(ws, {
        type: 'error',
        code: 'MODERATION_WARNING',
        message: `Moderation strike ${player.strikes}/3: ${reason}`,
      });
    }
    this.broadcastRoomState(room);
  }

  private handleChatReport(ws: WebSocket, messageId: string) {
    const ctx = this.getPlayerContext(ws);
    if (!ctx) return;
    const { room, player } = ctx;
    const targetMsg = room.messages.find((m) => m.id === messageId);
    if (!targetMsg || targetMsg.channel === 'system' || targetMsg.senderId === player.id) return;

    if (targetMsg.reporters.has(player.id)) return;
    targetMsg.reporters.add(player.id);
    targetMsg.reportsCount = targetMsg.reporters.size;

    const threshold = Math.max(2, Math.ceil(room.players.size / 2));
    if (targetMsg.reportsCount >= threshold && !targetMsg.flagged) {
      targetMsg.flagged = true;
      const offender = room.players.get(targetMsg.senderId);
      if (offender) {
        offender.strikes += 1;
        offender.mutedUntil = Date.now() + 60_000;
        this.pushSystemMessage(
          room,
          `Moderation: ${offender.name} was automatically muted for 60s following player reports.`
        );
      }
      this.broadcastRoomState(room);
    } else {
      for (const recipient of room.players.values()) {
        if (!recipient.connected || !recipient.ws) continue;
        if (!this.canSeeMessage(room, recipient, targetMsg)) continue;
        this.send(recipient.ws, {
          type: 'chat:report_updated',
          messageId: targetMsg.id,
          reportsCount: targetMsg.reportsCount,
        });
      }
    }
  }

  private handleHostModerate(
    ws: WebSocket,
    targetPlayerId: string,
    action: 'mute' | 'unmute' | 'kick'
  ) {
    const ctx = this.getPlayerContext(ws);
    if (!ctx || !ctx.player.isHost) return;
    const { room } = ctx;
    const target = room.players.get(targetPlayerId);
    if (!target || target.id === ctx.player.id) return;

    if (action === 'mute') {
      target.mutedUntil = Date.now() + 90_000;
      this.pushSystemMessage(room, `Host muted ${target.name} for 90s.`);
    } else if (action === 'unmute') {
      target.mutedUntil = null;
      this.pushSystemMessage(room, `Host unmuted ${target.name}.`);
    } else if (action === 'kick') {
      if (target.ws) {
        this.socketIndex.delete(target.ws);
        this.send(target.ws, { type: 'kicked', reason: 'Removed from the table by the host.' });
        this.lobbySubscribers.add(target.ws);
        this.send(target.ws, { type: 'lobby:list', rooms: this.getRoomSummaries() });
      }
      room.players.delete(target.id);
      this.pushSystemMessage(room, `${target.name} was removed by the host.`);
      if (room.phase !== 'LOBBY' && room.phase !== 'GAME_OVER') {
        this.checkWinCondition(room);
      }
      this.broadcastLobbyList();
    }

    this.broadcastRoomState(room);
  }

  private canSeeMessage(room: Room, recipient: ServerPlayer, msg: InternalMessage): boolean {
    if (msg.channel === 'system' || msg.channel === 'public') return true;
    if (msg.channel === 'mafia') {
      return recipient.role === 'mafia' || room.phase === 'GAME_OVER';
    }
    if (msg.channel === 'ghost') {
      return !recipient.alive || room.phase === 'GAME_OVER';
    }
    return false;
  }

  private pushSystemMessage(room: Room, text: string) {
    const sysMsg: InternalMessage = {
      id: generateId('sys_'),
      channel: 'system',
      senderId: 'system',
      senderName: 'Table Arbiter',
      systemText: text,
      timestamp: Date.now(),
      reportsCount: 0,
      reporters: new Set(),
    };
    room.messages.push(sysMsg);
    if (room.messages.length > 200) room.messages.shift();

    const payload: EncryptedChatMessage = {
      id: sysMsg.id,
      channel: 'system',
      senderId: 'system',
      senderName: 'Table Arbiter',
      systemText: text,
      timestamp: sysMsg.timestamp,
      reportsCount: 0,
    };

    for (const p of room.players.values()) {
      if (p.connected && p.ws) {
        this.send(p.ws, { type: 'chat:message', message: payload });
      }
    }
  }

  private buildClientState(room: Room, viewer: ServerPlayer): ClientGameState {
    const isGameOver = room.phase === 'GAME_OVER';
    const viewerIsMafia = viewer.role === 'mafia';

    const mafiaTeammateIds =
      viewerIsMafia || isGameOver
        ? Array.from(room.players.values())
            .filter((p) => p.role === 'mafia')
            .map((p) => p.id)
        : [];

    const voteCounts = new Map<string, number>();
    const votersByTarget = new Map<string, string[]>();
    if (room.phase === 'DAY_VOTING' || room.phase === 'EXECUTION') {
      for (const [voterId, targetId] of room.dayVotes.entries()) {
        voteCounts.set(targetId, (voteCounts.get(targetId) || 0) + 1);
        if (!room.modifiers.anonymousVoting) {
          const voter = room.players.get(voterId);
          if (voter) {
            const arr = votersByTarget.get(targetId) || [];
            arr.push(voter.name);
            votersByTarget.set(targetId, arr);
          }
        }
      }
    }

    const players: PublicPlayer[] = Array.from(room.players.values()).map((p) => {
      let revealedRole: Role | null = null;
      if (isGameOver) {
        revealedRole = p.role;
      } else if (p.id === viewer.id) {
        revealedRole = p.role;
      } else if (viewerIsMafia && p.role === 'mafia') {
        revealedRole = 'mafia';
      } else if (!p.alive && room.modifiers.revealRoleOnDeath) {
        revealedRole = p.role;
      }

      let hasActedNight = false;
      if (room.phase === 'NIGHT') {
        if (p.id === viewer.id) {
          hasActedNight =
            room.nightMafiaTargets.has(p.id) ||
            room.nightDetectiveTargets.has(p.id) ||
            room.nightDoctorTargets.has(p.id);
        } else if (viewerIsMafia && p.role === 'mafia') {
          hasActedNight = room.nightMafiaTargets.has(p.id);
        }
      }

      return {
        id: p.id,
        name: p.name,
        alive: p.alive,
        connected: p.connected,
        isHost: p.isHost,
        mutedUntil: p.mutedUntil,
        strikes: p.strikes,
        revealedRole,
        votesAgainst: voteCounts.get(p.id) || 0,
        votedByNames: votersByTarget.get(p.id) || [],
        hasActedNight,
      };
    });

    const mafiaNightVotes: Record<string, string> = {};
    if (viewerIsMafia && room.phase === 'NIGHT') {
      for (const [mid, tid] of room.nightMafiaTargets.entries()) {
        mafiaNightVotes[mid] = tid;
      }
    }

    let selfNightTargetId: string | null = null;
    if (room.phase === 'NIGHT') {
      selfNightTargetId =
        room.nightMafiaTargets.get(viewer.id) ||
        room.nightDetectiveTargets.get(viewer.id) ||
        room.nightDoctorTargets.get(viewer.id) ||
        null;
    }

    const visibleMessages: EncryptedChatMessage[] = room.messages
      .filter((m) => this.canSeeMessage(room, viewer, m))
      .map((m) => ({
        id: m.id,
        channel: m.channel,
        senderId: m.senderId,
        senderName: m.senderName,
        iv: m.iv,
        ciphertext: m.ciphertext,
        systemText: m.systemText,
        timestamp: m.timestamp,
        reportsCount: m.reportsCount,
        flagged: m.flagged,
      }));

    return {
      roomId: room.roomId,
      roomName: room.name,
      isPrivate: Boolean(room.passwordHash),
      maxPlayers: room.maxPlayers,
      phase: room.phase,
      round: room.round,
      phaseEndsAt: room.phaseEndsAt,
      serverTime: Date.now(),
      modifiers: room.modifiers,
      players,
      selfId: viewer.id,
      selfRole: viewer.role,
      selfAlive: viewer.alive,
      selfHasSelfSaved: viewer.hasSelfSaved,
      selfNightTargetId,
      selfVoteTargetId: room.dayVotes.get(viewer.id) || null,
      mafiaTeammateIds,
      mafiaNightVotes,
      investigations: viewer.investigations,
      lastNightOutcome: room.lastNightOutcome,
      lastExecution: room.lastExecution,
      winner: room.winner,
      publicRoomKeyB64: room.publicRoomKeyB64,
      mafiaRoomKeyB64: viewerIsMafia ? room.mafiaRoomKeyB64 : null,
      messages: visibleMessages,
      readyToVoteIds: Array.from(room.readyToVoteIds),
    };
  }

  private broadcastRoomState(room: Room) {
    for (const player of room.players.values()) {
      if (player.connected && player.ws) {
        this.send(player.ws, {
          type: 'room:state',
          state: this.buildClientState(room, player),
        });
      }
    }
  }

  getRoomSummaries(): RoomSummary[] {
    return Array.from(this.rooms.values()).map((r) => {
      const host = Array.from(r.players.values()).find((p) => p.isHost);
      return {
        roomId: r.roomId,
        name: r.name,
        hostName: host?.name || 'Host',
        playerCount: r.players.size,
        maxPlayers: r.maxPlayers,
        isPrivate: Boolean(r.passwordHash),
        phase: r.phase,
        modifiers: r.modifiers,
      };
    });
  }

  private broadcastLobbyList() {
    const rooms = this.getRoomSummaries();
    for (const ws of this.lobbySubscribers) {
      this.send(ws, { type: 'lobby:list', rooms });
    }
  }

  private getPlayerContext(ws: WebSocket): { room: Room; player: ServerPlayer } | null {
    const loc = this.socketIndex.get(ws);
    if (!loc) return null;
    const room = this.rooms.get(loc.roomId);
    if (!room) return null;
    const player = room.players.get(loc.playerId);
    if (!player) return null;
    return { room, player };
  }

  private clearRoomTimer(room: Room) {
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
  }

  private scheduleRoomCleanupIfEmpty(room: Room) {
    const anyConnected = Array.from(room.players.values()).some((p) => p.connected);
    if (anyConnected) return;
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.cleanupTimer = setTimeout(() => {
      const stillAny = Array.from(room.players.values()).some((p) => p.connected);
      if (!stillAny) {
        this.destroyRoom(room);
        this.broadcastLobbyList();
      }
    }, 120_000);
  }

  private destroyRoom(room: Room) {
    this.clearRoomTimer(room);
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }
    this.rooms.delete(room.roomId);
  }
}
