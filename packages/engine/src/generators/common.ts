// What the build functions of the generator catalog share: the limits, the rule of the chords of an
// arc and the placement of a point of the sketch in the model. Imported by the catalog
// (generators.ts) and by the build functions that live in modules of their own, so that neither
// imports the other at run time.
import type { Frame, Vec3 } from '../types';

export const TAU = 2 * Math.PI;
export const DEGREE = Math.PI / 180;

// A profile above this size would block the synchronous engine in triangulation and booleans.
export const MAX_PROFILE_POINTS = 50_000;
export const tooLarge = (points: number, cure = 'lower the number of teeth or raise the chord tolerance'): string => `the generated profile has ${points} points, more than ${MAX_PROFILE_POINTS}; ${cure}`;

export const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
// A number for a message: six decimals at most.
export const round = (value: number): number => Math.round(value * 1e6) / 1e6;

// Number of chords for an arc of the given sweep, the same rule as for arcs of a sketch, with the
// same cap: a tolerance far below the radius must not ask for an endless arc.
export const MAX_ARC_STEPS = 4096;
export function arcSteps(sweep: number, radius: number, chordTolerance: number): number {
  const step = Math.min(2 * Math.acos(1 - Math.min(chordTolerance / radius, 1)), Math.PI / 4);
  return Math.min(MAX_ARC_STEPS, Math.max(1, Math.ceil(sweep / step - 1e-9)));
}

// A point of the sketch plane in model coordinates.
export const toModel = (frame: Frame, u: number, v: number): Vec3 => [0, 1, 2].map((i) => frame.origin[i] + u * frame.x[i] + v * frame.y[i]) as Vec3;
// A direction of the sketch plane, by its angle from the x axis of the sketch, in model coordinates.
export const directionInModel = (frame: Frame, angle: number): Vec3 => [0, 1, 2].map((i) => Math.cos(angle) * frame.x[i] + Math.sin(angle) * frame.y[i]) as Vec3;
