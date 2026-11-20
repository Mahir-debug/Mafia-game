import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Crosshair,
  Eye,
  EyeOff,
  Gavel,
  HeartHandshake,
  Moon,
  RotateCcw,
  Search,
  ShieldCheck,
  Skull,
  Sun,
  Trophy,
} from 'lucide-react';
import type { ClientGameState, DeathEvent } from '../shared/types.ts';
import { ROLE_DEFINITIONS } from '../constants/roles.ts';
import { soundEngine } from '../utils/sound.ts';
import { DramaticDeathOverlay } from './DramaticDeathOverlay.tsx';
import { EncryptedChatPanel } from './EncryptedChatPanel.tsx';

interface GameArenaProps {
  gameState: ClientGameState;
  onNightAction: (targetId: string) => void;
  onSkipToVote: () => void;
  onVote: (targetId: string | 'skip') => void;
  onResetGame: () => void;
  onSendChat: (channel: 'public' | 'mafia' | 'ghost', cleanText: string) => Promise<void>;
  onStrike: (reason: string) => void;
  onReport: (messageId: string) => void;
  onModeratePlayer: (targetPlayerId: string, action: 'mute' | 'unmute' | 'kick') => void;
}

type SuspicionMark = 'none' | 'suspect' | 'cleared';

export function GameArena({
  gameState,
  onNightAction,
  onSkipToVote,
  onVote,
  onResetGame,
  onSendChat,
  onStrike,
  onReport,
  onModeratePlayer,
}: GameArenaProps) {
  const [nowMs, setNowMs] = useState(Date.now());
  const [hideRoleCard, setHideRoleCard] = useState(false);
  const [suspicions, setSuspicions] = useState<Record<string, SuspicionMark>>({});
  const [dismissedEventId, setDismissedEventId] = useState<string | null>(null);

  const selfPlayer = gameState.players.find((p) => p.id === gameState.selfId);
  const isHost = Boolean(selfPlayer?.isHost);
  const roleDef = gameState.selfRole ? ROLE_DEFINITIONS[gameState.selfRole] : null;

  // Live countdown ticker synced against phaseEndsAt
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  // Phase transition audio feedback
  useEffect(() => {
    if (gameState.phase === 'NIGHT') soundEngine.playPhaseChime('night');
    else if (gameState.phase === 'DAWN') soundEngine.playPhaseChime('dawn');
    else if (gameState.phase === 'DAY_DISCUSSION') soundEngine.playPhaseChime('day');
    else if (gameState.phase === 'DAY_VOTING') soundEngine.playPhaseChime('vote');
    else if (gameState.phase === 'GAME_OVER') soundEngine.playPhaseChime('win');
  }, [gameState.phase, gameState.round]);

  const remainingSec = useMemo(() => {
    if (!gameState.phaseEndsAt) return 0;
    return Math.max(0, Math.ceil((gameState.phaseEndsAt - nowMs) / 1000));
  }, [gameState.phaseEndsAt, nowMs]);

  const livingCount = gameState.players.filter((p) => p.alive).length;
  const deadCount = gameState.players.length - livingCount;

  // Determine active dramatic death/save overlay
  const activeOverlay = useMemo<{
    key: string;
    death: DeathEvent | null;
    wasSaved: boolean;
  } | null>(() => {
    if (gameState.phase === 'DAWN' && gameState.lastNightOutcome) {
      if (gameState.lastNightOutcome.wasSaved) {
        const key = `saved_${gameState.lastNightOutcome.round}`;
        if (dismissedEventId === key) return null;
        return { key, death: null, wasSaved: true };
      }
      if (gameState.lastNightOutcome.death) {
        const key = gameState.lastNightOutcome.death.id;
        if (dismissedEventId === key) return null;
        return { key, death: gameState.lastNightOutcome.death, wasSaved: false };
      }
    }
    if (gameState.phase === 'EXECUTION' && gameState.lastExecution) {
      const key = gameState.lastExecution.id;
      if (dismissedEventId === key) return null;
      return { key, death: gameState.lastExecution, wasSaved: false };
    }
    return null;
  }, [gameState.phase, gameState.lastNightOutcome, gameState.lastExecution, dismissedEventId]);

  const phaseMeta = useMemo(() => {
    switch (gameState.phase) {
      case 'NIGHT':
        return {
          title: `Night ${gameState.round}`,
          subtitle:
            gameState.selfRole === 'mafia'
              ? 'Coordinate in Mafia chat and select one target to eliminate.'
              : gameState.selfRole === 'detective'
                ? 'Choose one living suspect to investigate tonight.'
                : gameState.selfRole === 'doctor'
                  ? 'Select one living player to protect from elimination tonight.'
                  : 'City streets are quiet. Wait for dawn.',
          icon: Moon,
          accent: 'text-red-400',
        };
      case 'DAWN':
        return {
          title: `Dawn · Round ${gameState.round}`,
          subtitle: gameState.lastNightOutcome?.wasSaved
            ? 'An attack was thwarted by the Doctor.'
            : gameState.lastNightOutcome?.death
              ? `${gameState.lastNightOutcome.death.playerName} did not survive the night.`
              : 'The sun rises on an unbroken town.',
          icon: Sun,
          accent: 'text-amber-400',
        };
      case 'DAY_DISCUSSION':
        return {
          title: `Day ${gameState.round} Discussion`,
          subtitle: 'Debate findings in Town Square and mark suspicions before the ballot opens.',
          icon: Sun,
          accent: 'text-amber-400',
        };
      case 'DAY_VOTING':
        return {
          title: `Town Trial · Round ${gameState.round}`,
          subtitle: 'Cast your vote on a suspect or choose to skip execution.',
          icon: Gavel,
          accent: 'text-red-400',
        };
      case 'EXECUTION':
        return {
          title: `Verdict · Round ${gameState.round}`,
          subtitle: gameState.lastExecution
            ? `${gameState.lastExecution.playerName} was executed by the town.`
            : 'No suspect reached a decisive majority.',
          icon: Gavel,
          accent: 'text-slate-300',
        };
      default:
        return {
          title: gameState.winner === 'town' ? 'Town Victory' : 'Syndicate Victory',
          subtitle:
            gameState.winner === 'town'
              ? 'All Mafia operatives have been eliminated.'
              : 'The Mafia now holds control over the city.',
          icon: Trophy,
          accent: gameState.winner === 'town' ? 'text-emerald-400' : 'text-red-400',
        };
    }
  }, [gameState.phase, gameState.round, gameState.selfRole, gameState.lastNightOutcome, gameState.lastExecution, gameState.winner]);

  const PhaseIcon = phaseMeta.icon;

  const cycleSuspicion = (playerId: string) => {
    setSuspicions((prev) => {
      const cur = prev[playerId] || 'none';
      const next: SuspicionMark = cur === 'none' ? 'suspect' : cur === 'suspect' ? 'cleared' : 'none';
      return { ...prev, [playerId]: next };
    });
  };

  const canActNightOn = (targetId: string, targetAlive: boolean): boolean => {
    if (gameState.phase !== 'NIGHT' || !gameState.selfAlive || !targetAlive) return false;
    if (gameState.selfRole === 'mafia') {
      return !gameState.mafiaTeammateIds.includes(targetId);
    }
    if (gameState.selfRole === 'detective') {
      if (targetId === gameState.selfId) return false;
      return !gameState.selfNightTargetId;
    }
    if (gameState.selfRole === 'doctor') {
      if (targetId === gameState.selfId) {
        if (gameState.modifiers.doctorSelfSave === 'never') return false;
        if (gameState.modifiers.doctorSelfSave === 'once' && gameState.selfHasSelfSaved) return false;
      }
      return true;
    }
    return false;
  };

  const isReadyToVote = gameState.readyToVoteIds.includes(gameState.selfId);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Dramatic Death / Doctor Save Overlay */}
      {activeOverlay && (
        <DramaticDeathOverlay
          death={activeOverlay.death}
          wasSaved={activeOverlay.wasSaved}
          onClose={() => setDismissedEventId(activeOverlay.key)}
        />
      )}

      {/* Phase & Timer Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#121620] p-5">
        <div className="flex items-start gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-[#0B0E14] shrink-0">
            <PhaseIcon className={`h-5 w-5 ${phaseMeta.accent}`} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>{gameState.roomName}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {livingCount} Alive · {deadCount} Fallen
              </span>
            </div>
            <h1 className="mt-0.5 font-display text-2xl font-bold text-[#F4F4F0]">
              {phaseMeta.title}
            </h1>
            <p className="mt-0.5 text-sm text-slate-300">{phaseMeta.subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {gameState.phase === 'DAY_DISCUSSION' && gameState.selfAlive && (
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                onSkipToVote();
              }}
              className={`inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isReadyToVote
                  ? 'border-amber-500/50 bg-amber-950/50 text-amber-300'
                  : 'border-white/15 bg-white/5 text-slate-200 hover:bg-white/10'
              }`}
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>
                Ready to Vote ({gameState.readyToVoteIds.length}/{Math.floor(livingCount / 2) + 1})
              </span>
            </button>
          )}

          {gameState.phase !== 'GAME_OVER' && gameState.phaseEndsAt && (
            <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-[#0B0E14] px-4 py-2">
              <Clock className="h-4 w-4 text-amber-400" />
              <span className="font-mono text-xl font-semibold tabular-nums text-[#F4F4F0]">
                {String(remainingSec).padStart(2, '0')}s
              </span>
            </div>
          )}

          {gameState.phase === 'GAME_OVER' && isHost && (
            <button
              type="button"
              onClick={onResetGame}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-red-600 px-5 text-sm font-semibold text-white hover:bg-red-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
              <span>Play Again</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Arena Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left/Center: Player Suspect Table & Secret Role Dossier */}
        <div className="space-y-6 lg:col-span-8">
          {/* Game Over Victory Summary Banner */}
          {gameState.phase === 'GAME_OVER' && (
            <div
              className={`rounded-xl border p-6 ${
                gameState.winner === 'town'
                  ? 'border-emerald-500/40 bg-emerald-950/25'
                  : 'border-red-500/40 bg-red-950/25'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-300">
                    Match Concluded · Round {gameState.round}
                  </p>
                  <h2 className="mt-1 font-display text-3xl font-bold text-[#F4F4F0]">
                    {gameState.winner === 'town'
                      ? 'The Town Prevails'
                      : 'The Syndicate Claims the City'}
                  </h2>
                </div>
                {!isHost && (
                  <span className="text-xs text-slate-300">
                    Waiting for Host to start another round...
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Players Grid */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-[#F4F4F0]">Town Roster</h2>
              <span className="text-xs text-slate-400">
                Click note tags to track personal suspicions locally
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {gameState.players.map((p) => {
                const isSelf = p.id === gameState.selfId;
                const isMafiaAlly =
                  gameState.selfRole === 'mafia' && gameState.mafiaTeammateIds.includes(p.id);
                const isSelectedNight = gameState.selfNightTargetId === p.id;
                const isSelectedVote = gameState.selfVoteTargetId === p.id;
                const suspicion = suspicions[p.id] || 'none';
                const investigation = gameState.investigations.find((inv) => inv.targetId === p.id);

                const nightAllowed = canActNightOn(p.id, p.alive);
                const voteAllowed =
                  gameState.phase === 'DAY_VOTING' && gameState.selfAlive && p.alive;

                const mafiaTargetedByAlly = Object.entries(gameState.mafiaNightVotes).some(
                  ([mid, tid]) => mid !== gameState.selfId && tid === p.id
                );

                const revealedDef = p.revealedRole ? ROLE_DEFINITIONS[p.revealedRole] : null;

                return (
                  <div
                    key={p.id}
                    className={`flex flex-col justify-between rounded-xl border p-4 transition-colors ${
                      !p.alive
                        ? 'border-white/5 bg-[#0E1118] opacity-65'
                        : isSelectedNight || isSelectedVote
                          ? 'border-red-500/60 bg-red-950/20'
                          : 'border-white/10 bg-[#121620]'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[#F4F4F0] truncate">{p.name}</span>
                            {isSelf && <span className="text-xs text-amber-400">(You)</span>}
                            {isMafiaAlly && !isSelf && (
                              <span className="text-xs text-red-400">Syndicate Ally</span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <span className={p.alive ? 'text-emerald-400' : 'text-red-400'}>
                              {p.alive ? 'Alive' : 'Eliminated'}
                            </span>
                            {revealedDef && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className={revealedDef.accentText}>{revealedDef.name}</span>
                              </>
                            )}
                            {!p.connected && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-amber-400">Reconnecting</span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Personal Suspicion Tracker */}
                        {!isSelf && p.alive && gameState.phase !== 'GAME_OVER' && (
                          <button
                            type="button"
                            onClick={() => cycleSuspicion(p.id)}
                            className={`rounded border px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              suspicion === 'suspect'
                                ? 'border-red-500/40 bg-red-950/50 text-red-300'
                                : suspicion === 'cleared'
                                  ? 'border-emerald-500/40 bg-emerald-950/50 text-emerald-300'
                                  : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {suspicion === 'suspect'
                              ? 'Suspect'
                              : suspicion === 'cleared'
                                ? 'Trusted'
                                : 'Mark Note'}
                          </button>
                        )}
                      </div>

                      {/* Detective Investigation Stamp */}
                      {investigation && (
                        <div
                          className={`mt-2.5 flex items-center gap-1.5 text-xs ${
                            investigation.alignment === 'mafia'
                              ? 'text-red-300'
                              : 'text-emerald-300'
                          }`}
                        >
                          <Search className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            Dossier (R{investigation.round}):{' '}
                            {investigation.alignment === 'mafia'
                              ? 'Mafia Syndicate'
                              : 'Innocent / Town'}
                          </span>
                        </div>
                      )}

                      {/* Mafia Ally Night Target Indicator */}
                      {mafiaTargetedByAlly && gameState.phase === 'NIGHT' && (
                        <div className="mt-2 text-xs text-red-300">
                          Targeted by fellow Mafia operative
                        </div>
                      )}

                      {/* Vote Tally Bar during Day Voting */}
                      {(gameState.phase === 'DAY_VOTING' || gameState.phase === 'EXECUTION') &&
                        p.alive && (
                          <div className="mt-3 space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-slate-400">Votes Against</span>
                              <span className="font-mono tabular-nums text-[#F4F4F0]">
                                {p.votesAgainst}
                              </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                              <div
                                className="h-full bg-red-500 transition-all duration-200"
                                style={{
                                  width: `${
                                    livingCount > 0 ? (p.votesAgainst / livingCount) * 100 : 0
                                  }%`,
                                }}
                              />
                            </div>
                            {!gameState.modifiers.anonymousVoting && p.votedByNames.length > 0 && (
                              <p className="text-[11px] text-slate-400 truncate">
                                Voted by: {p.votedByNames.join(', ')}
                              </p>
                            )}
                          </div>
                        )}
                    </div>

                    {/* Action Controls */}
                    {(nightAllowed || voteAllowed) && (
                      <div className="mt-3 pt-3 border-t border-white/10">
                        {nightAllowed && (
                          <button
                            type="button"
                            onClick={() => {
                              soundEngine.playClick();
                              onNightAction(p.id);
                            }}
                            className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                              isSelectedNight
                                ? 'bg-amber-500 text-black'
                                : gameState.selfRole === 'mafia'
                                  ? 'bg-red-600/90 text-white hover:bg-red-500'
                                  : gameState.selfRole === 'doctor'
                                    ? 'bg-emerald-600/90 text-white hover:bg-emerald-500'
                                    : 'bg-amber-600/90 text-white hover:bg-amber-500'
                            }`}
                          >
                            {gameState.selfRole === 'mafia' ? (
                              <Crosshair className="h-3.5 w-3.5" />
                            ) : gameState.selfRole === 'doctor' ? (
                              <HeartHandshake className="h-3.5 w-3.5" />
                            ) : (
                              <Search className="h-3.5 w-3.5" />
                            )}
                            <span>
                              {isSelectedNight
                                ? 'Action Locked'
                                : gameState.selfRole === 'mafia'
                                  ? 'Eliminate Target'
                                  : gameState.selfRole === 'doctor'
                                    ? 'Protect Tonight'
                                    : 'Investigate'}
                            </span>
                          </button>
                        )}

                        {voteAllowed && (
                          <button
                            type="button"
                            onClick={() => {
                              soundEngine.playClick();
                              onVote(p.id);
                            }}
                            className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                              isSelectedVote
                                ? 'bg-red-600 text-white'
                                : 'border border-white/15 bg-white/5 text-[#F4F4F0] hover:bg-red-600 hover:border-red-600'
                            }`}
                          >
                            <Gavel className="h-3.5 w-3.5" />
                            <span>{isSelectedVote ? 'Vote Cast' : 'Vote to Execute'}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Skip Vote Bar */}
            {gameState.phase === 'DAY_VOTING' && gameState.selfAlive && (
              <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#121620] px-4 py-3">
                <span className="text-xs text-slate-300">
                  Unsure who the Mafia is? You may abstain from executing anyone this round.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    onVote('skip');
                  }}
                  className={`rounded-lg px-4 py-2 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    gameState.selfVoteTargetId === 'skip'
                      ? 'bg-amber-500 text-black'
                      : 'border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10'
                  }`}
                >
                  {gameState.selfVoteTargetId === 'skip' ? 'Abstaining' : 'Skip Execution'}
                </button>
              </div>
            )}
          </section>

          {/* Secret Role Dossier & Night Log */}
          {roleDef && (
            <section className="rounded-xl border border-white/10 bg-[#121620] p-5">
              <div className="flex items-center justify-between gap-4">
                <h2 className="font-display text-lg font-bold text-[#F4F4F0]">
                  Confidential Role Dossier
                </h2>
                <button
                  type="button"
                  onClick={() => setHideRoleCard((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 cursor-pointer"
                >
                  {hideRoleCard ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  <span>{hideRoleCard ? 'Reveal Role' : 'Conceal Role'}</span>
                </button>
              </div>

              {hideRoleCard ? (
                <div className="mt-4 rounded-lg border border-white/10 bg-[#0B0E14] p-6 text-center text-xs text-slate-400">
                  Role dossier concealed for screen privacy. Click &ldquo;Reveal Role&rdquo; to inspect.
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
                  <div className="h-28 w-28 shrink-0 overflow-hidden rounded-xl border border-white/15 bg-[#0B0E14]">
                    <img
                      src={roleDef.image}
                      alt={roleDef.name}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-xl font-bold text-[#F4F4F0]">
                        {roleDef.name}
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className={`text-xs font-medium ${roleDef.accentText}`}>
                        {roleDef.team} Alignment
                      </span>
                      {!gameState.selfAlive && (
                        <>
                          <span className="text-slate-500">·</span>
                          <span className="inline-flex items-center gap-1 text-xs text-red-400">
                            <Skull className="h-3.5 w-3.5" />
                            Eliminated
                          </span>
                        </>
                      )}
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed">{roleDef.summary}</p>

                    {gameState.selfRole === 'doctor' && (
                      <p className="text-xs text-emerald-300">
                        Self-save policy: {gameState.modifiers.doctorSelfSave}
                        {gameState.modifiers.doctorSelfSave === 'once' &&
                          (gameState.selfHasSelfSaved ? ' (Already used)' : ' (Available)')}
                      </p>
                    )}

                    {gameState.selfRole === 'detective' && gameState.investigations.length > 0 && (
                      <div className="pt-2 space-y-1">
                        <div className="text-xs font-medium text-amber-400">
                          Investigation Log
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-slate-300">
                          {gameState.investigations.map((inv) => (
                            <span key={`${inv.round}_${inv.targetId}`}>
                              R{inv.round}: {inv.targetName} —{' '}
                              <strong
                                className={
                                  inv.alignment === 'mafia' ? 'text-red-400' : 'text-emerald-400'
                                }
                              >
                                {inv.alignment === 'mafia' ? 'Mafia' : 'Innocent'}
                              </strong>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Right: Multi-Channel Encrypted Chat */}
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
