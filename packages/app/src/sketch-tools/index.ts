// The tools of the sketch bar (D64, part 4): a file per tool and one line here. The bar shows them
// in the order of the table, and `SketchMode.tool` is a key of it. The tools of the app and the
// engine's `SKETCH_TOOLS` stay two catalogs: most tools here are interactions, and an engine tool
// reaches MCP without the app; a tool here that runs an engine tool calls `sketchTool`.
import { arc } from './arc';
import { circle } from './circle';
import { fillet } from './fillet';
import { line } from './line';
import { point } from './point';
import { polygon } from './polygon';
import { project } from './project';
import { rect } from './rect';
import { select } from './select';
import type { SketchToolUi } from './spec';

// Each entry is written with its own type of options; the table forgets it, as `FEATURE_UI` does.
const TABLE = { select, point, line, rect, polygon, circle, arc, fillet, project };

export type SketchToolName = keyof typeof TABLE;
export const SKETCH_TOOL_UI: { readonly [T in SketchToolName]: SketchToolUi<any> } = TABLE;

export type { Place, SketchEdgeTool, SketchPlaceTool, SketchToolUi, ToolOptions } from './spec';
export { anchor, drawn, placePosition } from './spec';
