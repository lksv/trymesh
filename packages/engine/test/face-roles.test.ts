// The catalog of face roles (D37): the validator of a face name, the key of a face and the parts
// of a label are built from it.
import { describe, expect, it } from 'vitest';
import { FACE_ROLES, type RoleCatalog, faceKey, facePartNames, faceParts } from '../src/face-roles';
import type { FaceName } from '../src/types';
import { canonicalEdge, edgeKey } from '../src/util';
import { CommandError, edgeName, faceName } from '../src/validation';

// A catalog with a role no feature has yet: the wall of a stepped hole, told apart by the point
// the hole stands on and the number of its step.
const WITH_WALL: RoleCatalog = { ...FACE_ROLES, wall: { title: 'wall of a hole', parts: { step: { title: 'step', kind: 'integer' }, point: { title: 'point', kind: 'text' } } } };
const wall = (extra: object = {}) => ({ feature: 'H', role: 'wall', point: 'p1', step: 2, ...extra });
const refused = (run: () => unknown, message: RegExp) => {
  expect(run).toThrow(CommandError);
  expect(run).toThrow(message);
};

describe('roles of faces', () => {
  it('the roles of an extrusion and of a hole, in the order they are listed to a client', () => {
    expect(Object.keys(FACE_ROLES)).toEqual(['side', 'startCap', 'endCap', 'wallSide', 'wallEnd', 'holeBore', 'holeHead', 'holeFlat', 'holeSeat', 'mesh']);
    expect(Object.fromEntries(Object.entries(FACE_ROLES).map(([role, spec]) => [role, Object.keys(spec.parts)]))).toEqual({
      side: ['curve'],
      startCap: [],
      endCap: [],
      wallSide: ['curve', 'side'],
      wallEnd: ['point'],
      holeBore: ['point'],
      holeHead: ['point'],
      holeFlat: ['point', 'flat'],
      holeSeat: [],
      mesh: [],
    });
  });

  it('a text part holds any ID a sketch can have, a derived one with its slash included; the key stays unambiguous', () => {
    // the centre of a projected circle as the point of a hole (D46 asks for own points, but the name itself is valid)
    const bore: FaceName = { feature: 'H', role: 'holeBore', point: 'rim/center' };
    expect(faceName(bore, 'face')).toEqual(bore);
    expect(faceKey(bore)).toBe('H/holeBore/rim/center');
    // a flat: the whole number first (alphabetical), then the free ID, which is the only free part of the role
    const flat: FaceName = { feature: 'H', role: 'holeFlat', point: 'rim/center', flat: 2 };
    expect(faceKey(flat)).toBe('H/holeFlat/2/rim/center');
    expect(faceKey({ ...flat, flat: 1 })).not.toBe(faceKey(flat));
    expect(faceKey({ feature: 'H', role: 'holeSeat', copy: [{ pattern: 'P', index: 1 }] })).toBe('H/holeSeat/@P:1');
    // every role has at most one part that holds a free ID: the others are whole numbers or from a closed set
    const free = (role: string): string[] => Object.entries(FACE_ROLES[role as keyof typeof FACE_ROLES].parts).flatMap(([part, spec]) => (spec.kind === 'text' && !(role === 'wallSide' && part === 'side') ? [part] : []));
    for (const role of Object.keys(FACE_ROLES)) expect(free(role).length, role).toBeLessThanOrEqual(1);
  });

  it('the key of a face keeps its form for the roles of an extrusion', () => {
    expect(faceKey({ feature: 'E1', role: 'side', curve: 'l3' })).toBe('E1/side/l3');
    expect(faceKey({ feature: 'E1', role: 'startCap' })).toBe('E1/startCap');
    expect(faceKey({ feature: 'E1', role: 'endCap', copy: [{ pattern: 'P', index: 2 }] })).toBe('E1/endCap/@P:2');
    expect(faceKey({ feature: 'E1', role: 'side', curve: 'teeth', copy: [{ pattern: 'P', index: 1 }, { pattern: 'Q', index: 3 }] })).toBe('E1/side/teeth/@P:1/@Q:3');
    expect(faceParts({ feature: 'E1', role: 'side', curve: 'l3' })).toEqual(['l3']);
    expect(faceParts({ feature: 'E1', role: 'endCap' })).toEqual([]);
  });

  it('the order of edges follows the keys', () => {
    const [cap, side]: FaceName[] = [{ feature: 'E1', role: 'endCap' }, { feature: 'E1', role: 'side', curve: 'l1' }];
    expect(canonicalEdge({ a: side, b: cap })).toEqual({ a: cap, b: side });
    expect(edgeKey({ a: side, b: cap })).toBe('E1/endCap|E1/side/l1');
  });

  it('a face name is validated by the entry of its role', () => {
    expect(faceName({ feature: 'E1', role: 'side', curve: 'l1', extra: 1 }, 'face')).toEqual({ feature: 'E1', role: 'side', curve: 'l1' });
    expect(Object.keys(faceName({ curve: 'l1', role: 'side', feature: 'E1' }, 'face'))).toEqual(['feature', 'role', 'curve']); // the canonical order
    expect(faceName({ feature: 'E1', role: 'endCap', curve: 'l1' }, 'face')).toEqual({ feature: 'E1', role: 'endCap' }); // a cap has no curve
    expect(faceName({ feature: 'E1', role: 'endCap', copy: [] }, 'face')).toEqual({ feature: 'E1', role: 'endCap' });
    refused(() => faceName({ feature: 'E1', role: 'side' }, 'face'), /face\.curve: čeká se řetězec/);
    refused(() => faceName({ feature: 'E1', role: 'side', curve: 3 }, 'face'), /face\.curve: čeká se řetězec/);
    refused(() => faceName({ feature: 'E1', role: 'top' }, 'face'), /face\.role: čeká se jedna z hodnot side, startCap, endCap/);
    refused(() => faceName({ feature: 'E1', role: 'constructor' }, 'face'), /face\.role/);
    refused(() => edgeName({ a: { feature: 'E1', role: 'endCap' }, b: { feature: 'E1', role: 'endCap' } }, 'edge'), /hrana je rozhraní dvou různých stěn/);
  });

  it('a role with several fields: every field is required and of its kind, and the key lists them by name', () => {
    expect(facePartNames('wall', WITH_WALL)).toEqual(['point', 'step']); // alphabetical, not the order of the entry
    expect(faceName(wall(), 'face', WITH_WALL)).toEqual(wall());
    expect(faceKey(wall() as unknown as FaceName, WITH_WALL)).toBe('H/wall/p1/2');
    expect(faceKey(wall({ copy: [{ pattern: 'P', index: 1 }] }) as unknown as FaceName, WITH_WALL)).toBe('H/wall/p1/2/@P:1');
    // two walls of one hole differ by the step, two holes of one feature by the point
    expect(faceKey(wall({ step: 1 }) as unknown as FaceName, WITH_WALL)).not.toBe(faceKey(wall() as unknown as FaceName, WITH_WALL));
    refused(() => faceName(wall({ step: '2' }), 'face', WITH_WALL), /face\.step: čeká se konečné číslo/);
    refused(() => faceName(wall({ step: 2.5 }), 'face', WITH_WALL), /face\.step: a whole number is expected/);
    refused(() => faceName(wall({ step: undefined }), 'face', WITH_WALL), /face\.step/);
    refused(() => faceName(wall({ point: 7 }), 'face', WITH_WALL), /face\.point: čeká se řetězec/);
    refused(() => faceName(wall(), 'face'), /face\.role: čeká se jedna z hodnot side, startCap, endCap/); // the real catalog has no wall
    // a role the catalog does not know has no fields in a key; it cannot come from a validated name
    expect(faceKey(wall() as unknown as FaceName)).toBe('H/wall');
  });
});
