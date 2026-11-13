# Architektura

Stav: odsouhlaseno 2026-11-13 (D10–D27), předpoklady ověřeny spiky.

Vychází z [requirements.md](requirements.md) a [decisions.md](decisions.md). Návrh UI je v [ui.md](ui.md).

Poslední úprava: 2026-11-13

## Přehled

```
┌──────────────────────────┐
│ UI + renderer (three.js) │   kreslí, hlásí výběr myší
└───────────┬──────────────┘
            │ příkazy (JSON) ↓        ↑ stav, sítě (typed arrays)
┌───────────┴──────────────────────────────────────────┐
│ Engine (TypeScript, bez runtime závislostí)          │
│                                                      │
│  api        fasáda: příkazy, undo/redo, náhled       │
│  document   datový model, příkazy, serializace       │
│  sketch     model skici, detekce profilů             │
│  solid      síť tělesa, stavba extrude, jména        │
│  regen      přehrání logu, cache, chybové stavy      │
│  export     STL (3MF později)                        │
│                                                      │
│  porty:  SketchSolver          SolidKernel           │
└────────────┬──────────────────────┬──────────────────┘
             │                      │
   ┌─────────┴────────┐   ┌─────────┴────────┐
   │ solver-planegcs  │   │ kernel-manifold  │   adaptéry (WASM)
   └──────────────────┘   └──────────────────┘
```

Pravidlo závislostí: engine nezná adaptéry ani renderer. Adaptéry a renderer znají jen veřejné typy enginu. Adaptéry se enginu předají při vytvoření.

## Struktura repozitáře

pnpm workspace, čtyři balíčky. Hranice jsou tím vynucené fyzicky: `engine` nemá v `package.json` žádnou runtime závislost.

```
packages/
  engine/            jádro, čistý TS
  solver-planegcs/   adaptér SketchSolver
  kernel-manifold/   adaptér SolidKernel
  app/               ukázkové UI + renderer (three.js)
```

Testy: Vitest. Validační scénáře běží v Node proti skutečným adaptérům.

## Dvě různé historie

- **Časová osa (feature log)** je recept na model: uspořádaný seznam features (`Plane`, `Sketch`, `Extrude`). Je součástí dokumentu. Úprava feature uprostřed vyvolá přepočet.
- **Historie příkazů** je záznam uživatelských úprav dokumentu kvůli undo/redo. Není receptem na model.

Skica je **jedna feature** na časové ose. Její obsah (body, křivky, vazby) je stav, ne log. Přidání úsečky do skici je příkaz (jde vrátit přes undo), ale není to nová položka časové osy.

## Dokument

Dokument je neměnná (immutable) datová struktura serializovatelná do JSON. Každý příkaz vrací nový dokument, nezměněné části se sdílejí.

- **Undo/redo** je zásobník předchozích dokumentů.
- **Cache přepočtu** je memoizace podle identity objektů (viz Přepočet).
- **Round-trip**: dokument je jediný zdroj pravdy.

```ts
type Id = string;                    // trvalé, nikdy se nerecykluje
type Vec3 = [number, number, number];

interface Document {
  schemaVersion: number;
  settings: {
    chordTolerance: number;               // dělení oblouků na segmenty
  };
  features: Feature[];                    // časová osa
}

type Feature = PlaneFeature | SketchFeature | ExtrudeFeature;

interface FeatureBase { id: Id; name: string; suppressed: boolean }

interface PlaneFeature extends FeatureBase {
  type: 'plane';
  base: PlaneRef;
  offset: number;                   // posun ve směru normály základu
}

interface SketchFeature extends FeatureBase {
  type: 'sketch';
  plane: PlaneRef;
  points: Record<Id, { x: number; y: number }>;   // řešené proměnné: polohy bodů
  radii: Record<Id, number>;                      // řešené proměnné: poloměry kružnic
  curves: Record<Id, Curve>;
  constraints: Record<Id, Constraint>;
  external: Record<Id, ExternalRef>;              // promítnutá geometrie
  solved: SolveStamp;                             // pro jaké vstupy uložené proměnné platí
}

interface SolveStamp {
  inputs: string;                         // otisk křivek, vazeb a hodnot promítnuté geometrie
  external: Record<Id, number[]>;         // poslední platné hodnoty promítnuté geometrie
}

type Curve = { construction?: boolean } & (
  | { type: 'line';   a: Id; b: Id }                       // ID bodů
  | { type: 'circle'; center: Id }                         // poloměr je v `radii`
  | { type: 'arc';    center: Id; start: Id; end: Id }     // proti směru hodin
);

type ExternalRef = { type: 'edge'; body: Id; edge: EdgeName };

// Každá varianta má pojmenované operandy s pevným významem.
type Constraint = GeometricConstraint | Dimension;

type GeometricConstraint =
  | { type: 'coincident';   a: Id; b: Id }            // bod, bod
  | { type: 'pointOnCurve'; point: Id; curve: Id }
  | { type: 'horizontal' | 'vertical'; line: Id }
  | { type: 'parallel' | 'perpendicular' | 'equalLength'; a: Id; b: Id }  // úsečky
  | { type: 'tangent';      a: Id; b: Id };           // úsečka–kružnice/oblouk, nebo dvě kružnice/oblouky

type Dimension = { value: number; driving: boolean } & (
  | { type: 'distance';           a: Id; b: Id }      // bod–bod (délka úsečky = její koncové body)
  | { type: 'distancePointLine';  point: Id; line: Id }
  | { type: 'horizontalDistance' | 'verticalDistance'; a: Id; b: Id }   // bod, bod
  | { type: 'angle';              a: Id; b: Id }      // úsečky; úhel od směru `a` ke směru `b`, proti směru hodin, radiány
  | { type: 'radius' | 'diameter'; curve: Id }
);

type PlaneRef =
  | { kind: 'base';  plane: 'XY' | 'XZ' | 'YZ' }
  | { kind: 'plane'; feature: Id }                    // PlaneFeature
  | { kind: 'face';  body: Id; face: FaceName };

interface ExtrudeFeature extends FeatureBase {
  type: 'extrude';
  sketch: Id;
  regions: RegionRef[];
  distance: number;                 // kladná = ve směru normály roviny skici
  operation: 'new' | 'add' | 'cut';
  target?: Id;                      // těleso pro add/cut
}
```

ID tělesa je ID feature, která ho založila (`operation: 'new'`). Délky jsou v milimetrech, úhly v radiánech.

Konvence:
- **ID** generuje volající a posílá je v příkazech (viz API). Musí být v dokumentu jedinečná, nesmí obsahovat znak `/` (ten je vyhrazený pro odvozená ID promítnuté geometrie) a nesmí být `origin`.
- **Směr úsečky** je od bodu `a` k bodu `b`. Úhel kóty `angle` je orientovaný a leží v intervalu (−π, π].
- **Pořadí** tam, kde se mluví o seřazených nebo kanonicky uspořádaných ID a jménech, je lexikografické pořadí řetězců. Jméno stěny se pro porovnání zapíše jako `feature/role/curve`.
- **Rozsah extrude** je v PoC jen pevná `distance`. Varianty „skrz vše" a „po stěnu" jsou budoucí funkce a přibudou jako další pole vedle `distance`; díra okótovaná pevnou vzdáleností po změně tloušťky tělesa procházet přestane.

### Skica

**Body** jsou samostatné entity a křivky na ně odkazují. Dvě úsečky sdílející bod jsou spojené bez vazby. Vazba `coincident` zůstává pro spojení dodatečně.

**Počátek.** Každá skica má rezervovaný bod s ID `origin` v poloze (0, 0). Je pevný, solver s ním nehýbe a nejde smazat. Natočení kotví vazby `horizontal` a `vertical`, které se vztahují k osám skici.

**Oblouk.** `start` i `end` musí ležet ve stejné vzdálenosti od `center`. Tuto implicitní podmínku zajišťuje solver, v dokumentu se jako vazba neukládá.

**Konstrukční geometrie.** Křivka s `construction: true` slouží jen jako pomůcka pro vazby (osy, pomocné čáry). Detekce profilů ji ignoruje.

**Referenční kóty.** Kóta s `driving: false` geometrii neřídí, jen měří. Solveru se neposílá; její hodnotu počítá engine z vyřešených proměnných a vrací ji ve výsledku skici (`measurements`).

**Nadbytečné vazby** nejsou chyba ani varování. Engine je vrací v `redundant` a UI je může nabídnout ke smazání. Automaticky odvozené vazby je budou vyrábět běžně.

**Promítnutá geometrie (D23).** Položka `external` promítne hranu tělesa do roviny skici jako pevnou referenční křivku. Uživatel k ní váže a kótuje stejně jako k vlastní geometrii, takže například díra drží vzdálenost od okraje nebo soustřednost s válcem i po změně tělesa.

Výsledek promítnutí je obecně „křivka skici", jejíž typ plyne z druhu hrany a z polohy roviny:

| Hrana | Rovina skici | Výsledek | Odvozená ID |
|---|---|---|---|
| přímá | libovolná | úsečka | křivka `<id>`, body `<id>/a`, `<id>/b` |
| přímá, kolmá na rovinu | | nejde promítnout (`degenerateProjection`) | |
| kruhová | rovnoběžná s rovinou kružnice | kružnice | křivka `<id>`, bod `<id>/center` |
| kruhová | šikmá nebo kolmá | elipsa nebo úsečka: **budoucí funkce**, v PoC nejde promítnout (`unsupportedProjection`) | |
| jiná | | nejde promítnout (`unsupportedProjection`) | |

- Hodnoty se počítají při každém přepočtu ze stavu těles **před** touto skicou.
- Solver s promítnutými body nehýbe a poloměr promítnuté kružnice nemění. Detekce profilů je ignoruje.
- Kruhová hrana se promítá vždy jako celá kružnice, i když je hrana jen její částí.
- **Promítnutí, které nejde vyhodnotit, skicu neshodí.** Když hrana zanikla nebo ji nejde promítnout, skica dostane varování a promítnutá křivka zůstane zmrazená na posledních platných hodnotách ze `solved.external`. Vazby na ni platí dál. Pokud žádné platné hodnoty nejsou (promítnutí se nepovedlo nikdy), vazby na tuto křivku se při řešení vynechají a varování je vyjmenuje.

**Připravenost na elipsu.** Promítání do šikmé roviny přidá do `Curve` variantu `ellipse` a do portu solveru odpovídající vazby. Zbytek návrhu se nemění: `ExternalRef` druh výsledku neukládá (odvozuje se při přepočtu), `fixed` v `SolveInput` pracuje s obecnými ID a kód, který zpracovává křivky, musí neznámou variantu odmítnout chybou, ne ji tiše přeskočit.

### Řešení skici (D12)

Skica má **řešené proměnné** (polohy bodů v `points`, poloměry kružnic v `radii`) a **vstupy solveru** (křivky, vazby s hodnotami a hodnoty promítnuté geometrie). Razítko `solved.inputs` je otisk vstupů, pro které uložené proměnné platí.

Řešení probíhá na jediném místě, při přepočtu. Příkazy solver samy nevolají (s výjimkou tažení, viz níže), jen mění dokument:

1. Spočítá se promítnutá geometrie ze stavu těles před skicou.
2. **Otisk vstupů se shoduje s razítkem:** uložené proměnné se použijí beze změny. Solver se volá jen pro diagnostiku (stupně volnosti, konflikty, nadbytečné vazby).
3. **Neshoduje se:** skica se vyřeší, počátečním odhadem jsou uložené proměnné. Dál v logu se použije výsledek solveru.
4. **Solver řešení nenajde:** použijí se uložené proměnné a skica dostane varování `sketchConflict`. Přehrávání pokračuje, model nezmizí.

Stejné pravidlo tak pokrývá změnu tělesa i úpravu skici samotné. Změna kóty z 40 na 50, přidání vazby nebo nakreslení křivky změní otisk vstupů, takže následný přepočet skicu vyřeší. Platí to shodně pro `execute`, `preview` i `batch` (u dávky se řeší jednou, po posledním příkazu).

**Zápis výsledku.** Po `execute` engine u skic vyřešených v kroku 3 zapíše do dokumentu atomicky všechny řešené proměnné (body i poloměry) a nové razítko, v rámci téhož kroku undo. Při konfliktu se nezapisuje nic, takže se skica při dalším přepočtu zkusí vyřešit znovu.

**Tažení bodu** je jediný příkaz, který solveru dodává vstup mimo dokument (cíl tažení). Engine skicu vyřeší s dočasným cílem, výchozím odhadem jsou vždy uložené proměnné. `preview(dragPoint)` výsledek jen vrátí, `execute(dragPoint)` ho zapíše jako nové proměnné; razítko zůstává, vstupy se nezměnily. Náhledy jsou bezstavové, každý začíná z uložených poloh; spike potvrdil, že to drží bez skoků i při vzdáleném cíli.

**Cache.** Zápis vytvoří nový objekt feature, takže by memoizace podle identity minula. Engine proto záznam v cache převěsí ze starého objektu na nový. Je to korektní z konstrukce: nový objekt projde při přepočtu větví 2 a dá přesně ty proměnné, které předtím dal solver.

**Determinismus.** `evaluate` je čistá deterministická funkce dokumentu. Po uložení a načtení se razítko shoduje, solver se pro proměnné nevolá a výsledek je bitově stejný (scénář 4). Opírá se to jen o determinismus solveru a jádra, které spiky potvrdily.

**Vědomý důsledek.** Kvůli zápisu výsledku počítá `execute` vždy celý model, i když uživatel kreslí ve skice uprostřed logu; šetří jen `preview(cmd, at)` a `getState(at)`. Pro PoC je to přijatelné. Pozdější optimalizace: zápis odložit a dopočítat zbytek modelu až při opuštění skici.

## Pojmenování

### Stěny

Stěna má strukturované jméno odvozené z původu:

```ts
type FaceName =
  | { feature: Id; role: 'side'; curve: Id }     // z křivky skici
  | { feature: Id; role: 'startCap' }            // víko v rovině skici
  | { feature: Id; role: 'endCap' };             // protější víko
```

Víko nenese označení oblasti. Všechna víka jedné extrude leží v jedné rovině, takže tvoří jednu logickou stěnu, i když je extrude složená z více oblastí. Nový výběr profilu tak víko nepřejmenuje a skici na něm se nerozbijí.

Každý trojúhelník tělesa nese číslo stěny, tabulka čísel → jmen patří k výsledku přepočtu. Čísla se neukládají, ukládají se jen jména.

| Situace | Chování |
|---|---|
| Booleovská operace | Trojúhelník dědí jméno stěny, ze které pochází. Horní stěna kvádru je i po vyříznutí díry „endCap extrude E1". |
| Stěna se rozdělí na víc částí | Zůstává jednou logickou stěnou (nesouvislou). |
| Stěna zanikne | Jméno nemá žádný trojúhelník → reference je rozbitá → feature je v chybě. |
| Dvě stěny splynou do jedné roviny | Zůstávají dvě stěny s různými jmény. |
| Kružnice nebo oblouk | Všechny segmenty mají stejné jméno, válcová plocha je jedna stěna. |

### Hrany (D22)

Hrana je rozhraní dvou různě pojmenovaných stěn. Jejím jménem je neuspořádaná dvojice jmen stěn:

```ts
interface EdgeName { a: FaceName; b: FaceName }   // a < b v lexikografickém pořadí zápisu feature/role/curve
```

- Hrana existuje, pokud v síti sousedí aspoň jedna dvojice trojúhelníků s těmito jmény. Jinak je reference rozbitá.
- Hrana rozdělená na víc úseků zůstává jednou logickou hranou.
- Přímá hrana (obě stěny rovinné a různoběžné) leží na průsečnici jejich analytických rovin. Poloha a směr přímky se počítají analyticky, ze sítě se bere jen rozsah (krajní body).
- Přímka je orientovaná směrem n_a × n_b, kde `a`, `b` jsou stěny v kanonickém pořadí jmen a n jejich normály ven z tělesa. Krajní bod `<id>/a` promítnuté úsečky je ten s menším parametrem v tomto směru. Pořadí konců se tak při přepočtu neprohodí.
- Krajní body mají přesnost sítě (viz Přesnost u SolidKernel). Přímka samotná je přesná. Geometrie přichycená na krajní bod proto dá stěny nástroje jen téměř koplanární se stěnami tělesa; s tím počítá záruka jádra č. 3.
- Hrana mezi dvěma stěnami v téže rovině (výstupek zarovnaný s horní stěnou) má druh `coplanar`. Průsečnice neexistuje a hranice nemusí být přímá. Nekreslí se a nejde promítnout.
- Kruhová hrana je rozhraní boční stěny vzniklé z kružnice nebo oblouku a rovinné stěny kolmé na osu extrude. Střed a poloměr se počítají analyticky z vyřešené zdrojové křivky skici, ze sítě se nebere nic kromě ověření existence.
- Ostatní hrany (válec říznutý šikmou rovinou, průnik dvou válců) mají druh `other` a promítnout nejdou.

Pojmenování hran je zároveň předpokladem pro budoucí rovinu nakloněnou kolem hrany, zaoblení a zkosení.

### Rovina skici na stěně

Počítá se analyticky z definice feature, ne prokládáním trojúhelníků. Souřadný systém je pravotočivý a jeho normála míří vždy **ven z tělesa**:

| Stěna | Počátek | Osa Y | Normála N |
|---|---|---|---|
| víko | počátek rodičovské skici promítnutý do roviny víka | osa Y rodičovské skici | ven z tělesa |
| boční stěna z úsečky | počáteční bod úsečky (`a`) v rovině rodičovské skici | normála rodičovské skici | ven z tělesa |
| boční stěna z kružnice nebo oblouku | není rovinná → chyba `nonPlanarFace` | | |

Osa X se dopočítá jako Y × N. Nezávisí tedy na pořadí bodů úsečky ani na orientaci smyčky.

Směr „ven" se bere ze sítě: je to součet normál všech trojúhelníků s daným jménem vážený plochou. Jediný trojúhelník by mohl být úzký a dát špatné znaménko. Síť zároveň ověří, že stěna stále existuje. Ze sítě se bere jen znaménko, poloha a osy jsou analytické.

Důsledek: kladná `distance` u extrude ze skici na stěně vždy znamená ven z tělesa, záporná dovnitř.

**Vlastní rovina** (`PlaneFeature`) přebírá souřadný systém základu posunutý o `offset` ve směru jeho normály.

### Profily a oblasti

**Spojování bodů.** Dva body skici se pro účely profilu považují za jeden, když je to tentýž bod, nebo když je spojuje vazba `coincident`, která je v použitých polohách skutečně splněná (vzdálenost do tolerance). Samotná existence vazby nestačí: konfliktní `coincident` mezi dvěma rohy obdélníku, která se nesplnila, profil nezmění.

**Graf.** Křivky skici (bez konstrukčních a promítnutých) tvoří rovinný graf. Křivky se smějí dotýkat jen ve spojených bodech. Když se dvě křivky kříží nebo dotýkají jinde, třeba proto, že se profil po vyřešení sám protnul, je profil neplatný a extrude nad touto skicou skončí v chybě `invalidProfile`. Engine tak jádru nikdy nepředá síť, která není uzavřeným tělesem.

**Oblast** je omezená stěna tohoto grafu, tedy nejmenší uzavřená plocha, kterou křivky ohraničují. Obdélník rozdělený příčkou má dvě oblasti, ne tři. Křivky, které žádnou plochu neuzavírají, se ignorují. Oblast může mít díry: jsou to hranice dalších, do ní vnořených souvislých částí grafu.

```ts
interface RegionRef { outerLoop: Id[] }   // ID křivek na vnější hranici oblasti, seřazená
```

Díry se v referenci neukládají, odvozují se při přepočtu. Když se do skici přidá další kružnice uvnitř obdélníku, oblast „obdélník" ji automaticky dostane jako díru.

Když některá oblast z `regions` neexistuje, extrude skončí celý v chybě `noProfile`. Částečný výsledek se nevytváří. Pravidlo je záměrně striktní: i náhrada jedné křivky hranice jinou mezi stejnými body oblast zruší a uživatel musí profil vybrat znovu. Identifikace hranice body by to obešla, ale je nejednoznačná, když dva body spojuje víc křivek.

**Sousední oblasti.** Boční stěna vznikne jen z křivky, která leží na hranici (vnější nebo na hranici díry) právě jedné z vybraných oblastí. Křivka sdílená dvěma vybranými oblastmi se vyruší. Platí to pro příčku mezi dvěma polovinami obdélníku i pro kružnici mezi obdélníkem s dírou a kruhem v té díře. Jinak by uvnitř tělesa zůstala stěna.

Omezení PoC: oblasti vzniklé křížením křivek se nedetekují, křížení je chyba (viz výše).

## Extrude

1. Vyhodnotí se rovina skici a oblasti (`regions`). Neplatný profil → `invalidProfile`, chybějící oblast → `noProfile`.
2. Oblouky a kružnice se rozdělí na segmenty podle `chordTolerance`.
3. Engine postaví uzavřenou síť: dvě víka (triangulace přes jádro) a boční stěny. Každý trojúhelník dostane číslo stěny podle jména.
4. Pro `add` a `cut` se zavolá boolean s cílovým tělesem.

Výsledky, které nejsou běžné:

| Situace | Chování |
|---|---|
| `cut` těleso mine, `add` nic nepřidá | Těleso zůstane beze změny, feature má varování `noEffect`. |
| `cut` odebere celé těleso | Chyba `emptyResult`, feature se chová jako prázdná operace a těleso zůstane. |
| Jádro selže | Chyba `kernelFailure`. |

**Koplanární stěny (D19).** Engine staví nástroj přesně podle skici a nic neposouvá. Skica na stěně znamená, že víko nástroje leží v rovině této stěny; že s tím jádro neumí pracovat spolehlivě, je vlastnost konkrétního jádra a řeší ji jeho adaptér (viz záruka č. 3 u SolidKernel).

## Porty

### SketchSolver

```ts
interface SketchSolver {
  solve(input: SolveInput): SolveResult;
}

interface SolveInput {
  points: Record<Id, { x: number; y: number }>;   // počáteční odhad
  radii: Record<Id, number>;                      // počáteční odhad poloměrů kružnic
  curves: Record<Id, Curve>;                      // včetně promítnutých křivek
  constraints: Record<Id, Constraint>;
  fixed: Id[];                                    // body, které se nehýbou, a kružnice s pevným poloměrem
  drag?: { point: Id; target: { x: number; y: number } };
}

interface SolveResult {
  status: 'solved' | 'conflict' | 'failed';
  points: Record<Id, { x: number; y: number }>;
  radii: Record<Id, number>;
  degreesOfFreedom: number;          // 0 = plně určená
  conflicting: Id[];                 // vazby v konfliktu
  redundant: Id[];
}
```

Bezstavová funkce. Načtení WASM je asynchronní a proběhne při vytvoření adaptéru, `solve` je synchronní.

Záruky implementace:
1. Body ve `fixed` se nepohnou, kružnice ve `fixed` nezmění poloměr.
2. U každého oblouku leží `start` i `end` na stejném poloměru kolem `center`.
3. Stejný vstup dá vždy stejný výstup.

planegcs navíc vrací splněný vstup bitově beze změny (ověřeno spikem), ale návrh se o to neopírá.

Adaptér překládá každou variantu `Constraint` na odpovídající vazbu knihovny jedna ku jedné podle `type`.

Referenční kóty (`driving: false`) se solveru neposílají. Engine je před voláním odfiltruje a jejich hodnotu spočítá z vyřešených poloh. planegcs s nimi podle spiku nepracuje spolehlivě.

### SolidKernel

```ts
interface Solid {
  positions: Float32Array;   // xyz
  triangles: Uint32Array;    // indexy vrcholů
  faceIds: Uint32Array;      // číslo stěny pro každý trojúhelník
}

interface SolidKernel {
  boolean(op: 'union' | 'difference' | 'intersection', a: Solid, b: Solid): Solid;
  triangulate(loops: Float64Array[]): Uint32Array;   // 2D polygon s dírami
}
```

Předpoklad na vstupu: čísla stěn v `a` i `b` pocházejí z jedné společné tabulky. Stejné číslo znamená stejnou stěnu, různé stěny mají různá čísla. Zajišťuje to engine (viz tabulka čísel stěn v sekci Přepočet).

Záruky implementace:
1. Výstup `boolean` je uzavřené těleso.
2. Každý výstupní trojúhelník má `faceId` stěny, ze které pochází.
3. Rovinné stěny obou operandů, které leží v jedné rovině v rámci tolerance jádra a překrývají se, se berou jako shodné. Výsledek neobsahuje blány, vnitřní stěny ani zbytky stěn, které měly zaniknout.
4. Stejný vstup dá vždy stejný výstup.

**Jak záruku č. 3 plní adaptér Manifoldu.** Manifold sám toleranci ke skoro-koplanárním plochám nemá a na šikmých stěnách kvůli float32 selhává. Adaptér proto boolean obalí dvěma kroky:

Před booleanem:
1. Proloží roviny stěnami obou těles (podle čísel stěn) a najde dvojice v jedné rovině v rámci tolerance.
2. Ověří, že se stěny v rovině skutečně překrývají.
3. Stěnu nástroje posune o malý přesah: u rozdílu ven z tělesa, když lícuje s jeho povrchem, a od tělesa, když na něj dosedá zvenku; u sjednocení dovnitř tělesa, když na něj dosedá. Lícující stěny u sjednocení nechá.
4. Vrcholy posouvá podél průsečnic sousedních stěn, aby se sousední stěny nenaklonily.

Po booleanu:
5. Pokud ve výsledku zůstal zbytek posunuté stěny (stěna lícovala jen zčásti a zbytkem procházela materiálem), vrátí jeho vrcholy stejným způsobem do původní roviny.
6. Sloučí vrcholy, které tím splynuly, a zahodí zaniklé trojúhelníky.

Kroky 5 a 6 jsou nutné. Bez nich leží zbylá stěna o přesah vedle roviny, kterou pro ni engine počítá analyticky, a další operace na ní selže: nálitek zavěšený na takové stěně skončil ve spiku jako samostatná komponenta s mezerou 0,002 mm. Výstup adaptéru tedy musí být konzistentní s analytickou geometrií v rámci přesnosti float32, ne v rámci přesahu.

Toleranci i přesah odvozuje adaptér z rozměru modelu (ve spiku 1e-5 a 4e-5 úhlopříčky). V dokumentu ani v core se nenastavují.

Omezení:
- Řeší se jen rovinné stěny. Válcová stěna nástroje shodná s válcovou stěnou tělesa (rozšíření díry na stejný poloměr) ne.
- Vyčištění průchodem přes Manifold nejde použít: nulové trojúhelníky sbalil špatným směrem a poškodil těleso. Slučování vrcholů si adaptér dělá sám.
- Zkoušené byly hranoly a válce. Vrchol, kde se stýká víc než tři různé roviny, zkoušený nebyl.

**Přesnost (D20).** Manifold přijímá i vrací souřadnice jen ve `Float32Array`, proto je má `Solid` také v tomto typu. Engine geometrii nikdy neodvozuje ze sítě, pokud ji umí spočítat analyticky; analytické výpočty běží ve float64. Naměřená odchylka vrcholů od roviny po 12 booleanech za sebou na šikmé stěně byla 2e-6.

`Solid` jsou čistá data. Přechod na B-rep by znamenal jiný typ tělesa a jiný adaptér; jména, reference a přepočet zůstanou.

## Přepočet

```ts
function evaluate(doc: Document, deps: { solver; kernel }, upTo?: Id): Evaluation;

interface Evaluation {
  features: Record<Id, FeatureResult>;
  bodies: Record<Id, BodyResult>;           // stav po poslední vyhodnocené feature
  faceNames: FaceName[];                    // společná tabulka, index = číslo stěny
}

interface BodyResult {
  solid: Solid;
  faces: { id: number; planar: boolean }[];             // stěny, které těleso má
  edges: { name: EdgeName; kind: 'line' | 'circle' | 'coplanar' | 'other'; polyline: Float64Array }[];
}

interface Issue { code: IssueCode; message: string; refs?: unknown[] }

type IssueCode =
  // chyby: feature nemá výsledek
  | 'brokenReference' | 'noProfile' | 'invalidProfile' | 'nonPlanarFace'
  | 'emptyResult' | 'kernelFailure'
  // varování: feature výsledek má
  | 'sketchConflict' | 'brokenProjection' | 'degenerateProjection' | 'unsupportedProjection'
  | 'noEffect';

interface FeatureResult {
  status: 'ok' | 'warning' | 'suppressed' | 'error';
  error?: Issue;                 // jen při status 'error'
  warnings: Issue[];
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
}
```

- `evaluate` je čistá funkce dokumentu.
- Přehrává se lineárně od první feature. Stav po každé feature se memoizuje podle identity objektu feature a identity předchozího stavu, takže nezměněný začátek logu se nepřepočítává.
- Feature ve stavu `error` se chová jako prázdná operace a přehrávání pokračuje. Co na ní závisí, skončí také v chybě.
- Feature ve stavu `warning` výsledek má a závislé features s ním pracují normálně.
- `upTo` ukončí přehrávání u zadané feature. Náhled při úpravě feature uprostřed logu tak nepočítá nic za ní.

**Tabulka čísel stěn.** Čísla stěn jsou součástí memoizovaného stavu, ne vlastností jednoho běhu. Stav po každé feature nese tabulku jmen; feature, která vytváří nové stěny, přidá jejich jména na konec tabulky předchozího stavu. Číslo stěny je tak funkcí začátku logu a sedí i tehdy, když se začátek bere z cache. Tabulka je jedna společná pro všechna tělesa, čísla se neukládají do dokumentu.

Graf závislostí (přeskočení nezávislých features) je možná pozdější optimalizace.

## API enginu

```ts
interface Engine {
  execute(cmd: Command): CommandResult;          // změní dokument, jeden krok undo
  preview(cmd: Command, at?: Id): CommandResult; // spočítá, ale nezapíše; at = jen po danou feature
  undo(): void;
  redo(): void;
  getState(at?: Id): EngineState;                // at = stav modelu po dané feature, dál se nepočítá
  load(json: string): CommandResult;
  save(): string;
  exportMesh(format: 'stl'): Uint8Array;         // '3mf' později
  subscribe(listener: (state: EngineState) => void): () => void;
}

interface EngineState {
  document: Document;
  evaluation: Evaluation;
  canUndo: boolean;
  canRedo: boolean;
}

type CommandResult =
  | { ok: true; state: EngineState }
  | { ok: false; error: { code: 'invalidCommand' | 'invalidDocument'; message: string; commandIndex?: number } };
```

### Příkazy

Příkazy jsou čistá JSON data. ID nových entit generuje volající a posílá je v příkazu, takže dávka může na právě vytvořený bod odkázat hned v dalším příkazu.

```ts
type Command =
  // časová osa
  | { type: 'addFeature'; feature: Feature; index?: number }      // bez indexu na konec
  | { type: 'removeFeature'; id: Id }
  | { type: 'moveFeature'; id: Id; index: number }
  | { type: 'renameFeature'; id: Id; name: string }
  | { type: 'setSuppressed'; id: Id; suppressed: boolean }
  // rovina, extrude
  | { type: 'updatePlane'; id: Id; base?: PlaneRef; offset?: number }
  | { type: 'updateExtrude'; id: Id; regions?: RegionRef[]; distance?: number;
      operation?: 'new' | 'add' | 'cut'; target?: Id }
  // skica
  | { type: 'setSketchPlane'; sketch: Id; plane: PlaneRef }
  | { type: 'addPoint'; sketch: Id; id: Id; x: number; y: number }
  | { type: 'addCurve'; sketch: Id; id: Id; curve: Curve; radius?: number }   // radius u kružnice
  | { type: 'removeEntity'; sketch: Id; id: Id }                              // bod nebo křivka
  | { type: 'setConstruction'; sketch: Id; id: Id; construction: boolean }
  | { type: 'addConstraint'; sketch: Id; id: Id; constraint: Constraint }
  | { type: 'removeConstraint'; sketch: Id; id: Id }
  | { type: 'setConstraintValue'; sketch: Id; id: Id; value?: number; driving?: boolean }
  | { type: 'dragPoint'; sketch: Id; point: Id; x: number; y: number }
  | { type: 'addExternal'; sketch: Id; id: Id; ref: ExternalRef }
  | { type: 'updateExternal'; sketch: Id; id: Id; ref: ExternalRef }
  | { type: 'removeExternal'; sketch: Id; id: Id }
  // složený
  | { type: 'batch'; commands: Command[] };
```

**Validace.** Každý příkaz se před provedením ověří. Neplatný příkaz dokument nezmění a vrátí `invalidCommand` s popisem. Dávka je atomická: neplatný kterýkoli příkaz zruší celou dávku a `commandIndex` říká, který to byl. Ověřuje se:

- ID nových entit jsou jedinečná a splňují konvence (bez `/`, ne `origin`).
- Odkazované entity existují a mají správný typ (vazba `parallel` dostala dvě úsečky).
- Feature odkazuje jen na features před sebou. `addFeature` a `moveFeature`, které by to porušily, jsou neplatné.
- `origin` a odvozené entity promítnuté geometrie nejde smazat ani jimi táhnout.

Validace hlídá strukturu, ne geometrii. Příkaz, který je strukturálně v pořádku, ale vede k chybě přepočtu (konfliktní vazba, zaniklá stěna), se provede a problém se objeví ve stavu feature.

**Pravidla mazání:**

- `removeEntity` kaskáduje: smazání bodu odstraní křivky, které na něm stojí, a smazání bodu nebo křivky odstraní vazby, které na ně odkazují.
- `removeExternal` kaskáduje stejně: odstraní vazby na promítnutou křivku i její odvozené body.
- `updateExternal` zachová ID, takže vazby zůstanou. Smí vybrat jen hranu, která se promítne jako stejný druh křivky. Změna druhu (úsečka místo kružnice) by změnila odvozená ID a příkaz je neplatný; uživatel promítnutí smaže a vytvoří nové.
- `removeFeature` nekaskáduje: závislé features zůstanou a skončí v chybě.

**`load`** ověří verzi schématu a stejná pravidla jako příkazy pro celý dokument. Neplatný dokument se nenačte, stav enginu se nezmění a vrátí se `invalidDocument`.

### Co z API vzešlo z návrhu UI (D24)

- **`batch`**: nakreslení úsečky s automaticky odvozenými vazbami musí být jeden krok undo.
- **`addFeature` s pozicí**: vložení feature doprostřed logu.
- **`getState(at)` a `preview(cmd, at)`**: úprava feature uprostřed logu zobrazuje model v tom okamžiku a nepřepočítává features za ní.
- **Data pro výběr**: stěny s příznakem rovinnosti, hrany s lomenou čarou a druhem, oblasti skici se smyčkami.

Výběr myší: renderer zjistí index trojúhelníku, přes `faceIds` číslo stěny a přes `faceNames` jméno, které pošle zpět v příkazu. Hrany a oblasti analogicky.

**Web Worker.** Vše, co přes API prochází, jsou serializovatelná data. API je ale synchronní, takže přesun enginu do Workeru znamená asynchronní obal nad stejnými příkazy a stavem, ne nulovou změnu. V PoC běží engine v hlavním vlákně.

## Ověření proti scénářům

| Scénář | Jak ho návrh pokrývá |
|---|---|
| 1 Základní průchod | Změna kóty → nový dokument → přepočet od první skici. Výřez odkazuje na `endCap` extrude E1, jméno přežije. Díra okótovaná k promítnuté hraně se posune s okrajem. |
| 2a Přidání díry | Oblast ji získá automaticky, žádné ID se neposune, pozdější reference platí. |
| 2b Smazání úsečky obdélníku | Profil se rozpadne, první extrude skončí v chybě `noProfile`. Těleso nevznikne, takže vše, co na něm závisí, skončí v chybě `brokenReference`. |
| 2c Nahrazení úsečky jinou | Úsečka L3 se smaže a mezi stejné body se nakreslí L9. Oblast z původních křivek zanikla, extrude skončí v chybě `noProfile`. Uživatel vybere profil znovu a extrude projde. Víka si jméno nechají, skici na nich platí dál; pokud mají promítnutou hranu k zaniklé stěně z L3, dostanou varování `brokenProjection` a hrana zůstane zmrazená. Skica přímo na stěně „side E1/L3" skončí v chybě `brokenReference` a uživatel vybere novou stěnu. |
| 3 Solver | `SolveResult` nese stupně volnosti a konfliktní vazby. Konfliktní skica má stav `warning` a model nezmizí. Tažení přes `preview` s `drag`. |
| 4 Round-trip | Dokument je jediný zdroj pravdy, `evaluate` je čistá deterministická funkce. Po načtení se skici neřeší znovu, protože razítko odpovídá. |
| 5 Časová osa a undo | Vlastní rovina je feature jako každá jiná. Vložení, potlačení a přesun jsou příkazy nad seznamem features, validace hlídá pořadí závislostí. Undo vrací předchozí dokument. |
| 6 Navazování geometrie | Promítnutá kružnice dává pevný střed, soustředná díra ho sleduje. Lícující nálitek nechá obě stěny a hranu druhu `coplanar`. Další operace na zbytku posunuté stěny funguje díky návratu do roviny v adaptéru. |

## Výsledky spiků

Provedeno 2026-11-13 v Node 25. Skripty jsou ve složce `spikes/` a jdou spustit znovu (`npm install`, pak `node <skript>`).

### Manifold (`manifold-3d` 3.5.5)

Skripty: `manifold-spike.mjs`, `manifold-ghost.mjs`, `manifold-determinism.mjs`. Každý případ běžel v osově zarovnané i v obecně natočené poloze.

| Předpoklad | Výsledek |
|---|---|
| `faceID` ze vstupu přežije booleany | Platí. Čísla stěn obou operandů jsou ve výstupu zachovaná. |
| Válcová plocha zůstane jednou stěnou, normály míří ven z materiálu | Platí. |
| Rozdělená stěna si nechá číslo v obou částech | Platí. |
| Stěny v jedné rovině s různými čísly nesplynou | Platí. |
| Výstup je uzavřené těleso, objem odpovídá | Platí ve všech případech. |
| Koplanární plochy, osově | Bez potíží i bez přesahu. |
| Koplanární plochy, šikmo | **Neplatí bez úprav.** Nálitek bez přesahu zůstal oddělený vnitřní stěnou; kapsa s bokem v rovině boku tělesa nechala v ústí blánu. Přesah 0,01 obojí odstranil. Nastavení tolerance ani `simplify` nepomáhá. Vedlo k záruce č. 3 a úpravě v adaptéru (D19). |
| Přesnost | Vstup i výstup jen `Float32Array`, API pro float64 neexistuje. Vedlo k rozhodnutí D20. |
| `triangulate` v JS API | Platí, včetně polygonu s dírou. |
| Determinismus | Opakovaný boolean dá bitově stejný výstup. |
| Běh v Node | Platí. |

Úzké trojúhelníky se objevily jen v jednom případě (dva v šikmém sjednocení lícujících těles).

### Koplanární stěny v adaptéru

Skript: `manifold-adapter-spike.mjs`. Ověřuje, že záruku č. 3 jde splnit uvnitř adaptéru jen ze sítě a čísel stěn, bez znalosti jmen a bez zásahu do core. Nástroje jsou postavené přesně, bez ručního přesahu.

Jednotlivé případy, každý osově i šikmo: nálitek a kapsa přesně na stěně, kapsa s bokem v rovině boku tělesa, výřez přesně na tloušťku, válcová díra a válcový čep, bok kapsy vychýlený o ±3e-6 (napodobuje přichycení na bod s přesností float32), bok 0,05 od roviny (posunout se nesmí), nástroj dosedající zvenku, lícující sjednocení, stupňovité těleso, částečný překryv, stejná rovina bez překryvu.

Řetězené případy, každý osově i šikmo: nálitek zavěšený na stropě tunelu a kapsa do téhož stropu (strop je zbytek posunuté stěny), blok pod převisem nálitku, který přesahuje okraj stěny.

| Varianta adaptéru | Prošlo |
|---|---|
| Posun před booleanem a návrat po něm | 34 z 34 |
| Jen posun, bez návratu (první verze) | řetězené případy selhaly: nálitek na stropě tunelu byl samostatná komponenta |
| Bez úprav | selhává většina šikmých případů |

S návratem do roviny leží strop tunelu přesně na zadané výšce (bez něj o 0,002 až 0,003 výš). Úprava má asi 150 řádků.

### planegcs (`@salusoft89/planegcs` 1.3.0)

Skript: `planegcs-spike.mjs`. Prošlo 33 z 34 kontrol.

| Předpoklad | Výsledek |
|---|---|
| Stupně volnosti | Platí (`dof()`). |
| Konfliktní vazby | Platí. Vrací celou skupinu vazeb v konfliktu, ne jen tu naposled přidanou. Stav řešení je pak `Failed`. |
| Nadbytečné vazby | Platí. |
| Pevné body | Platí (`fixed: true`), nepohnou se ani o bit. |
| Pevný poloměr promítnuté kružnice | Platí přes vazbu `circle_radius`; soustředná díra i tečna k pevné kružnici fungují. |
| Podmínky oblouku | Platí přes `arc_rules`. Adaptér musí dopočítat poloměr a úhly z bodů, planegcs je chce na vstupu. |
| Mapování variant vazeb | Všech 17 zkoušených variant má protějšek. `horizontalDistance` a `verticalDistance` se mapují na vazbu `difference` nad souřadnicemi bodů. |
| Splněný vstup se vrátí beze změny | Platí bitově, pro plně určenou i podurčenou skicu. |
| Determinismus | Platí bitově. |
| Tažení přes dočasné vazby | Platí. 30 kroků, vazby drží, bod sleduje cíl ve volném směru, žádné skoky. Ověřeno navazujícími kroky i bezstavově, kdy každý krok začíná z uložených poloh a cíl se vzdaluje (tak to volá `preview`). |
| Referenční kóty | **Neplatí.** Neřídicí kóta přidala stupeň volnosti a vrátila nesmyslnou hodnotu. Engine je proto solveru neposílá. |
| Běh v Node | Platí. |

Poznámky pro adaptér:
- Solver při hledání nadbytečných vazeb vypisuje ladicí text na standardní výstup; je potřeba ho vypnout nebo odfiltrovat.
- Paměť WASM se uvolňuje ručně (`destroy_gcs_module`).
- Nezkoušeno: tečnost s obloukem (`tangent_la`, `tangent_ca`, `tangent_aa`) a bod na oblouku (`point_on_arc`). Vazby v knihovně existují.
