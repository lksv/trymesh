// The row of the projection of an edge: a line or a circle of a body, repaired by the tool Project.
import type { EdgeProjection } from '@trymesh/engine';
import type { ReferenceUi } from './spec';

export const edge: ReferenceUi<EdgeProjection> = {
  title: (ref) => (ref.kind === 'line' ? 'Úsečka' : 'Kružnice'),
  detail: (ref, host) => host.bodyName(ref.body),
  tag: 'projected',
  repair: () => ({
    title: 'Promítnout znovu: klikněte potom na novou hranu tělesa',
    tool: 'project',
    hint: 'Klikněte na hranu, která má promítnutí nahradit (Esc ruší).',
  }),
};
