import type { Role } from '../shared/types.ts';

export const PARLOR_BACKDROP_IMAGE = '/src/assets/images/noir_parlor_hero_1795174204710.jpg';

export interface RoleDefinition {
  id: Role;
  name: string;
  team: 'Syndicate' | 'Town';
  summary: string;
  nightActionLabel: string;
  image: string;
  accentText: string;
  accentBorder: string;
  accentBg: string;
}

export const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  mafia: {
    id: 'mafia',
    name: 'Mafia',
    team: 'Syndicate',
    summary:
      'Coordinates in an encrypted night channel to eliminate one town member each round while concealing their identity by day.',
    nightActionLabel: 'Select Elimination Target',
    image: '/src/assets/images/role_mafia_1795174204742.jpg',
    accentText: 'text-red-400',
    accentBorder: 'border-red-500/30',
    accentBg: 'bg-red-950/30',
  },
  detective: {
    id: 'detective',
    name: 'Detective',
    team: 'Town',
    summary:
      'Investigates one living suspect each night to uncover whether they belong to the Mafia syndicate or the Town.',
    nightActionLabel: 'Investigate Suspect',
    image: '/src/assets/images/role_detective_1795174204088.jpg',
    accentText: 'text-amber-400',
    accentBorder: 'border-amber-500/30',
    accentBg: 'bg-amber-950/30',
  },
  doctor: {
    id: 'doctor',
    name: 'Doctor',
    team: 'Town',
    summary:
      'Protects one living player each night, preventing the Mafia elimination if they guard the targeted victim.',
    nightActionLabel: 'Protect Patient',
    image: '/src/assets/images/role_doctor_1795174204984.jpg',
    accentText: 'text-emerald-400',
    accentBorder: 'border-emerald-500/30',
    accentBg: 'bg-emerald-950/30',
  },
  civilian: {
    id: 'civilian',
    name: 'Civilian',
    team: 'Town',
    summary:
      'Relies on observation, encrypted Town Square debate, and daytime voting to expose and outnumber the Mafia.',
    nightActionLabel: 'Keep Watch Through the Night',
    image: '/src/assets/images/role_civilian_1795174204536.jpg',
    accentText: 'text-slate-200',
    accentBorder: 'border-slate-500/30',
    accentBg: 'bg-slate-800/40',
  },
};
