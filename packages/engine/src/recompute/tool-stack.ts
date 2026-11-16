// The tool of an extrusion whose outline changes along the normal (a taper, D45): a stack of rings,
// each the outline at one level, with side triangles between neighbouring rings. The prism of
// tool-prism.ts stays the tool of an extrusion without a taper.
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
export interface Section {
  rings: Ring[];
  sideOf(key: string): { name: FaceRole; info: FaceInfo };
}

// Builds the closed mesh of a section placed in `frame`: the cap at the first ring (`startCap`, the
// start of the extent) and at the last (`endCap`), each triangulated by the kernel on its own (the
// triangulation of one is not valid for the other once the outline has moved), and two triangles
// for every edge of a loop between two neighbouring rings, with the face of the curve the edge
// belongs to. Side faces are numbered after the caps in the order of their keys.
// The winding follows the direction of the rings along the normal. Like the prism, the build
// assumes a right-handed frame; in a mirrored one the solid comes out turned inside out.
// `triangulation`: a cache of the cap triangulations by region, shared by the builds of copies.
// (Several sections, with a planar step where two outlines differ, are for the hole of 2c.)
export function buildStack(feature: Id, section: Section, frame: Frame, firstFaceId: number, kernel: SolidKernel, triangulation?: Map<Region, Uint32Array>): BuiltTool {
  const { rings } = section;
  if (rings.length < 2) throw new Error('buildStack: a section needs two rings');
  const loopsOf = (ring: Ring) => ring.regions.flatMap((region) => [region.outer, ...region.holes]);
  const loops = loopsOf(rings[0]);
  const perRing = loops.reduce((sum, loop) => sum + loop.xy.length / 2, 0);
  for (const ring of rings) {
    const counts = loopsOf(ring).map((loop) => loop.xy.length / 2);
    if (counts.length !== loops.length || counts.some((count, i) => count !== loops[i].xy.length / 2)) throw new Error('buildStack: the rings of a section differ in their loops');
  }
  const positions = new Float32Array(3 * perRing * rings.length);
  rings.forEach((ring, r) => {
    let at = r * perRing;
    for (const loop of loopsOf(ring)) for (let k = 0; k < loop.xy.length; k += 2) positions.set(toWorld(frame, loop.xy[k], loop.xy[k + 1], ring.w), 3 * at++);
  });

  // the faces: the two caps, then the sides by key
  const local: RigidTransform = { matrix: [[frame.x[0], frame.y[0], frame.normal[0]], [frame.x[1], frame.y[1], frame.normal[1]], [frame.x[2], frame.y[2], frame.normal[2]]], translation: frame.origin };
  const [first, last] = [rings[0], rings[rings.length - 1]];
  const faces: BuiltTool['faces'] = [
    { name: { feature, role: 'startCap' }, info: { planar: true, origin: toWorld(frame, 0, 0, first.w), y: frame.y, normal: frame.normal } },
    { name: { feature, role: 'endCap' }, info: { planar: true, origin: toWorld(frame, 0, 0, last.w), y: frame.y, normal: frame.normal } },
  ];
  const sideId = new Map<string, number>();
  for (const key of [...new Set(loops.flatMap((loop) => loop.curves))].sort()) {
    sideId.set(key, firstFaceId + faces.length);
    const { name, info } = section.sideOf(key);
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
    let at = ring * perRing;
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
  for (let r = 0; r + 1 < rings.length; r++) {
    let start = 0;
    for (const loop of loops) {
      const count = loop.xy.length / 2;
      for (let k = 0; k < count; k++) {
        const [p, p1] = [r * perRing + start + k, r * perRing + start + ((k + 1) % count)];
        const [q, q1] = [p + perRing, p1 + perRing];
        const face = sideId.get(loop.curves[k]) as number;
        triangle(p, p1, q1, face, !up);
        triangle(p, q1, q, face, !up);
      }
      start += count;
    }
  }
  return { solid: { positions, triangles: Uint32Array.from(out), faceIds: Uint32Array.from(ids) }, faces };
}
