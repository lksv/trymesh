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
  curvePoints,
  documentIds,
  duplicateOf,
  emptyDocument,
  emptySketch,
  entryInput,
  featureInput,
  fieldsOf,
  isDimension,
  referenceEntities,
  withPath,
} from './document';
export { bodyRefs, bodySource, featuresWithInserted, generatorOf, insertedFeature, producesTool, sourceChain, sourceRoot } from './features/index';
export { INSERT_FIELDS } from './features/insert';
export { entryOrder } from './references/derive';
export { FIXED_JOIN, type TangentEnds, commonEnd } from './common-end';
export { insertedFaceName } from './recompute/insertion';
export { MAX_INSERT_DEPTH } from './sections/documents';
export { GRID_STRIDE, MAX_PATTERN_PLACES } from './features/pattern';
export { PATTERN_ANGLE, PATTERN_COUNT, PATTERN_LENGTH, PATTERN_SPACING } from './pattern-numbers';
export { type MeshOrigin, shapeOrigin } from './solid';
export { FACE_ROLES, type FaceRoleSpec, faceKey, faceParts, faceText, sameFaceName } from './face-roles';
export { type CatalogTable, type Catalogs, DATA_CATALOGS, type DataCatalog, catalogTable } from './data-catalogs';
export type { ClearanceHoleRow, CountersunkScrewRow, HeatSetInsertRow, HexNutRow, SocketHeadScrewRow } from './catalogs/hardware';
export { HARDWARE_HOLE_ARGS, type HardwareHole } from './query/hardware-hole';
export { HOLE_FIELDS, HOLE_SHAPES } from './features/hole';
export { EXPORT_FORMATS, exportPathProblem } from './export/index';
export { IMPORT_FORMATS, type ImportOutcome, type MeshReport, fileNameOf, fileStemOf, idFromFile, importAccept, importFormatOf, importMesh, meshNameOf } from './import/index';
export { type AnyImportFormat, type ImportCatalog, ImportFailure, type ImportFormat, type ImportFormatSpec, type ImportFormats, type ImportOptions, type ReadTriangles } from './import/spec';
export { STL_IMPORT_OPTIONS, UNIT_IN_MM } from './import/stl';
export { OUTLINE_FORMATS, type OutlineOutcome, type OutlineReport, type OutlineRevision, WELD_DEFAULT, curveCounts, importOutline, outlineEntryId, outlineFormatOf, outlineRevision } from './import/outline-formats';
export { OUTLINE_LIMITS } from './imported-curve';
export { OUTLINE_ANCHORS, OUTLINE_PLACE, OUTLINE_TURN, placedOutlineBox } from './references/outline';
export { type AnyOutlineFormat, OUTLINE_SHARED_OPTIONS, type OutlineCatalog, type OutlineFormat, type OutlineFormatSpec, type OutlineFormats, type OutlineOptions, type ReadOutline } from './import/spec';
export { DXF_OPTIONS } from './import/dxf';
export { SVG_OPTIONS } from './import/svg';
export { type IndexedMesh, MESH_LIMITS, type MeshDefects, type MeshProblem, type MeshShell, defectsText, fromBase64, indexedMesh, meshDefects, meshProblem, shellsOf, storedMesh, toBase64, withoutWalls } from './mesh';
export { PLACEMENT_FIELDS } from './features/mesh';
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
export { EXPRESSION_CONSTANTS, EXPRESSION_FUNCTIONS, EXPRESSION_SYNTAX, type ExprKind, analyzeExpression, expressionValue } from './expression';
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
export { CUT_IDS, type CutIds, type CurveChanges, type CurvePredicates, type ExtendInput, type PieceShape, type RemovedStretch, type Repair, type SketchContact, type SplitInput, type TrimInput, curvePredicates, curveUnder, extendEnd, extendReach, readersOf, repairsByDefault, trimPiece } from './sketch-cut';
export { type EntityIndex, REFERENCE_KINDS, type UpdateHolds, derivedOrigin, entityIndex, entityOf, kindOf, updateHolds } from './references/index';
export type { AnyKind, EntryKindName } from './references/spec';
export { type ContactKind, type ContactPoint, type CurveContacts, type TightPlace, curveContacts, profileOf, profileProblem } from './sketch';
export { type SketchBase, type SketchWorld, cutInMemory, sketchWorld, stepBase, toolBase } from './references/world';
export type { Deps } from './evaluate';
export { AXIS_REACH, ORIGIN_AXES, type OriginAxis, isOriginAxis, underOrigin } from './util';
export { AXIS_CURVES, type SketchCurve, type SketchGeometry, type SolvedCurves, lineExtent, solvedCurves } from './sketch';
export { DUPLICATE, type ProjectedKind, REGIONS_ON_A_POINT, type SketchMap, UNDER_ORIGIN, degreesText, projectionEntities, sketchMap } from './references/projection';
export { PROJECT_SKETCH_IDS, type ProjectSketchInput } from './sketch-project';
export type { SketchSource, SketchSourcesResult, SourceEntity } from './query/sketch-sources';
export { ENTRY_PAGE_POSITIONS, type EntryCurvesResult, type ListedCurve } from './query/entry-curves';
export { REGION_PAGE_IDS, type RegionRow, type SketchRegionsResult } from './query/sketch-regions';
// The geometry of a spline (D70): its Bezier pieces, its polyline, where it runs.
export { MAX_SPLINE_POINTS, MIN_SPLINE_POINTS, bsplineBeziers, splineBeziers, splineBox, splinePolyline, splineThrough } from './spline';
