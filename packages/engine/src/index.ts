export type * from './types';
export { createEngine } from './engine';
export {
  FEATURE_TYPE_INFO,
  type FeatureTypeInfo,
  type FieldInfo,
  atPath,
  bodyOwner,
  constraintKey,
  constraintOperands,
  constraintPath,
  documentIds,
  duplicateOf,
  emptyDocument,
  emptySketch,
  featureInput,
  fieldsOf,
  isDimension,
  withPath,
} from './document';
export { generatorOf, producesTool } from './features/index';
export { FACE_ROLES, type FaceRoleSpec, faceKey, faceParts } from './face-roles';
export { CONSTRAINTS, type Bound, type ConstraintSpec, type EntityKind, type FieldSpec, type NumberSpec, type OperandSpec, type Unit, checkNumber, rangeText } from './catalog';
export { GENERATORS, type FlagSpec, type GeneratorSpec, type ParamSpec, isFlag } from './generators';
export { EXPRESSION_CONSTANTS, EXPRESSION_FUNCTIONS, EXPRESSION_SYNTAX, type ExprKind, analyzeExpression } from './expression';
export { INTERFERENCE_THRESHOLD, bodyFileName } from './interference';
export {
  type Anchor,
  MAX_POLYGON_SIDES,
  type NewId,
  type Placed,
  SKETCH_TOOLS,
  type SketchToolContext,
  type SketchToolInput,
  type SketchToolInputs,
  type SketchToolName,
  type SketchToolResult,
  type SketchToolSpec,
  anchorPosition,
  freshIds,
  placeAnchor,
  sketchTool,
} from './sketch-tools';
export type { Deps } from './evaluate';
