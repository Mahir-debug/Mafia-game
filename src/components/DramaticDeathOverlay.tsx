import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { HeartPulse, Search, ShieldCheck, Skull, UserX, X } from 'lucide-react';
import type { DeathEvent, Role } from '../shared/types.ts';
import { ROLE_DEFINITIONS } from '../constants/roles.ts';
import { soundEngine } from '../utils/sound.ts';

interface DramaticDeathOverlayProps {
  death: DeathEvent | null;
  wasSaved?: boolean;
  onClose?: () => void;
  isPreview?: boolean;
}

export function DramaticDeathOverlay({
  death,
  wasSaved = false,
  onClose,
  isPreview = false,
}: DramaticDeathOverlayProps) {
  useEffect(() => {
    if (wasSaved) {
      soundEngine.playSavedPulse();
    } else if (death) {
      soundEngine.playDeathSequence(death.role);
    }
  }, [death?.id, wasSaved, death]);

  if (!death && !wasSaved) return null;

  const role: Role | 'unknown' = death?.role || 'unknown';
  const roleDef = role !== 'unknown' ? ROLE_DEFINITIONS[role] : null;

  const theme =
    wasSaved
      ? {
          ring: 'border-emerald-500/40',
          glow: 'from-emerald-950/90 via-[#0B0E14]/95 to-[#0B0E14]',
          stamp: 'INTERVENTION · SAVED BY THE DOCTOR',
          stampColor: 'text-emerald-300 border-emerald-500/50 bg-emerald-950/60',
          title: 'A Life Spared in the Shadows',
          subtitle: 'The syndicate struck under cover of night, but the Doctor arrived in time.',
        }
      : role === 'mafia'
        ? {
            ring: 'border-red-500/40',
            glow: 'from-red-950/90 via-[#0B0E14]/95 to-[#0B0E14]',
            stamp: 'SYNDICATE OPERATIVE ELIMINATED',
            stampColor: 'text-red-300 border-red-500/60 bg-red-950/70',
            title: `${death?.playerName} Has Fallen`,
            subtitle:
              death?.cause === 'town_execution'
                ? 'The town verdict exposed a syndicate operative at the gallows.'
                : 'Taken out in the crossfire of the night.',
          }
        : role === 'detective'
          ? {
              ring: 'border-amber-500/40',
              glow: 'from-amber-950/85 via-[#0B0E14]/95 to-[#0B0E14]',
              stamp: 'DETECTIVE FALLEN · CASE CLOSED',
              stampColor: 'text-amber-300 border-amber-500/60 bg-amber-950/70',
              title: `${death?.playerName} Has Fallen`,
              subtitle:
                death?.cause === 'town_execution'
                  ? 'A tragic misjudgment silenced the town’s investigator.'
                  : 'Silenced beside their open case files in the dark.',
            }
          : role === 'doctor'
            ? {
                ring: 'border-emerald-500/40',
                glow: 'from-teal-950/85 via-[#0B0E14]/95 to-[#0B0E14]',
                stamp: 'PHYSICIAN FALLEN · PULSE LOST',
                stampColor: 'text-emerald-300 border-emerald-500/60 bg-emerald-950/70',
                title: `${death?.playerName} Has Fallen`,
                subtitle:
                  death?.cause === 'town_execution'
                    ? 'The town lost its healer to a fatal accusation.'
                    : 'No one remained to tend the physician’s own wounds.',
              }
            : {
                ring: 'border-slate-500/40',
                glow: 'from-slate-900/90 via-[#0B0E14]/95 to-[#0B0E14]',
                stamp:
                  role === 'unknown'
                    ? 'IDENTITY CLASSIFIED · ELIMINATED'
                    : 'CIVILIAN FALLEN · SILENCED',
                stampColor: 'text-slate-200 border-slate-500/60 bg-slate-900/80',
                title: `${death?.playerName} Has Fallen`,
                subtitle:
                  death?.cause === 'town_execution'
                    ? 'Executed by majority ballot in the town square.'
                    : 'Claimed by the midnight syndicate before dawn.',
              };

  return (
    <AnimatePresence>
      <motion.div
        key={wasSaved ? 'saved' : death?.id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md"
        role="dialog"
        aria-modal="true"
        aria-label={theme.title}
      >
        {/* Ambient radial backdrop */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className={`relative w-full max-w-2xl overflow-hidden rounded-2xl border ${theme.ring} bg-gradient-to-b ${theme.glow} p-6 sm:p-10 shadow-2xl`}
        >
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="absolute right-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-black/40 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
              <span>{isPreview ? 'Close Preview' : 'Dismiss'}</span>
            </button>
          )}

          {/* Role-Specific Dramatic Visual Choreography */}
          <div className="relative mx-auto mb-8 flex h-56 w-full max-w-md items-center justify-center">
            {wasSaved ? (
              /* DOCTOR SAVE INTERVENTION ANIMATION */
              <div className="relative flex items-center justify-center">
                <motion.div
                  initial={{ scale: 1.8, opacity: 0 }}
                  animate={{ scale: [1.5, 1, 1.08, 1], opacity: [0, 1, 0.9, 1] }}
                  transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute h-44 w-44 rounded-full border-2 border-emerald-400/50"
                />
                <motion.div
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: [0.6, 1.35], opacity: [0.8, 0] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
                  className="absolute h-44 w-44 rounded-full border border-emerald-400/60"
                />
                <motion.div
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.5 }}
                  className="relative flex h-32 w-32 items-center justify-center rounded-2xl border border-emerald-400/40 bg-emerald-950/60 shadow-lg"
                >
                  <ShieldCheck className="h-16 w-16 text-emerald-400" />
                </motion.div>
              </div>
            ) : role === 'doctor' ? (
              /* DOCTOR DEATH: ECG PULSE TO FLATLINE + SHATTERED VIAL GLOW */
              <div className="relative flex w-full flex-col items-center justify-center gap-4">
                <div className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-xl border border-emerald-500/30 bg-black/50">
                  {roleDef && (
                    <motion.img
                      src={roleDef.image}
                      alt={roleDef.name}
                      referrerPolicy="no-referrer"
                      initial={{ filter: 'grayscale(0%) brightness(1)' }}
                      animate={{ filter: 'grayscale(100%) brightness(0.45)' }}
                      transition={{ duration: 1.4, delay: 0.3 }}
                      className="h-full w-full object-cover"
                    />
                  )}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.8 }}
                    className="absolute inset-0 flex items-center justify-center bg-black/45"
                  >
                    <HeartPulse className="h-10 w-10 text-red-500" />
                  </motion.div>
                </div>

                {/* Animated ECG waveform collapsing to flatline */}
                <svg viewBox="0 0 420 72" className="h-16 w-full max-w-sm overflow-visible">
                  <motion.path
                    d="M 0 36 L 65 36 L 80 36 L 92 12 L 104 60 L 116 20 L 126 36 L 165 36 L 178 16 L 190 54 L 200 28 L 210 36 L 420 36"
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ pathLength: 0, opacity: 0.9 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    transition={{ duration: 2.1, ease: 'easeInOut' }}
                  />
                </svg>
              </div>
            ) : role === 'detective' ? (
              /* DETECTIVE DEATH: CRACKED MAGNIFYING LENS & FALLING EVIDENCE */
              <div className="relative flex items-center justify-center">
                <motion.div
                  initial={{ rotate: -6, y: -12, opacity: 0 }}
                  animate={{ rotate: 0, y: 0, opacity: 1 }}
                  transition={{ duration: 0.45 }}
                  className="relative h-40 w-40 overflow-hidden rounded-full border-4 border-amber-500/50 bg-black/60 shadow-2xl"
                >
                  {roleDef && (
                    <motion.img
                      src={roleDef.image}
                      alt={roleDef.name}
                      referrerPolicy="no-referrer"
                      initial={{ scale: 1.15, filter: 'sepia(0%)' }}
                      animate={{ scale: 1, filter: 'grayscale(90%) contrast(1.15) brightness(0.55)' }}
                      transition={{ duration: 1.1 }}
                      className="h-full w-full object-cover"
                    />
                  )}
                  {/* Animated radial fracture SVG across the lens */}
                  <svg viewBox="0 0 160 160" className="pointer-events-none absolute inset-0 h-full w-full">
                    <motion.path
                      d="M80 80 L25 22 M80 80 L142 35 M80 80 L125 144 M80 80 L18 118 M80 80 L84 12"
                      stroke="rgba(255,255,255,0.8)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      transition={{ delay: 0.45, duration: 0.5, ease: 'easeOut' }}
                    />
                  </svg>
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.65 }}
                  className="absolute -bottom-3 -right-3 rounded-full border border-amber-500/40 bg-[#121620] p-2.5 text-amber-400"
                >
                  <Search className="h-5 w-5" />
                </motion.div>
              </div>
            ) : role === 'mafia' ? (
              /* MAFIA DEATH: SPLIT PLAYING CARD & CRIMSON SHATTER */
              <div className="relative flex h-44 w-44 items-center justify-center">
                {/* Left fractured half */}
                <motion.div
                  initial={{ x: 0, y: 0, rotate: 0 }}
                  animate={{ x: -18, y: 8, rotate: -9 }}
                  transition={{ delay: 0.45, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                  style={{ clipPath: 'polygon(0 0, 100% 0, 35% 100%, 0 100%)' }}
                  className="absolute inset-0 overflow-hidden rounded-xl border border-red-500/40 bg-black"
                >
                  {roleDef && (
                    <img
                      src={roleDef.image}
                      alt={roleDef.name}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover brightness-75 grayscale-[40%]"
                    />
                  )}
                </motion.div>
                {/* Right fractured half */}
                <motion.div
                  initial={{ x: 0, y: 0, rotate: 0 }}
                  animate={{ x: 18, y: -6, rotate: 10 }}
                  transition={{ delay: 0.45, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                  style={{ clipPath: 'polygon(100% 0, 100% 100%, 35% 100%)' }}
                  className="absolute inset-0 overflow-hidden rounded-xl border border-red-500/40 bg-black"
                >
                  {roleDef && (
                    <img
                      src={roleDef.image}
                      alt={roleDef.name}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover brightness-75 grayscale-[40%]"
                    />
                  )}
                </motion.div>
                <motion.div
                  initial={{ scale: 2.2, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.7, duration: 0.35 }}
                  className="relative z-10 rounded-full border border-red-500/60 bg-black/75 p-3 text-red-400"
                >
                  <Skull className="h-7 w-7" />
                </motion.div>
              </div>
            ) : (
              /* CIVILIAN / UNKNOWN DEATH: EXTINGUISHED STREETLAMP & FRACTURED PORTRAIT */
              <div className="relative flex h-44 w-44 items-center justify-center">
                <motion.div
                  initial={{ opacity: 1, scale: 1 }}
                  animate={{ opacity: 0.75, scale: 0.94 }}
                  transition={{ duration: 0.9 }}
                  className="relative h-full w-full overflow-hidden rounded-xl border border-slate-500/40 bg-slate-950"
                >
                  {roleDef ? (
                    <motion.img
                      src={roleDef.image}
                      alt={roleDef.name}
                      referrerPolicy="no-referrer"
                      initial={{ filter: 'grayscale(0%) brightness(1)' }}
                      animate={{ filter: 'grayscale(100%) brightness(0.42)' }}
                      transition={{ duration: 1.2 }}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-slate-900">
                      <UserX className="h-14 w-14 text-slate-400" />
                    </div>
                  )}
                  {/* Diagonal slash */}
                  <svg viewBox="0 0 160 160" className="absolute inset-0 h-full w-full">
                    <motion.line
                      x1="16"
                      y1="144"
                      x2="144"
                      y2="16"
                      stroke="#dc2626"
                      strokeWidth="4"
                      strokeLinecap="round"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ delay: 0.35, duration: 0.45 }}
                    />
                  </svg>
                </motion.div>
              </div>
            )}
          </div>

          {/* Dramatic Stamp & Typography */}
          <div className="text-center">
            <motion.div
              initial={{ scale: 1.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.55, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className={`mx-auto mb-4 inline-block rounded border px-3 py-1 font-mono text-xs tracking-wider ${theme.stampColor}`}
            >
              {theme.stamp}
            </motion.div>

            <motion.h2
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.35, duration: 0.4 }}
              className="font-display text-3xl sm:text-4xl font-bold text-[#F4F4F0] text-balance"
            >
              {theme.title}
            </motion.h2>

            <motion.p
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.45, duration: 0.4 }}
              className="mx-auto mt-3 max-w-md text-sm text-slate-300 leading-relaxed"
            >
              {theme.subtitle}
            </motion.p>

            {death && (
              <div className="mt-5 flex items-center justify-center gap-2 text-xs text-slate-400">
                <span>Round {death.round}</span>
                <span aria-hidden="true">·</span>
                <span>{death.cause === 'mafia_kill' ? 'Night Elimination' : 'Town Ballot'}</span>
                <span aria-hidden="true">·</span>
                <span className="capitalize">
                  Role: {death.role === 'unknown' ? 'Classified' : death.role}
                </span>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
