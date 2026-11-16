// The arm of validation scenario 13 (docs/d36/5a-mechanism/calls.ts): every shape a cylinder
// along Z from a circle of its own sketch on XY (mm); see scenario13.test.ts for the bodies.
// Shared with the tests of the second opinion of the kernel (D50), which vary the radius of the
// pin of the elbow and of its hole.
import { type Command, type Id, emptySketch } from '@trymesh/engine';

const sketch = (id: Id): Command => ({ type: 'addFeature', feature: emptySketch(id, id, { kind: 'base', plane: 'XY' }) });
const fixedPoint = (sketchId: Id, point: Id, x: number, y: number): Command[] => [
  { type: 'addPoint', sketch: sketchId, id: point, x, y },
  { type: 'addConstraint', sketch: sketchId, id: `${point}Fix`, constraint: { type: 'fixed', point, x, y } },
];
// A cylinder: the feature `id` from the circle of its own sketch `<id>Sketch`, whose centre is the
// point `<id>Centre`. With a target it is added to that body or cut from it.
export function cylinder(id: Id, x: number, y: number, radius: number, from: number, to: number, operation: 'new' | 'add' | 'cut' = 'new', target?: Id): Command[] {
  const [sketchId, circle] = [`${id}Sketch`, `${id}Circle`];
  return [
    sketch(sketchId),
    ...fixedPoint(sketchId, `${id}Centre`, x, y),
    { type: 'addCurve', sketch: sketchId, id: circle, curve: { type: 'circle', center: `${id}Centre` }, radius },
    { type: 'addConstraint', sketch: sketchId, id: `${id}Radius`, constraint: { type: 'radius', curve: circle, value: radius, driving: true } },
    {
      type: 'addFeature',
      feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: sketchId, regions: [{ outerLoop: [circle] }] }, extent: { type: 'distance', start: from, distance: to - from }, operation, ...(target === undefined ? {} : { targets: [target] }) },
    },
  ];
}
export const arm = ({ pin = 4, hole = pin }: { pin?: number; hole?: number } = {}): Command => ({
  type: 'batch',
  commands: [
    ...cylinder('base', 0, 0, 30, -10, 0),
    ...cylinder('shoulderPin', 0, 0, 4, -10, 8, 'add', 'base'),
    ...cylinder('upper', 60, 0, 70, 0, 8),
    ...cylinder('shoulderHole', 0, 0, 4, -1, 9, 'cut', 'upper'),
    ...cylinder('elbowHole', 120, 0, hole, -1, 9, 'cut', 'upper'),
    ...cylinder('forearm', 180, 0, 70, 8, 16),
    ...cylinder('elbowPin', 120, 0, pin, 0, 16, 'add', 'forearm'),
    sketch('layout'),
    ...fixedPoint('layout', 'shoulder', 0, 0),
    ...fixedPoint('layout', 'elbow', 120, 0),
    ...cylinder('motor', 60, 0, 14, 8, 38),
    ...cylinder('screw', 80, 0, 1.5, 8, 14),
    { type: 'addFeature', feature: { id: 'screws', name: 'Screws', suppressed: false, type: 'pattern', source: { type: 'body', body: 'screw' }, transform: { type: 'circular', axis: { kind: 'sketchPoint', sketch: 'motorSketch', point: 'motorCentre' }, count: 4, span: { type: 'full' } } } },
  ],
});
