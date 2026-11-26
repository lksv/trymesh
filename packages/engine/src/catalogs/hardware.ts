// The hardware catalogs (D46): clearance holes, the heads of screws, nuts and heat-set inserts, one
// catalog per source, so that `source` names one document and no row has an empty cell. The query
// `hardwareHole` turns them into the shape of a hole; the document stores the numbers.
// - Rows of the standards are keyed by the thread ("M3"); `thread` is its nominal diameter. Rows of
//   the inserts are keyed by the size as sold.
// - Lengths in millimetres, the angle in radians. Every number is typed from the table its catalog
//   names in `source`, never from memory, and was compared with a second, independent table.
// - Sizes from M2 to M8 (the owner's range: M2 to M4 on 2026-11-15, up to M8 on 2026-11-26); a
//   catalog holds the sizes its source has. M7 is left out: ISO 4762, ISO 10642 and ISO 4032:1999 do
//   not have it.
import type { DataCatalog } from '../data-catalogs';

export interface ClearanceHoleRow {
  thread: number;
  fine: number; // the three series of clearance holes, tightest first
  medium: number;
  coarse: number;
}
export interface SocketHeadScrewRow {
  thread: number;
  headDiameter: number; // the largest the standard allows: a counterbore has to take it
  headHeight: number; // the largest the standard allows
}
export interface CountersunkScrewRow {
  thread: number;
  headDiameter: number; // the largest the standard allows (the theoretical sharp edge)
  headAngle: number; // the included angle of the head
}
export interface HexNutRow {
  thread: number;
  acrossFlats: number; // the largest the standard allows
  thickness: number; // the largest the standard allows
}
// No standard: typical values for unbranded inserts, a start to correct in a test print.
export interface HeatSetInsertRow {
  thread: number;
  outerDiameter: number;
  length: number;
  holeDiameter: number;
  holeDepth: number; // the least depth of the hole
}

declare module '../data-catalogs' {
  interface Catalogs {
    clearanceHoles: ClearanceHoleRow;
    socketHeadScrews: SocketHeadScrewRow;
    countersunkScrews: CountersunkScrewRow;
    hexNuts: HexNutRow;
    heatSetInserts: HeatSetInsertRow;
  }
}

const THREAD = { title: 'Nominal diameter of the thread', unit: 'mm' } as const;

export const clearanceHoles: DataCatalog<ClearanceHoleRow> = {
  title: 'Clearance holes for bolts and screws',
  summary: 'The diameter of the hole a screw of the thread passes through, in the three series of ISO 273: fine, medium and coarse.',
  source: 'ISO 273:1979, section 2 Dimensions, as reproduced identically in IS 1821:1987 (Bureau of Indian Standards): the nominal clearance holes of the series fine, medium and coarse. Checked against the table of the German Wikipedia, Durchgangsbohrung. ISO 273 also has M7, which the screw and nut standards here do not, so it is left out.',
  columns: { thread: THREAD, fine: { title: 'Clearance hole, fine series', unit: 'mm' }, medium: { title: 'Clearance hole, medium series', unit: 'mm' }, coarse: { title: 'Clearance hole, coarse series', unit: 'mm' } },
  rows: {
    M2: { thread: 2, fine: 2.2, medium: 2.4, coarse: 2.6 },
    'M2.5': { thread: 2.5, fine: 2.7, medium: 2.9, coarse: 3.1 },
    M3: { thread: 3, fine: 3.2, medium: 3.4, coarse: 3.6 },
    'M3.5': { thread: 3.5, fine: 3.7, medium: 3.9, coarse: 4.2 },
    M4: { thread: 4, fine: 4.3, medium: 4.5, coarse: 4.8 },
    M5: { thread: 5, fine: 5.3, medium: 5.5, coarse: 5.8 },
    M6: { thread: 6, fine: 6.4, medium: 6.6, coarse: 7 },
    M8: { thread: 8, fine: 8.4, medium: 9, coarse: 10 },
  },
};

export const socketHeadScrews: DataCatalog<SocketHeadScrewRow> = {
  title: 'Hexagon socket head cap screws',
  summary: 'The head of a cylindrical socket head cap screw (ISO 4762): the largest diameter and height the standard allows, for a counterbore.',
  source: 'ISO 4762:2004, Table 1, as reproduced identically in IS 2269:2006: dk max for knurled heads (larger than for plain heads) and k max. Checked against fasten.it, DIN EN ISO 4762 (06-2004). The standard has no M3.5 and no M7.',
  columns: { thread: THREAD, headDiameter: { title: 'Head diameter, largest', unit: 'mm' }, headHeight: { title: 'Head height, largest', unit: 'mm' } },
  rows: {
    M2: { thread: 2, headDiameter: 3.98, headHeight: 2 },
    'M2.5': { thread: 2.5, headDiameter: 4.68, headHeight: 2.5 },
    M3: { thread: 3, headDiameter: 5.68, headHeight: 3 },
    M4: { thread: 4, headDiameter: 7.22, headHeight: 4 },
    M5: { thread: 5, headDiameter: 8.72, headHeight: 5 },
    M6: { thread: 6, headDiameter: 10.22, headHeight: 6 },
    M8: { thread: 8, headDiameter: 13.27, headHeight: 8 },
  },
};

export const countersunkScrews: DataCatalog<CountersunkScrewRow> = {
  title: 'Hexagon socket countersunk head screws',
  summary: 'The head of a countersunk screw (ISO 10642): the largest diameter of the head and its included angle, for a countersink.',
  source: 'ISO 10642 (EN ISO 10642:2019) from fasten.it, DIN EN ISO 10642 (02/2020): dk theoretical max (the sharp cone at the bearing face) and the head angle of 90° (90° to 92°). Checked against Westfield Fasteners, ISO 10642, and for M3 and M4 against the text of ISO 10642:1997; M5 to M8 also against the PDF of Westfield (its Figure 1 gives the angle as 90° to 92°). The standard has no M3.5 and no M7.',
  columns: { thread: THREAD, headDiameter: { title: 'Head diameter, largest', unit: 'mm' }, headAngle: { title: 'Included angle of the head', unit: 'rad' } },
  rows: {
    M2: { thread: 2, headDiameter: 4.7, headAngle: Math.PI / 2 },
    'M2.5': { thread: 2.5, headDiameter: 5.88, headAngle: Math.PI / 2 },
    M3: { thread: 3, headDiameter: 6.72, headAngle: Math.PI / 2 },
    M4: { thread: 4, headDiameter: 8.96, headAngle: Math.PI / 2 },
    M5: { thread: 5, headDiameter: 11.2, headAngle: Math.PI / 2 },
    M6: { thread: 6, headDiameter: 13.44, headAngle: Math.PI / 2 },
    M8: { thread: 8, headDiameter: 17.92, headAngle: Math.PI / 2 },
  },
};

export const hexNuts: DataCatalog<HexNutRow> = {
  title: 'Hexagon nuts',
  summary: 'A hexagon nut (ISO 4032): the largest width across flats and thickness the standard allows, for a nut pocket.',
  source: 'ISO 4032:1999, Tables 1 and 2, as reproduced identically in IS 1364 (Part 3):2002: s nom = max and m max. Checked against fasten.it, DIN EN ISO 4032 (04-2013, that is ISO 4032:2012). ISO 4032:2023 moved the sizes below M5 into an informative annex. For M6 fasten.it gives m max 5, where ISO 4032:1999 gives 5.2; ISO 4032:2023, Table 1, and torqbolt.com agree with 5.2, which the row keeps. ISO 4032:1999 has no M7 (ISO 4032:2023 added it as a non-preferred size).',
  columns: { thread: THREAD, acrossFlats: { title: 'Width across flats, largest', unit: 'mm' }, thickness: { title: 'Thickness, largest', unit: 'mm' } },
  rows: {
    M2: { thread: 2, acrossFlats: 4, thickness: 1.6 },
    'M2.5': { thread: 2.5, acrossFlats: 5, thickness: 2 },
    M3: { thread: 3, acrossFlats: 5.5, thickness: 2.4 },
    'M3.5': { thread: 3.5, acrossFlats: 6, thickness: 2.8 },
    M4: { thread: 4, acrossFlats: 7, thickness: 3.2 },
    M5: { thread: 5, acrossFlats: 8, thickness: 4.7 },
    M6: { thread: 6, acrossFlats: 10, thickness: 5.2 },
    M8: { thread: 8, acrossFlats: 13, thickness: 6.8 },
  },
};

export const heatSetInserts: DataCatalog<HeatSetInsertRow> = {
  title: 'Heat-set inserts',
  summary: 'Threaded inserts melted into a printed part, by the size as sold (thread, outer diameter, length), with a hole to start from. No standard: typical values; try the hole in a test print.',
  source: 'Typical values for unbranded brass heat-set inserts, named thread × length × outer diameter as sold ("M3x3x4.5": M3, 3 long, 4.5 across), sizes offered by shops on 2026-11-16. The hole is straight, its diameter the outer diameter less 0.3 mm (ME Design Lab, University of Wisconsin–Madison, Heat Set Inserts), its depth the length and 1 mm (CNC Kitchen, Tips & Tricks for Heat-Set Inserts, 2021). Checked against 3D Printer Gear, which recommends the same hole at an outer diameter of 4.5 and one 0.1 mm smaller at 5 (M3) and 6 (M4), and Sovol (0.1 to 0.3 mm under the knurl); for M4 with an outer diameter of 5 and 5.5 no second source was found. M5 to M8 (owner, 2026-11-26): the sizes OzFDM, Heat Set Inserts: Sizes, Hole Dimensions and Installation, sells (M5 7 across, 6 and 9.5 long; M6 8 across, 8 and 12 long; M8 10 across, 12 long), and a hole 0.7 mm under the outer diameter by rule (so 6.3 for M5, where OzFDM gives 6.4), as the two sources that list these sizes recommend rather than 0.3 (the pages were read on 2026-11-26): the holes of OzFDM for a first test are 6.4, 7.3 and 9.3, and those of CNC Kitchen (sold by kb-3d.com) 0.5 to 0.7 under its outer diameters of 7.1, 8.7 and 10.2; the depth is the length and 1 mm, as OzFDM gives too. Try the hole in a test print.',
  columns: {
    thread: THREAD,
    outerDiameter: { title: 'Outer diameter', unit: 'mm' },
    length: { title: 'Length', unit: 'mm' },
    holeDiameter: { title: 'Diameter of the hole', unit: 'mm' },
    holeDepth: { title: 'Depth of the hole, least', unit: 'mm' },
  },
  rows: {
    'M3x3x4.5': { thread: 3, outerDiameter: 4.5, length: 3, holeDiameter: 4.2, holeDepth: 4 },
    'M3x4x4.5': { thread: 3, outerDiameter: 4.5, length: 4, holeDiameter: 4.2, holeDepth: 5 },
    'M3x5x4.5': { thread: 3, outerDiameter: 4.5, length: 5, holeDiameter: 4.2, holeDepth: 6 },
    'M3x6x4.5': { thread: 3, outerDiameter: 4.5, length: 6, holeDiameter: 4.2, holeDepth: 7 },
    'M3x8x4.5': { thread: 3, outerDiameter: 4.5, length: 8, holeDiameter: 4.2, holeDepth: 9 },
    'M3x10x4.5': { thread: 3, outerDiameter: 4.5, length: 10, holeDiameter: 4.2, holeDepth: 11 },
    'M3x3x5': { thread: 3, outerDiameter: 5, length: 3, holeDiameter: 4.7, holeDepth: 4 },
    'M3x4x5': { thread: 3, outerDiameter: 5, length: 4, holeDiameter: 4.7, holeDepth: 5 },
    'M3x5x5': { thread: 3, outerDiameter: 5, length: 5, holeDiameter: 4.7, holeDepth: 6 },
    'M3x6x5': { thread: 3, outerDiameter: 5, length: 6, holeDiameter: 4.7, holeDepth: 7 },
    'M3x8x5': { thread: 3, outerDiameter: 5, length: 8, holeDiameter: 4.7, holeDepth: 9 },
    'M4x3x5': { thread: 4, outerDiameter: 5, length: 3, holeDiameter: 4.7, holeDepth: 4 },
    'M4x4x5.5': { thread: 4, outerDiameter: 5.5, length: 4, holeDiameter: 5.2, holeDepth: 5 },
    'M4x5x5.5': { thread: 4, outerDiameter: 5.5, length: 5, holeDiameter: 5.2, holeDepth: 6 },
    'M4x6x5.5': { thread: 4, outerDiameter: 5.5, length: 6, holeDiameter: 5.2, holeDepth: 7 },
    'M4x4x6': { thread: 4, outerDiameter: 6, length: 4, holeDiameter: 5.7, holeDepth: 5 },
    'M4x5x6': { thread: 4, outerDiameter: 6, length: 5, holeDiameter: 5.7, holeDepth: 6 },
    'M4x6x6': { thread: 4, outerDiameter: 6, length: 6, holeDiameter: 5.7, holeDepth: 7 },
    'M4x8x6': { thread: 4, outerDiameter: 6, length: 8, holeDiameter: 5.7, holeDepth: 9 },
    'M4x10x6': { thread: 4, outerDiameter: 6, length: 10, holeDiameter: 5.7, holeDepth: 11 },
    'M5x6x7': { thread: 5, outerDiameter: 7, length: 6, holeDiameter: 6.3, holeDepth: 7 },
    'M5x9.5x7': { thread: 5, outerDiameter: 7, length: 9.5, holeDiameter: 6.3, holeDepth: 10.5 },
    'M6x8x8': { thread: 6, outerDiameter: 8, length: 8, holeDiameter: 7.3, holeDepth: 9 },
    'M6x12x8': { thread: 6, outerDiameter: 8, length: 12, holeDiameter: 7.3, holeDepth: 13 },
    'M8x12x10': { thread: 8, outerDiameter: 10, length: 12, holeDiameter: 9.3, holeDepth: 13 },
  },
};
