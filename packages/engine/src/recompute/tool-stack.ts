// The tool of an extrusion whose outline changes along the normal (a taper, D45), and of a hole
// (D46): a stack of rings, each the outline at one level, with side triangles between neighbouring
// rings, in sections with planar steps between them. The prism of tool-prism.ts stays the tool of
// an extrusion without a taper.
import type { Region } from '../sketch';
import { type FaceInfo, type RigidTransform, toWorld, transformFace } from '../solid';
import type { FaceName, Frame, Id, SolidKernel } from '../types';
import type { BuiltTool, FaceRole } from './state';

// A level along the normal of the sketch plane (`w`, measured from the plane) and the outline there,
// divided into polylines.
export interface Ring {
  w: number;
  regions: Region[];
}
// Rings of one outline from the start of the extent to its end: the same regions, loops and number
// of points in every ring, in the same order, so that rings pair point by point. `sideOf` gives the
// face of the sides of a key of `Loop.curves`, its surface in the coordinates of the sketch (x and
// y in the plane, z along its normal).
// Sections follow each other along the normal (the stack of a hole, D46). Where a section starts
// in the outline the one before it ends in, the two share that ring and `step` is absent. Where it
// starts at the same level in another outline, `step` names the planar face between the two (the
// seat of a hole); the two rings have the same number of regions, without holes, each region of
// one inside the region of the other with the same index.
export interface Section {
  rings: Ring[];
  sideOf(key: string): { name: FaceRole; info: FaceInfo };
  step?: FaceRole;
}

// Builds the closed mesh of a stack of sections placed in `frame`: the cap at the first ring
// (`startCap`, the start of the extent) and at the last (`endCap`), each triangulated by the kernel
// on its own (the triangulation of one is not valid for the other once the outline has moved), two
// triangles for every edge of a loop between two neighbouring rings of a section, with the face of
// the curve the edge belongs to, and the planar steps between sections, triangulated by the kernel
// as a region with the narrower outline as its hole. The faces are the caps, then the steps (a name
// given twice is one face), then the sides in the order of their keys.
// The winding follows the direction of the rings along the normal, which is the same in every
// section. Like the prism, the build assumes a right-handed frame; in a mirrored one the solid
// comes out turned inside out.
// `triangulation`: a cache of the cap triangulations by region, shared by the builds of copies;
// `steps`: the same for the steps, by the region of the ring after the step.
export function buildStack(feature: Id, sections: Section | readonly Section[], frame: Frame, firstFaceId: number, kernel: SolidKernel, triangulation?: Map<Region, Uint32Array>, steps?: Map<Region, Uint32Array>): BuiltTool {
  const list: readonly Section[] = Array.isArray(sections) ? sections : [sections as Section];
  const loopsOf = (ring: Ring) => ring.regions.flatMap((region) => [region.outer, ...region.holes]);
  const countOf = (ring: Ring) => loopsOf(ring).reduce((sum, loop) => sum + loop.xy.length / 2, 0);
  for (const section of list) {
    if (section.rings.length < 2) throw new Error('buildStack: a section needs two rings');
    const loops = loopsOf(section.rings[0]);
    for (const ring of section.rings) {
      const counts = loopsOf(ring).map((loop) => loop.xy.length / 2);
      if (counts.length !== loops.length || counts.some((count, i) => count !== loops[i].xy.length / 2)) throw new Error('buildStack: the rings of a section differ in their loops');
    }
  }
  // the rings of the whole stack in their order, a ring two sections share once
  const sameOutline = (a: Ring, b: Ring): boolean => {
    const [la, lb] = [loopsOf(a), loopsOf(b)];
    return a.w === b.w && la.length === lb.length && la.every((loop, i) => loop.xy.length === lb[i].xy.length && loop.xy.every((value, k) => value === lb[i].xy[k]));
  };
  const rings: Ring[] = [];
  const ringsOf: number[][] = [];
  const stepBefore: (FaceRole | undefined)[] = [];
  list.forEach((section, s) => {
    const [first, ...rest] = section.rings;
    const previous = rings[rings.length - 1];
    if (s > 0 && section.step === undefined) {
      if (!sameOutline(previous, first)) throw new Error('buildStack: sections that meet in different outlines need a step');
      ringsOf.push([rings.length - 1, ...rest.map((ring) => rings.push(ring) - 1)]);
    } else {
      if (s > 0 && first.w !== previous.w) throw new Error('buildStack: a step lies at one level');
      ringsOf.push([first, ...rest].map((ring) => rings.push(ring) - 1));
    }
    stepBefore.push(s > 0 ? section.step : undefined);
  });
  const ringStart: number[] = [];
  let total = 0;
  for (const ring of rings) {
    ringStart.push(total);
    total += countOf(ring);
  }
  const positions = new Float32Array(3 * total);
  rings.forEach((ring, r) => {
    let at = ringStart[r];
    for (const loop of loopsOf(ring)) for (let k = 0; k < loop.xy.length; k += 2) positions.set(toWorld(frame, loop.xy[k], loop.xy[k + 1], ring.w), 3 * at++);
  });

  // the faces: the two caps, the steps, then the sides by key
  const local: RigidTransform = { matrix: [[frame.x[0], frame.y[0], frame.normal[0]], [frame.x[1], frame.y[1], frame.normal[1]], [frame.x[2], frame.y[2], frame.normal[2]]], translation: frame.origin };
  const [first, last] = [rings[0], rings[rings.length - 1]];
  const planeAt = (w: number): FaceInfo => ({ planar: true, origin: toWorld(frame, 0, 0, w), y: frame.y, normal: frame.normal });
  const faces: BuiltTool['faces'] = [
    { name: { feature, role: 'startCap' }, info: planeAt(first.w) },
    { name: { feature, role: 'endCap' }, info: planeAt(last.w) },
  ];
  const faceOf = new Map<string, number>(); // the key of a step's name → its face
  const stepId = stepBefore.map((name, s) => {
    if (name === undefined) return -1;
    const key = JSON.stringify(name);
    if (!faceOf.has(key)) {
      faceOf.set(key, firstFaceId + faces.length);
      faces.push({ name: { feature, ...name } as FaceName, info: planeAt(rings[ringsOf[s][0]].w) });
    }
    return faceOf.get(key) as number;
  });
  const sideId = new Map<string, number>();
  const sideSection = new Map<string, Section>();
  for (const section of list) for (const loop of loopsOf(section.rings[0])) for (const key of loop.curves) if (!sideSection.has(key)) sideSection.set(key, section);
  for (const key of [...sideSection.keys()].sort()) {
    sideId.set(key, firstFaceId + faces.length);
    const { name, info } = (sideSection.get(key) as Section).sideOf(key);
    faces.push({ name: { feature, ...name } as FaceName, info: transformFace(local, info) });
  }

  // Seen from the side the normal points to, a triangulation of the kernel and every loop run
  // counter-clockwise around the material. With the rings going up the normal, the first cap faces
  // down and the sides as built face out; going down, everything turns.
  const up = last.w > first.w;
  const out: number[] = [];
  const ids: number[] = [];
  const triangle = (a: number, b: number, c: number, face: number, flip: boolean): void => {
    out.push(...(flip ? [a, c, b] : [a, b, c]));
    ids.push(face);
  };
  const cap = (ring: number, face: number, flip: boolean): void => {
    let at = ringStart[ring];
    for (const region of rings[ring].regions) {
      const regionLoops = [region.outer, ...region.holes];
      const flat = triangulation?.get(region) ?? kernel.triangulate(regionLoops.map((loop) => Float64Array.from(loop.xy)));
      triangulation?.set(region, flat);
      for (let t = 0; t < flat.length; t += 3) triangle(at + flat[t], at + flat[t + 1], at + flat[t + 2], face, flip);
      at += regionLoops.reduce((sum, loop) => sum + loop.xy.length / 2, 0);
    }
  };
  cap(0, firstFaceId, up);
  cap(rings.length - 1, firstFaceId + 1, !up);
  list.forEach((section, s) => {
    const own = ringsOf[s];
    const loops = loopsOf(section.rings[0]);
    for (let r = 0; r + 1 < own.length; r++) {
      let start = 0;
      for (const loop of loops) {
        const count = loop.xy.length / 2;
        for (let k = 0; k < count; k++) {
          const [p, p1] = [ringStart[own[r]] + start + k, ringStart[own[r]] + start + ((k + 1) % count)];
          const [q, q1] = [ringStart[own[r + 1]] + start + k, ringStart[own[r + 1]] + start + ((k + 1) % count)];
          const face = sideId.get(loop.curves[k]) as number;
          triangle(p, p1, q1, face, !up);
          triangle(p, q1, q, face, !up);
        }
        start += count;
      }
    }
    if (stepId[s] >= 0) step(ringsOf[s - 1][ringsOf[s - 1].length - 1], own[0], stepId[s]);
  });

  // A step between the ring `before` and the ring `after`, region by region: the wider outer loop
  // with the narrower one as its hole. Where the section before is the wider, the step faces along
  // the direction of the rings; otherwise against it.
  function step(before: number, after: number, face: number): void {
    const [a, b] = [rings[before], rings[after]];
    if (a.regions.length !== b.regions.length || [...a.regions, ...b.regions].some((region) => region.holes.length > 0)) throw new Error('buildStack: a step pairs regions without holes');
    const area = (xy: number[]): number => {
      let sum = 0;
      for (let k = 0; k < xy.length; k += 2) sum += xy[k] * xy[(k + 3) % xy.length] - xy[(k + 2) % xy.length] * xy[k + 1];
      return Math.abs(sum) / 2;
    };
    let [atA, atB] = [ringStart[before], ringStart[after]];
    a.regions.forEach((regionA, j) => {
      const regionB = b.regions[j];
      const wider = area(regionA.outer.xy) > area(regionB.outer.xy);
      const [outer, inner, outerAt, innerAt] = wider ? [regionA.outer, regionB.outer, atA, atB] : [regionB.outer, regionA.outer, atB, atA];
      const [no, ni] = [outer.xy.length / 2, inner.xy.length / 2];
      const reversed: number[] = [];
      for (let k = ni - 1; k >= 0; k--) reversed.push(inner.xy[2 * k], inner.xy[2 * k + 1]);
      const flat = steps?.get(regionB) ?? kernel.triangulate([Float64Array.from(outer.xy), Float64Array.from(reversed)]);
      steps?.set(regionB, flat);
      const vertex = (i: number): number => (i < no ? outerAt + i : innerAt + (ni - 1 - (i - no)));
      for (let t = 0; t < flat.length; t += 3) triangle(vertex(flat[t]), vertex(flat[t + 1]), vertex(flat[t + 2]), face, wider ? !up : up);
      atA += regionA.outer.xy.length / 2;
      atB += regionB.outer.xy.length / 2;
    });
  }
  return { solid: { positions, triangles: Uint32Array.from(out), faceIds: Uint32Array.from(ids) }, faces };
}
