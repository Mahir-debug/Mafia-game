import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, Flag, Lock, Send, ShieldAlert, VolumeX } from 'lucide-react';
import type { ChatChannel, ClientGameState, EncryptedChatMessage } from '../shared/types.ts';
import {
  decryptChatPayload,
  evaluateMessageModeration,
  getKeyFingerprint,
} from '../utils/crypto.ts';

interface EncryptedChatPanelProps {
  gameState: ClientGameState;
  onSend: (channel: 'public' | 'mafia' | 'ghost', cleanText: string) => Promise<void>;
  onStrike: (reason: string) => void;
  onReport: (messageId: string) => void;
  onModeratePlayer: (targetPlayerId: string, action: 'mute' | 'unmute' | 'kick') => void;
}

export function EncryptedChatPanel({
  gameState,
  onSend,
  onStrike,
  onReport,
  onModeratePlayer,
}: EncryptedChatPanelProps) {
  const [activeChannel, setActiveChannel] = useState<'public' | 'mafia' | 'ghost'>('public');
  const [draft, setDraft] = useState('');
  const [modNotice, setModNotice] = useState<string | null>(null);
  const [showCipherInspector, setShowCipherInspector] = useState(false);
  const [fingerprint, setFingerprint] = useState<string>('...');
  const [decryptedMap, setDecryptedMap] = useState<Record<string, string>>({});
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const selfPlayer = gameState.players.find((p) => p.id === gameState.selfId);
  const isHost = Boolean(selfPlayer?.isHost);
  const isMuted = Boolean(selfPlayer?.mutedUntil && selfPlayer.mutedUntil > Date.now());
  const muteRemainingSec = selfPlayer?.mutedUntil
    ? Math.max(0, Math.ceil((selfPlayer.mutedUntil - Date.now()) / 1000))
    : 0;

  const canUseMafiaChannel =
    gameState.selfRole === 'mafia' && gameState.selfAlive && gameState.phase === 'NIGHT';
  const canUseGhostChannel =
    gameState.modifiers.ghostChatEnabled && !gameState.selfAlive && gameState.phase !== 'LOBBY';

  // Auto-switch channels gracefully when entering Night as Mafia or dying
  useEffect(() => {
    if (canUseMafiaChannel && activeChannel === 'public') {
      setActiveChannel('mafia');
    } else if (!canUseMafiaChannel && activeChannel === 'mafia' && gameState.phase !== 'GAME_OVER') {
      setActiveChannel(canUseGhostChannel ? 'ghost' : 'public');
    }
  }, [canUseMafiaChannel, canUseGhostChannel, gameState.phase, activeChannel]);

  // Compute live SHA-256 fingerprint of active room AES-256-GCM key
  useEffect(() => {
    const activeKey =
      activeChannel === 'mafia' && gameState.mafiaRoomKeyB64
        ? gameState.mafiaRoomKeyB64
        : gameState.publicRoomKeyB64;
    if (!activeKey) return;
    void getKeyFingerprint(activeKey).then(setFingerprint);
  }, [activeChannel, gameState.publicRoomKeyB64, gameState.mafiaRoomKeyB64]);

  // Decrypt encrypted messages client-side via Web Crypto AES-256-GCM
  useEffect(() => {
    let cancelled = false;
    const decryptAll = async () => {
      const updates: Record<string, string> = {};
      for (const msg of gameState.messages) {
        if (msg.channel === 'system' || !msg.iv || !msg.ciphertext) continue;
        if (decryptedMap[msg.id]) continue;
        const keyB64 =
          msg.channel === 'mafia' ? gameState.mafiaRoomKeyB64 : gameState.publicRoomKeyB64;
        if (!keyB64) continue;
        updates[msg.id] = await decryptChatPayload(keyB64, msg.iv, msg.ciphertext);
      }
      if (!cancelled && Object.keys(updates).length > 0) {
        setDecryptedMap((prev) => ({ ...prev, ...updates }));
      }
    };
    void decryptAll();
    return () => {
      cancelled = true;
    };
  }, [gameState.messages, gameState.publicRoomKeyB64, gameState.mafiaRoomKeyB64, decryptedMap]);

  const visibleMessages = useMemo(() => {
    return gameState.messages.filter((m) => {
      if (m.channel === 'system') return true;
      return m.channel === activeChannel;
    });
  }, [gameState.messages, activeChannel]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleMessages.length]);

  const canSendInCurrentChannel = useMemo(() => {
    if (isMuted) return false;
    if (activeChannel === 'mafia') return canUseMafiaChannel;
    if (activeChannel === 'ghost') return canUseGhostChannel;
    if (gameState.phase === 'NIGHT') return false;
    if (!gameState.selfAlive && gameState.phase !== 'LOBBY' && gameState.phase !== 'GAME_OVER') {
      return false;
    }
    return true;
  }, [activeChannel, canUseGhostChannel, canUseMafiaChannel, gameState.phase, gameState.selfAlive, isMuted]);

  const disabledReason = useMemo(() => {
    if (isMuted) return `Muted by moderation (${muteRemainingSec}s remaining)`;
    if (activeChannel === 'public' && gameState.phase === 'NIGHT') {
      return 'Town Square chat is silenced during the Night phase.';
    }
    if (
      activeChannel === 'public' &&
      !gameState.selfAlive &&
      gameState.phase !== 'LOBBY' &&
      gameState.phase !== 'GAME_OVER'
    ) {
      return gameState.modifiers.ghostChatEnabled
        ? 'Eliminated players speak in the Ghost channel.'
        : 'Eliminated players cannot speak during an active match.';
    }
    if (activeChannel === 'mafia' && !canUseMafiaChannel) {
      return 'Syndicate channel opens only to living Mafia during Night.';
    }
    return '';
  }, [
    isMuted,
    muteRemainingSec,
    activeChannel,
    gameState.phase,
    gameState.selfAlive,
    gameState.modifiers.ghostChatEnabled,
    canUseMafiaChannel,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSendInCurrentChannel || !draft.trim()) return;

    const mod = evaluateMessageModeration(draft, gameState.modifiers.moderationLevel);
    if (!mod.allowed) {
      setModNotice(mod.reason || 'Message blocked by chat moderation.');
      onStrike(mod.reason || 'Toxic or abusive language');
      return;
    }

    if (mod.severity === 'censored') {
      setModNotice(mod.reason || 'Profanity masked by room moderation.');
      window.setTimeout(() => setModNotice(null), 4000);
    } else {
      setModNotice(null);
    }

    setDraft('');
    await onSend(activeChannel, mod.sanitized);
  };

  const handleReport = (msg: EncryptedChatMessage) => {
    if (reportedIds.has(msg.id)) return;
    setReportedIds((prev) => new Set(prev).add(msg.id));
    onReport(msg.id);
  };

  const channelLabel = (ch: ChatChannel) =>
    ch === 'mafia' ? 'Syndicate' : ch === 'ghost' ? 'Spectator' : 'Town';

  return (
    <aside className="flex h-full min-h-[480px] flex-col rounded-xl border border-white/10 bg-[#121620]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#F4F4F0]">
            <Lock className="h-4 w-4 text-amber-400 shrink-0" />
            <span className="truncate">Encrypted Channel</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-400 truncate">
            AES-256-GCM · {gameState.modifiers.moderationLevel} moderation
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCipherInspector((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
            showCipherInspector
              ? 'border-amber-500/40 bg-amber-950/40 text-amber-300'
              : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
          }`}
          title="Inspect live AES-256-GCM ciphertext and key fingerprint"
        >
          <Eye className="h-3.5 w-3.5" />
          <span>{showCipherInspector ? 'Hide Cipher' : 'Inspect'}</span>
        </button>
      </div>

      {/* Key Fingerprint Banner when Inspector is active */}
      {showCipherInspector && (
        <div className="border-b border-amber-500/20 bg-amber-950/20 px-4 py-2 text-xs text-amber-200/90">
          <div className="flex items-center justify-between gap-2">
            <span>Room Key Fingerprint</span>
            <span className="font-mono tabular-nums text-amber-300">{fingerprint}</span>
          </div>
        </div>
      )}

      {/* Channel Tabs */}
      <div className="flex items-center gap-1 border-b border-white/10 bg-[#0B0E14]/60 p-1.5">
        <button
          type="button"
          onClick={() => setActiveChannel('public')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
            activeChannel === 'public'
              ? 'bg-[#1C2230] text-[#F4F4F0]'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Town Square
        </button>

        {(gameState.selfRole === 'mafia' || gameState.phase === 'GAME_OVER') && (
          <button
            type="button"
            onClick={() => setActiveChannel('mafia')}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              activeChannel === 'mafia'
                ? 'bg-red-950/60 text-red-200 border border-red-500/30'
                : 'text-red-400/80 hover:text-red-300'
            }`}
          >
            Mafia Night
          </button>
        )}

        {gameState.modifiers.ghostChatEnabled && (!gameState.selfAlive || gameState.phase === 'GAME_OVER') && (
          <button
            type="button"
            onClick={() => setActiveChannel('ghost')}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              activeChannel === 'ghost'
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Ghost Chat
          </button>
        )}
      </div>

      {/* Messages Feed */}
      <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto p-4 max-h-[440px]">
        {visibleMessages.length === 0 && (
          <div className="py-10 text-center text-xs text-slate-500">
            Encrypted channel ready. Messages are encrypted in your browser before transmission.
          </div>
        )}

        {visibleMessages.map((msg) => {
          if (msg.channel === 'system') {
            return (
              <div
                key={msg.id}
                className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-xs text-slate-300"
              >
                <span className="font-medium text-amber-400">Arbiter: </span>
                <span>{msg.systemText}</span>
              </div>
            );
          }

          const isSelf = msg.senderId === gameState.selfId;
          const plaintext = decryptedMap[msg.id] || 'Decrypting...';
          const sender = gameState.players.find((p) => p.id === msg.senderId);
          const isSenderMuted = Boolean(sender?.mutedUntil && sender.mutedUntil > Date.now());

          return (
            <div
              key={msg.id}
              className={`group rounded-lg border px-3 py-2 text-sm transition-colors ${
                msg.channel === 'mafia'
                  ? 'border-red-500/20 bg-red-950/20'
                  : isSelf
                    ? 'border-white/15 bg-[#1B2130]'
                    : 'border-white/8 bg-[#151A25]'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-semibold text-[#F4F4F0] truncate">{msg.senderName}</span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-400">{channelLabel(msg.channel)}</span>
                  <span className="text-slate-500">·</span>
                  <span className="font-mono tabular-nums text-slate-500">
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                {!isSelf && (
                  <div className="flex items-center gap-1 opacity-75 group-hover:opacity-100">
                    {isHost && sender && (
                      <button
                        type="button"
                        onClick={() =>
                          onModeratePlayer(sender.id, isSenderMuted ? 'unmute' : 'mute')
                        }
                        className="rounded px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-white/10 cursor-pointer"
                        title={isSenderMuted ? 'Unmute player' : 'Mute player'}
                      >
                        <VolumeX className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleReport(msg)}
                      disabled={reportedIds.has(msg.id)}
                      className={`rounded px-1.5 py-0.5 text-[11px] inline-flex items-center gap-1 cursor-pointer ${
                        reportedIds.has(msg.id)
                          ? 'text-red-400'
                          : 'text-slate-400 hover:text-red-300 hover:bg-white/5'
                      }`}
                      title="Report toxic message"
                    >
                      <Flag className="h-3 w-3" />
                      {msg.reportsCount > 0 && (
                        <span className="font-mono tabular-nums">{msg.reportsCount}</span>
                      )}
                    </button>
                  </div>
                )}
              </div>

              <p className="mt-1 text-sm text-slate-100 break-words leading-relaxed">{plaintext}</p>

              {showCipherInspector && msg.ciphertext && (
                <div className="mt-2 rounded bg-black/50 p-2 font-mono text-[10px] text-amber-300/80 break-all">
                  <div>IV: {msg.iv}</div>
                  <div className="mt-0.5 truncate">CIPHER: {msg.ciphertext}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Moderation Warning Banner */}
      {modNotice && (
        <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
          <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
          <span>{modNotice}</span>
        </div>
      )}

      {/* Composer */}
      <form onSubmit={handleSubmit} className="border-t border-white/10 p-3">
        {!canSendInCurrentChannel ? (
          <div className="rounded-lg border border-white/10 bg-[#0B0E14] px-3 py-2.5 text-xs text-slate-400">
            {disabledReason}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={280}
              placeholder={
                activeChannel === 'mafia'
                  ? 'Encrypted whisper to Mafia...'
                  : activeChannel === 'ghost'
                    ? 'Speak with eliminated players...'
                    : 'Send encrypted message...'
              }
              className="min-w-0 flex-1 rounded-lg border border-white/15 bg-[#0B0E14] px-3 py-2.5 text-sm text-[#F4F4F0] placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Send className="h-4 w-4" />
              <span>Send</span>
            </button>
          </div>
        )}
      </form>
    </aside>
  );
}
