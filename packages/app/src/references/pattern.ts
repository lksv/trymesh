// The row of a mirror or a pattern of the sketch (D68): derived geometry, its copies computed after
// the sketch is solved.
import type { SketchPattern } from '@trymesh/engine';
import type { ReferenceUi } from './spec';

const TITLES = { mirror: 'Mirror', linear: 'Linear pattern', circular: 'Circular pattern' } as const;

export const pattern: ReferenceUi<SketchPattern> = {
  title: (ref) => (ref.transform.type === 'linear' && ref.transform.second ? 'Grid' : TITLES[ref.transform.type]),
  detail: (ref) => {
    const t = ref.transform;
    const sources = `${ref.sources.length} ${ref.sources.length === 1 ? 'source' : 'sources'}`;
    switch (t.type) {
      case 'mirror':
        return `${sources} about ${t.axis}`;
      case 'linear':
        return `${sources}, ${t.count} along ${t.direction}${t.second ? ` × ${t.second.count} along ${t.second.direction}` : ''}`;
      case 'circular':
        return `${sources}, ${t.count} about ${t.center}`;
    }
  },
  tag: 'copy',
};
