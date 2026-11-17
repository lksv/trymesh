export type * from './types';
export { type EngineDeps, createEngine } from './engine';
export {
  FEATURE_TYPE_INFO,
  type FeatureTypeInfo,
  type FieldInfo,
  atPath,
  bodyOwner,
  constraintKey,
  constraintOperands,
  constraintPath,
  CURVE_POINTS,
  documentIds,
  duplicateOf,
  emptyDocument,
  emptySketch,
  featureInput,
  fieldsOf,
  isDimension,
  withPath,
} from './document';
export { bodySource, generatorOf, producesTool, sourceChain, sourceRoot } from './features/index';
export { GRID_STRIDE, MAX_PATTERN_PLACES } from './features/pattern';
export { type MeshOrigin, shapeOrigin } from './solid';
export { FACE_ROLES, type FaceRoleSpec, faceKey, faceParts } from './face-roles';
export { type CatalogTable, type Catalogs, DATA_CATALOGS, type DataCatalog, catalogTable } from './data-catalogs';
export type { ClearanceHoleRow, CountersunkScrewRow, HeatSetInsertRow, HexNutRow, SocketHeadScrewRow } from './catalogs/hardware';
export { HARDWARE_HOLE_ARGS, type HardwareHole } from './query/hardware-hole';
export { HOLE_FIELDS, HOLE_SHAPES } from './features/hole';
export { EXPORT_FORMATS, exportPathProblem } from './export/index';
export { ZIP_NAME_LIMIT, type ZipEntry, crc32, zip } from './export/zip';
export type { MeshAbout } from './export/threemf';
export type { OutlineAbout } from './export/outline';
export { PARTS_CSV, type PartsCsvAbout, partsCsvText } from './export/parts-csv';
export { csvField, significant } from './export/text';
export { NO_MECHANISM, ROBOT_FILES, ROBOT_REFUSALS, type RobotAbout, type RobotMeshAbout, meshName } from './export/robot';
export type { AnyExportFormat, ExportFormat, ExportFormatSpec, ExportFormats, ExportOptions } from './export/spec';
export { QUERIES } from './query/index';
export type { ArgKind, ArgSpec, ArgSpecs, ArgsOf, Described, RunArgsOf } from './query/args';
export { type AnyQuery, type Queries, type QueryArgs, type QueryContext, QueryFailure, type QueryName, type QueryResult, type QuerySpec, type ResultUnit, type ResultUnits } from './query/spec';
export { type EntityShape, type ShapedRef, entityShape } from './query/entity';
export type { Measurement } from './query/measure';
export type { Gap, GapReport } from './query/gap';
export { type PrintFrame, type PrintOrientation, type PrintPass, type PrintReport, frameOfDirection, printPass } from './query/print';
export { type MassFrom, type MassIntegrals, type MassProperties, type MassSource, massIntegrals } from './query/mass';
export { type CutLoop, type SectionLoop, type SectionOfBody, type SectionRegion, type SectionResult, type SectionSpan, SECTION_ARGS, completeRegions, cut, takenAt } from './query/section';
export { type Closest, type MeshPart, closest, coordinatePrecision, meshAccuracy } from './mesh-distance';
export { type Circle3, circleBetween, circlesBetween } from './surfaces';
export { argText, checkArgs, specProblems } from './query/check';
export { SCHEMA_PENDING, SCHEMA_VERSION, UPGRADES, type UpgradeStep } from './schema';
export { DOCUMENT_SECTIONS, SECTION_INFO, type SectionName, namedBySections, takenOver } from './sections/index';
export type { SectionFieldSpec, SectionInfo } from './sections/spec';
export { DENSITY, MASS, bodyPropertiesWithoutBody, partName, printedBodies } from './sections/body-properties';
export { type Carried, JOINT_DRIVE_FIELDS, JOINT_FIELDS, LIMIT_TOLERANCE, type PoseNote, blockingJoints, carriedBy, poseNote, poseOfBody } from './sections/mechanism';
export { MECHANISM_ARGS, type MechanismAnswer } from './query/mechanism';
export { PARTS_LIST_ARGS, type HardwareRow, type HoleCount, type PartRow, type PartsList, type PartsSum, holeCounts } from './query/parts-list';
export { pairInFrame } from './query/pose';
export type { MaterialRow } from './catalogs/materials';
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
  type SketchToolCall,
  type SketchToolContext,
  type SketchToolInput,
  type SketchToolInputs,
  type SketchToolName,
  type SketchToolResult,
  type SketchToolSpec,
  anchorPosition,
  freshIds,
  nearestCurvePoint,
  placeAnchor,
  sketchTool,
} from './sketch-tools';
export type { Deps } from './evaluate';
