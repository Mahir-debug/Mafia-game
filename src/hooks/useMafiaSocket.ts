import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientGameState,
  ClientToServerMessage,
  EncryptedChatMessage,
  GameModifiers,
  RoomSummary,
  ServerToClientMessage,
} from '../shared/types.ts';
import { encryptChatPayload } from '../utils/crypto.ts';

interface StoredSession {
  roomId: string;
  sessionToken: string;
  playerName: string;
}

const SESSION_KEY = 'nocturne_mafia_session';

function loadStoredSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function saveStoredSession(session: StoredSession | null) {
  try {
    if (!session) {
      sessionStorage.removeItem(SESSION_KEY);
    } else {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
  } catch {
    // ignore storage failures
  }
}

export function useMafiaSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef(true);

  const [connected, setConnected] = useState(false);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [passwordPromptRoom, setPasswordPromptRoom] = useState<{
    roomId: string;
    playerName: string;
  } | null>(null);

  const sendRaw = useCallback((msg: ClientToServerMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setErrorMsg('Connection interrupted. Reconnecting to table...');
      return;
    }
    ws.send(JSON.stringify(msg));
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = import.meta.env.VITE_WS_URL || `${proto}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setErrorMsg(null);
      setErrorCode(null);

      const saved = loadStoredSession();
      if (saved) {
        ws.send(
          JSON.stringify({
            type: 'room:join',
            roomId: saved.roomId,
            playerName: saved.playerName,
            sessionToken: saved.sessionToken,
          } satisfies ClientToServerMessage)
        );
      } else {
        ws.send(JSON.stringify({ type: 'lobby:subscribe' } satisfies ClientToServerMessage));
      }
    };

    ws.onmessage = (event) => {
      let data: ServerToClientMessage;
      try {
        data = JSON.parse(event.data as string) as ServerToClientMessage;
      } catch {
        return;
      }

      switch (data.type) {
        case 'lobby:list': {
          setRooms(data.rooms);
          break;
        }
        case 'room:joined': {
          setPasswordPromptRoom(null);
          setErrorMsg(null);
          setErrorCode(null);
          const self = data.state.players.find((p) => p.id === data.state.selfId);
          saveStoredSession({
            roomId: data.state.roomId,
            sessionToken: data.sessionToken,
            playerName: self?.name || 'Player',
          });
          setGameState(data.state);
          break;
        }
        case 'room:state': {
          setGameState(data.state);
          break;
        }
        case 'chat:message': {
          // Idempotent append checking message ID
          setGameState((prev) => {
            if (!prev) return prev;
            if (prev.messages.some((m) => m.id === data.message.id)) return prev;
            const nextMessages: EncryptedChatMessage[] = [...prev.messages, data.message].slice(-200);
            return { ...prev, messages: nextMessages };
          });
          break;
        }
        case 'chat:report_updated': {
          setGameState((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === data.messageId ? { ...m, reportsCount: data.reportsCount } : m
              ),
            };
          });
          break;
        }
        case 'kicked': {
          saveStoredSession(null);
          setGameState(null);
          setErrorCode('KICKED');
          setErrorMsg(data.reason);
          break;
        }
        case 'error': {
          setErrorCode(data.code);
          setErrorMsg(data.message);
          if (data.code === 'ROOM_NOT_FOUND' && loadStoredSession()) {
            saveStoredSession(null);
            setGameState(null);
            ws.send(JSON.stringify({ type: 'lobby:subscribe' } satisfies ClientToServerMessage));
          }
          break;
        }
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (shouldReconnectRef.current) {
        reconnectTimerRef.current = window.setTimeout(() => {
          connect();
        }, 1500);
      }
    };
  }, []);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();
    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const clearError = useCallback(() => {
    setErrorMsg(null);
    setErrorCode(null);
  }, []);

  const createRoom = useCallback(
    (payload: {
      roomName: string;
      playerName: string;
      password?: string;
      maxPlayers: number;
      modifiers: GameModifiers;
    }) => {
      clearError();
      sendRaw({ type: 'room:create', ...payload });
    },
    [clearError, sendRaw]
  );

  const joinRoom = useCallback(
    (roomId: string, playerName: string, password?: string) => {
      clearError();
      sendRaw({ type: 'room:join', roomId, playerName, password });
    },
    [clearError, sendRaw]
  );

  const leaveRoom = useCallback(() => {
    saveStoredSession(null);
    setGameState(null);
    sendRaw({ type: 'room:leave' });
  }, [sendRaw]);

  const updateModifiers = useCallback(
    (
      modifiers: GameModifiers,
      options?: { password?: string | null; isPrivate?: boolean; maxPlayers?: number }
    ) => {
      sendRaw({ type: 'room:update_modifiers', modifiers, ...options });
    },
    [sendRaw]
  );

  const startGame = useCallback(() => {
    clearError();
    sendRaw({ type: 'game:start' });
  }, [clearError, sendRaw]);

  const submitNightAction = useCallback(
    (targetId: string) => {
      sendRaw({ type: 'game:night_action', targetId });
    },
    [sendRaw]
  );

  const skipToVote = useCallback(() => {
    sendRaw({ type: 'game:skip_to_vote' });
  }, [sendRaw]);

  const submitVote = useCallback(
    (targetId: string | 'skip') => {
      sendRaw({ type: 'game:vote', targetId });
    },
    [sendRaw]
  );

  const resetGame = useCallback(() => {
    sendRaw({ type: 'game:reset' });
  }, [sendRaw]);

  const sendEncryptedChat = useCallback(
    async (channel: 'public' | 'mafia' | 'ghost', cleanText: string) => {
      if (!gameState) return;
      const keyB64 = channel === 'mafia' ? gameState.mafiaRoomKeyB64 : gameState.publicRoomKeyB64;
      if (!keyB64) return;
      const { iv, ciphertext } = await encryptChatPayload(keyB64, cleanText);
      sendRaw({ type: 'chat:send', channel, iv, ciphertext });
    },
    [gameState, sendRaw]
  );

  const sendModerationStrike = useCallback(
    (reason: string) => {
      sendRaw({ type: 'chat:strike', reason });
    },
    [sendRaw]
  );

  const reportMessage = useCallback(
    (messageId: string) => {
      sendRaw({ type: 'chat:report', messageId });
    },
    [sendRaw]
  );

  const moderatePlayer = useCallback(
    (targetPlayerId: string, action: 'mute' | 'unmute' | 'kick') => {
      sendRaw({ type: 'host:moderate', targetPlayerId, action });
    },
    [sendRaw]
  );

  return {
    connected,
    rooms,
    gameState,
    errorMsg,
    errorCode,
    clearError,
    passwordPromptRoom,
    setPasswordPromptRoom,
    createRoom,
    joinRoom,
    leaveRoom,
    updateModifiers,
    startGame,
    submitNightAction,
    skipToVote,
    submitVote,
    resetGame,
    sendEncryptedChat,
    sendModerationStrike,
    reportMessage,
    moderatePlayer,
  };
}
