# Architecture: the recompute

Part of [architecture.md](../architecture.md), the design as implemented. The replay of the features, its cache and the states of errors.

## Přepočet

V kódu je přepočet metodou třídy `Evaluator` (`evaluate.ts`), která drží cache; adaptéry dostane při vytvoření. The class does what every feature type shares (the cache, the values of expressions, a suppressed feature, a failed expression) and calls the step of the type through the registry: `specOf(feature).step(feature, context)`, where the context (`StepContext`) carries the state before the feature, the settings, the adapters, the callbacks `done` and `failed`, and for the sketch the drag target and the fields whose expression failed. Signatura popisuje vstupy a výstup:

```ts
function evaluate(doc: Document, deps: { solver; kernel }, opts?: {
  upTo?: Id;                                                        // skončit u této feature
  drag?: { sketch: Id; point: Id; target: { x: number; y: number } };   // tažení bodu, viz Řešení skici
}): Evaluation;

interface Evaluation {
  features: Record<Id, FeatureResult>;
  bodies: Record<Id, BodyResult>;           // stav po poslední vyhodnocené feature
  faceNames: FaceName[];                    // společná tabulka, index = číslo stěny
  faceSurfaces: Surface[];                  // the surface of every face, same index (D37)
  parameters: Record<string, ParameterResult>;   // values and errors of parameters
  checks: Record<string, CheckResult>;           // 'ok' | 'failed' | 'error' by check name
}

interface BodyResult {
  solid: Solid;
  faces: { id: number; planar: boolean }[];             // stěny, které těleso má
  edges: { name: EdgeName; kind: 'line' | 'circle' | 'coplanar' | 'other'; segments: Float64Array }[];   // segments: úsečky, 6 čísel na úsečku
  volume: number;                                       // mm³
  bounds: { min: Vec3; max: Vec3 };                     // the box of the body along the axes of the model
}

interface Issue { code: IssueCode; message: string; refs?: unknown[] }

type IssueCode =
  // chyby: feature nemá výsledek
  | 'brokenReference' | 'noProfile' | 'invalidProfile' | 'nonPlanarFace'
  | 'emptyResult' | 'kernelFailure'
  | 'invalidExpression'            // an error everywhere except a sketch, where it is a warning
  // varování: feature výsledek má
  | 'sketchConflict' | 'brokenProjection' | 'degenerateProjection' | 'unsupportedProjection'
  | 'noEffect'
  | 'gearMesh' | 'gearInterference';   // from the gear generator, see Profile generators

interface FeatureResult {
  status: 'ok' | 'warning' | 'suppressed' | 'error';
  error?: Issue;                 // jen při status 'error'
  warnings: Issue[];
  bodies: Id[];                  // bodies the feature created: an extrusion with `new` its own, a pattern of a body its copies
  plane?: { origin: Vec3; x: Vec3; y: Vec3; normal: Vec3 };   // sketch, plane
  sketch?: {
    points: Record<Id, { x: number; y: number }>;   // použité polohy, včetně promítnutých
    radii: Record<Id, number>;
    degreesOfFreedom: number;
    conflicting: Id[];
    redundant: Id[];
    measurements: Record<Id, number>;               // hodnoty referenčních kót
    valid: boolean;                                 // false = křivky se kříží, profil je neplatný
    regions: { ref: RegionRef; loops: Float64Array[] }[];   // pro vykreslení a výběr
  };
  fieldErrors?: Record<FieldPath, ExpressionError>;   // expression errors by field
  facts?: Record<string, number | boolean | Vec3>;    // what the profile generator published
  values?: Record<FieldPath, number>;                 // values of fields with an expression used in this recompute
}
```

- `evaluate` je čistá funkce dokumentu.
- Přehrává se lineárně od první feature. Stav po každé feature se memoizuje podle identity objektu feature a identity předchozího stavu, takže nezměněný začátek logu se nepřepočítává. With expressions the key is the resolved feature (see Parameters and expressions), so the identity changes only when a value of an expression changes.
- Feature ve stavu `error` se chová jako prázdná operace a přehrávání pokračuje. Co na ní závisí, skončí také v chybě.
- Feature ve stavu `warning` výsledek má a závislé features s ním pracují normálně.
- Potlačená feature (`suppressed`) se chová jako prázdná operace, stejně jako feature v chybě. Co na ní závisí, skončí v `brokenReference`, promítnutí v `brokenProjection`.
- `upTo` ukončí přehrávání u zadané feature. Náhled při úpravě feature uprostřed logu tak nepočítá nic za ní.

**Tabulka čísel stěn.** Čísla stěn jsou součástí memoizovaného stavu, ne vlastností jednoho běhu. Stav po každé feature nese tabulku jmen; feature, která vytváří nové stěny, přidá jejich jména na konec tabulky předchozího stavu. Číslo stěny je tak funkcí začátku logu a sedí i tehdy, když se začátek bere z cache. Tabulka je jedna společná pro všechna tělesa, čísla se neukládají do dokumentu.

Graf závislostí (přeskočení nezávislých features) je možná pozdější optimalizace.
