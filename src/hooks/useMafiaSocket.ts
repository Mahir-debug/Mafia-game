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
const CUSTOM_WS_KEY = 'nocturne_custom_ws_url';

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

export function normalizeWsUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  let url = trimmed;
  if (url.startsWith('https://')) url = 'wss://' + url.slice('https://'.length);
  else if (url.startsWith('http://')) url = 'ws://' + url.slice('http://'.length);
  else if (!url.startsWith('ws://') && !url.startsWith('wss://')) url = `wss://${url}`;
  url = url.replace(/\/+$/, '');
  if (!url.endsWith('/ws')) url = `${url}/ws`;
  return url;
}

export function getSavedCustomWsUrl(): string {
  try {
    return localStorage.getItem(CUSTOM_WS_KEY) || '';
  } catch {
    return '';
  }
}

export function saveCustomWsUrl(url: string) {
  try {
    const clean = url.trim();
    if (!clean) localStorage.removeItem(CUSTOM_WS_KEY);
    else localStorage.setItem(CUSTOM_WS_KEY, normalizeWsUrl(clean));
  } catch {
    // ignore
  }
}

export function useMafiaSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef(true);
  const pendingQueueRef = useRef<ClientToServerMessage[]>([]);
  const failedAttemptsRef = useRef(0);

  const [connected, setConnected] = useState(false);
  const [staticHostDetected, setStaticHostDetected] = useState(false);
  const [activeWsUrl, setActiveWsUrl] = useState('');
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [passwordPromptRoom, setPasswordPromptRoom] = useState<{
    roomId: string;
    playerName: string;
  } | null>(null);

  const resolveWsUrl = useCallback(() => {
    const custom = getSavedCustomWsUrl();
    if (custom) return custom;
    if (import.meta.env.VITE_WS_URL) return normalizeWsUrl(import.meta.env.VITE_WS_URL);
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }, []);

  const connect = useCallback(() => {
    const existing = wsRef.current;
    if (
      existing &&
      (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const wsUrl = resolveWsUrl();
    setActiveWsUrl(wsUrl);

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      setConnected(false);
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      failedAttemptsRef.current = 0;
      setConnected(true);
      setStaticHostDetected(false);
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

      if (pendingQueueRef.current.length > 0) {
        const queued = [...pendingQueueRef.current];
        pendingQueueRef.current = [];
        for (const q of queued) {
          ws.send(JSON.stringify(q));
        }
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

    ws.onerror = () => {
      // handled in onclose
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      setConnected(false);
      failedAttemptsRef.current += 1;

      if (failedAttemptsRef.current >= 2 && !getSavedCustomWsUrl() && !import.meta.env.VITE_WS_URL) {
        void fetch('/api/health')
          .then((r) => {
            if (!r.ok) setStaticHostDetected(true);
          })
          .catch(() => {
            setStaticHostDetected(true);
          });
      }

      if (shouldReconnectRef.current) {
        const delay = Math.min(5000, 1000 + failedAttemptsRef.current * 500);
        reconnectTimerRef.current = window.setTimeout(() => {
          connect();
        }, delay);
      }
    };
  }, [resolveWsUrl]);

  const sendRaw = useCallback(
    (msg: ClientToServerMessage) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
        return;
      }
      if (ws && ws.readyState === WebSocket.CONNECTING) {
        pendingQueueRef.current.push(msg);
        return;
      }
      pendingQueueRef.current.push(msg);
      setErrorMsg(
        staticHostDetected
          ? 'No WebSocket server is running on this domain. Connect a game server URL below or open the full-stack URL.'
          : 'Reconnecting to game server...'
      );
      connect();
    },
    [connect, staticHostDetected]
  );

  const setCustomServerUrl = useCallback(
    (url: string) => {
      saveCustomWsUrl(url);
      failedAttemptsRef.current = 0;
      setStaticHostDetected(false);
      setErrorMsg(null);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      connect();
    },
    [connect]
  );

  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();
    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
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
    staticHostDetected,
    activeWsUrl,
    setCustomServerUrl,
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
