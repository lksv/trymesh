// Texts the panels and the forms share: the titles of the feature types and of the choices of an
// extrusion, and the facts a profile generator publishes.
import { type ExtrudeFeature, FEATURE_TYPE_INFO, type Feature, type FeatureResult, type GeneratorName, type Unit } from '@trymesh/engine';
import { fmt } from './dom';
import { valueText } from './fields';
import type { ExtentSide, ExtrudeDraft } from './sketch-commands';

export const FEATURE_TYPES = Object.fromEntries(Object.entries(FEATURE_TYPE_INFO).map(([type, info]) => [type, info.title])) as Record<Feature['type'], string>;
export const OPERATIONS: Record<ExtrudeFeature['operation'], string> = { new: 'Nové těleso', add: 'Přidat k tělesu', cut: 'Odebrat z tělesa' };
// A numeric field of a feature for a summary: its expression with the value, or the value alone.
export const shownValue = (feature: Feature, path: string, value: number): string => (feature.expressions?.[path] ? `${feature.expressions[path]} = ${fmt(value)}` : fmt(value));
export const SIDES: Record<ExtentSide, string> = { both: 'Both sides', forward: 'Along the normal', backward: 'Against the normal' };

// Facts of a generated profile shown below the form and at the selected feature, with their units.
const FACTS_SHOWN: Record<GeneratorName, [name: string, label: string, unit: Unit][]> = {
  involuteGear: [
    ['module', 'module', 'mm'],
    ['pitchDiameter', 'pitch ⌀', 'mm'],
    ['tipDiameter', 'tip ⌀', 'mm'],
    ['rootDiameter', 'root ⌀', 'mm'],
    ['rotation', 'rotation', 'rad'],
    ['shift', 'shift', 'none'],
  ],
  cycloidalDisc: [
    ['lobes', 'lobes', 'count'],
    ['eccentricity', 'eccentricity', 'mm'],
    ['outerDiameter', 'outer ⌀', 'mm'],
    ['innerDiameter', 'inner ⌀', 'mm'],
  ],
  gt2Pulley: [
    ['pitchDiameter', 'pitch ⌀', 'mm'],
    ['outsideDiameter', 'outside ⌀', 'mm'],
  ],
};

// The length an extent up to a plane gave (D47), from the facts of the result.
export function lengthText(f: { extent: ExtrudeDraft['extent'] }, result: FeatureResult | undefined): string {
  const facts = result?.facts;
  if (f.extent.type !== 'upTo' || typeof facts?.lengthMin !== 'number' || typeof facts.lengthMax !== 'number') return '';
  const length = facts.lengthMin === facts.lengthMax ? fmt(facts.lengthMin) : `${fmt(facts.lengthMin)} to ${fmt(facts.lengthMax)}`;
  return `length ${length} mm, ${facts.forward ? 'along' : 'against'} the normal of the sketch plane`;
}

// What the generator of a feature published, for a human: "module 0.9 mm, pitch ⌀ 16.2 mm, …".
export function factsText(f: { profile: ExtrudeDraft['profile'] }, result: FeatureResult | undefined): string {
  if (f.profile.type !== 'generated' || !result?.facts) return '';
  const facts = result.facts;
  return FACTS_SHOWN[f.profile.generator].filter(([name]) => typeof facts[name] === 'number').map(([name, label, unit]) => `${label} ${valueText(facts[name] as number, unit)}`).join(', ');
}
