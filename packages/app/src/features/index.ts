// The registry of feature types in the app: one entry per type of the engine, and the compiler
// guards that none is missing. The toolbar, the timeline, the model panel, the events of the view
// and the scene ask the entry instead of spelling the types out.
import type { Feature } from '@trymesh/engine';
import { chamfer } from './chamfer';
import { combine } from './combine';
import type { FeatureUi } from './draft';
import { extrude } from './extrude';
import { fillet } from './fillet';
import { hole } from './hole';
import { insert } from './insert';
import { mesh } from './mesh';
import { pattern } from './pattern';
import { plane } from './plane';
import { revolve } from './revolve';
import { sketch } from './sketch';
import { split } from './split';
import { thread } from './thread';

// Each entry is written and checked with the type of what its form remembers; the registry
// forgets it.
export const FEATURE_UI: { [K in Feature['type']]: FeatureUi<Extract<Feature, { type: K }>, any> } = { plane, sketch, extrude, pattern, hole, mesh, combine, split, revolve, chamfer, fillet, insert, thread };

// The entry of a feature, as code that handles any type reads it: one cast, as picking a step by
// feature type needs in the engine.
export const uiOf = (type: Feature['type']): FeatureUi<Feature> => FEATURE_UI[type] as unknown as FeatureUi<Feature>;

// The buttons of the toolbar that start a feature, in their order.
export const TOOLBAR: readonly Feature['type'][] = ['sketch', 'extrude', 'revolve', 'hole', 'chamfer', 'fillet', 'thread', 'plane', 'pattern', 'mesh', 'insert', 'combine', 'split'];
