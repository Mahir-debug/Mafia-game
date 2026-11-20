import { useEffect, useState } from 'react';
import { AlertCircle, Volume2, VolumeX, X } from 'lucide-react';
import type { DeathEvent } from './shared/types.ts';
import { useMafiaSocket } from './hooks/useMafiaSocket.ts';
import { soundEngine } from './utils/sound.ts';
import { LobbyBrowser } from './components/LobbyBrowser.tsx';
import { WaitingLobby } from './components/WaitingLobby.tsx';
import { GameArena } from './components/GameArena.tsx';
import { DramaticDeathOverlay } from './components/DramaticDeathOverlay.tsx';

export default function App() {
  const {
    connected,
    rooms,
    gameState,
    errorMsg,
    clearError,
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
  } = useMafiaSocket();

  const [soundMuted, setSoundMuted] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [previewDeath, setPreviewDeath] = useState<{
    death: DeathEvent | null;
    wasSaved: boolean;
  } | null>(null);
  const [initialRoomCode, setInitialRoomCode] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room');
    if (code) {
      setInitialRoomCode(code.toUpperCase().slice(0, 8));
    }
  }, []);

  const toggleSound = () => {
    const next = !soundMuted;
    soundEngine.muted = next;
    setSoundMuted(next);
    if (!next) soundEngine.playClick();
  };

  return (
    <div className="min-h-screen bg-[#0B0E14] text-[#F4F4F0] flex flex-col">
      {/* 3-Zone Top Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0B0E14]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6 lg:px-8">
          {/* Zone 1: Single-Element Brand Wordmark */}
          <button
            type="button"
            onClick={() => {
              if (gameState) leaveRoom();
            }}
            className="font-display text-xl font-bold tracking-tight text-[#F4F4F0] whitespace-nowrap shrink-0 cursor-pointer"
          >
            Nocturne Mafia
          </button>

          {/* Zone 2: Clean Single-Line Nav Controls */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
            <button
              type="button"
              onClick={() => {
                if (gameState) leaveRoom();
              }}
              className="hover:text-[#F4F4F0] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Lobbies
            </button>
            <button
              type="button"
              onClick={() => setShowRulesModal(true)}
              className="hover:text-[#F4F4F0] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Rules
            </button>
            <button
              type="button"
              onClick={() =>
                setPreviewDeath({
                  death: {
                    id: `preview_mafia_${Date.now()}`,
                    playerId: 'preview',
                    playerName: 'Vito Moretti',
                    role: 'mafia',
                    cause: 'mafia_kill',
                    round: 2,
                  },
                  wasSaved: false,
                })
              }
              className="hover:text-[#F4F4F0] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Death FX
            </button>
            <button
              type="button"
              onClick={toggleSound}
              className="inline-flex items-center gap-1.5 hover:text-[#F4F4F0] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {soundMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              <span>{soundMuted ? 'Muted' : 'Audio'}</span>
            </button>
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="flex items-center gap-3 shrink-0">
            {gameState ? (
              <button
                type="button"
                onClick={leaveRoom}
                className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-[#F4F4F0] hover:bg-red-600 hover:border-red-600 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Leave Table
              </button>
            ) : (
              <span className="text-xs font-medium text-slate-400 whitespace-nowrap shrink-0">
                {connected ? 'Socket Connected' : 'Connecting...'}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Error Toast / Banner */}
      {errorMsg && (
        <div className="mx-auto mt-4 w-full max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-950/60 px-4 py-3 text-sm text-red-100">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={clearError}
              className="rounded p-1 text-red-300 hover:bg-white/10 cursor-pointer"
              aria-label="Dismiss alert"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1">
        {!gameState ? (
          <LobbyBrowser
            rooms={rooms}
            initialJoinCode={initialRoomCode}
            onCreateRoom={createRoom}
            onJoinRoom={joinRoom}
            onPreviewDeath={(death, wasSaved = false) => setPreviewDeath({ death, wasSaved })}
          />
        ) : gameState.phase === 'LOBBY' ? (
          <WaitingLobby
            gameState={gameState}
            onUpdateModifiers={updateModifiers}
            onStartGame={startGame}
            onSendChat={sendEncryptedChat}
            onStrike={sendModerationStrike}
            onReport={reportMessage}
            onModeratePlayer={moderatePlayer}
          />
        ) : (
          <GameArena
            gameState={gameState}
            onNightAction={submitNightAction}
            onSkipToVote={skipToVote}
            onVote={submitVote}
            onResetGame={resetGame}
            onSendChat={sendEncryptedChat}
            onStrike={sendModerationStrike}
            onReport={reportMessage}
            onModeratePlayer={moderatePlayer}
          />
        )}
      </main>

      {/* Preview Death Animation Overlay */}
      {previewDeath && (
        <DramaticDeathOverlay
          death={previewDeath.death}
          wasSaved={previewDeath.wasSaved}
          isPreview
          onClose={() => setPreviewDeath(null)}
        />
      )}

      {/* Rules Modal */}
      {showRulesModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Game Rules"
        >
          <div className="w-full max-w-lg space-y-4 rounded-2xl border border-white/15 bg-[#121620] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl font-bold text-[#F4F4F0]">
                How Nocturne Mafia Works
              </h2>
              <button
                type="button"
                onClick={() => setShowRulesModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white cursor-pointer"
                aria-label="Close rules"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-sm leading-relaxed text-slate-300">
              <p>
                <strong className="text-[#F4F4F0]">Night Phase:</strong> Mafia operatives coordinate
                in an encrypted Syndicate channel and select one player to eliminate. Simultaneously,
                the Detective investigates one suspect’s alignment, and the Doctor chooses one
                player to protect.
              </p>
              <p>
                <strong className="text-[#F4F4F0]">Dawn Reveal:</strong> If the Doctor protected the
                Mafia’s target, the assassination fails and the player survives. Otherwise, the
                target is eliminated with a role-specific death sequence.
              </p>
              <p>
                <strong className="text-[#F4F4F0]">Day Discussion &amp; Ballot:</strong> Living
                players debate in the AES-256-GCM encrypted Town Square and cast votes to execute a
                suspect. Ties or skipped votes result in no execution.
              </p>
              <p>
                <strong className="text-[#F4F4F0]">Moderation &amp; Fair Play:</strong> Toxic
                messages are filtered prior to encryption, players can report abusive chat, and hosts
                can enforce passwords, slow mode, and mute/kick actions.
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowRulesModal(false)}
                className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-500 cursor-pointer"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
