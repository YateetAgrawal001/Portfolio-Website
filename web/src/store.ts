import { useSyncExternalStore } from 'react';

/* ---------- Content, as served by GET /api/portfolio ---------- */
export interface Station {
  turn: number;
  short: string;
  title: string;
  sub: string;
  body: string;
  chips?: string[];
  roles?: { role: string; company: string; years: string; text: string }[];
  projects?: { name: string; text: string; stack: string[]; url?: string }[];
  steps?: { title: string; text: string }[];
  links?: { label: string; href: string }[];
}
export interface Portfolio { name: string; role: string; heroSub: string; stations: Station[] }

/* ---------- UI state shared by the game engine and React. Low frequency only: nothing here changes per frame. ---------- */
export interface Readouts { lap: string; time: string; best: string; pos: string; gap: string; kmh: number; gear: string; drive: string }
export const HUD0: Readouts = { lap: 'OUT', time: '--', best: '--', pos: 'P1', gap: '', kmh: 0, gear: 'N', drive: 'Idle' };

export interface Ui {
  phase: 'intro' | 'countdown' | 'race';
  ready: boolean;        // the 3D engine is up
  noGame: boolean;       // WebGL or the 3D chunk failed: list view only
  night: boolean;
  rain: boolean;
  rival: boolean;
  cam: 0 | 1;            // 0 cockpit, 1 chase
  shown: number;         // station in the banner, -1 for none
  visited: number[];
  bannerHidden: boolean;
  lights: number;        // start lights lit, -1 when the gantry is hidden
  listOpen: boolean;
  listNote: string;
  listSec: number;       // section to open the list at, -1 for the top
  hud: Readouts;         // refreshed by the engine at 10 Hz
}

let state: Ui = {
  phase: 'intro', ready: false, noGame: false, night: true, rain: false, rival: true, cam: 0,
  shown: -1, visited: [], bannerHidden: false, lights: -1,
  listOpen: false, listNote: '', listSec: -1, hud: HUD0,
};
const subs = new Set<() => void>();
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export const get = () => state;
export function set(patch: Partial<Ui>) { state = { ...state, ...patch }; subs.forEach(f => f()); }
/** Subscribe to one field. The selector must return a primitive or a reference that only changes when the data does. */
export const useUi = <T,>(sel: (s: Ui) => T): T => useSyncExternalStore(subscribe, () => sel(state));

export const openList = (note = '', sec = -1) => set({ listOpen: true, listNote: note, listSec: sec });
export const closeList = () => set({ listOpen: false });

export const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Handle to the running engine (see engine.ts) ---------- */
export type Control = 'gas' | 'brake' | 'left' | 'right';
export interface GameHandle {
  touch: Record<Control, boolean>;
  start(): void;
  restart(): void;
  teleport(i: number): void;
  toggleCam(): void;
  toggleRain(): void;
  toggleRival(): void;
  dispose(): void;
}
export const game: { current: GameHandle | null } = { current: null };
