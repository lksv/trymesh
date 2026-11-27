// The catalog of threads of D76: the ISO metric threads ISO 262 selects for screws, bolts and nuts
// from M2 to M64, with the pitch, the two diameters of ISO 724 and the tap drill of ISO 2306. A
// thread feature takes `diameter` and `pitch` of a row; the query `hardwareHole` with the use
// `tapped` takes the tap drill. Every number was read in two sources (docs/d36/7a-thread/design.md,
// "The catalog"); a test pins the rows.
import type { DataCatalog } from '../data-catalogs';

declare module '../data-catalogs' {
  interface Catalogs {
    metricThreads: MetricThreadRow;
  }
}

// The ISO metric threads of ISO 262 (the sizes selected for screws, bolts and nuts) from M2 to
// M64: every coarse thread and every fine one that standard selects. Keyed by the designation: the
// coarse thread of a diameter "M8", a fine one with its pitch "M8x1". Lengths in mm.
// - `diameter`, `pitch`: what goes into the fields of a thread feature.
// - `pitchDiameter`, `minorDiameter`: D2 and D1 of the basic profile (ISO 724): D − 0.649519 · P
//   and D − 1.082532 · P, rounded to the third decimal place as the standard rounds them. For
//   reading; a thread feature computes its profile from the pitch.
// - `tapDrill`: the drill before tapping (ISO 2306), the diameter of a bore that takes this
//   thread.
// - `series`: `coarse` or `fine`. `choice`: 1 or 2, the column of ISO 262 the diameter is in.
export interface MetricThreadRow {
  diameter: number;
  pitch: number;
  pitchDiameter: number;
  minorDiameter: number;
  tapDrill: number;
  series: string;
  choice: number;
}
// The rows, checked against their sources on 2026-11-26 (design.md, "The catalog"): every
// `pitchDiameter` and `minorDiameter` is the formula of ISO 724 rounded and was read in its Table
// 1 and in a second table; every `tapDrill` up to M56 (coarse) and M52x4 (fine) was read in Tables
// 1 and 2 of ISO 2306:1972 and in a second table; the five larger ones (M56x4, M60, M60x4, M64,
// M64x4), which ISO 2306 does not list, are the nominal diameter less the pitch, the rule of its
// scope, as a second table has them.
export const METRIC_THREAD_ROWS: Record<string, MetricThreadRow> = {
  M2: { diameter: 2, pitch: 0.4, pitchDiameter: 1.74, minorDiameter: 1.567, tapDrill: 1.6, series: 'coarse', choice: 1 },
  'M2.5': { diameter: 2.5, pitch: 0.45, pitchDiameter: 2.208, minorDiameter: 2.013, tapDrill: 2.05, series: 'coarse', choice: 1 },
  M3: { diameter: 3, pitch: 0.5, pitchDiameter: 2.675, minorDiameter: 2.459, tapDrill: 2.5, series: 'coarse', choice: 1 },
  'M3.5': { diameter: 3.5, pitch: 0.6, pitchDiameter: 3.11, minorDiameter: 2.85, tapDrill: 2.9, series: 'coarse', choice: 2 },
  M4: { diameter: 4, pitch: 0.7, pitchDiameter: 3.545, minorDiameter: 3.242, tapDrill: 3.3, series: 'coarse', choice: 1 },
  M5: { diameter: 5, pitch: 0.8, pitchDiameter: 4.48, minorDiameter: 4.134, tapDrill: 4.2, series: 'coarse', choice: 1 },
  M6: { diameter: 6, pitch: 1, pitchDiameter: 5.35, minorDiameter: 4.917, tapDrill: 5, series: 'coarse', choice: 1 },
  M7: { diameter: 7, pitch: 1, pitchDiameter: 6.35, minorDiameter: 5.917, tapDrill: 6, series: 'coarse', choice: 2 },
  M8: { diameter: 8, pitch: 1.25, pitchDiameter: 7.188, minorDiameter: 6.647, tapDrill: 6.8, series: 'coarse', choice: 1 },
  M8x1: { diameter: 8, pitch: 1, pitchDiameter: 7.35, minorDiameter: 6.917, tapDrill: 7, series: 'fine', choice: 1 },
  M10: { diameter: 10, pitch: 1.5, pitchDiameter: 9.026, minorDiameter: 8.376, tapDrill: 8.5, series: 'coarse', choice: 1 },
  'M10x1.25': { diameter: 10, pitch: 1.25, pitchDiameter: 9.188, minorDiameter: 8.647, tapDrill: 8.8, series: 'fine', choice: 1 },
  M10x1: { diameter: 10, pitch: 1, pitchDiameter: 9.35, minorDiameter: 8.917, tapDrill: 9, series: 'fine', choice: 1 },
  M12: { diameter: 12, pitch: 1.75, pitchDiameter: 10.863, minorDiameter: 10.106, tapDrill: 10.2, series: 'coarse', choice: 1 },
  'M12x1.5': { diameter: 12, pitch: 1.5, pitchDiameter: 11.026, minorDiameter: 10.376, tapDrill: 10.5, series: 'fine', choice: 1 },
  'M12x1.25': { diameter: 12, pitch: 1.25, pitchDiameter: 11.188, minorDiameter: 10.647, tapDrill: 10.8, series: 'fine', choice: 1 },
  M14: { diameter: 14, pitch: 2, pitchDiameter: 12.701, minorDiameter: 11.835, tapDrill: 12, series: 'coarse', choice: 2 },
  'M14x1.5': { diameter: 14, pitch: 1.5, pitchDiameter: 13.026, minorDiameter: 12.376, tapDrill: 12.5, series: 'fine', choice: 2 },
  M16: { diameter: 16, pitch: 2, pitchDiameter: 14.701, minorDiameter: 13.835, tapDrill: 14, series: 'coarse', choice: 1 },
  'M16x1.5': { diameter: 16, pitch: 1.5, pitchDiameter: 15.026, minorDiameter: 14.376, tapDrill: 14.5, series: 'fine', choice: 1 },
  M18: { diameter: 18, pitch: 2.5, pitchDiameter: 16.376, minorDiameter: 15.294, tapDrill: 15.5, series: 'coarse', choice: 2 },
  M18x2: { diameter: 18, pitch: 2, pitchDiameter: 16.701, minorDiameter: 15.835, tapDrill: 16, series: 'fine', choice: 2 },
  'M18x1.5': { diameter: 18, pitch: 1.5, pitchDiameter: 17.026, minorDiameter: 16.376, tapDrill: 16.5, series: 'fine', choice: 2 },
  M20: { diameter: 20, pitch: 2.5, pitchDiameter: 18.376, minorDiameter: 17.294, tapDrill: 17.5, series: 'coarse', choice: 1 },
  M20x2: { diameter: 20, pitch: 2, pitchDiameter: 18.701, minorDiameter: 17.835, tapDrill: 18, series: 'fine', choice: 1 },
  'M20x1.5': { diameter: 20, pitch: 1.5, pitchDiameter: 19.026, minorDiameter: 18.376, tapDrill: 18.5, series: 'fine', choice: 1 },
  M22: { diameter: 22, pitch: 2.5, pitchDiameter: 20.376, minorDiameter: 19.294, tapDrill: 19.5, series: 'coarse', choice: 2 },
  M22x2: { diameter: 22, pitch: 2, pitchDiameter: 20.701, minorDiameter: 19.835, tapDrill: 20, series: 'fine', choice: 2 },
  'M22x1.5': { diameter: 22, pitch: 1.5, pitchDiameter: 21.026, minorDiameter: 20.376, tapDrill: 20.5, series: 'fine', choice: 2 },
  M24: { diameter: 24, pitch: 3, pitchDiameter: 22.051, minorDiameter: 20.752, tapDrill: 21, series: 'coarse', choice: 1 },
  M24x2: { diameter: 24, pitch: 2, pitchDiameter: 22.701, minorDiameter: 21.835, tapDrill: 22, series: 'fine', choice: 1 },
  M27: { diameter: 27, pitch: 3, pitchDiameter: 25.051, minorDiameter: 23.752, tapDrill: 24, series: 'coarse', choice: 2 },
  M27x2: { diameter: 27, pitch: 2, pitchDiameter: 25.701, minorDiameter: 24.835, tapDrill: 25, series: 'fine', choice: 2 },
  M30: { diameter: 30, pitch: 3.5, pitchDiameter: 27.727, minorDiameter: 26.211, tapDrill: 26.5, series: 'coarse', choice: 1 },
  M30x2: { diameter: 30, pitch: 2, pitchDiameter: 28.701, minorDiameter: 27.835, tapDrill: 28, series: 'fine', choice: 1 },
  M33: { diameter: 33, pitch: 3.5, pitchDiameter: 30.727, minorDiameter: 29.211, tapDrill: 29.5, series: 'coarse', choice: 2 },
  M33x2: { diameter: 33, pitch: 2, pitchDiameter: 31.701, minorDiameter: 30.835, tapDrill: 31, series: 'fine', choice: 2 },
  M36: { diameter: 36, pitch: 4, pitchDiameter: 33.402, minorDiameter: 31.67, tapDrill: 32, series: 'coarse', choice: 1 },
  M36x3: { diameter: 36, pitch: 3, pitchDiameter: 34.051, minorDiameter: 32.752, tapDrill: 33, series: 'fine', choice: 1 },
  M39: { diameter: 39, pitch: 4, pitchDiameter: 36.402, minorDiameter: 34.67, tapDrill: 35, series: 'coarse', choice: 2 },
  M39x3: { diameter: 39, pitch: 3, pitchDiameter: 37.051, minorDiameter: 35.752, tapDrill: 36, series: 'fine', choice: 2 },
  M42: { diameter: 42, pitch: 4.5, pitchDiameter: 39.077, minorDiameter: 37.129, tapDrill: 37.5, series: 'coarse', choice: 1 },
  M42x3: { diameter: 42, pitch: 3, pitchDiameter: 40.051, minorDiameter: 38.752, tapDrill: 39, series: 'fine', choice: 1 },
  M45: { diameter: 45, pitch: 4.5, pitchDiameter: 42.077, minorDiameter: 40.129, tapDrill: 40.5, series: 'coarse', choice: 2 },
  M45x3: { diameter: 45, pitch: 3, pitchDiameter: 43.051, minorDiameter: 41.752, tapDrill: 42, series: 'fine', choice: 2 },
  M48: { diameter: 48, pitch: 5, pitchDiameter: 44.752, minorDiameter: 42.587, tapDrill: 43, series: 'coarse', choice: 1 },
  M48x3: { diameter: 48, pitch: 3, pitchDiameter: 46.051, minorDiameter: 44.752, tapDrill: 45, series: 'fine', choice: 1 },
  M52: { diameter: 52, pitch: 5, pitchDiameter: 48.752, minorDiameter: 46.587, tapDrill: 47, series: 'coarse', choice: 2 },
  M52x4: { diameter: 52, pitch: 4, pitchDiameter: 49.402, minorDiameter: 47.67, tapDrill: 48, series: 'fine', choice: 2 },
  M56: { diameter: 56, pitch: 5.5, pitchDiameter: 52.428, minorDiameter: 50.046, tapDrill: 50.5, series: 'coarse', choice: 1 },
  M56x4: { diameter: 56, pitch: 4, pitchDiameter: 53.402, minorDiameter: 51.67, tapDrill: 52, series: 'fine', choice: 1 },
  M60: { diameter: 60, pitch: 5.5, pitchDiameter: 56.428, minorDiameter: 54.046, tapDrill: 54.5, series: 'coarse', choice: 2 },
  M60x4: { diameter: 60, pitch: 4, pitchDiameter: 57.402, minorDiameter: 55.67, tapDrill: 56, series: 'fine', choice: 2 },
  M64: { diameter: 64, pitch: 6, pitchDiameter: 60.103, minorDiameter: 57.505, tapDrill: 58, series: 'coarse', choice: 1 },
  M64x4: { diameter: 64, pitch: 4, pitchDiameter: 61.402, minorDiameter: 59.67, tapDrill: 60, series: 'fine', choice: 1 },
};
export const metricThreads: DataCatalog<MetricThreadRow> = {
  title: 'ISO metric threads',
  summary: 'The ISO metric threads selected for screws, bolts and nuts, M2 to M64, coarse ("M8") and fine ("M8x1"): the nominal diameter and the pitch for a thread feature, the pitch and minor diameters of the basic profile, and the tap-drill diameter for the bore.',
  source:
    'Sizes, pitches, series and choice: ISO 262:1998, Table 1, as reproduced identically in IS 4218 (Part 4):2001 (Bureau of Indian Standards); checked against the table of the English Wikipedia, ISO metric screw thread (which also lists fine pitches of ISO 261 below M8 that ISO 262 does not select). ' +
    'Pitch and minor diameter: ISO 724:1993, Table 1 and its formulae (D2 = D − 0.6495 P, D1 = D − 1.0825 P, rounded to the third decimal place), as reproduced identically in IS 4218 (Part 3):1999; checked against the metric thread chart of Get It Made (get-it-made.co.uk) and, for M45, of Optimas. ' +
    'Tap drill: ISO 2306:1972, Tables 1 and 2 (coarse to M56, fine to M52x4); checked against the charts of Get It Made, Optimas and Engineers Edge and the DIN 336 column of the German Wikipedia, Metrisches ISO-Gewinde. ISO 2306 does not list M56x4, M60, M60x4, M64 and M64x4: their drill is the nominal diameter less the pitch, the rule of its scope, as the chart of Get It Made has them. ' +
    'The basic profile is that of ISO 68-1:1998 (IS 4218 (Part 1):2001). A drilled hole in metal; a printed bore usually needs an allowance.',
  columns: {
    diameter: { title: 'Nominal (major) diameter', unit: 'mm' },
    pitch: { title: 'Pitch', unit: 'mm' },
    pitchDiameter: { title: 'Pitch diameter of the basic profile (D2)', unit: 'mm' },
    minorDiameter: { title: 'Minor diameter of the basic profile (D1)', unit: 'mm' },
    tapDrill: { title: 'Tap drill diameter', unit: 'mm' },
    series: { title: 'Series (coarse or fine)', unit: 'text' },
    choice: { title: 'Choice of the diameter in ISO 262 (1 or 2)', unit: 'none' },
  },
  rows: METRIC_THREAD_ROWS,
};
