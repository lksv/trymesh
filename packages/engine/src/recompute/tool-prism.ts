// The tool of an extrusion without a taper: a prism over regions of a sketch plane.
import type { Region } from '../sketch';
import { toWorld } from '../solid';
import type { FaceName, Frame, Id, SolidKernel } from '../types';
import { cross3, sub3, unit3 } from '../util';
import type { BuiltTool, ResolvedProfile } from './state';

// Postaví uzavřenou síť nad vybranými oblastmi: dvě víka a boční stěny. Boční stěna vznikne jen
// z křivky na hranici právě jedné vybrané oblasti; křivka sdílená dvěma oblastmi se vyruší.
// `span` je rozsah podél normály roviny skici: [začátek, konec], měřeno od roviny skici. Víko
// startCap leží na začátku, endCap na konci.
// `triangulation`: a cache of the planar triangulation by region. A tool that is built again and
// again (for every copy of a pattern) passes the same map, so the profile is triangulated once.
export function buildPrism(feature: Id, regions: Region[], frame: Frame, span: [number, number], sideOf: ResolvedProfile['sideOf'], firstFaceId: number, kernel: SolidKernel, triangulation?: Map<Region, Uint32Array>): BuiltTool {
  const [start, end] = span;
  // 2D síť sjednocení oblastí. Vrcholy se sdílejí podle klíče, takže sousední oblasti na sebe navazují.
  const index = new Map<string, number>();
  const xy: number[] = [];
  const triangles: number[] = [];
  const curveAt = new Map<string, Id>(); // hrana (neorientovaná dvojice vrcholů) → křivka
  const pair = (i: number, j: number) => (i < j ? `${i}_${j}` : `${j}_${i}`);
  for (const region of regions) {
    const loops = [region.outer, ...region.holes];
    const local: number[] = [];
    for (const loop of loops) {
      const count = loop.keys.length;
      const ids = loop.keys.map((key, k) => {
        let i = index.get(key);
        if (i === undefined) {
          i = xy.length / 2;
          index.set(key, i);
          xy.push(loop.xy[2 * k], loop.xy[2 * k + 1]);
        }
        return i;
      });
      ids.forEach((i, k) => curveAt.set(pair(i, ids[(k + 1) % count]), loop.curves[k]));
      local.push(...ids);
    }
    const flat = triangulation?.get(region) ?? kernel.triangulate(loops.map((loop) => Float64Array.from(loop.xy)));
    triangulation?.set(region, flat);
    for (const i of flat) triangles.push(local[i]);
  }

  // Kde se oblast dotýká sama sebe nebo jiné vybrané oblasti jen v bodě, by svislá hrana nesla čtyři
  // boční stěny. Vrchol se proto zdvojí: každý vějíř trojúhelníků kolem něj dostane vlastní.
  const original: number[] = Array.from({ length: xy.length / 2 }, (_, i) => i);
  const count = triangles.length / 3;
  const around = new Map<number, number[]>();
  for (let t = 0; t < count; t++) for (let k = 0; k < 3; k++) around.set(triangles[3 * t + k], [...(around.get(triangles[3 * t + k]) ?? []), t]);
  for (const [v, list] of around) {
    const group = new Map<number, number>(list.map((t) => [t, t]));
    const root = (t: number): number => {
      while (group.get(t) !== t) t = group.get(t) as number;
      return t;
    };
    const byNeighbour = new Map<number, number[]>(); // druhý vrchol hrany → trojúhelníky vějíře
    for (const t of list) for (let k = 0; k < 3; k++) if (triangles[3 * t + k] !== v) byNeighbour.set(triangles[3 * t + k], [...(byNeighbour.get(triangles[3 * t + k]) ?? []), t]);
    for (const shared of byNeighbour.values()) if (shared.length === 2) group.set(root(shared[0]), root(shared[1]));
    const fans = [...new Set(list.map(root))];
    for (const fan of fans.slice(1)) {
      const copy = xy.length / 2;
      xy.push(xy[2 * v], xy[2 * v + 1]);
      original.push(original[v]);
      for (const t of list) if (root(t) === fan) for (let k = 0; k < 3; k++) if (triangles[3 * t + k] === v) triangles[3 * t + k] = copy;
    }
  }

  // Stěny: víka a boky. Boční stěny podle křivek, v pořadí ID křivky.
  const directed = new Set<string>();
  for (let t = 0; t < count; t++) for (let k = 0; k < 3; k++) directed.add(`${triangles[3 * t + k]}>${triangles[3 * t + ((k + 1) % 3)]}`);
  const boundary: [number, number, Id][] = [];
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const [i, j] = [triangles[3 * t + k], triangles[3 * t + ((k + 1) % 3)]];
      if (directed.has(`${j}>${i}`)) continue;
      const curve = curveAt.get(pair(original[i], original[j]));
      if (curve === undefined) throw new Error('extrude: hrana obrysu bez křivky');
      boundary.push([i, j, curve]);
    }
  }
  const faces: BuiltTool['faces'] = [
    { name: { feature, role: 'startCap' }, info: { planar: true, origin: toWorld(frame, 0, 0, start), y: frame.y, normal: frame.normal } },
    { name: { feature, role: 'endCap' }, info: { planar: true, origin: toWorld(frame, 0, 0, end), y: frame.y, normal: frame.normal } },
  ];
  const sideId = new Map<Id, number>();
  for (const curve of [...new Set(boundary.map((edge) => edge[2]))].sort()) {
    sideId.set(curve, firstFaceId + faces.length);
    const { name: role, shape } = sideOf(curve);
    const name = { feature, ...role } as FaceName;
    if (shape.type === 'line') {
      const direction = sub3(toWorld(frame, shape.b[0], shape.b[1]), toWorld(frame, shape.a[0], shape.a[1]));
      faces.push({ name, info: { planar: true, origin: toWorld(frame, shape.a[0], shape.a[1]), y: frame.normal, normal: unit3(cross3(direction, frame.normal)) } });
    } else if (shape.type === 'round') {
      faces.push({ name, info: { planar: false, surface: 'cylinder', center: toWorld(frame, shape.center[0], shape.center[1]), axis: frame.normal, radius: shape.radius } });
    } else {
      faces.push({ name, info: { planar: false, surface: 'swept', axis: frame.normal } });
    }
  }

  // 3D síť: spodní a horní hladina podle normály roviny skici; startCap je víko na začátku rozsahu.
  const n = xy.length / 2;
  const [low, high] = [Math.min(start, end), Math.max(start, end)];
  const positions = new Float32Array(6 * n);
  for (let i = 0; i < n; i++) {
    positions.set(toWorld(frame, xy[2 * i], xy[2 * i + 1], low), 3 * i);
    positions.set(toWorld(frame, xy[2 * i], xy[2 * i + 1], high), 3 * (n + i));
  }
  const [lowId, highId] = end > start ? [firstFaceId, firstFaceId + 1] : [firstFaceId + 1, firstFaceId];
  const out: number[] = [];
  const ids: number[] = [];
  for (let t = 0; t < count; t++) {
    const [a, b, c] = [triangles[3 * t], triangles[3 * t + 1], triangles[3 * t + 2]];
    out.push(a, c, b, n + a, n + b, n + c);
    ids.push(lowId, highId);
  }
  for (const [i, j, curve] of boundary) {
    out.push(i, j, n + j, i, n + j, n + i);
    ids.push(sideId.get(curve) as number, sideId.get(curve) as number);
  }
  return { solid: { positions, triangles: Uint32Array.from(out), faceIds: Uint32Array.from(ids) }, faces };
}
