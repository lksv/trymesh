// The import of a mesh as a reference body (D55) without the adapters: the codec of a stored mesh,
// the checks, the walls between stacked solids, the shells and what they are, the importer and its
// report, the section `meshes` with its commands and its upgrade step, and the feature `mesh` through
// the engine (its step calls no kernel). The cases of design.md, "Measured", that need no kernel are
// here; the scenario with the real adapters is the part of 3b in
// packages/scenarios/test/scenario13.test.ts, and what the kernel does with such meshes is in
// packages/scenarios/test/mesh-import.test.ts.
import { describe, expect, it } from 'vitest';
import { CommandError, applyCommand, emptyDocument, validateDocument } from '../src/document';
import { createEngine } from '../src/engine';
import { IMPORT_FORMATS, importFormatOf, importMesh } from '../src/import/index';
import { MESH_LIMITS, type IndexedMesh, MeshLimit, fromBase64, indexedMesh, judgeShells, meshDefects, meshProblem, meshVolume, shellsOf, storedMesh, toBase64, weld, withoutWalls } from '../src/mesh';
import { applyTool } from '../src/recompute/services';
import type { Model, ToolRecipe } from '../src/recompute/state';
import { UPGRADES } from '../src/schema';
import { SECTION_INFO } from '../src/sections/index';
import { rotation, toStl, transformPoint } from '../src/solid';
import type { Command, Document, Engine, MeshFeature, SketchSolver, Solid, SolidKernel, StoredMesh, Vec3 } from '../src/types';

// ---------------------------------------------------------------- meshes built here

type Corners = number[]; // nine numbers a triangle
// An axis-aligned box as corners, every face cut along the diagonal from its lowest corner, so that
// two boxes on one face have the same triangles there. Outwards, or inside out.
function box(min: Vec3, max: Vec3, outward = true): Corners {
  const out: Corners = [];
  for (let k = 0; k < 3; k++) {
    const [u, v] = [(k + 1) % 3, (k + 2) % 3];
    for (const high of [false, true]) {
      const at = (a: boolean, b: boolean): number[] => {
        const p = [0, 0, 0];
        p[k] = high ? max[k] : min[k];
        p[u] = a ? max[u] : min[u];
        p[v] = b ? max[v] : min[v];
        return p;
      };
      const [p00, p10, p11, p01] = [at(false, false), at(true, false), at(true, true), at(false, true)];
      // u × v is +k: this order faces +k, so it is outwards on the high side
      const tris = high === outward ? [p00, p10, p11, p00, p11, p01] : [p00, p11, p10, p00, p01, p11];
      out.push(...tris.flat());
    }
  }
  return out;
}
const inverted = (corners: Corners): Corners => {
  const out = [...corners];
  for (let t = 0; t < out.length; t += 9) for (let i = 0; i < 3; i++) [out[t + 3 + i], out[t + 6 + i]] = [out[t + 6 + i], out[t + 3 + i]];
  return out;
};
const meshOf = (...parts: Corners[]): IndexedMesh => weld(Float32Array.from(parts.flat())).mesh;
// binary STL of corners
function stl(corners: Corners): Uint8Array {
  const count = corners.length / 9;
  const positions = Float32Array.from(corners);
  return toStl([{ positions, triangles: Uint32Array.from({ length: 3 * count }, (_, i) => i), faceIds: new Uint32Array(count) }]);
}
const ascii = (corners: Corners, head = 'solid part'): Uint8Array => {
  const lines = [head];
  for (let t = 0; t < corners.length; t += 9) lines.push(' facet normal 0 0 1', '  outer loop', ...[0, 1, 2].map((k) => `   vertex ${corners.slice(t + 3 * k, t + 3 * k + 3).join(' ')}`), '  endloop', ' endfacet');
  lines.push('endsolid part');
  return new TextEncoder().encode(lines.join('\n'));
};
const TETRA: IndexedMesh = { positions: Float32Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]), triangles: Uint32Array.from([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]) };
const turnedBy = (corners: Corners, turn: ReturnType<typeof rotation>): Corners => {
  const out: Corners = [];
  for (let i = 0; i < corners.length; i += 3) out.push(...transformPoint(turn, [corners[i], corners[i + 1], corners[i + 2]]));
  return out;
};
const TURN = rotation([3, -2, 1], [0.3, 0.5, 0.8], 0.7);
const read = (outcome: ReturnType<typeof importMesh>) => {
  if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
  return outcome;
};

// ---------------------------------------------------------------- the codec

describe('the stored form of a mesh: canonical base64 of little-endian numbers', () => {
  it('bytes go there and back; the text is the canonical form', () => {
    for (let n = 0; n <= 7; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 13) & 255);
      const text = toBase64(bytes);
      expect(text.length % 4).toBe(0);
      expect(Buffer.from(text, 'base64')).toEqual(Buffer.from(bytes));
      expect(text).toBe(Buffer.from(bytes).toString('base64'));
      expect(fromBase64(text, 'x')).toEqual(bytes);
    }
  });

  it('anything but the canonical form is refused: one mesh has one spelling', () => {
    const refused = (text: string, message: RegExp) => expect(() => fromBase64(text, 'mesh.positions')).toThrow(message);
    refused('AAA', /a length divisible by 4/);
    refused('AA A', /the character " " at 2 is not one of base64/);
    refused('AA\nA', /is not one of base64/);
    refused('A=AA', /is not one of base64/);
    refused('AB==', /set bits that no byte uses/);
    refused('AAB=', /set bits that no byte uses/);
    refused('AA-_', /is not one of base64/); // the alphabet for URLs is another
    expect(() => fromBase64('AA==', 'x')).not.toThrow();
  });

  it('a stored mesh is little-endian whatever the machine; decoded once per entry object', () => {
    const stored = storedMesh({ positions: Float32Array.from([1, 0, 0]), triangles: Uint32Array.from([1, 2, 3]) }, 'one');
    expect(stored).toEqual({ name: 'one', positions: 'AACAPwAAAAAAAAAA', triangles: 'AQAAAAIAAAADAAAA' });
    const decoded = indexedMesh(stored);
    expect(Array.from(decoded.positions)).toEqual([1, 0, 0]);
    expect(Array.from(decoded.triangles)).toEqual([1, 2, 3]);
    expect(indexedMesh(stored)).toBe(decoded);
    expect(() => indexedMesh({ positions: 'AAAA', triangles: '' })).toThrow(/mesh\.positions: 3 bytes are not whole triples/);
    expect(() => indexedMesh({ positions: '', triangles: 'AAAAAAAA' })).toThrow(CommandError);
    // −0 is stored as 0
    expect(storedMesh({ positions: Float32Array.from([-0, 0, 0]), triangles: new Uint32Array(0) }).positions).toBe('AAAAAAAAAAAAAAAA');
  });
});

// ---------------------------------------------------------------- the checks

describe('the checks of a stored mesh, in their order', () => {
  const problem = (mesh: IndexedMesh, limit?: number) => meshProblem(mesh, limit);
  it('a tetrahedron passes; a box passes', () => {
    expect(problem(TETRA)).toBeUndefined();
    expect(problem(meshOf(box([0, 0, 0], [10, 20, 30])))).toBeUndefined();
  });

  it('1. the count: more than the limit is too large, fewer than four triangles is no solid', () => {
    expect(problem(TETRA, 3)).toMatchObject({ code: 'tooLarge', message: expect.stringContaining('4 triangles, more than the 3') });
    expect(problem({ positions: TETRA.positions, triangles: TETRA.triangles.slice(0, 9) })).toMatchObject({ code: 'notASolid', message: expect.stringContaining('3 triangles') });
  });

  it('2. every coordinate finite and within ±1e9', () => {
    for (const value of [NaN, Infinity, 2e9]) {
      const positions = Float32Array.from(TETRA.positions);
      positions[4] = value;
      expect(problem({ positions, triangles: TETRA.triangles })?.message).toMatch(/coordinate y of the vertex 1/);
    }
  });

  it('3. every index names a position, every position is named, no triangle names a vertex twice', () => {
    const triangles = Uint32Array.from(TETRA.triangles);
    triangles[0] = 9;
    expect(problem({ positions: TETRA.positions, triangles })?.message).toMatch(/names the vertex 9/);
    expect(problem({ positions: Float32Array.from([...TETRA.positions, 5, 5, 5]), triangles: TETRA.triangles })?.message).toMatch(/the vertex 4 is in no triangle/);
    triangles[0] = 2;
    expect(problem({ positions: TETRA.positions, triangles })?.message).toMatch(/the triangle 0 names a vertex twice/);
  });

  it('4. closed: the counts of what is wrong with the edges', () => {
    const open = { positions: TETRA.positions, triangles: Uint32Array.from([...TETRA.triangles.slice(0, 9), 0, 3, 2, 0, 3, 2].slice(0, 15)) };
    expect(meshDefects({ positions: TETRA.positions, triangles: TETRA.triangles.slice(0, 9) })).toEqual({ open: 3, overused: 0, misoriented: 0 });
    expect(meshDefects(open)).toEqual({ open: 0, overused: 3, misoriented: 0 });
    const flipped = Uint32Array.from(TETRA.triangles);
    [flipped[1], flipped[2]] = [flipped[2], flipped[1]];
    expect(meshDefects({ positions: TETRA.positions, triangles: flipped })).toEqual({ open: 0, overused: 0, misoriented: 3 });
    expect(problem({ positions: TETRA.positions, triangles: flipped })).toMatchObject({ code: 'notASolid', defects: { misoriented: 3 }, message: expect.stringContaining('3 edges whose two triangles run the same way') });
  });

  it('5. outwards: a positive volume', () => {
    expect(problem(meshOf(inverted(box([0, 0, 0], [1, 1, 1])))))?.toMatchObject({ code: 'notASolid', message: expect.stringContaining('face inwards') });
  });

  it('6. every shell encloses something: thicker than a millionth of its own size, wherever it stands', () => {
    const sheet = (x: number, thickness: number) => box([x, 0, 0], [x + 10, 10, thickness]);
    expect(problem(meshOf(box([0, 0, 0], [20, 20, 20]), sheet(100, 1e-7)))?.message).toMatch(/the shell 2 \(of 2\) encloses nothing/);
    expect(problem(meshOf(sheet(0, 1e-5)))?.message).toMatch(/encloses nothing/);
    // a millionth of its size, not of the largest coordinate: 0.125 mm at x = 10⁶ and 10⁻³ mm at x = 10³ pass
    expect(problem(meshOf(sheet(1e6, 0.125)))).toBeUndefined();
    expect(problem(meshOf(sheet(1e3, 1e-3)))).toBeUndefined();
  });

  it('7. a shell inside out beside a solid is refused; a hollow, a core in a hollow and two solids apart pass', () => {
    const cube = box([0, 0, 0], [20, 20, 20]);
    expect(problem(meshOf(cube, inverted(box([30, 0, 0], [40, 10, 10])))))?.toMatchObject({ code: 'notASolid', message: expect.stringContaining('the shell 2 (of 2) faces inwards and is not a hollow') });
    expect(shellsOf(meshOf(cube, inverted(box([5, 5, 5], [15, 15, 15])))).map((shell) => shell.kind)).toEqual(['solid', 'hollow']);
    expect(shellsOf(meshOf(cube, inverted(box([5, 5, 5], [15, 15, 15])), box([8, 8, 8], [12, 12, 12]))).map((shell) => shell.kind)).toEqual(['solid', 'hollow', 'solid']);
    expect(shellsOf(meshOf(cube, box([30, 0, 0], [40, 10, 10]))).map((shell) => shell.kind)).toEqual(['solid', 'solid']);
    // a hollow written outwards is read as a part inside a part
    expect(shellsOf(meshOf(cube, box([5, 5, 5], [15, 15, 15]))).map((shell) => shell.kind)).toEqual(['solid', 'nested']);
    // the tetrahedron and a smaller one inside out beside it (calls.ts)
    const two: IndexedMesh = {
      positions: Float32Array.from([...TETRA.positions, 50, 0, 0, 55, 0, 0, 50, 5, 0, 50, 0, 5]),
      triangles: Uint32Array.from([...TETRA.triangles, ...[0, 1, 2, 0, 3, 1, 1, 3, 2, 0, 2, 3].map((v) => v + 4)]),
    };
    expect(shellsOf(two).map((shell) => shell.kind)).toEqual(['solid', 'insideOut']);
  });

  it('7. a hollow that touches the solid at a vertex is judged at a centroid away from it (round 2)', () => {
    // a cube of 10 with an inward tetrahedron at its corner, sharing the corner vertex
    const corner: Corners = inverted([0, 0, 0, 0, 2, 0, 2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 2, 0, 2, 0]);
    const mesh = meshOf(box([0, 0, 0], [10, 10, 10]), corner);
    expect(meshProblem(mesh)).toBeUndefined();
    expect(shellsOf(mesh).map((shell) => shell.kind)).toEqual(['solid', 'hollow']);
  });

  it('7. a centroid on a face of another shell is passed over: an inside-out box resting on a box is no hollow, in any frame (round 3)', () => {
    const base = box([0, 0, 0], [20, 20, 10]);
    const top = inverted(box([5, 5, 10], [15, 15, 20]));
    for (const turn of [undefined, TURN]) {
      const parts = [base, top].map((part) => (turn ? turnedBy(part, turn) : part));
      expect(shellsOf(meshOf(...parts)).map((shell) => shell.kind)).toEqual(['solid', 'insideOut']);
      // two plain boxes resting so: both solid, none nested
      expect(shellsOf(meshOf(parts[0], turn ? turnedBy(box([5, 5, 10], [15, 15, 20]), turn) : box([5, 5, 10], [15, 15, 20]))).map((shell) => shell.kind)).toEqual(['solid', 'solid']);
    }
  });

  it('7. the work is bounded: a dense shell around many others is too large to check', () => {
    // a box whose faces are cut into a grid of 60 × 60 squares (43 200 triangles), with 240 hollows
    const n = 60;
    const corners: Corners = [];
    const size = 100;
    for (let k = 0; k < 3; k++) {
      const [u, v] = [(k + 1) % 3, (k + 2) % 3];
      for (const high of [false, true]) {
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++) {
            const at = (a: number, b: number): number[] => {
              const p = [0, 0, 0];
              p[k] = high ? size : 0;
              p[u] = (a * size) / n;
              p[v] = (b * size) / n;
              return p;
            };
            const [p00, p10, p11, p01] = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
            corners.push(...(high ? [p00, p10, p11, p00, p11, p01] : [p00, p11, p10, p00, p01, p11]).flat());
          }
      }
    }
    const hollows = Array.from({ length: 240 }, (_, i) => inverted(box([5 + (i % 15) * 6, 5 + Math.floor(i / 15) * 5, 40], [8 + (i % 15) * 6, 8 + Math.floor(i / 15) * 5, 43])));
    const mesh = meshOf(corners, ...hollows);
    expect(() => judgeShells(mesh)).toThrow(MeshLimit);
    expect(meshProblem(mesh, 1e6)).toMatchObject({ code: 'tooLarge', message: expect.stringContaining('too many shells around one another') });
  });
});

// ---------------------------------------------------------------- the walls

describe('the wall between two solids stacked on one outline', () => {
  it('three boxes on one outline are one solid: 4 pairs left out, in the base frame and turned', () => {
    for (const turn of [undefined, TURN]) {
      const parts = [box([0, 0, 0], [42, 42, 10]), box([0, 0, 10], [42, 42, 30]), box([0, 0, 30], [42, 42, 40])].map((part) => (turn ? turnedBy(part, turn) : part));
      const { mesh, walls } = withoutWalls(meshOf(...parts));
      expect(walls).toBe(4);
      expect(meshProblem(mesh)).toBeUndefined();
      expect(shellsOf(mesh)).toHaveLength(1);
      expect(meshVolume(mesh)).toBeCloseTo(42 * 42 * 40, turn ? 1 : 9);
      expect(mesh.positions.length / 3).toBe(16); // the positions nothing names are gone
    }
  });

  it('four boxes in a 2 × 2 block cut alike are one solid: 8 pairs, the walls meet at an edge inside them', () => {
    const parts = [0, 1].flatMap((i) => [0, 1].map((j) => box([10 * i, 10 * j, 0], [10 * i + 10, 10 * j + 10, 10])));
    const { mesh, walls } = withoutWalls(meshOf(...parts));
    expect(walls).toBe(8);
    expect(meshProblem(mesh)).toBeUndefined();
    expect(meshVolume(mesh)).toBeCloseTo(4000, 9);
  });

  it('the guard: a solid glued to an inside-out one on the same side keeps the pair and is refused (round 2)', () => {
    const positions = Float32Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10, 20, 20, 5]);
    const outward = [0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2];
    const second = [0, 1, 2, 0, 4, 1, 1, 4, 2, 0, 2, 4];
    const glued = withoutWalls({ positions, triangles: Uint32Array.from([...outward, ...second]) });
    expect(glued.walls).toBe(0);
    expect(meshDefects(glued.mesh).overused).toBe(3);
  });

  it('a wall without a border (a closed double sheet) stays and is refused by its thickness', () => {
    // two boxes of zero height on top of each other: every pair is a candidate, no border
    const flat = (outward: boolean) => box([0, 0, 0], [10, 10, 0], outward);
    const { walls } = withoutWalls(meshOf(flat(true)));
    expect(walls).toBe(0);
  });

  it('the importer turns an inside-out file over before the walls: three boxes, all inside out', () => {
    const parts = [box([0, 0, 0], [42, 42, 10]), box([0, 0, 10], [42, 42, 30]), box([0, 0, 30], [42, 42, 40])].map(inverted);
    const { report } = read(importMesh('stl', stl(parts.flat())));
    expect(report).toMatchObject({ insideOut: true, walls: 4, shells: 1 });
    expect(report.volume).toBeCloseTo(42 * 42 * 40, 6);
  });
});

// ---------------------------------------------------------------- the import

describe('the import: the format, the weld, the shells turned over, the report', () => {
  it('the catalog: STL by its extension, with the option unit', () => {
    expect(Object.keys(IMPORT_FORMATS)).toEqual(['stl']);
    expect(importFormatOf('parts/Motor.STL')).toBe('stl');
    expect(importFormatOf('motor.step')).toBeUndefined();
    expect(Object.keys(IMPORT_FORMATS.stl.options)).toEqual(['unit']);
  });

  it('binary and ASCII give the same mesh; the normals are not read; the unit scales', () => {
    const corners = box([0, 0, 0], [10, 20, 30]);
    const binary = read(importMesh('stl', stl(corners), {}, 'box.stl'));
    const text = read(importMesh('stl', ascii(corners)));
    expect(binary.report).toMatchObject({ format: 'stl', about: { encoding: 'binary', unit: 'mm' }, facets: 12, triangles: 12, vertices: 8, shells: 1, volume: 6000, bounds: { min: [0, 0, 0], max: [10, 20, 30] }, notes: [] });
    expect(binary.mesh.name).toBe('box.stl');
    expect(text.report.about).toEqual({ encoding: 'ascii', unit: 'mm' });
    expect([text.mesh.positions, text.mesh.triangles]).toEqual([binary.mesh.positions, binary.mesh.triangles]);
    // several solid blocks are one mesh; a binary file may begin with `solid`
    const two = new TextEncoder().encode(`${new TextDecoder().decode(ascii(box([0, 0, 0], [1, 1, 1])))}\n${new TextDecoder().decode(ascii(box([5, 0, 0], [6, 1, 1])))}`);
    expect(read(importMesh('stl', two)).report.shells).toBe(2);
    const named = stl(corners);
    named.set(new TextEncoder().encode('solid binary header'), 0);
    expect(read(importMesh('stl', named)).report.about.encoding).toBe('binary');
    expect(read(importMesh('stl', stl(corners), { unit: 'in' })).report.bounds.max).toEqual([254, 508, 762]);
    expect(read(importMesh('stl', stl(corners), { unit: 'cm' })).report.volume).toBeCloseTo(6e6, 3);
  });

  it('what a file that is no STL gets: unreadable, with the length it has and the one its count would need', () => {
    const outcome = (bytes: Uint8Array) => importMesh('stl', bytes);
    const short = stl(box([0, 0, 0], [1, 1, 1])).slice(0, 300);
    expect(outcome(short)).toMatchObject({ ok: false, error: { code: 'unreadable', message: expect.stringContaining('it has 300 bytes, where a binary STL of the 12 triangles its header counts has 684') } });
    expect(outcome(new Uint8Array(10))).toMatchObject({ ok: false, error: { code: 'unreadable', message: expect.stringContaining('fewer than the 84') } });
    expect(outcome(new TextEncoder().encode('solid empty\nendsolid empty'))).toMatchObject({ ok: false, error: { code: 'unreadable' } });
    expect(outcome(new TextEncoder().encode('solid x\n vertex 1 2 3\n vertex 1 2 3\n'))).toMatchObject({ ok: false, error: { code: 'unreadable', message: expect.stringContaining('2 vertices, which are not whole triangles') } });
    expect(outcome(new TextEncoder().encode('solid x\n vertex 1 2 nan\n'))).toMatchObject({ ok: false, error: { code: 'unreadable', message: expect.stringContaining('"nan"') } });
    const infinite = stl(box([0, 0, 0], [1, 1, 1]));
    new DataView(infinite.buffer).setFloat32(84 + 12, Infinity, true);
    expect(outcome(infinite)).toMatchObject({ ok: false, error: { code: 'unreadable', message: expect.stringContaining('not a finite number') } });
  });

  it('too many triangles: decided from the count of the file, before anything is welded', () => {
    const count = MESH_LIMITS.triangles + 1;
    const bytes = new Uint8Array(84 + 50 * count);
    new DataView(bytes.buffer).setUint32(80, count, true);
    expect(importMesh('stl', bytes)).toMatchObject({ ok: false, error: { code: 'tooLarge', message: expect.stringContaining(`${count} triangles`) } });
  });

  it('the options are checked against the description of the format', () => {
    expect(importMesh('stl', stl(box([0, 0, 0], [1, 1, 1])), { unit: 'ft' } as never)).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['unit'] } });
    expect(importMesh('stl', stl(box([0, 0, 0], [1, 1, 1])), { scale: 2 } as never)).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['scale'] } });
    expect(importMesh('obj' as never, new Uint8Array(0))).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['format'], message: expect.stringContaining('the formats are stl') } });
  });

  it('the weld: corners at one float32 position are one vertex (−0 as 0); a triangle that loses a corner is left out and counted', () => {
    const corners = box([0, 0, 0], [10, 10, 10]);
    const zero = corners.map((value) => (value === 0 ? -0 : value));
    const { report } = read(importMesh('stl', stl([...zero, 1, 1, 1, 1, 1, 1, 2, 2, 2])));
    expect(report).toMatchObject({ facets: 13, dropped: 1, triangles: 12, vertices: 8, notes: ['1 triangle was left out: two of its corners are at one position'] });
    // no tolerance: a seam that differs in the last bit stays open
    const moved = [...corners];
    moved[0] = Math.fround(1e-30);
    expect(importMesh('stl', stl(moved))).toMatchObject({ ok: false, error: { code: 'notASolid' } });
  });

  it('a whole file inside out is turned over; an outermost shell inside out is turned with the shells it contains', () => {
    expect(read(importMesh('stl', stl(inverted(box([0, 0, 0], [10, 10, 10])))))).toMatchObject({ report: { insideOut: true, turned: 0, volume: 1000, notes: [expect.stringContaining('written inside out')] } });
    // a cube beside an inverted 4 mm box whose 2 mm hollow is written outwards: the group is turned (round 3)
    const file = [...box([0, 0, 0], [10, 10, 10]), ...inverted(box([20, 0, 0], [24, 4, 4])), ...box([21, 1, 1], [23, 3, 3])];
    const { report } = read(importMesh('stl', stl(file)));
    expect(report).toMatchObject({ insideOut: false, turned: 2, shells: 3, cavities: 1, nested: 0 });
    expect(report.volume).toBeCloseTo(1056, 9);
    // an inside-out box resting on a box is turned over, in any frame
    for (const turn of [undefined, TURN]) {
      const parts = [box([0, 0, 0], [20, 20, 10]), inverted(box([5, 5, 10], [15, 15, 20]))].map((part) => (turn ? turnedBy(part, turn) : part));
      const resting = read(importMesh('stl', stl(parts.flat()))).report;
      expect(resting).toMatchObject({ turned: 1, shells: 2, cavities: 0, nested: 0 });
      expect(resting.volume).toBeCloseTo(5000, 1);
    }
  });

  it('the report: shells, nested shells and a large mesh are notes; a hollow is a cavity', () => {
    const hollow = read(importMesh('stl', stl([...box([0, 0, 0], [20, 20, 20]), ...inverted(box([5, 5, 5], [15, 15, 15]))]))).report;
    expect(hollow).toMatchObject({ shells: 2, cavities: 1, nested: 0, volume: 7000 });
    expect(hollow.notes).toEqual([expect.stringContaining('2 shells: shells that overlap are counted twice')]);
    const nested = read(importMesh('stl', stl([...box([0, 0, 0], [20, 20, 20]), ...box([5, 5, 5], [15, 15, 15])]))).report;
    expect(nested).toMatchObject({ nested: 1, volume: 9000 });
    expect(nested.notes[1]).toMatch(/1 shell lies in the material of other shells/);
    const tiny = read(importMesh('stl', stl(box([0, 0, 0], [0.04, 0.02, 0.03])))).report;
    expect(tiny.notes).toEqual(['the largest side of the bounds is 0.04 mm: is the unit of the file right (the option unit)?']);
  });

  it('the same bytes give the same mesh', () => {
    const bytes = stl([...box([0, 0, 0], [20, 20, 20]), ...inverted(box([5, 5, 5], [15, 15, 15]))]);
    expect(importMesh('stl', bytes)).toEqual(importMesh('stl', bytes.slice()));
  });
});

// ---------------------------------------------------------------- the section and the feature

// An engine whose steps never reach the adapters: no sketch is solved and no tool applied.
const solver = { solve: () => ({ status: 'failed', points: {}, radii: {}, degreesOfFreedom: 0, conflicting: [], redundant: [] }) } as SketchSolver;
const newEngine = (): Engine => createEngine({ solver, kernel: {} as SolidKernel });
const XY = { kind: 'base', plane: 'XY' } as const;
const TETRA_STORED: StoredMesh = storedMesh(TETRA, 'tetra.stl');
const BOX_STORED: StoredMesh = storedMesh(meshOf(box([0, 0, 0], [10, 20, 30])));
const placedMesh = (id: string, mesh: string, placement: object = { frame: XY }): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'mesh', mesh, placement } as never });
const ok = (engine: Engine, ...commands: Command[]) => {
  const result = engine.execute(commands.length === 1 ? commands[0] : { type: 'batch', commands });
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
};
const refused = (doc: Document, command: unknown, message: RegExp) => {
  expect(() => applyCommand(doc, command as Command)).toThrow(CommandError);
  expect(() => applyCommand(doc, command as Command)).toThrow(message);
};

describe('the section meshes and its commands', () => {
  it('is always in the document, before the stored documents; the step gives an older document the empty section', () => {
    expect(emptyDocument().meshes).toEqual({});
    expect(Object.keys(emptyDocument()).slice(-2)).toEqual(['meshes', 'documents']);
    const step = UPGRADES.find((entry) => entry.name === '3b-mesh-import');
    expect(UPGRADES[5]).toBe(step);
    const older = { schemaVersion: 6, settings: { chordTolerance: 0.01 }, parameters: [], checks: [], features: [], bodyProperties: {}, mechanism: { links: {}, joints: {} } };
    expect(step?.run(older)).toEqual({ ...older, meshes: {} });
    expect(step?.run({ ...older, meshes: null })).toEqual({ ...older, meshes: null });
    expect(validateDocument(older).meshes).toEqual({});
    expect(() => validateDocument({ ...older, meshes: null })).toThrow(/document\.meshes: čeká se objekt/);
    expect(SECTION_INFO.meshes).toMatchObject({ title: 'Stored meshes', commands: ['addMesh', 'removeMesh'], fields: [] });
  });

  it('addMesh checks the entry in full and strictly; an ID the section has is refused', () => {
    const doc = applyCommand(emptyDocument(), { type: 'addMesh', id: 'tetra', mesh: TETRA_STORED });
    expect(doc.meshes).toEqual({ tetra: TETRA_STORED });
    refused(doc, { type: 'addMesh', id: 'tetra', mesh: BOX_STORED }, /addMesh\.id: the document has a stored mesh "tetra" already/);
    refused(doc, { type: 'addMesh', id: 'origin', mesh: BOX_STORED }, /addMesh\.id: ID "origin" není přípustné/);
    refused(doc, { type: 'addMesh', id: 'constructor', mesh: BOX_STORED }, /addMesh\.id/);
    refused(doc, { type: 'addMesh', id: 'b', mesh: { ...BOX_STORED, colour: 'red' } }, /addMesh\.mesh\.colour: a stored mesh has no such field/);
    refused(doc, { type: 'addMesh', id: 'b', mesh: { ...BOX_STORED, name: ' box' } }, /addMesh\.mesh\.name/);
    refused(doc, { type: 'addMesh', id: 'b', mesh: { positions: BOX_STORED.positions } }, /addMesh\.mesh\.triangles: čeká se řetězec/);
    refused(doc, { type: 'addMesh', id: 'b', mesh: storedMesh(meshOf(inverted(box([0, 0, 0], [1, 1, 1])))) }, /addMesh\.mesh: the volume of the mesh/);
    refused(doc, { type: 'addMesh', id: 'b', mesh: { ...BOX_STORED, positions: `${BOX_STORED.positions.slice(0, -4)} ${BOX_STORED.positions.slice(-3)}` } }, /addMesh\.mesh\.positions: the character " "/);
  });

  it('removeMesh: refused while a feature names the mesh, suppressed or not; the message lists them', () => {
    let doc = applyCommand(emptyDocument(), { type: 'batch', commands: [{ type: 'addMesh', id: 'm', mesh: TETRA_STORED }, placedMesh('a', 'm'), placedMesh('b', 'm'), { type: 'setSuppressed', id: 'b', suppressed: true }] });
    refused(doc, { type: 'removeMesh', id: 'm' }, /placed by the features a, b; remove them or point them to another mesh first/);
    refused(doc, { type: 'removeMesh', id: 'n' }, /no stored mesh "n"/);
    doc = applyCommand(doc, { type: 'batch', commands: [{ type: 'removeFeature', id: 'a' }, { type: 'removeFeature', id: 'b' }, { type: 'removeMesh', id: 'm' }] });
    expect(doc.meshes).toEqual({});
  });

  it('a load checks every entry with the limit that is never lowered, strictly, and keeps the canonical form', () => {
    const doc = applyCommand(emptyDocument(), { type: 'addMesh', id: 'm', mesh: TETRA_STORED });
    const text = JSON.parse(JSON.stringify(doc));
    expect(validateDocument(text).meshes).toEqual({ m: TETRA_STORED });
    expect(() => validateDocument({ ...text, meshes: { m: { ...TETRA_STORED, faces: 'AAAA' } } })).toThrow(/document\.meshes\.m\.faces: a stored mesh has no such field/);
    expect(() => validateDocument({ ...text, meshes: { 'a/b': TETRA_STORED } })).toThrow(/document\.meshes\.a\/b/);
    expect(() => validateDocument({ ...text, meshes: { m: storedMesh({ positions: indexedMesh(BOX_STORED).positions, triangles: indexedMesh(BOX_STORED).triangles.slice(3) }) } })).toThrow(/document\.meshes\.m: the mesh is not a closed solid: 3 edges with one triangle/);
    // a feature whose mesh is not in the section loads
    expect(validateDocument({ ...text, meshes: {}, features: [{ id: 'a', name: 'a', suppressed: false, type: 'mesh', mesh: 'gone', placement: { frame: XY } }] }).features).toHaveLength(1);
    expect(MESH_LIMITS.stored).toBeGreaterThanOrEqual(MESH_LIMITS.triangles);
  });
});

describe('the feature mesh: a stored mesh placed as a body with one face', () => {
  it('the body: the ID of the feature, one face that is not planar and has no edges, where the placement puts it', () => {
    const engine = newEngine();
    const state = ok(engine, { type: 'addMesh', id: 'box', mesh: BOX_STORED }, placedMesh('b', 'box', { frame: XY, x: 5, z: 2 }));
    const { bodies, faceNames, faceSurfaces, features, meshes } = state.evaluation;
    expect(features.b).toMatchObject({ status: 'ok', bodies: ['b'], facts: { origin: [5, 0, 2], axisX: [1, 0, 0], axisY: [0, 1, 0], axisZ: [0, 0, 1] } });
    expect(bodies.b.faces).toEqual([{ id: 0, planar: false }]);
    expect(faceNames[0]).toEqual({ feature: 'b', role: 'mesh' });
    expect(faceSurfaces[0]).toEqual({ kind: 'general' });
    expect(bodies.b.edges).toEqual([]);
    expect(bodies.b.bounds).toEqual({ min: [5, 0, 2], max: [15, 20, 32] });
    expect(bodies.b.volume).toBeCloseTo(6000, 9);
    expect(meshes.box).toEqual({ vertices: 8, triangles: 12, bounds: { min: [0, 0, 0], max: [10, 20, 30] }, volume: 6000, shells: 1, usedBy: ['b'] });
    // a base plane as a frame: XZ is (+X, +Z, −Y)
    const xz = ok(engine, { type: 'updateFeature', id: 'b', patch: { placement: { frame: { kind: 'base', plane: 'XZ' } } } });
    expect(xz.evaluation.bodies.b.bounds).toEqual({ min: [5, -32, 0], max: [15, -2, 20] });
    expect(xz.document.features[0]).toMatchObject({ placement: { frame: { kind: 'base', plane: 'XZ' }, x: 5, z: 2 } });
  });

  it('the turns: about X, then Y, then the normal, the axes of the frame staying; within ±2π', () => {
    const engine = newEngine();
    ok(engine, { type: 'addMesh', id: 'box', mesh: BOX_STORED }, placedMesh('b', 'box'));
    const facts = (patch: object) => {
      const preview = engine.preview({ type: 'updateFeature', id: 'b', patch: { placement: patch } as never });
      if (!preview.ok) throw new Error(preview.error.message);
      return preview.state.evaluation.features.b.facts as Record<string, number[]>;
    };
    const near = (actual: number[], expected: number[]) => expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 12));
    near(facts({ rx: 'deg(90)' }).axisY, [0, 0, 1]); // X takes Y to Z
    near(facts({ ry: 'deg(90)' }).axisZ, [1, 0, 0]); // Y takes Z to X
    near(facts({ rz: 'deg(90)' }).axisX, [0, 1, 0]); // the normal takes X to Y
    near(facts({ rx: 'deg(90)', rz: 'deg(90)' }).axisZ, [1, 0, 0]); // calls.ts: Z to −Y, then −Y to X
    near(facts({ ry: 'deg(90)', x: 1, y: 2, z: 3 }).origin, [1, 2, 3]); // the offset is in the frame, not in the turned part
    expect(engine.preview({ type: 'updateFeature', id: 'b', patch: { placement: { rz: 7 } } })).toMatchObject({ ok: false, error: { message: expect.stringContaining('updateFeature.patch.placement.rz') } });
  });

  it('the six numbers are optional numeric fields: setField adds one, null removes one, a patch merges, the frame is replaced whole', () => {
    const engine = newEngine();
    ok(engine, { type: 'addMesh', id: 'box', mesh: BOX_STORED }, { type: 'addMesh', id: 'tetra', mesh: TETRA_STORED }, placedMesh('b', 'box'));
    ok(engine, { type: 'setField', feature: 'b', path: 'placement/y', value: 'deg(1) * 0 + 4' });
    let f = engine.getState().document.features[0] as MeshFeature;
    expect(f).toMatchObject({ placement: { frame: XY, y: 4 }, expressions: { 'placement/y': 'deg(1) * 0 + 4' } });
    ok(engine, { type: 'updateFeature', id: 'b', patch: { mesh: 'tetra', placement: { y: null, rz: 0.5 } } });
    f = engine.getState().document.features[0] as MeshFeature;
    expect(f.placement).toEqual({ frame: XY, rz: 0.5 });
    expect(f.expressions).toBeUndefined();
    expect(f.mesh).toBe('tetra');
    // null for a number the feature does not have is fine; for another name it is not
    ok(engine, { type: 'updateFeature', id: 'b', patch: { placement: { x: null } } });
    expect(engine.execute({ type: 'updateFeature', id: 'b', patch: { placement: { scale: null } } as never })).toMatchObject({ ok: false });
    expect(engine.execute({ type: 'updateFeature', id: 'b', patch: { placement: { scale: 2 } } as never })).toMatchObject({ ok: false, error: { message: expect.stringContaining('scale') } });
    expect(engine.execute({ type: 'setField', feature: 'b', path: 'placement/scale', value: 2 })).toMatchObject({ ok: false, error: { message: expect.stringContaining('not a numeric field') } });
    // a frame of a sketch point is checked: the sketch and its point
    expect(engine.execute({ type: 'updateFeature', id: 'b', patch: { placement: { frame: { kind: 'sketchPoint', sketch: 's', point: 'p' } } } })).toMatchObject({ ok: false, error: { message: expect.stringContaining('feature "s" neexistuje') } });
    expect(engine.execute({ type: 'updateFeature', id: 'b', patch: { placement: { frame: { kind: 'sketchPoint', sketch: 's', point: 'p', axis: 'Z' } } } as never })).toMatchObject({ ok: false, error: { message: expect.stringContaining('axis') } });
  });

  it('a mesh that is not in the section: the error of the feature; adding it under that ID computes the feature again', () => {
    const engine = newEngine();
    const loaded = engine.load(JSON.stringify({ ...emptyDocument(), features: [{ id: 'b', name: 'b', suppressed: false, type: 'mesh', mesh: 'box', placement: { frame: XY } }] }));
    expect(loaded.ok && loaded.state.evaluation.features.b.error).toMatchObject({ code: 'brokenReference', refs: [{ mesh: 'box' }] });
    const feature = engine.getState().document.features[0];
    const state = ok(engine, { type: 'addMesh', id: 'box', mesh: BOX_STORED });
    expect(state.document.features[0]).toBe(feature); // the same feature object, another input
    expect(state.evaluation.features.b.status).toBe('ok');
    expect(state.evaluation.bodies.b.volume).toBeCloseTo(6000, 9);
  });

  it('an edit before the feature that keeps the number of faces leaves the body the same object; a change of the placement decodes nothing', () => {
    const engine = newEngine();
    const first = ok(engine, { type: 'addMesh', id: 'box', mesh: BOX_STORED }, placedMesh('b', 'box'));
    const solid = first.evaluation.bodies.b.solid;
    const decoded = indexedMesh(first.document.meshes.box);
    const before = ok(engine, { type: 'addFeature', feature: { id: 'p', name: 'p', suppressed: false, type: 'plane', base: XY, offset: 3 }, index: 0 });
    expect(before.evaluation.bodies.b.solid).toBe(solid);
    const moved = ok(engine, { type: 'setField', feature: 'b', path: 'placement/z', value: 1 });
    expect(moved.evaluation.bodies.b.solid).not.toBe(solid);
    expect(indexedMesh(moved.document.meshes.box)).toBe(decoded);
    // back where it was: the solid kept for that placement
    expect(ok(engine, { type: 'updateFeature', id: 'b', patch: { placement: { z: null } } }).evaluation.bodies.b.solid).toBe(solid);
    // another feature in the place of a removed one with the same mesh and placement gets a solid of its own
    const other = ok(engine, { type: 'batch', commands: [{ type: 'removeFeature', id: 'b' }, placedMesh('c', 'box')] });
    expect(other.evaluation.bodies.c.solid).not.toBe(solid);
    expect(other.evaluation.faceNames[other.evaluation.bodies.c.faces[0].id]).toEqual({ feature: 'c', role: 'mesh' });
  });

  it('a frame on a face that is not planar is nonPlanarFace; on a plane feature it follows the plane', () => {
    const engine = newEngine();
    const state = ok(
      engine,
      { type: 'addMesh', id: 'box', mesh: BOX_STORED },
      placedMesh('a', 'box'),
      placedMesh('b', 'box', { frame: { kind: 'face', body: 'a', face: { feature: 'a', role: 'mesh' } } }),
      { type: 'addFeature', feature: { id: 'p', name: 'p', suppressed: false, type: 'plane', base: XY, offset: 7 } },
      placedMesh('c', 'box', { frame: { kind: 'plane', feature: 'p' } }),
    );
    expect(state.evaluation.features.b.error).toMatchObject({ code: 'nonPlanarFace', refs: [{ kind: 'face', body: 'a', face: { feature: 'a', role: 'mesh' } }] });
    expect(state.evaluation.bodies.c.bounds.min[2]).toBe(7);
    // a plane on the face of the mesh: the command is valid, the feature in error
    const plane = ok(engine, { type: 'addFeature', feature: { id: 'q', name: 'q', suppressed: false, type: 'plane', base: { kind: 'face', body: 'a', face: { feature: 'a', role: 'mesh' } }, offset: 0 } });
    expect(plane.evaluation.features.q.error?.code).toBe('nonPlanarFace');
  });

  it('a pattern of the body copies it with the face of the mesh and its copy tag; the copy is a copy of one shape', () => {
    const engine = newEngine();
    const state = ok(
      engine,
      { type: 'addMesh', id: 'box', mesh: BOX_STORED },
      placedMesh('a', 'box'),
      { type: 'addFeature', feature: { id: 'row', name: 'row', suppressed: false, type: 'pattern', source: { type: 'body', body: 'a' }, transform: { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 2, span: { type: 'spacing', spacing: 50 } } } },
    );
    const copy = state.evaluation.bodies['row/1'];
    expect(state.evaluation.faceNames[copy.faces[0].id]).toEqual({ feature: 'a', role: 'mesh', copy: [{ pattern: 'row', index: 1 }] });
    expect(state.evaluation.faceSurfaces[copy.faces[0].id]).toEqual({ kind: 'general' });
    expect(copy.bounds.min[0]).toBe(50);
  });

  it('applyTool refuses a target with a face of an imported mesh before it builds anything: importedTarget', () => {
    const engine = newEngine();
    ok(engine, { type: 'addMesh', id: 'box', mesh: BOX_STORED }, placedMesh('a', 'box'));
    const state = engine.getState().evaluation;
    const designed: Solid = { positions: Float32Array.from([0, 0, 0]), triangles: new Uint32Array(0), faceIds: new Uint32Array(0) };
    const model: Model = { bodies: { a: state.bodies.a.solid, plate: designed }, faceNames: state.faceNames, faceInfos: [{ planar: false, surface: 'mesh' }], faceIds: new Map() };
    let built = 0;
    const recipe: ToolRecipe = {
      operation: 'cut',
      targets: ['plate', 'a'],
      build: () => {
        built++;
        throw new Error('not built');
      },
    };
    expect(applyTool(recipe, model, {} as SolidKernel)).toEqual({ ok: false, code: 'importedTarget', refs: ['a'] });
    expect(built).toBe(0);
  });

  it('the result of the section: what a stored mesh is and what uses it, the same object while nothing changes', () => {
    const engine = newEngine();
    const first = ok(engine, { type: 'addMesh', id: 'box', mesh: BOX_STORED }, { type: 'addMesh', id: 'spare', mesh: TETRA_STORED }, placedMesh('a', 'box'), placedMesh('b', 'box'));
    expect(first.evaluation.meshes.box.usedBy).toEqual(['a', 'b']);
    expect(first.evaluation.meshes.spare).toMatchObject({ name: 'tetra.stl', usedBy: [], shells: 1 });
    const again = ok(engine, { type: 'renameFeature', id: 'a', name: 'other' });
    expect(again.evaluation.meshes.box).toBe(first.evaluation.meshes.box);
  });

  it('save and load: the section in the file, undo across addMesh', () => {
    const engine = newEngine();
    ok(engine, { type: 'addMesh', id: 'box', mesh: BOX_STORED }, placedMesh('a', 'box'));
    const saved = JSON.parse(engine.save());
    expect(saved.meshes).toEqual({ box: BOX_STORED });
    // the branch d36/2h: version 9 with its pending step; the merge makes it version 10 without names
    expect([saved.schemaVersion, saved.schemaSteps]).toEqual([9, ['2h-extent-start']]);
    engine.undo();
    expect(engine.getState().document.meshes).toEqual({});
    engine.redo();
    expect(engine.getState().evaluation.bodies.a.volume).toBeCloseTo(6000, 9);
    const other = newEngine();
    expect(other.load(JSON.stringify(saved)).ok).toBe(true);
    expect(other.save()).toBe(engine.save());
  });
});
