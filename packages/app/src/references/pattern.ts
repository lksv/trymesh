// The row of a mirror or a pattern of the sketch (D68): derived geometry, its copies computed after
// the sketch is solved. Its form is data (the controls by the path of their field in the input
// form); picking the axis, the direction or the centre again is the tool of its transform.
import { PATTERN_ANGLE, PATTERN_COUNT, PATTERN_LENGTH, PATTERN_SPACING, type SketchPattern, type SketchTransform } from '@trymesh/engine';
import { unreachable } from '../sketch-view';
import type { EntryControl, ReferenceUi } from './spec';

const TITLES = { mirror: 'Mirror', linear: 'Linear pattern', circular: 'Circular pattern' } as const;
const mm = (value: number | string): string => (typeof value === 'number' ? `${Math.round(value * 1e4) / 1e4} mm` : value);
const degrees = (value: number | string): string => (typeof value === 'number' ? `${Math.round(((value * 180) / Math.PI) * 1e4) / 1e4}°` : value);

// A new transform of a kind, keeping the line or the point of the one before where it fits.
export function newTransform(kind: SketchTransform['type'], before: SketchTransform): SketchTransform {
  const line = before.type === 'mirror' ? before.axis : before.type === 'linear' ? before.direction : 'origin/x';
  switch (kind) {
    case 'mirror':
      return { type: 'mirror', axis: line };
    case 'linear':
      return { type: 'linear', direction: line, count: 3, span: { type: 'spacing', spacing: 10 } };
    case 'circular':
      return { type: 'circular', center: before.type === 'circular' ? before.center : 'origin', count: 3, span: { type: 'full' } };
    default:
      return unreachable(kind, 'transform');
  }
}

// The fields of one direction of a linear pattern (the first at `transform`, the second at
// `transform/second`).
const direction = (path: string, span: { type: 'spacing' | 'length' }, second: boolean): EntryControl[] => [
  { kind: 'entity', path: `${path}/direction`, title: second ? 'Second: direction' : 'Direction', entity: 'line' },
  { kind: 'number', path: `${path}/count`, title: second ? 'Second: count' : 'Count', spec: PATTERN_COUNT },
  {
    kind: 'choice',
    path: `${path}/span/type`,
    title: second ? 'Second: span' : 'Span',
    options: [
      { value: 'spacing', label: 'Spacing' },
      { value: 'length', label: 'Length' },
    ],
    set: (input, value) => withSpan(input, path, value === 'length' ? { type: 'length', length: 20 } : { type: 'spacing', spacing: 10 }),
  },
  span.type === 'spacing' ? { kind: 'number', path: `${path}/span/spacing`, title: second ? 'Second: spacing' : 'Spacing', spec: PATTERN_SPACING } : { kind: 'number', path: `${path}/span/length`, title: second ? 'Second: length' : 'Length', spec: PATTERN_LENGTH },
];
const withSpan = (input: unknown, path: string, span: unknown): unknown => {
  const keys = path.split('/');
  const set = (value: unknown, i: number): unknown => (i === keys.length ? { ...(value as object), span } : { ...(value as object), [keys[i]]: set((value as Record<string, unknown>)[keys[i]], i + 1) });
  return set(input, 0);
};

export const pattern: ReferenceUi<SketchPattern> = {
  title: (ref) => (ref.transform.type === 'linear' && ref.transform.second ? 'Grid' : TITLES[ref.transform.type]),
  detail: (ref) => {
    const t = ref.transform;
    const sources = `${ref.sources.length} ${ref.sources.length === 1 ? 'source' : 'sources'}`;
    switch (t.type) {
      case 'mirror':
        return `${sources} about ${t.axis}`;
      case 'linear': {
        const along = (count: number, line: string, span: typeof t.span): string => `${count} along ${line}, ${span.type === 'spacing' ? mm(span.spacing) : `${mm(span.length)} in all`}`;
        return `${sources}, ${along(t.count, t.direction, t.span)}${t.second ? ` × ${along(t.second.count, t.second.direction, t.second.span)}` : ''}`;
      }
      case 'circular':
        return `${sources}, ${t.count} about ${t.center}${t.span.type === 'angle' ? `, ${degrees(t.span.angle)}` : ''}`;
      default:
        return unreachable(t, 'transform');
    }
  },
  tag: 'copy',
  repair: (ref) => {
    const t = ref.transform;
    switch (t.type) {
      case 'mirror':
        return { title: 'Pick the axis again in the view', tool: 'mirror', hint: 'Click the line the copies are mirrored about (Esc cancels).' };
      case 'linear':
        return { title: 'Pick the direction again in the view', tool: 'linearPattern', hint: 'Click the line the copies are shifted along (Esc cancels).' };
      case 'circular':
        return { title: 'Pick the centre again in the view', tool: 'circularPattern', hint: 'Click the point the copies are turned about (Esc cancels).' };
      default:
        return unreachable(t, 'transform');
    }
  },
  form: (input) => {
    const t = input.transform;
    const kind: EntryControl = {
      kind: 'choice',
      path: 'transform/type',
      title: 'Kind',
      options: Object.entries(TITLES).map(([value, label]) => ({ value, label })),
      set: (form, value) => ({ ...(form as SketchPattern), transform: newTransform(value as SketchTransform['type'], (form as SketchPattern).transform) }),
    };
    const sources: EntryControl = { kind: 'sources', path: 'sources', title: 'Sources' };
    switch (t.type) {
      case 'mirror':
        return [sources, kind, { kind: 'entity', path: 'transform/axis', title: 'Axis', entity: 'line' }];
      case 'linear':
        return [
          sources,
          kind,
          ...direction('transform', t.span, false),
          { kind: 'switch', path: 'transform/second', title: 'Second direction', on: { direction: t.direction === 'origin/y' ? 'origin/x' : 'origin/y', count: 2, span: { type: 'spacing', spacing: 10 } } },
          ...(t.second ? direction('transform/second', t.second.span, true) : []),
        ];
      case 'circular':
        return [
          sources,
          kind,
          { kind: 'entity', path: 'transform/center', title: 'Centre', entity: 'point' },
          { kind: 'number', path: 'transform/count', title: 'Count', spec: PATTERN_COUNT },
          {
            kind: 'choice',
            path: 'transform/span/type',
            title: 'Span',
            options: [
              { value: 'full', label: 'Full turn' },
              { value: 'angle', label: 'Angle' },
            ],
            set: (form, value) => withSpan(form, 'transform', value === 'angle' ? { type: 'angle', angle: Math.PI / 2 } : { type: 'full' }),
          },
          ...(t.span.type === 'angle' ? [{ kind: 'number', path: 'transform/span/angle', title: 'Angle', spec: PATTERN_ANGLE } as const] : []),
        ];
      default:
        return unreachable(t, 'transform');
    }
  },
};
