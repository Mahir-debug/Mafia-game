import { useState } from 'react';
import {
  Check,
  Copy,
  Crown,
  Lock,
  Minus,
  Play,
  Plus,
  Shield,
  UserX,
  VolumeX,
} from 'lucide-react';
import type {
  ClientGameState,
  DoctorSelfSaveMode,
  GameModifiers,
  ModerationLevel,
} from '../shared/types.ts';
import { EncryptedChatPanel } from './EncryptedChatPanel.tsx';

interface WaitingLobbyProps {
  gameState: ClientGameState;
  onUpdateModifiers: (
    modifiers: GameModifiers,
    options?: { password?: string | null; isPrivate?: boolean; maxPlayers?: number }
  ) => void;
  onStartGame: () => void;
  onSendChat: (channel: 'public' | 'mafia' | 'ghost', cleanText: string) => Promise<void>;
  onStrike: (reason: string) => void;
  onReport: (messageId: string) => void;
  onModeratePlayer: (targetPlayerId: string, action: 'mute' | 'unmute' | 'kick') => void;
}

export function WaitingLobby({
  gameState,
  onUpdateModifiers,
  onStartGame,
  onSendChat,
  onStrike,
  onReport,
  onModeratePlayer,
}: WaitingLobbyProps) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  const self = gameState.players.find((p) => p.id === gameState.selfId);
  const isHost = Boolean(self?.isHost);
  const mods = gameState.modifiers;

  const playerCount = gameState.players.length;
  const specialTotal = mods.mafiaCount + mods.detectiveCount + mods.doctorCount;
  const civiliansForCurrent = Math.max(0, playerCount - specialTotal);
  const civiliansAtCap = Math.max(0, gameState.maxPlayers - specialTotal);

  const canStart =
    playerCount >= 4 &&
    mods.mafiaCount >= 1 &&
    specialTotal <= playerCount &&
    mods.mafiaCount < playerCount - mods.mafiaCount;

  const startValidationHint =
    playerCount < 4
      ? `Need at least 4 players to begin (${4 - playerCount} more needed).`
      : specialTotal > playerCount
        ? `Special roles (${specialTotal}) exceed connected players (${playerCount}).`
        : mods.mafiaCount >= playerCount - mods.mafiaCount
          ? 'Town players must outnumber Mafia at match start.'
          : 'Ready to deal roles and begin Night 1.';

  const copyInviteLink = async () => {
    const url = `${window.location.origin}/?room=${gameState.roomId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const patchMod = (partial: Partial<GameModifiers>) => {
    if (!isHost) return;
    onUpdateModifiers({ ...mods, ...partial });
  };

  const handlePasswordApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isHost || !newPassword.trim()) return;
    onUpdateModifiers(mods, { isPrivate: true, password: newPassword.trim() });
    setNewPassword('');
  };

  const togglePrivacy = () => {
    if (!isHost) return;
    if (gameState.isPrivate) {
      onUpdateModifiers(mods, { isPrivate: false, password: null });
    } else if (newPassword.trim()) {
      onUpdateModifiers(mods, { isPrivate: true, password: newPassword.trim() });
      setNewPassword('');
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Top Room Summary Bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#121620] p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>Lobby Staging</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 text-amber-400">
              {gameState.isPrivate && <Lock className="h-3 w-3" />}
              {gameState.isPrivate ? 'Password Protected' : 'Open Table'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {playerCount}/{gameState.maxPlayers} Seated
            </span>
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold text-[#F4F4F0] sm:text-3xl">
            {gameState.roomName}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={copyInviteLink}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/15 bg-[#0B0E14] px-3.5 font-mono text-xs text-slate-200 hover:border-amber-500/50 transition-colors cursor-pointer"
          >
            <span>CODE: {gameState.roomId}</span>
            {copiedCode ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-slate-400" />
            )}
          </button>

          {isHost && (
            <button
              type="button"
              disabled={!canStart}
              onClick={onStartGame}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-red-600 px-5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play className="h-4 w-4" />
              <span>Start Match</span>
            </button>
          )}
        </div>
      </div>

      {/* Main 3-Zone Workspace */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left & Center: Players + Role Counts + Modifiers */}
        <div className="space-y-6 lg:col-span-8">
          {/* Role Allocation & Counts */}
          <section className="rounded-xl border border-white/10 bg-[#121620] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-bold text-[#F4F4F0]">
                  Role Assignment Allocation
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">{startValidationHint}</p>
              </div>
              <span className="font-mono text-xs tabular-nums text-slate-300">
                {mods.mafiaCount} Mafia · {mods.detectiveCount} Detective · {mods.doctorCount}{' '}
                Doctor · {civiliansForCurrent} Civilian
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  {
                    key: 'mafiaCount' as const,
                    label: 'Mafia',
                    value: mods.mafiaCount,
                    min: 1,
                    max: 5,
                    color: 'text-red-400',
                  },
                  {
                    key: 'detectiveCount' as const,
                    label: 'Detectives',
                    value: mods.detectiveCount,
                    min: 0,
                    max: 4,
                    color: 'text-amber-400',
                  },
                  {
                    key: 'doctorCount' as const,
                    label: 'Doctors',
                    value: mods.doctorCount,
                    min: 0,
                    max: 3,
                    color: 'text-emerald-400',
                  },
                ] as const
              ).map((roleCfg) => (
                <div
                  key={roleCfg.key}
                  className="rounded-lg border border-white/10 bg-[#0B0E14] p-3.5"
                >
                  <div className={`text-xs font-medium ${roleCfg.color}`}>{roleCfg.label}</div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      disabled={!isHost || roleCfg.value <= roleCfg.min}
                      onClick={() => patchMod({ [roleCfg.key]: roleCfg.value - 1 })}
                      className="flex h-8 w-8 items-center justify-center rounded border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 disabled:opacity-30 cursor-pointer"
                      aria-label={`Decrease ${roleCfg.label}`}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="font-mono text-xl font-semibold tabular-nums text-[#F4F4F0]">
                      {roleCfg.value}
                    </span>
                    <button
                      type="button"
                      disabled={!isHost || roleCfg.value >= roleCfg.max}
                      onClick={() => patchMod({ [roleCfg.key]: roleCfg.value + 1 })}
                      className="flex h-8 w-8 items-center justify-center rounded border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 disabled:opacity-30 cursor-pointer"
                      aria-label={`Increase ${roleCfg.label}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}

              <div className="rounded-lg border border-white/10 bg-[#0B0E14] p-3.5">
                <div className="text-xs font-medium text-slate-300">Civilians (Auto)</div>
                <div className="mt-2 flex h-8 items-baseline justify-between">
                  <span className="font-mono text-xl font-semibold tabular-nums text-[#F4F4F0]">
                    {civiliansForCurrent}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-slate-500">
                    up to {civiliansAtCap}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Connected Players Roster */}
          <section className="rounded-xl border border-white/10 bg-[#121620] p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-[#F4F4F0]">Seated Players</h2>
              <span className="text-xs text-slate-400">
                Share the code or link so others can join via WebSockets
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {gameState.players.map((p) => {
                const isMuted = Boolean(p.mutedUntil && p.mutedUntil > Date.now());
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#0B0E14] px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-[#F4F4F0]">
                        {p.isHost && <Crown className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                        <span className="truncate">{p.name}</span>
                        {p.id === gameState.selfId && (
                          <span className="text-xs text-slate-400">(You)</span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                        <span>{p.connected ? 'Connected' : 'Reconnecting'}</span>
                        {isMuted && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-red-400">Muted</span>
                          </>
                        )}
                        {p.strikes > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-400 font-mono tabular-nums">
                              {p.strikes} strikes
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {isHost && p.id !== gameState.selfId && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => onModeratePlayer(p.id, isMuted ? 'unmute' : 'mute')}
                          className="rounded border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/10 cursor-pointer"
                          title={isMuted ? 'Unmute' : 'Mute'}
                        >
                          <VolumeX className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onModeratePlayer(p.id, 'kick')}
                          className="rounded border border-red-500/20 px-2 py-1 text-xs text-red-400 hover:bg-red-950/50 cursor-pointer"
                          title="Kick player"
                        >
                          <UserX className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Custom Modifiers & Private Match Security */}
          <section className="rounded-xl border border-white/10 bg-[#121620] p-5 space-y-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-amber-400" />
                <h2 className="font-display text-lg font-bold text-[#F4F4F0]">
                  Match Modifiers & Fair Play
                </h2>
              </div>
              {!isHost && (
                <span className="text-xs text-slate-400">Controlled by Table Host</span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Night Phase Duration</label>
                <select
                  disabled={!isHost}
                  value={mods.nightDurationSec}
                  onChange={(e) => patchMod({ nightDurationSec: Number(e.target.value) })}
                  className="w-full rounded-lg border border-white/15 bg-[#0B0E14] px-3 py-2 text-sm text-[#F4F4F0] disabled:opacity-60"
                >
                  <option value={20}>20 seconds</option>
                  <option value={30}>30 seconds</option>
                  <option value={45}>45 seconds</option>
                  <option value={60}>60 seconds</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Day Discussion</label>
                <select
                  disabled={!isHost}
                  value={mods.dayDurationSec}
                  onChange={(e) => patchMod({ dayDurationSec: Number(e.target.value) })}
                  className="w-full rounded-lg border border-white/15 bg-[#0B0E14] px-3 py-2 text-sm text-[#F4F4F0] disabled:opacity-60"
                >
                  <option value={30}>30 seconds</option>
                  <option value={45}>45 seconds</option>
                  <option value={60}>60 seconds</option>
                  <option value={90}>90 seconds</option>
                  <option value={120}>120 seconds</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Day Voting Window</label>
                <select
                  disabled={!isHost}
                  value={mods.votingDurationSec}
                  onChange={(e) => patchMod({ votingDurationSec: Number(e.target.value) })}
                  className="w-full rounded-lg border border-white/15 bg-[#0B0E14] px-3 py-2 text-sm text-[#F4F4F0] disabled:opacity-60"
                >
                  <option value={20}>20 seconds</option>
                  <option value={30}>30 seconds</option>
                  <option value={45}>45 seconds</option>
                  <option value={60}>60 seconds</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Doctor Self-Save</label>
                <select
                  disabled={!isHost}
                  value={mods.doctorSelfSave}
                  onChange={(e) =>
                    patchMod({ doctorSelfSave: e.target.value as DoctorSelfSaveMode })
                  }
                  className="w-full rounded-lg border border-white/15 bg-[#0B0E14] px-3 py-2 text-sm text-[#F4F4F0] disabled:opacity-60"
                >
                  <option value="once">Once per match</option>
                  <option value="unlimited">Unlimited</option>
                  <option value="never">Disabled</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Chat Moderation</label>
                <select
                  disabled={!isHost}
                  value={mods.moderationLevel}
                  onChange={(e) =>
                    patchMod({ moderationLevel: e.target.value as ModerationLevel })
                  }
                  className="w-full rounded-lg border border-white/15 bg-[#0B0E14] px-3 py-2 text-sm text-[#F4F4F0] disabled:opacity-60"
                >
                  <option value="strict">Strict (Block profanity)</option>
                  <option value="standard">Standard (Mask + Strike)</option>
                  <option value="relaxed">Relaxed (Severe only)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Chat Slow Mode</label>
                <select
                  disabled={!isHost}
                  value={mods.slowModeSec}
                  onChange={(e) => patchMod({ slowModeSec: Number(e.target.value) })}
                  className="w-full rounded-lg border border-white/15 bg-[#0B0E14] px-3 py-2 text-sm text-[#F4F4F0] disabled:opacity-60"
                >
                  <option value={0}>Off</option>
                  <option value={3}>3 seconds</option>
                  <option value={5}>5 seconds</option>
                  <option value={10}>10 seconds</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 pt-1">
              <label className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#0B0E14] px-3.5 py-2.5 text-xs text-slate-200 cursor-pointer">
                <span>Anonymous Ballots</span>
                <input
                  type="checkbox"
                  disabled={!isHost}
                  checked={mods.anonymousVoting}
                  onChange={(e) => patchMod({ anonymousVoting: e.target.checked })}
                  className="h-4 w-4 accent-red-600"
                />
              </label>

              <label className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#0B0E14] px-3.5 py-2.5 text-xs text-slate-200 cursor-pointer">
                <span>Reveal Role on Death</span>
                <input
                  type="checkbox"
                  disabled={!isHost}
                  checked={mods.revealRoleOnDeath}
                  onChange={(e) => patchMod({ revealRoleOnDeath: e.target.checked })}
                  className="h-4 w-4 accent-red-600"
                />
              </label>

              <label className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#0B0E14] px-3.5 py-2.5 text-xs text-slate-200 cursor-pointer">
                <span>Eliminated Ghost Chat</span>
                <input
                  type="checkbox"
                  disabled={!isHost}
                  checked={mods.ghostChatEnabled}
                  onChange={(e) => patchMod({ ghostChatEnabled: e.target.checked })}
                  className="h-4 w-4 accent-red-600"
                />
              </label>
            </div>

            {isHost && (
              <form
                onSubmit={handlePasswordApply}
                className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4"
              >
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <Lock className="h-3.5 w-3.5 text-amber-400" />
                  <span>
                    {gameState.isPrivate ? 'Match Password Active' : 'Add Private Match Password'}
                  </span>
                </div>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Set new password..."
                  className="min-w-[180px] flex-1 rounded-lg border border-white/15 bg-[#0B0E14] px-3 py-2 text-xs text-[#F4F4F0] focus:border-amber-500/60 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!newPassword.trim()}
                  className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-40 cursor-pointer"
                >
                  Save Password
                </button>
                {gameState.isPrivate && (
                  <button
                    type="button"
                    onClick={togglePrivacy}
                    className="rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-300 hover:bg-red-950/40 cursor-pointer"
                  >
                    Make Public
                  </button>
                )}
              </form>
            )}
          </section>
        </div>

        {/* Right: Encrypted Lobby Chat */}
        <div className="lg:col-span-4">
          <EncryptedChatPanel
            gameState={gameState}
            onSend={onSendChat}
            onStrike={onStrike}
            onReport={onReport}
            onModeratePlayer={onModeratePlayer}
          />
        </div>
      </div>
    </div>
  );
}
