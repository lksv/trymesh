// The row of the projection of an edge: a line or a circle of a body, repaired by the tool Project.
import type { EdgeProjection } from '@trymesh/engine';
import type { ReferenceUi } from './spec';

export const edge: ReferenceUi<EdgeProjection> = {
  title: (ref) => (ref.kind === 'line' ? 'Line' : 'Circle'),
  detail: (ref, host) => host.bodyName(ref.body),
  tag: 'projected',
  repair: () => ({
    title: 'Project again: then click the new edge of a body',
    tool: 'project',
    hint: 'Click the edge that replaces the source of the projection (Esc cancels).',
  }),
};
