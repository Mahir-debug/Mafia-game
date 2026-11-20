import { useState } from 'react';
import { Lock, Play, Plus, Shield, Users } from 'lucide-react';
import type { DeathEvent, GameModifiers, Role, RoomSummary } from '../shared/types.ts';
import { PARLOR_BACKDROP_IMAGE, ROLE_DEFINITIONS } from '../constants/roles.ts';

interface LobbyBrowserProps {
  rooms: RoomSummary[];
  initialJoinCode?: string;
  onCreateRoom: (payload: {
    roomName: string;
    playerName: string;
    password?: string;
    maxPlayers: number;
    modifiers: GameModifiers;
  }) => void;
  onJoinRoom: (roomId: string, playerName: string, password?: string) => void;
  onPreviewDeath: (death: DeathEvent | null, wasSaved?: boolean) => void;
}

const DEFAULT_CREATE_MODIFIERS: GameModifiers = {
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

export function LobbyBrowser({
  rooms,
  initialJoinCode = '',
  onCreateRoom,
  onJoinRoom,
  onPreviewDeath,
}: LobbyBrowserProps) {
  const [playerName, setPlayerName] = useState('');
  const [roomName, setRoomName] = useState('Midnight Parlor');
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [isPrivate, setIsPrivate] = useState(false);
  const [createPassword, setCreatePassword] = useState('');

  const [joinCode, setJoinCode] = useState(initialJoinCode);
  const [joinPassword, setJoinPassword] = useState('');
  const [modalMode, setModalMode] = useState<'create' | 'join-private' | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<RoomSummary | null>(null);

  const handleQuickJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    onJoinRoom(
      joinCode.trim().toUpperCase(),
      playerName.trim() || 'Investigator',
      joinPassword.trim() || undefined
    );
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreateRoom({
      roomName: roomName.trim() || 'Midnight Parlor',
      playerName: playerName.trim() || 'Host',
      password: isPrivate ? createPassword.trim() : undefined,
      maxPlayers,
      modifiers: DEFAULT_CREATE_MODIFIERS,
    });
    setModalMode(null);
  };

  const handleRoomJoinClick = (room: RoomSummary) => {
    if (room.isPrivate) {
      setSelectedRoom(room);
      setJoinPassword('');
      setModalMode('join-private');
    } else {
      onJoinRoom(room.roomId, playerName.trim() || 'Investigator');
    }
  };

  const handlePrivateJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRoom) return;
    onJoinRoom(
      selectedRoom.roomId,
      playerName.trim() || 'Investigator',
      joinPassword.trim()
    );
    setModalMode(null);
  };

  const triggerRolePreview = (role: Role) => {
    onPreviewDeath(
      {
        id: `preview_${role}_${Date.now()}`,
        playerId: 'preview',
        playerName:
          role === 'mafia'
            ? 'Vito Moretti'
            : role === 'detective'
              ? 'Claire Vance'
              : role === 'doctor'
                ? 'Dr. Julian Mercer'
                : 'Arthur Pendelton',
        role,
        cause: 'mafia_kill',
        round: 2,
      },
      false
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-12 px-4 py-8 sm:px-6 lg:px-8">
      {/* Hero Split — Balanced 2-Column with Parlor Backdrop */}
      <section className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-12">
        <div className="flex flex-col justify-between rounded-2xl border border-white/10 bg-[#121620] p-6 sm:p-8 lg:col-span-6">
          <div>
            <p className="text-xs font-medium tracking-wider text-amber-400">
              Real-Time Social Deduction
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-[#F4F4F0] sm:text-5xl text-balance">
              Trust No One After Midnight.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-300 sm:text-base">
              Host private or open lobbies over live WebSockets with AES-256-GCM encrypted Town and
              Syndicate channels, custom role counts, active moderation, and dramatic death sequences.
            </p>

            {/* Player Alias & Quick Join Bar */}
            <div className="mt-6 space-y-4">
              <div>
                <label
                  htmlFor="alias-input"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Your Table Alias
                </label>
                <input
                  id="alias-input"
                  type="text"
                  maxLength={20}
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Enter your name (e.g. Elena)"
                  className="w-full rounded-lg border border-white/15 bg-[#0B0E14] px-3.5 py-2.5 text-sm text-[#F4F4F0] placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setModalMode('create')}
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-red-600 px-5 text-sm font-semibold text-white hover:bg-red-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>Create Lobby</span>
                </button>

                <form onSubmit={handleQuickJoinSubmit} className="flex flex-1 items-center gap-2 min-w-[220px]">
                  <input
                    type="text"
                    maxLength={8}
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="Room Code"
                    className="min-w-0 flex-1 rounded-lg border border-white/15 bg-[#0B0E14] px-3 py-2.5 font-mono text-sm uppercase tracking-wider text-[#F4F4F0] placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!joinCode.trim()}
                    className="inline-flex h-11 items-center rounded-lg border border-white/15 bg-white/5 px-4 text-sm font-medium text-[#F4F4F0] hover:bg-white/10 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Join Code
                  </button>
                </form>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/10 pt-4 text-xs text-slate-400">
            <span>WebSockets Sync</span>
            <span aria-hidden="true">·</span>
            <span>AES-256-GCM Chat</span>
            <span aria-hidden="true">·</span>
            <span>Private Match Passwords</span>
            <span aria-hidden="true">·</span>
            <span>4–16 Players</span>
          </div>
        </div>

        {/* Hero Visual Panel */}
        <div className="relative min-h-[280px] overflow-hidden rounded-2xl border border-white/10 bg-[#121620] lg:col-span-6">
          <img
            src={PARLOR_BACKDROP_IMAGE}
            alt="Dimly lit mahogany parlor table prepared for a Mafia match"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0B0E14] via-[#0B0E14]/35 to-transparent" />
          <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-amber-400">Encrypted Social Deduction</p>
              <p className="mt-1 font-display text-xl font-semibold text-[#F4F4F0]">
                Night Elimination, Daytime Verdict
              </p>
            </div>
            <button
              type="button"
              onClick={() => onPreviewDeath(null, true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/70 px-3 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-900/80 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Shield className="h-3.5 w-3.5" />
              <span>Preview Doctor Save</span>
            </button>
          </div>
        </div>
      </section>

      {/* Open Lobbies List */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-[#F4F4F0]">Active Tables</h2>
            <p className="mt-1 text-sm text-slate-400">
              Join an open lobby or enter a password for private matches.
            </p>
          </div>
          <div className="font-mono text-xs tabular-nums text-slate-400">
            {rooms.length} {rooms.length === 1 ? 'Table' : 'Tables'} Open
          </div>
        </div>

        {rooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-[#121620] px-6 py-12 text-center">
            <Users className="h-8 w-8 text-slate-500" />
            <p className="mt-3 text-sm font-medium text-slate-200">No active lobbies yet</p>
            <p className="mt-1 max-w-md text-xs text-slate-400">
              Create a table and share the room code or invite link with friends—or open a second
              browser tab to test live WebSocket gameplay right away.
            </p>
            <button
              type="button"
              onClick={() => setModalMode('create')}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Create First Lobby</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {rooms.map((room) => (
              <div
                key={room.roomId}
                className="flex flex-col justify-between rounded-xl border border-white/10 bg-[#121620] p-5 transition-colors hover:border-white/20"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-display text-lg font-semibold text-[#F4F4F0] truncate">
                      {room.name}
                    </h3>
                    <span className="font-mono text-xs tabular-nums text-amber-400 shrink-0">
                      {room.roomId}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                    <span>Host: {room.hostName}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {room.playerCount}/{room.maxPlayers} Players
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      {room.isPrivate && <Lock className="h-3 w-3 text-amber-400" />}
                      {room.isPrivate ? 'Private' : 'Open'}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                    <span>{room.modifiers.mafiaCount} Mafia</span>
                    <span aria-hidden="true">·</span>
                    <span>{room.modifiers.detectiveCount} Detective</span>
                    <span aria-hidden="true">·</span>
                    <span>{room.modifiers.doctorCount} Doctor</span>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/10 pt-3.5">
                  <span className="text-xs text-slate-300">
                    {room.phase === 'LOBBY' ? 'Waiting for players' : 'Match in progress'}
                  </span>
                  <button
                    type="button"
                    disabled={room.phase !== 'LOBBY' || room.playerCount >= room.maxPlayers}
                    onClick={() => handleRoomJoinClick(room)}
                    className="rounded-lg bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-[#F4F4F0] hover:bg-red-600 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {room.phase !== 'LOBBY'
                      ? 'In Match'
                      : room.playerCount >= room.maxPlayers
                        ? 'Full'
                        : 'Join Match'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Roles & Death Animation Showcase */}
      <section className="space-y-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-[#F4F4F0]">
            Roles & Dramatic Death Sequences
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Configure exact counts for each role before starting. Preview each role’s bespoke
            elimination animation below.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(['mafia', 'detective', 'doctor', 'civilian'] as Role[]).map((roleKey) => {
            const def = ROLE_DEFINITIONS[roleKey];
            return (
              <div
                key={roleKey}
                className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#121620]"
              >
                <div className="relative aspect-square w-full overflow-hidden bg-[#0B0E14]">
                  <img
                    src={def.image}
                    alt={`${def.name} role illustration`}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#121620] via-transparent to-transparent" />
                </div>

                <div className="flex flex-1 flex-col justify-between p-4">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-display text-lg font-bold text-[#F4F4F0]">{def.name}</h3>
                      <span className={`text-xs font-medium ${def.accentText}`}>{def.team}</span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-300">{def.summary}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => triggerRolePreview(roleKey)}
                    className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>Preview Death FX</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Create Lobby Modal */}
      {modalMode === 'create' && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Create Lobby"
        >
          <form
            onSubmit={handleCreateSubmit}
            className="w-full max-w-md space-y-4 rounded-2xl border border-white/15 bg-[#121620] p-6 shadow-2xl"
          >
            <h3 className="font-display text-xl font-bold text-[#F4F4F0]">Create Match Lobby</h3>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Your Name</label>
              <input
                type="text"
                maxLength={20}
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Host alias"
                className="w-full rounded-lg border border-white/15 bg-[#0B0E14] px-3 py-2.5 text-sm text-[#F4F4F0] focus:border-amber-500/60 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Lobby Name</label>
              <input
                type="text"
                maxLength={32}
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="Midnight Parlor"
                className="w-full rounded-lg border border-white/15 bg-[#0B0E14] px-3 py-2.5 text-sm text-[#F4F4F0] focus:border-amber-500/60 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Max Players ({maxPlayers})
              </label>
              <input
                type="range"
                min={4}
                max={16}
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(Number(e.target.value))}
                className="w-full accent-red-600"
              />
            </div>

            <div className="space-y-2 rounded-xl border border-white/10 bg-[#0B0E14] p-3.5">
              <label className="flex items-center justify-between gap-2 text-sm text-slate-200 cursor-pointer">
                <span>Private Match Password</span>
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  className="h-4 w-4 accent-red-600"
                />
              </label>
              {isPrivate && (
                <input
                  type="password"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  required
                  placeholder="Enter match password"
                  className="mt-2 w-full rounded-lg border border-white/15 bg-[#121620] px-3 py-2 text-sm text-[#F4F4F0] focus:border-amber-500/60 focus:outline-none"
                />
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setModalMode(null)}
                className="rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-500 cursor-pointer"
              >
                Open Table
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Private Password Prompt Modal */}
      {modalMode === 'join-private' && selectedRoom && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Private Match Password"
        >
          <form
            onSubmit={handlePrivateJoinSubmit}
            className="w-full max-w-sm space-y-4 rounded-2xl border border-white/15 bg-[#121620] p-6 shadow-2xl"
          >
            <div className="flex items-center gap-2 text-amber-400">
              <Lock className="h-4 w-4" />
              <h3 className="font-display text-lg font-bold text-[#F4F4F0]">
                {selectedRoom.name}
              </h3>
            </div>
            <p className="text-xs text-slate-400">
              This table requires a private match password to verify entry and decrypt room chat.
            </p>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Your Name</label>
              <input
                type="text"
                maxLength={20}
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Player alias"
                className="w-full rounded-lg border border-white/15 bg-[#0B0E14] px-3 py-2 text-sm text-[#F4F4F0] focus:border-amber-500/60 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Match Password
              </label>
              <input
                type="password"
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
                required
                autoFocus
                placeholder="Enter password"
                className="w-full rounded-lg border border-white/15 bg-[#0B0E14] px-3 py-2 text-sm text-[#F4F4F0] focus:border-amber-500/60 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setModalMode(null)}
                className="rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-500 cursor-pointer"
              >
                Join Table
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
