// The context a query runs in: one state of the model, read through the internal state of the
// recompute it came from.
import { axis as axisOf, frame as frameOf, lookup } from '../recompute/services';
import type { State } from '../recompute/state';
import { transformFrame, transformPoint, transformSurface, transformVector } from '../solid';
import type { Deflater, Document, Evaluation, SolidKernel, ThreadResult } from '../types';
import { faceNumber, has } from '../util';
import { poseOf } from './pose';
import { type QueryContext, QueryFailure, type RefProblem } from './spec';

// Results of queries kept for as long as all the objects they were computed from live. A result is
// reached through its owners one after another, each step a weak map, so it is dropped when any of
// them is. The owners are put in one order first (the order they were first seen in), so the same
// set gives the same result whatever order the caller names them in.
interface Node {
  next: WeakMap<object, Node>;
  values: Map<string, unknown>;
}
export class Memo {
  private readonly root: Node = { next: new WeakMap(), values: new Map() };
  private readonly order = new WeakMap<object, number>();
  private seen = 0;

  private rank(owner: object): number {
    let rank = this.order.get(owner);
    if (rank === undefined) this.order.set(owner, (rank = this.seen++));
    return rank;
  }

  get<T>(owners: readonly object[], key: string, compute: () => T): T {
    if (owners.length === 0) throw new Error('memo: at least one owner is needed');
    let node = this.root;
    for (const owner of [...new Set(owners)].sort((a, b) => this.rank(a) - this.rank(b))) {
      let next = node.next.get(owner);
      if (!next) node.next.set(owner, (next = { next: new WeakMap(), values: new Map() }));
      node = next;
    }
    if (!node.values.has(key)) node.values.set(key, compute());
    return node.values.get(key) as T;
  }
}

// The kernel as a query sees it: an exception becomes the answer `failed`, with the text of the
// kernel. (The port says that `boolean` throws when the result is not a closed body.)
function guarded(kernel: SolidKernel): SolidKernel {
  const failed = (error: unknown): never => {
    throw new QueryFailure('failed', error instanceof Error ? error.message : String(error));
  };
  return new Proxy(kernel, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver);
      if (typeof member !== 'function') return member;
      return (...args: unknown[]) => {
        try {
          return member.apply(target, args);
        } catch (error) {
          return failed(error);
        }
      };
    },
  });
}

// What the engine keeps with every evaluation it hands out.
export interface Internals {
  document: Document;
  state: State; // the state of the recompute the evaluation was made from
}

export interface ContextDeps {
  kernel: SolidKernel;
  deflater?: Deflater; // absent when the engine was created without one
  memo: Memo;
}

// The context of the query `name` over one state. `name` keeps the memoised results of different
// queries apart.
// - `geometry: 'modelled'`: the bodies as modelled, whatever the pose (an export, an entry of the
//   catalog that says so, a caller who asks for it). Otherwise what belongs to a body is in the pose
//   of the mechanism of the state (D49): `bodies`, `surface` and the frame of a face, each moved
//   when it is read; reading a body whose pose is not known (a joint on its way has no motion)
//   throws `QueryFailure('failed', …)` naming the joint.
export function queryContext(name: string, evaluation: Evaluation, internals: Internals, deps: ContextDeps, geometry?: 'modelled'): QueryContext {
  const { bodies: modelledBodies, faceSurfaces, threads: allThreads, ...modelled } = evaluation;
  const { state } = internals;
  const pose = geometry === 'modelled' ? undefined : poseOf(internals.document.mechanism, evaluation.mechanism, modelledBodies);
  const bodies = pose ? pose.bodies : modelledBodies;
  // the threads of a body, kept for the context: the same list for every call
  const byBody = new Map<string, ThreadResult[]>();
  const threadsOn = (body: string): ThreadResult[] => {
    let found = byBody.get(body);
    if (!found) byBody.set(body, (found = allThreads.filter((thread) => thread.bodies.includes(body))));
    return found;
  };
  const problem = (code: string, detail?: string): RefProblem => ({ problem: code === 'nonPlanarFace' || code === 'invalidAxis' ? code : 'brokenReference', ...(detail ? { detail } : {}) });
  return {
    state: { document: internals.document, evaluation: modelled },
    bodies,
    surface(body, face) {
      const number = faceNumber(state, face);
      if (number === undefined || !has(modelledBodies, body) || !modelledBodies[body].faces.some((own) => own.id === number)) return undefined;
      const moved = pose?.transformOf(body);
      return moved ? transformSurface(moved, faceSurfaces[number]) : faceSurfaces[number];
    },
    frame(ref) {
      const frame = frameOf(ref, state);
      if (typeof frame === 'string') return problem(frame);
      const moved = ref.kind === 'face' ? pose?.transformOf(ref.body) : undefined;
      return moved ? transformFrame(moved, frame) : frame;
    },
    // the axis of a round face moves with its body, as the frame of a face does (D60)
    axis(ref) {
      const line = axisOf(ref, state);
      if ('code' in line) return problem(line.code, line.detail);
      const moved = ref.kind === 'face' ? pose?.transformOf(ref.body) : undefined;
      return moved ? { origin: transformPoint(moved, line.point), direction: transformVector(moved, line.direction) } : { origin: line.point, direction: line.direction };
    },
    face: (name) => faceNumber(state, name),
    threadsAsModelled: (body) => threadsOn(body),
    threads(body) {
      const own = threadsOn(body);
      const moved = own.length ? pose?.transformOf(body) : undefined;
      return moved ? own.map((thread) => ({ ...thread, origin: transformPoint(moved, thread.origin), axis: transformVector(moved, thread.axis), zero: transformVector(moved, thread.zero) })) : [...own];
    },
    sketch: (id) => lookup(state.sketches, id),
    kernel: guarded(deps.kernel),
    // not wrapped: a format hands it to `zip`, which turns its failure into `failed`
    ...(deps.deflater ? { deflater: deps.deflater } : {}),
    memo: (owners, key, compute) => deps.memo.get(owners, `${name}\u0000${key}`, compute),
  };
}
