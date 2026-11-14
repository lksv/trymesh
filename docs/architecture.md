# Architektura

Stav: odsouhlaseno 2026-11-13 (D10–D28), předpoklady ověřeny spiky. Změny z implementace (D29–D31) čekají na potvrzení; D32 až D34 jsou odsouhlaseny 2026-11-14.

Vychází z [requirements.md](requirements.md) a [decisions.md](decisions.md). Návrh UI je v [ui.md](ui.md).

Poslední úprava: 2026-11-14

## Přehled

```
┌──────────────────────────┐
│ UI + renderer (three.js) │   kreslí, hlásí výběr myší
└───────────┬──────────────┘
            │ příkazy (JSON) ↓        ↑ stav, sítě (typed arrays)
┌───────────┴──────────────────────────────────────────┐
│ Engine (TypeScript, bez runtime závislostí)          │
│                                                      │
│  engine     fasáda: příkazy, undo/redo, náhled       │
│  document   datový model, příkazy, serializace       │
│  sketch     model skici, detekce profilů             │
│  solid      síť tělesa, stavba extrude, jména, STL   │
│  evaluate   přehrání logu, cache, chybové stavy      │
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

pnpm workspace. Hranice jsou tím vynucené fyzicky: `engine` nemá v `package.json` žádnou závislost.

```
packages/
  engine/            jádro, čistý TS
  solver-planegcs/   adaptér SketchSolver
  kernel-manifold/   adaptér SolidKernel
  scenarios/         validační scénáře proti skutečným adaptérům (jen testy)
  app/               ukázkové UI + renderer (three.js)
  mcp/               rozhraní pro AI: MCP server a most do běžící aplikace
```

Moduly aplikace (`packages/app/src`): `viewport.ts` (three.js: vykreslení popisu scény, paprsek pod kurzorem, zásah tělesa), `sketch-view.ts` (geometrie skici pro vykreslení, test zásahu a měření), `sketch-commands.ts` (příkazy kreslicích nástrojů, vazby a kóty z výběru), `app.ts` (stav UI, režimy, časová osa, panely). Spouští se `pnpm dev`.

Moduly enginu (`packages/engine/src`): `catalog.ts` (katalog vazeb), `document.ts` (validace a provedení příkazů, načtení), `analysis.ts` a `diagnose.ts` (rozbor určenosti skici a diagnostika), `sketch.ts` (vstup solveru a razítko, referenční kóty, profily a oblasti), `solid.ts` (síť extrude, stěny a hrany tělesa, rovina na stěně, promítnutí hrany, STL), `evaluate.ts` (přepočet s cache), `engine.ts` (fasáda).

Moduly rozhraní pro AI (`packages/mcp/src`): `tools.ts` (nástroje nad enginem, bez závislosti na Node i prohlížeči), `api.ts` (popis API generovaný ze zdrojů enginu), `server.ts` a `main.ts` (MCP server a jeho spuštění), `bridge.ts` a `bridge-client.ts` (most mezi serverem a aplikací). Sestavuje se `pnpm mcp:build`; je to jediný balíček, který se skládá do jednoho souboru, protože ho spouští Node bez Vite.

Testy: Vitest (`pnpm test`), typová kontrola `pnpm typecheck`. Validační scénáře běží v Node proti skutečným adaptérům. Balíčky se neskládají: každý vystavuje přímo zdrojový TypeScript.

Stav 2026-11-14: oba adaptéry a engine jsou hotové včetně testů; všech šest validačních scénářů prochází v Node proti skutečným adaptérům. Ukázková aplikace pokrývá funkce z [ui.md](ui.md) potřebné k jejich projití v prohlížeči (D31).

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
  inputs: string;                         // otisk křivek, vazeb a hodnot promítnuté geometrie; počítá engine
  external: Record<Id, Projected>;        // poslední platné hodnoty promítnuté geometrie
}

type Projected =
  | { kind: 'line';   a: [number, number]; b: [number, number] }
  | { kind: 'circle'; center: [number, number]; radius: number };

type Curve = { construction?: boolean } & (
  | { type: 'line';   a: Id; b: Id }                       // ID bodů
  | { type: 'circle'; center: Id }                         // poloměr je v `radii`
  | { type: 'arc';    center: Id; start: Id; end: Id }     // proti směru hodin
);

type ExternalRef = { type: 'edge'; body: Id; edge: EdgeName; kind: 'line' | 'circle' };   // kind: jako co se hrana promítá

// Každá varianta má pojmenované operandy s pevným významem.
type Constraint = GeometricConstraint | Dimension;

type GeometricConstraint =
  | { type: 'coincident';   a: Id; b: Id }            // bod, bod
  | { type: 'pointOnCurve'; point: Id; curve: Id }
  | { type: 'horizontal' | 'vertical'; line: Id }
  | { type: 'parallel' | 'perpendicular' | 'equalLength'; a: Id; b: Id }  // úsečky
  | { type: 'tangent';      a: Id; b: Id }            // úsečka–kružnice/oblouk, nebo dvě kružnice/oblouky
  | { type: 'symmetric';    a: Id; b: Id; line: Id }  // body a, b souměrně podle přímky úsečky (osy)
  | { type: 'midpoint';     point: Id; line: Id };    // bod ve středu úsečky

type Dimension = { value: number; driving: boolean } & (
  | { type: 'distance';           a: Id; b: Id }      // bod–bod (délka úsečky = její koncové body)
  | { type: 'distancePointLine';  point: Id; line: Id }
  | { type: 'horizontalDistance' | 'verticalDistance'; a: Id; b: Id }   // bod, bod; orientovaná: b.x − a.x, resp. b.y − a.y
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
- **Základní roviny** mají pevné pravotočivé souřadné systémy (osa X skici, osa Y skici, normála): XY = (+X, +Y, +Z), XZ = (+X, +Z, −Y), YZ = (+Y, +Z, +X).
- **Znaménko kót.** `horizontalDistance` a `verticalDistance` jsou orientované (b − a) a smějí být záporné; UI volí pořadí bodů tak, aby hodnota při vytvoření vyšla kladná. Orientace brání tomu, aby se bod při řešení překlopil na druhou stranu. `distance` a `distancePointLine` jsou neorientované a nezáporné, `radius` a `diameter` kladné.
- **Tolerance enginu** jsou pevné konstanty: délková 1e-6 mm (splněná `coincident`, dotyk křivek při detekci profilu) a úhlová 1e-4 rad (stěny v téže rovině při určování druhu hrany). Tolerance booleanů jsou věcí jádra, engine je nezná.
- **Razítko** `solved.inputs` počítá engine jako otisk kanonického zápisu vstupů (klíče seřazené podle konvence výše). Volající ho nevyplňuje: v `addFeature` posílá skicu s prázdným razítkem (`inputs: ''`, `external: {}`) a engine ho po prvním řešení přepíše.
- **Rozsah extrude** je v kódu zatím jen pevná `distance`; díra okótovaná pevnou vzdáleností po změně tloušťky tělesa procházet přestane. D35 to mění (zatím neimplementováno): rozsah bude varianta (`distance`, „skrz vše", později „po stěnu") a vysunutí dostane zdroj profilu. Dokud se D35 neimplementuje, popisuje tento dokument stav kódu a plánované změny jsou v decisions.md, D35.

### Skica

**Body** jsou samostatné entity a křivky na ně odkazují. Dvě úsečky sdílející bod jsou spojené bez vazby. Vazba `coincident` zůstává pro spojení dodatečně.

Křivka smí odkazovat jen na vlastní body skici a na `origin`, ne na odvozené body promítnuté geometrie. K promítnutému bodu se vlastní bod připojí vazbou `coincident`. Smazání promítnutí tak odstraní jen vazby a nikdy nenechá křivku bez koncového bodu.

**Počátek.** Každá skica má rezervovaný bod s ID `origin` v poloze (0, 0). Je pevný, solver s ním nehýbe a nejde smazat. Natočení kotví vazby `horizontal` a `vertical`, které se vztahují k osám skici.

**Oblouk.** `start` i `end` musí ležet ve stejné vzdálenosti od `center`. Tuto implicitní podmínku zajišťuje solver, v dokumentu se jako vazba neukládá.

**Konstrukční geometrie.** Křivka s `construction: true` slouží jen jako pomůcka pro vazby (osy, pomocné čáry). Detekce profilů ji ignoruje.

**Referenční kóty.** Kóta s `driving: false` geometrii neřídí, jen měří. Solveru se neposílá; její hodnotu počítá engine z vyřešených proměnných a vrací ji ve výsledku skici (`measurements`).

**Nadbytečné vazby** nejsou chyba ani varování. Automaticky odvozené vazby je budou vyrábět běžně. Výsledek skici nese v `redundant` jen to, co ohlásí solver, a ten ohlásí z každé závislé skupiny jen některé; úplný přehled dává diagnostika skici (viz níže). Přesnou duplicitu (stejný typ a stejné operandy u dvou řídicích vazeb) engine nepřijme vůbec.

**Promítnutá geometrie (D23).** Položka `external` promítne hranu tělesa do roviny skici jako pevnou referenční křivku. Uživatel k ní váže a kótuje stejně jako k vlastní geometrii, takže například díra drží vzdálenost od okraje nebo soustřednost s válcem i po změně tělesa.

`kind` říká, jako jaká křivka se má hrana promítnout. Volí ho ten, kdo promítnutí zakládá, podle druhu hrany (`edges[i].kind`). Ukládá se proto, že z něj plynou odvozená ID a přípustné vazby: příkaz i `load` tak jdou ověřit jen ze struktury dokumentu, bez přepočtu, a dávka může na promítnutou křivku navázat hned v dalším příkazu.

Co se skutečně promítne, plyne z druhu hrany a z polohy roviny:

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
- **Promítnutí, které nejde vyhodnotit, skicu neshodí.** Když hrana zanikla, nejde ji promítnout nebo by se promítla jako jiný druh křivky, než říká `kind` (`unsupportedProjection`), skica dostane varování a promítnutá křivka zůstane zmrazená na posledních platných hodnotách ze `solved.external`. Vazby na ni platí dál. Pokud žádné platné hodnoty nejsou (promítnutí se nepovedlo nikdy), vazby na tuto křivku se při řešení vynechají a varování je vyjmenuje.

**Připravenost na elipsu.** Promítání do šikmé roviny přidá variantu `ellipse` do `Curve`, do `kind` a `Projected` a do portu solveru odpovídající vazby. Zbytek návrhu se nemění: `fixed` v `SolveInput` pracuje s obecnými ID a kód, který zpracovává křivky, musí neznámou variantu odmítnout chybou, ne ji tiše přeskočit. Kružnice promítnutá s `kind: 'circle'`, jejíž rovina se později naklonila, skončí varováním a zůstane zmrazená; uživatel promítnutí založí znovu jako elipsu.

### Řešení skici (D12)

Skica má **řešené proměnné** (polohy bodů v `points`, poloměry kružnic v `radii`) a **vstupy solveru** (křivky, vazby s hodnotami a hodnoty promítnuté geometrie). Razítko `solved.inputs` je otisk vstupů, pro které uložené proměnné platí.

Řešení probíhá na jediném místě, při přepočtu. Příkazy solver samy nevolají (s výjimkou tažení, viz níže), jen mění dokument:

1. Spočítá se promítnutá geometrie ze stavu těles před skicou.
2. **Otisk vstupů se shoduje s razítkem:** uložené proměnné se použijí beze změny. Solver se volá jen kvůli konfliktům a nadbytečným vazbám, které sám hlásí; stupně volnosti počítá engine vlastním rozborem (viz Diagnostika skici).
3. **Neshoduje se:** skica se vyřeší, počátečním odhadem jsou uložené proměnné. Dál v logu se použije výsledek solveru.
4. **Solver řešení nenajde:** použijí se uložené proměnné a skica dostane varování `sketchConflict`. Přehrávání pokračuje, model nezmizí.

Stejné pravidlo tak pokrývá změnu tělesa i úpravu skici samotné. Změna kóty z 40 na 50, přidání vazby nebo nakreslení křivky změní otisk vstupů, takže následný přepočet skicu vyřeší. Platí to shodně pro `execute`, `preview` i `batch` (u dávky se řeší jednou, po posledním příkazu).

**Zápis výsledku.** Po `execute` engine u skic vyřešených v kroku 3 zapíše do dokumentu atomicky všechny řešené proměnné (body i poloměry) a nové razítko, v rámci téhož kroku undo. Při konfliktu se nezapisuje nic, takže se skica při dalším přepočtu zkusí vyřešit znovu.

**Tažení bodu** je jediný příkaz, který solveru dodává vstup mimo dokument (cíl tažení). Engine skicu vyřeší s dočasným cílem, výchozím odhadem jsou vždy uložené proměnné. `preview(dragPoint)` výsledek jen vrátí, `execute(dragPoint)` ho zapíše jako nové proměnné spolu s aktuálním razítkem, stejně jako každé jiné úspěšné řešení. Cíl tažení se do `evaluate` předává parametrem `drag`: promítnutá geometrie skici se musí spočítat ze stavu těles před ní dřív, než se zavolá solver, a features za skicou se počítají z výsledku tažení. Náhledy jsou bezstavové, každý začíná z uložených poloh; spike potvrdil, že to drží bez skoků i při vzdáleném cíli.

**Cache.** Zápis vytvoří nový objekt feature, takže by memoizace podle identity minula. Engine proto záznam v cache převěsí ze starého objektu na nový. Je to korektní z konstrukce: nový objekt projde při přepočtu větví 2 a dá přesně ty proměnné, které předtím dal solver.

**Determinismus.** `evaluate` je čistá deterministická funkce dokumentu. Po uložení a načtení se razítko shoduje, solver se pro proměnné nevolá a výsledek je bitově stejný (scénář 4). Opírá se to jen o determinismus solveru a jádra, které spiky potvrdily.

**Vědomý důsledek.** Kvůli zápisu výsledku počítá `execute` vždy celý model, i když uživatel kreslí ve skice uprostřed logu; šetří jen `preview(cmd, at)` a `getState(at)`. Pro PoC je to přijatelné. Pozdější optimalizace: zápis odložit a dopočítat zbytek modelu až při opuštění skici.

### Diagnostika skici (D32)

Dva dotazy, které dokument ani vyhodnocení nemění:

```ts
interface SketchDiagnosis {
  status: 'solved' | 'conflict' | 'failed' | 'unavailable';
  degreesOfFreedom: number;
  conflicting: Id[];
  duplicates: Id[][];   // skupiny řídicích vazeb se stejným typem a operandy
  redundant: Id[];      // vazby, které plynou z ostatních
  removable: Id[];      // sada, kterou jde odebrat naráz beze změny volnosti
  free: { id: Id; kind: 'point' | 'radius'; freedom: number }[];
}
interface ConstraintExplanation {
  redundant: boolean;
  impliedBy: Id[];      // sada ostatních vazeb, ze kterých vazba plyne a ze které nejde nic ubrat
}
```

Diagnostika se počítá **rozborem v prvním řádu**, bez solveru. Každá vazba je jedna nebo dvě rovnice nad polohami bodů a poloměry kružnic (`engine/src/analysis.ts`); k nim se přidá podmínka každého oblouku. Z derivací rovnic ve vyřešeném stavu (Jacobiho matice, numericky) plyne všechno ostatní lineární algebrou:

- **Stupně volnosti** jsou počet proměnných minus hodnost matice. Tuto hodnotu nese i výsledek skici (`degreesOfFreedom`); počet, který hlásí solver, engine nepoužívá.
- **Nadbytečná** je řídicí vazba, jejíž řádky leží v prostoru řádků ostatních vazeb: po jejím odebrání zůstane volnost stejná. V závislé skupině jsou tak označené všechny členy, ne jen ten poslední přidaný: kterýkoli z nich jde odebrat.
- **Sada k odebrání** vzniká postupným odebíráním od nejnovější vazby, dokud to hodnost nesnižuje. Složení sady závisí na pořadí vazeb: starší vazby zůstávají. Počet vazeb v ní na pořadí nezávisí, pokud mají všechny závislé vazby jednu rovnici; vazba se dvěma rovnicemi (totožnost, souměrnost, střed úsečky) může nahradit dvě jiné, takže vedle totožnosti a nulové vodorovné i svislé vzdálenosti týchž bodů je sadou buď totožnost, nebo obě kóty. Odebírá se jen celá vazba: vazba, ze které je navíc jen jedna rovnice ze dvou, v sadě není. Po odebrání celé sady nezbude nadbytečná žádná vazba a geometrie se nezmění. Pořadí vazeb je pořadí klíčů v dokumentu; ID ve tvaru celého čísla řadí JavaScript číselně před ostatní, takže u nich pořadí vzniku neplatí.
- **Vysvětlení vazby** je sada ostatních vazeb, ze kterých plyne a ze které už nejde žádnou vynechat. Sad může být víc a nemusí jít o tu s nejmenším počtem vazeb; přednost má duplicita a pak vazby na stejných entitách. Prázdná sada u nadbytečné vazby znamená, že vazba plyne z definice křivky samotné (konec oblouku leží na oblouku).
- **Volnost entity** je počet nezávislých směrů, kterými se bod může pohnout, aniž poruší vazby (u poloměru kružnice 0 nebo 1). Bod na křivce má volnost 1, volný bod 2. Součet volností může být větší než volnost skici, protože body se hýbou spolu. Rovná-li se volnost bodu volnosti celé skici, stačí ho ukotvit a skica je určená: tak se pozná tvar, kterému chybí jen poloha.
- **Stav.** Při konfliktu nebo neúspěchu solveru se vrací jen stav, konfliktní vazby a duplicity. `unavailable` znamená, že se skica nevyhodnotila (je potlačená nebo má rozbitou rovinu). Neznámá skica nebo vazba je chyba volání (výjimka), stejně jako u `getState(at)`.
- **Referenční kóty a vazby vynechané kvůli ztracené promítnuté geometrii** se diagnostiky netýkají, solver je nedostává.

**Rovnice vazeb** mají rozměr délky, takže jejich derivace jsou bezrozměrné a prahy rozboru nezávisí na měřítku skici. Závisí jen na rozdílech poloh: vyhodnocují se v souřadnicích vzhledem k bodu vazby, aby malý útvar daleko od počátku neztrácel přesnost, a krok derivace se řídí velikostí geometrie vazby. Kde se rovnice s nulovou pravou stranou dělí délkou (rovnoběžnost, kolmost), je dělitelem délka ve vyřešeném stavu, tedy konstanta; dělení větší z obou délek by u stejně dlouhých úseček mělo zlom. Jejich význam musí odpovídat adaptéru solveru; testy ověřují pro každý typ vazby, že vyřešená skica rovnice splňuje a že vazba ubere tolik volnosti, kolik má rovnic. Tabulka rovnic je úplná z typů: nová vazba bez rovnice se nepřeloží.

**Dvojnásobné kořeny.** Rozbor v prvním řádu nevidí podmínku, která ve vyřešeném stavu říká v prvním řádu totéž co jiné vazby, i když skicu ve skutečnosti omezuje. Dva takové případy jsou běžné a rovnice se pro ně volí jinak:

- **Tečnost ve společném bodě.** Úsečka končící na kružnici, které se má dotýkat, nebo dva oblouky navazující ve společném konci (zaoblení, drážka). Obecná rovnice tečnosti (vzdálenost středu od přímky se rovná poloměru) tu má stejný řádek jako podmínka, že konec úsečky leží na kružnici. Tečnost se pak počítá jako kolmost poloměru na úsečku v tom bodě, respektive jako tři body na přímce (oba středy a společný bod). Tato podoba se použije jen tehdy, když konec úsečky nebo oblouku na kružnici drží ostatní vazby (společný bod, totožnost, bod na křivce, obecně cokoli kromě tečností): rozbor to pozná tak, že podmínka „bod leží na kružnici" leží v prostoru řádků ostatních vazeb. Leží-li tam bod jen shodou rozměrů nebo až díky tečnosti samé, platí obecná rovnice; jinak by z rozboru vypadl poloměr kružnice.
- **Nulová vzdálenost dvou bodů** se počítá jako totožnost (dvě rovnice).

Ostatní takové případy rozbor nepozná:

- Vazbu, která z ostatních plyne jen díky konkrétním hodnotám, jako nadbytečnou neoznačí (vzdálenost dvou bodů rovná jejich vodorovné vzdálenosti dělá úsečku vodorovnou). Výsledek tu může záviset na šumu ve vyřešených polohách.
- Společný bod tečnosti, který není koncem úsečky ani oblouku (samostatný bod přichycený na obě křivky), nebo který na kružnici drží až jiná tečnost: volnost vyjde o jedna větší.
- Plyne-li v trojici tečnost, bod na kružnici a kolmost poloměru kterákoli vazba ze zbylých dvou, označí rozbor jako zaměnitelné jen tečnost a kolmost.
- Skica blízko singulárního stavu (řádky závislé s odchylkou řádu 1e-7 až 1e-6) leží na hraně prahu a výsledek může záviset na pořadí vazeb.

**Proč ne solver.** První verze se ptala solveru: řešila skicu znovu bez každé vazby a porovnávala stupně volnosti. Revize ukázala, že počet ze solveru není spolehlivý (cyklus shodných délek v trojúhelníku ohlásí jako plně určený, u úsečky stažené do bodu volnost s přidanou vazbou vzroste, šum ve vyřešených polohách mění výsledek) a že desítky řešení jsou u větších skic pomalé (sekundy až desítky sekund při stovkách vazeb).

**Cena.** Rozbor (derivace a jedna ortogonalizace řádků) se počítá při každém vyhodnocení vyřešené skici, tedy i při každém kroku tažení. Roste se třetí mocninou počtu vazeb: do stovky vazeb jednotky milisekund, 240 vazeb kolem 15 ms, 480 kolem 0,1 s, 960 kolem 0,8 s. Skici v PoC mají desítky vazeb; pro stovky by se rozbor musel počítat až na vyžádání nebo po souvislých částech skici. Diagnostika a vysvětlení k němu přidají další lineární algebru stejného řádu. Výsledek diagnostiky se pamatuje podle vyhodnocené skici: dokud se skica ani stav před ní nezmění, nepočítá se znovu.

**Omezení solveru, které diagnostika odhalí, ale neodstraní.** Nadbytečnou vazbu, kterou solver sám nepozná (třetí rovnost délek v trojúhelníku), bere solver jako plnohodnotnou; skica se pak chová jako plně určená a bodem nejde táhnout, dokud se vazba neodebere.

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
- Hrana mezi dvěma stěnami v téže rovině (výstupek zarovnaný s horní stěnou) má druh `coplanar`. Průsečnice neexistuje a hranice nemusí být přímá. Nekreslí se a nejde promítnout. „V téže rovině" znamená, že normály obou stěn svírají úhel pod úhlovou tolerancí enginu. Přesná rovnoběžnost nestačí: stěna z úsečky přichycené na krajní body promítnutých hran je od stěny tělesa odkloněná o zlomek úhlové vteřiny a průsečnice takových rovin by vyšla kilometry daleko.
- Hrana se vrací jako seznam úseček (`segments`), ne jako jedna lomená čára: hrana rozdělená výřezem má víc nesouvislých úseků a jedna čára by je spojila přes prázdný prostor.
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

**Spojování bodů.** Dva body skici se pro účely profilu považují za jeden, když je to tentýž bod, nebo když je spojuje vazba `coincident`, která je v použitých polohách skutečně splněná (vzdálenost do délkové tolerance enginu). Samotná existence vazby nestačí: konfliktní `coincident` mezi dvěma rohy obdélníku, která se nesplnila, profil nezmění. Spojování je tranzitivní a jde i přes počátek a promítnuté body: dva konce přichycené vazbou ke stejnému promítnutému bodu jsou jeden vrchol grafu.

**Graf.** Křivky skici (bez konstrukčních a promítnutých) tvoří rovinný graf. Křivky se smějí dotýkat jen ve spojených bodech. Když se dvě křivky kříží nebo se k sobě jinde přiblíží pod délkovou toleranci, třeba proto, že se profil po vyřešení sám protnul, je profil neplatný a extrude nad touto skicou skončí v chybě `invalidProfile`. Totéž se ověřuje ještě jednou po rozdělení oblouků na úsečky, protože těleso vzniká z lomených čar a ty se od oblouku liší až o `chordTolerance`: když se hranice oblastí po rozdělení kříží (křivka míjí oblouk těsněji, než dělení rozliší) nebo oblast splaskne do dvou bodů (je tenčí než tolerance), je profil také neplatný. Engine tak jádru nikdy nepředá síť, která není uzavřeným tělesem. Platí to i pro tečný dotyk: kružnice tečná k hraně obdélníku, pokud nejsou jedna z nich konstrukční, zneplatní profil celé skici. Je to záměrně přísné a jednoduché; těleso s nulovou tloušťkou stěny by stejně vzniknout nemohlo.

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
2. Oblouky a kružnice se rozdělí na segmenty podle `chordTolerance`, nejvýš na 4096 úseček na křivku (u obřích poloměrů pak dělení toleranci nedodrží).
3. Engine postaví uzavřenou síť: dvě víka (triangulace přes jádro) a boční stěny. Každý trojúhelník dostane číslo stěny podle jména.
4. Pro `add` a `cut` se zavolá boolean s cílovým tělesem.

Výsledky, které nejsou běžné:

| Situace | Chování |
|---|---|
| `cut` těleso mine, `add` nic nepřidá | Těleso zůstane beze změny, feature má varování `noEffect`. Změna objemu se měří proti menšímu z obou těles (těleso, nástroj), takže drobný výstupek na velké desce účinek má. |
| `add` kusu, který se tělesa nedotýká | Těleso má dvě nesouvislé části; stav je `ok`. |
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

Když solver najde stav, který není použitelná geometrie (nekonečná hodnota, nekladný poloměr, oblouk s konci na různých poloměrech), vrací adaptér `failed`.

Jak adaptér planegcs řeší:
1. Při tažení nejdřív vyřeší skicu bez tažení a zjistí nadbytečné vazby. S dočasným cílem tažení by je knihovna ohlásila jako konflikt, proto se při tažení vynechají.
2. Vyřeší skicu. Když výchozí algoritmus (DogLeg) nedoběhne a konflikt nehlásí, zkusí Levenberg–Marquardt; stejně postupuje FreeCAD.
3. Řeší znovu z nalezeného stavu, dokud není ustálený. Knihovna totiž stupně volnosti a nadbytečné vazby hlásí podle výchozího odhadu, ne podle výsledku, a ve stavu `Converged` může nechat nadbytečnou vazbu nesplněnou. Vrácená diagnostika tak popisuje vrácenou geometrii a opakované řešení z výsledku dá totéž; o to se opírá krok 2 řešení skici (jen diagnostika z uložených proměnných).

Adaptér překládá každou variantu `Constraint` na odpovídající vazbu knihovny jedna ku jedné podle `type`. Neznámý druh křivky nebo ID ve `fixed`, které není bod ani kružnice, je výjimka. Pomocné vazby, které si přidává sám (podmínky oblouku, pevný poloměr promítnuté kružnice), z `conflicting` a `redundant` odfiltruje: výsledek smí obsahovat jen ID ze vstupu. Při stavu `conflict` nebo `failed` nemá `degreesOfFreedom` význam: knihovna vrací −1, adaptér předá 0 a UI se řídí varováním `sketchConflict` a seznamem `conflicting`.

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
  triangulate(loops: Float64Array[]): Uint32Array;   // 2D polygon s dírami: vnější smyčka proti směru hodin, díry po směru
}
```

Předpoklad na vstupu: čísla stěn v `a` i `b` pocházejí z jedné společné tabulky. Stejné číslo znamená stejnou stěnu, různé stěny mají různá čísla. Zajišťuje to engine (viz tabulka čísel stěn v sekci Přepočet).

Záruky implementace:
1. Výstup `boolean` je uzavřené těleso.
2. Každý výstupní trojúhelník má `faceId` stěny, ze které pochází.
3. Rovinné stěny obou operandů, které leží v jedné rovině v rámci tolerance jádra a překrývají se, se berou jako shodné. Výsledek neobsahuje blány, vnitřní stěny ani zbytky stěn, které měly zaniknout. Platí pro sjednocení a rozdíl; průnik engine v PoC nepoužívá a adaptér Manifoldu u něj záruku neplní.
4. Stejný vstup dá vždy stejný výstup.

Když adaptér výsledek zaručit nedokáže, skončí výjimkou a engine ji ohlásí jako `kernelFailure`. Potichu vadné těleso vrátit nesmí. Výjimkou končí i vadný vstup: neuzavřená nebo dovnitř orientovaná síť, nesedící počet čísel stěn.

**Jak záruku č. 3 plní adaptér Manifoldu.** Manifold sám toleranci ke skoro-koplanárním plochám nemá a na šikmých stěnách kvůli float32 selhává. Adaptér se proto řídí jedním pravidlem: stěny nástroje a tělesa se v jedné rovině nesmějí jen dotýkat. Každý takový styk změní před booleanem na skutečný průnik a po booleanu posunuté stěny vrátí.

Před booleanem:
1. Proloží roviny stěnami obou těles (podle čísel stěn). Stěna je rovinná, když její vrcholy leží do tolerance od proložené roviny. Podle normál jednotlivých trojúhelníků se nerozhoduje: úzký trojúhelník z dřívějšího booleanu má normálu nespolehlivou a celou stěnu by označil za nerovinnou.
2. Najde dvojice stěn nástroje a tělesa v jedné rovině, které se překrývají, dotýkají, nebo je dělí mezera do dvou přesahů. Dotyk se počítá, protože bok nálitku se boku tělesa dotýká jen hranou. Mezera se počítá, protože se stěny posunem sousedních stěn o přesah protáhnou.
3. Stěnu nástroje posune o přesah tak, aby se nástroj zvětšil. Jediná výjimka: u rozdílu, když nástroj na těleso dosedá zvenku, se nástroj zmenší. Když stěna nástroje potká ve své rovině stěny obou orientací (horní stěnu a spodek převisu), má zvětšení přednost; zmenšení by na lícující části nechalo blánu.
4. Vrcholy posouvá podél průsečnic sousedních stěn, aby se sousední stěny nenaklonily.

Po booleanu:
5. Vrátí zpět vše, co po posunu ve výsledku zůstalo. Polohy se neodhadují z okolí, dopočítají se přesně z původní, neposunuté geometrie. Každý vrchol výsledku je totiž buď vrchol jednoho z těles, nebo průsečík hrany jednoho tělesa se stěnou druhého:
   - posunutý vrchol nástroje se vrátí na původní vrchol,
   - průsečík hrany nástroje, jejíž konec se posunul (včetně úhlopříček triangulace), se stěnou tělesa se přesune do průsečíku původní hrany s rovinou té stěny,
   - průsečík hrany tělesa s posunutou stěnou nástroje, a každý jiný vrchol v pásu mezi původní a posunutou rovinou, se přesune po té hraně tělesa do původní roviny,
   - průsečík, který by na původní hraně ležel mimo její konce, v přesné geometrii neexistuje; stáhne se do bližšího konce.
6. Vyčistí síť, a to vždy, i když se nic neposouvalo:
   - sloučí vrcholy na stejném místě,
   - zahodí trojúhelníky s vrcholy v přímce a blány nulové tloušťky,
   - hrany, které tím zůstaly bez protějšku, dorovná: trojúhelník s takovou hranou rozdělí ve vrcholu, který na ní leží a ve kterém protější strana navazuje (T-spoj),
   - kde se těleso samo sebe dotýká jen hranou, rozdělí povrch po klínech materiálu.
7. Ověří výsledek a jinak skončí chybou (`kernelFailure`):
   - síť je uzavřená plocha (každá hrana právě ve dvou trojúhelnících, jednou v každém směru),
   - žádná rovinná stěna nemá trojúhelník otočený proti své normále.

Proč jsou kroky 5 až 7 nutné:
- Bez návratu leží zbylá stěna o přesah vedle roviny, kterou pro ni engine počítá analyticky, a další operace na ní selže: nálitek zavěšený na takové stěně skončil ve spiku jako samostatná komponenta s mezerou 0,002 mm. Výstup adaptéru tedy musí být konzistentní s analytickou geometrií v rámci přesnosti float32, ne v rámci přesahu.
- Bez čištění zůstanou po pásu nulové šířky trojúhelníky, které dál nesou číslo zaniklé stěny, a reference na ni by se nerozbila. Totéž nechává jádro samo tam, kde se nástroj tělesa jen dotkne hranou; proto se čistí vždy.
- Bez kontroly by chyba prošla potichu. Manifold síť, která není uzavřenou plochou, při dalším booleanu načte bez chyby, část trojúhelníků zahodí a změní objem (ve spiku o stovky mm³).

Co se ukázalo až v obecně natočené poloze a v náhodných testech:
- Roviny stěn se prokládají přes celou stěnu. Normály jednotlivých trojúhelníků výsledku použít nejde: úzké trojúhelníky je mají vychýlené o desítky stupňů.
- Návrat jen „do roviny" nestačí. Průsečík hrany, která se posunem natočila, zůstane ve správných rovinách, ale o zlomek přesahu vedle. Sám nevadí, dokud pozdější nástroj nemá stěnu přesně v tom místě; pak se síť přeloží. Proto se polohy dopočítávají z původních hran.
- Svislá hrana válce může ležet celá v rovině boku tělesa. Průsečík s takovou rovinou není určený; bere se nejpříčnější ze stěn tělesa, kterých se vrchol dotýká.
- Posun vrcholů nástroje před booleanem se počítá v ortonormální bázi normál. Výpočet přes regularizovanou soustavu 3×3 byl pro vrchol držený jedinou šikmou rovinou nestabilní.
- Tenký trojúhelník není totéž co trojúhelník s vrcholy v přímce. Jádro běžně vrací jehly: dva vrcholy pár desetitisícin od sebe a třetí daleko. Jehla má plochu a do sítě patří. Za nulový se proto bere trojúhelník užší než čtvrtina tolerance slučování (přesnost float32), širší jen tehdy, když jeho prostřední vrchol leží zřetelně uvnitř nejdelší strany.
- Dělit se smějí jen hrany bez protějšku. První verze dělila každou hranu, u které ležel cizí vrchol dost blízko její přímky. U zdravé hrany vycházející pod malým úhlem to vedlo ke střídání dvou stavů, z nichž ani jeden nebyl uzavřený.
- Po dotyku hranou se zdvojené vrcholy při dalším booleanu zase sloučí a dělí znovu. Dělení přes nový vrchol uprostřed hrany tak při každé další operaci zdvojnásobilo počet trojúhelníků v místě dotyku. Kde to jde, zdvojí se proto existující vrchol.
- Přesnost float32 klesá se vzdáleností od počátku. Tolerance odvozené jen z rozměru modelu selhávaly u modelu 60 mm velkého a 450 mm vzdáleného od počátku.
- Zmenšený nástroj mohl přeskočit stěnu tělesa ležící těsně za jeho stěnou; materiál mezi nimi zůstal jako blána. Posouvá se proto nejvýš do poloviny mezery.

Důsledek pro jména: kde stěna nástroje lícuje se stěnou tělesa a překrývají se plochou, nese překrytou část ve výsledku jméno stěny nástroje. Obě stěny dál existují a dělí je hrana druhu `coplanar`.

Všechny tolerance odvozuje adaptér z rozměru D: úhlopříčka obálky obou těles, nejméně však dvojnásobek největší souřadnice (model daleko od počátku má horší přesnost float32). Stejná rovina 1e-5 D, přesah 4e-5 D, slučování vrcholů 1e-6 D. V dokumentu ani v core se nenastavují.

Omezení:
- **Rozlišení.** Detail menší než asi 1e-4 D (u modelu 70 mm kolem 0,01 mm) těsně u lícujících stěn adaptér nezvládá spolehlivě: schod nebo mezera této velikosti, o kterou se nástroj posouvá. Výsledek je pak buď správný, nebo chyba `kernelFailure`; testy z revize potvrzují, že potichu vadný není. Od 0,05 mm výš prošly všechny zkoušené polohy.
- Řeší se jen rovinné stěny. Válcová stěna nástroje shodná s válcovou stěnou tělesa (rozšíření díry na stejný poloměr, výřez přesně podle válcového nálitku) ne; povrch pak vyjde špatně a chyba se neohlásí.
- Stěna nástroje užší než 8e-5 D (kapsa hluboká pár tisícin) se pro určení roviny nepoužije a lícování na ní se nepozná.
- Průnik se neupravuje (viz záruka č. 3).
- Návrat posunutých stěn porovnává každý vrchol výsledku se všemi posunutými hranami nástroje a hranami tělesa. U těles do několika tisíc trojúhelníků to nevadí; u desky se 192 kruhovými otvory (19 tisíc trojúhelníků) trval jeden boolean 7,6 s, samotné jádro 0,07 s. Prostorové vyhledávání je možná pozdější optimalizace.
- Vyčištění průchodem přes Manifold nejde použít: nulové trojúhelníky sbalil špatným směrem a poškodil těleso. Síť si adaptér čistí sám.
- Těleso, které se samo sebe dotýká jen hranou, adaptér zpracuje (v síti jsou v místě dotyku zdvojené vrcholy). Geometricky je to ale mezní stav a další operace přesně v místě dotyku zkoušené nejsou.
- Zkoušené nástroje jsou hranoly (kvádry, trojboké hranoly se šikmou stěnou) a válce. Jiné v PoC nevznikají, nástroj je vždy extrude.
- Výřez, jehož víko zároveň lícuje se spodkem převisu a leží na opačně orientované stěně v téže rovině, přejmenuje dotčenou část té stěny na víko nástroje. Geometrie je správná.
- Obalová funkce `triangulate` v knihovně neuvolňuje paměť WASM (u smyčky s 256 body 8 kB na volání). Adaptér proto volá funkci pod ní a paměť uvolňuje sám; je to vnitřní rozhraní knihovny a při její aktualizaci se musí ověřit.

**Přesnost (D20).** Manifold přijímá i vrací souřadnice jen ve `Float32Array`, proto je má `Solid` také v tomto typu. Engine geometrii nikdy neodvozuje ze sítě, pokud ji umí spočítat analyticky; analytické výpočty běží ve float64. Naměřená odchylka vrcholů od roviny po 12 booleanech za sebou na šikmé stěně byla 2e-6.

`Solid` jsou čistá data. Přechod na B-rep by znamenal jiný typ tělesa a jiný adaptér; jména, reference a přepočet zůstanou.

## Přepočet

V kódu je přepočet metodou třídy `Evaluator` (`evaluate.ts`), která drží cache; adaptéry dostane při vytvoření. Signatura popisuje vstupy a výstup:

```ts
function evaluate(doc: Document, deps: { solver; kernel }, opts?: {
  upTo?: Id;                                                        // skončit u této feature
  drag?: { sketch: Id; point: Id; target: { x: number; y: number } };   // tažení bodu, viz Řešení skici
}): Evaluation;

interface Evaluation {
  features: Record<Id, FeatureResult>;
  bodies: Record<Id, BodyResult>;           // stav po poslední vyhodnocené feature
  faceNames: FaceName[];                    // společná tabulka, index = číslo stěny
}

interface BodyResult {
  solid: Solid;
  faces: { id: number; planar: boolean }[];             // stěny, které těleso má
  edges: { name: EdgeName; kind: 'line' | 'circle' | 'coplanar' | 'other'; segments: Float64Array }[];   // segments: úsečky, 6 čísel na úsečku
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
- Potlačená feature (`suppressed`) se chová jako prázdná operace, stejně jako feature v chybě. Co na ní závisí, skončí v `brokenReference`, promítnutí v `brokenProjection`.
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
  diagnoseSketch(sketch: Id): SketchDiagnosis;   // viz Diagnostika skici
  explainConstraint(sketch: Id, constraint: Id): ConstraintExplanation;
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
  | { type: 'updateExtrude'; id: Id; sketch?: Id; regions?: RegionRef[]; distance?: number;
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

**Validace.** Každý příkaz se před provedením ověří. Neplatný příkaz dokument nezmění a vrátí `invalidCommand` s popisem. Dávka je atomická: neplatný kterýkoli příkaz zruší celou dávku a `commandIndex` říká, který to byl. Validace pracuje jen se strukturou dokumentu, přepočet k ní není potřeba. Ověřuje se:

- **ID** nových entit jsou jedinečná a splňují konvence: bez `/`, ne `origin`, ne prázdné a ne jméno vlastnosti, kterou má každý objekt (`constructor`, `toString`…), protože ID jsou klíče záznamů.
- **Odkazy uvnitř skici** musí vést na existující entity správného typu (vazba `parallel` dostala dvě úsečky). Křivka odkazuje na vlastní body nebo `origin`. Vazba smí odkazovat i na promítnutou geometrii; její odvozené entity plynou z `kind` (`<id>`, `<id>/a`, `<id>/b` u úsečky, `<id>`, `<id>/center` u kružnice). Protože mazání ve skici kaskáduje, platí toto pravidlo v každém dokumentu.
- **Odkazy mezi features** se ověřují tam, kde je příkaz nastavuje (`addFeature`, `updatePlane`, `setSketchPlane`, `updateExtrude`, `addExternal`, `updateExternal`): cílová feature existuje, má správný typ a leží před odkazující feature. U stěny a hrany se takto ověřuje těleso i extrude, které stěnu pojmenovalo (stěna existuje až po něm). `moveFeature` nesmí feature přesunout před feature, na kterou odkazuje, ani za feature, která odkazuje na ni.
- **Odkaz na feature, která v dokumentu není, validaci neporušuje.** Vzniká povoleným `removeFeature` a projeví se až při přepočtu jako `brokenReference`, `noProfile` nebo `brokenProjection`. Totéž platí pro jména stěn a hran a pro ID křivek v `regions`: ta se strukturálně ověřit nedají a rozbíjejí se běžnými úpravami.
- **Vazba musí mít aspoň jeden operand, kterým solver může hýbat.** Řídicí vazbu jen mezi pevnými entitami (počátek, promítnutá geometrie) solver tiše ignoruje, takže by se nikdy neprojevila ani jako konflikt; je proto neplatná. Referenční kóta mezi pevnými entitami platná je.
- **Stejná řídicí vazba nesmí být ve skice dvakrát.** `addConstraint` odmítne vazbu se stejným typem a stejnými operandy, jaké už má jiná geometrická vazba nebo řídicí kóta; u vazeb s operandy `a`, `b` na jejich pořadí nezáleží. Platí to i pro kótu s jinou hodnotou (upravit se má ta stávající) a pro přepnutí referenční kóty na řídicí. Referenční kóta smí měřit totéž co řídicí. `load` duplicity přijímá, aby šly otevřít starší dokumenty; ukáže je diagnostika a hodnotu takové kóty jde dál měnit. Druhy operandů, jejich zaměnitelnost a pravidla hodnot jsou v katalogu vazeb (`engine/src/catalog.ts`), kterým se validace řídí.
- **Hodnoty.** Čísla jsou konečná a v rozsahu ±1e9; záporná nula se ukládá jako nula. `distance` u extrude není nula a `regions` není prázdné (tatáž oblast dvakrát je jedna oblast). Poloměr nové kružnice je kladný. Hodnoty kót splňují konvenci znamének.
- `origin` a odvozené entity promítnuté geometrie nejde smazat ani jimi táhnout.

Příkaz, který je strukturálně v pořádku, ale vede k chybě přepočtu (konfliktní vazba, zaniklá stěna), se provede a problém se objeví ve stavu feature.

**Chování fasády:**

- **Krok undo vzniká jen změnou obsahu dokumentu.** Přejmenování na stejné jméno nebo tažení plně určeného bodu historii nezaplní.
- **Tažení, které solver nevyřeší,** dokument ani stav enginu nezmění; konflikt z neúspěšného pokusu ukáže jen `preview`.
- **`getState(at)` s neznámou feature vyhodí výjimku; `preview(cmd, at)`** vrátí `invalidCommand`, když `at` v dokumentu po příkazu není. Tichý přepočet celé osy by zakryl chybu volajícího.
- **Posluchači (`subscribe`)** dostanou stavy v pořadí, v jakém vznikly, i když některý z nich sám zavolá engine: vnořená změna se rozešle až po dokončení právě běžícího kola. Výjimka posluchače ostatní o zprávu nepřipraví a vyhodí se až nakonec; stav je v té chvíli už zapsaný.
- **Nový bod a nová křivka ruší razítko řešení skici,** protože zapisují řešené proměnné přímo. Skica se pak při přepočtu vyřeší znovu, i kdyby se otisk vstupů solveru shodoval.

**Pravidla mazání:**

- `removeEntity` kaskáduje: smazání bodu odstraní křivky, které na něm stojí, a smazání bodu nebo křivky odstraní vazby, které na ně odkazují. Křivky v `regions` pozdějších extrude zůstanou a extrude skončí v `noProfile`.
- `removeExternal` odstraní vazby na promítnutou křivku a její odvozené body. Vlastní křivky na promítnuté body neodkazují, takže se jich mazání netýká.
- `updateExternal` zachová ID, takže vazby zůstanou. Smí změnit hranu, ne `kind`: změna druhu by změnila odvozená ID. Kdo chce místo úsečky kružnici, promítnutí smaže a vytvoří nové.
- `removeFeature` nekaskáduje: závislé features zůstanou a skončí v chybě. Opravit je jde bez ztráty ID: `updateExtrude` umí změnit i zdrojovou skicu (spolu s novým výběrem oblastí), `setSketchPlane` rovinu, `updatePlane` základ.

**`load`** ověří verzi schématu a tatáž pravidla nad celým dokumentem. Odkazy na neexistující features jsou přípustné (viz výše), takže dokument, který vznikl povolenými příkazy, jde vždy uložit a znovu načíst, i když obsahuje features v chybě. Neplatný dokument se nenačte, stav enginu se nezmění a vrátí se `invalidDocument`. Po načtení se vyřešené skici zapíší do dokumentu stejně jako po `execute` a historie undo se smaže.

### Co z API vzešlo z návrhu UI (D24)

- **`batch`**: nakreslení úsečky s automaticky odvozenými vazbami musí být jeden krok undo.
- **`addFeature` s pozicí**: vložení feature doprostřed logu.
- **`getState(at)` a `preview(cmd, at)`**: úprava feature uprostřed logu zobrazuje model v tom okamžiku a nepřepočítává features za ní.
- **Data pro výběr**: stěny s příznakem rovinnosti, hrany s úsečkami a druhem, oblasti skici se smyčkami.

Výběr myší: renderer zjistí index trojúhelníku, přes `faceIds` číslo stěny a přes `faceNames` jméno, které pošle zpět v příkazu. Hrany a oblasti analogicky.

**Web Worker.** Vše, co přes API prochází, jsou serializovatelná data. API je ale synchronní, takže přesun enginu do Workeru znamená asynchronní obal nad stejnými příkazy a stavem, ne nulovou změnu. V PoC běží engine v hlavním vlákně.

## Rozhraní pro AI (D33)

```
klient AI ──stdio──▶ MCP server (Node) ──┬─▶ vlastní engine (dokument ze souboru)
                                         └─▶ most HTTP 127.0.0.1 ──▶ engine běžící aplikace
```

**Nástroje** jsou čisté funkce nad `Engine` (`tools.ts`), takže tentýž kód obsluhuje engine v serveru i engine aplikace. Server k nim přidává nástroje pro soubory, které potřebují disk.

| Nástroj | Co dělá |
|---|---|
| `describe_api` | Konvence, katalog vazeb s operandy a příklady, typy dokumentu a příkazů. Generuje se ze zdrojů enginu. |
| `get_model` | Časová osa se stavy a chybami, tělesa s objemem a rozměry; `at` = stav po dané feature. |
| `get_document` | Dokument tak, jak se ukládá, nebo jedna feature. |
| `get_sketch` | Body s polohami, křivky, vazby, promítnutá geometrie, oblasti, diagnostika a slovní rada (`advice`). |
| `explain_constraint` | Jestli vazba plyne z ostatních a ze kterých. |
| `get_body` | Stěny (rovinnost, plocha, normála) a hrany (druh, délka; u přímé krajní body, u kruhové střed a poloměr) se jmény použitelnými v odkazech. |
| `execute`, `preview` | Příkaz enginu (i `batch`); `preview` nezapisuje. Výsledek shrne, co není v pořádku, a u každé skici řekne, jestli je vyřešená a kolik má volnosti. |
| `undo`, `redo` | Historie příkazů. |
| `session_status` | Jestli nástroje pracují nad aplikací, nebo nad vlastním dokumentem serveru. |
| `open_document`, `save_document`, `export_stl` | Soubory na disku; dokument může být v aplikaci. |

Chyba volání (neznámá skica, špatný argument, neplatný příkaz) se vrací jako text s příznakem chyby, ne jako výjimka protokolu. Malý výsledek se vypisuje s odsazením, velký úsporně.

**Proč se nové vazby a příkazy objeví samy.** `execute` bere jakoukoli hodnotu typu `Command` a validuje ji engine. `describe_api` skládá text ze tří zdrojů: z ručně psaných konvencí, z katalogu vazeb (`CONSTRAINTS`: jméno, shrnutí, operandy a jejich druhy, pravidlo hodnoty) a ze zdrojového textu `engine/src/types.ts` bez sekce portů. Vazba přidaná do enginu je tedy v popisu i v nástrojích bez změny v `packages/mcp`.

**Most.** Server otevře HTTP na `127.0.0.1` (výchozí port 4517). Aplikace se po zapnutí propojení připojí na `GET /events` (proud událostí) a na každý požadavek odpoví `POST /reply`. Dokud je připojená, nástroje se provádějí nad jejím enginem; po odpojení nad vlastním enginem serveru. Platí poslední připojená aplikace; požadavek bez odpovědi do 30 s skončí chybou. Aplikace, kterou jiná vytlačila, dostane událost `displaced` a sama se znovu nepřipojuje (propojení se v ní vypne a jde zapnout zase jen tlačítkem); po výpadku serveru se naopak připojuje sama. Připojit se smí jen stránka z tohoto počítače: server ověřuje původ (`Origin`), cílovou adresu (`Host`) a vlastní hlavičku `x-trymesh-bridge`, kterou musí mít každý požadavek kromě `GET /status`.

**Soubory.** Server si pamatuje soubor vlastního dokumentu a zvlášť soubor dokumentu v aplikaci. Ten platí jen po dobu jednoho připojení a jen pro dokument, který v aplikaci byl, když se do souboru ukládalo nebo z něj načítalo: aplikace s každou odpovědí posílá pořadové číslo dokumentu, které zvýší při každé jeho výměně (Nový, Otevřít, načtení od AI). `save_document` bez cesty ukládá do souboru toho dokumentu, se kterým se právě pracuje; nemá-li žádný, je to chyba. Nástroj složený z více kroků pracuje celý nad enginem zjištěným na svém začátku.

**Spuštění.** `pnpm mcp:build`, pak v klientu AI příkaz `node packages/mcp/dist/server.js` (volby `--file model.json`, `--port`, `--no-bridge`). Pro Claude Code je v kořeni repa `.mcp.json`. V aplikaci se propojení zapíná tlačítkem AI na liště.

## Ověření proti scénářům

| Scénář | Jak ho návrh pokrývá |
|---|---|
| 1 Základní průchod | Změna kóty → nový dokument → přepočet od první skici. Výřez odkazuje na `endCap` extrude E1, jméno přežije. Díra okótovaná k promítnuté hraně se posune s okrajem. |
| 2a Přidání díry | Oblast ji získá automaticky, žádné ID se neposune, pozdější reference platí. |
| 2b Smazání úsečky obdélníku | Profil se rozpadne, první extrude skončí v chybě `noProfile`. Těleso nevznikne, takže vše, co na něm závisí, skončí v chybě `brokenReference`. |
| 2c Nahrazení úsečky jinou | Úsečka L3 se smaže a mezi stejné body se nakreslí L9. Oblast z původních křivek zanikla, extrude skončí v chybě `noProfile`. Uživatel vybere profil znovu a extrude projde. Víka si jméno nechají, skici na nich platí dál; pokud mají promítnutou hranu k zaniklé stěně z L3, dostanou varování `brokenProjection` a hrana zůstane zmrazená. Skica přímo na stěně „side E1/L3" skončí v chybě `brokenReference` a uživatel vybere novou stěnu. |
| 3 Solver | `SolveResult` nese stupně volnosti a konfliktní vazby. Konfliktní skica má stav `warning` a model nezmizí. Tažení přes `preview` s `drag`. |
| 4 Round-trip | Dokument je jediný zdroj pravdy, `evaluate` je čistá deterministická funkce. Po načtení se skici neřeší znovu, protože razítko odpovídá. Dokument s feature v chybě se načte také: odkaz na smazanou feature validaci neporušuje. |
| 5 Časová osa a undo | Vlastní rovina je feature jako každá jiná. Vložení, potlačení a přesun jsou příkazy nad seznamem features, validace hlídá pořadí závislostí. Undo vrací předchozí dokument. |
| 6 Navazování geometrie | Promítnutá kružnice dává pevný střed, soustředná díra ho sleduje. Lícující nálitek nechá obě stěny a hranu druhu `coplanar`, i když je jeho bok vedle roviny o chybu float32. Další operace na zbytku posunuté stěny funguje díky návratu do roviny v adaptéru. Po odříznutém nálitku nezůstanou zbytky jeho stěn, takže reference na ně se rozbijí. |

## Výsledky spiků

Provedeno 2026-11-13 v Node 25. Skripty ověřující samotné knihovny jsou ve složce `spikes/` a jdou spustit znovu (`npm install`, pak `node <skript>`). Adaptéry, které ze spiků vzešly, jsou od 2026-11-14 v balíčcích `kernel-manifold` a `solver-planegcs` a jejich případy běží jako testy.

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

Adaptér: `packages/kernel-manifold/src` (`coplanar.ts` posun a návrat stěn, `clean.ts` čištění sítě, `geometry.ts` roviny a tolerance). Testy: `test/coplanar.test.ts` (jednotlivé případy), `test/fuzz.test.ts` (náhodné) a `test/review.test.ts` (případy z revize). Ověřují, že záruku č. 3 jde splnit uvnitř adaptéru jen ze sítě a čísel stěn, bez znalosti jmen a bez zásahu do core. Nástroje jsou postavené přesně, bez ručního přesahu.

Jednotlivé případy, každý osově i šikmo: nálitek a kapsa přesně na stěně, kapsa s bokem v rovině boku tělesa, výřez přesně na tloušťku, válcová díra a válcový čep, bok kapsy vychýlený o ±3e-6 (napodobuje přichycení na bod s přesností float32), bok 0,05 od roviny (posunout se nesmí), nástroj dosedající zvenku, lícující sjednocení, stupňovité těleso, částečný překryv, stejná rovina bez překryvu.

Řetězené případy, každý osově i šikmo: nálitek zavěšený na stropě tunelu a kapsa do téhož stropu (strop je zbytek posunuté stěny), blok pod převisem nálitku, který přesahuje okraj stěny.

Případy ze čtvrté revize, každý osově i šikmo:
- schod přidaný sjednocením a zase celý odříznutý (jeho boky lícují s boky kvádru),
- nálitek s bokem lícujícím s bokem kvádru a s odchylkou ±3e-6, potom kapsa do horní stěny,
- válcový výřez pod schodem, kde dva vrcholy válce leží v rovině boku schodu (čtyři roviny v jednom vrcholu),
- blok pod převisem, jehož horní stěna zároveň lícuje s horní stěnou kvádru,
- drážka do nálitku od jeho spodku nástrojem, který zároveň leží na horní stěně kvádru.

Každý případ kontroluje čísla stěn, objem, uzavřenost sítě a to, že žádná rovinná stěna nemá přeložený trojúhelník.

| Varianta adaptéru | Prošlo |
|---|---|
| Posun před booleanem, přesný návrat a vyčištění sítě po něm | 46 z 46 |
| Verze po třetí revizi (vracel se jen zbytek posunuté stěny, lícující stěny u sjednocení se neposouvaly) | případy ze čtvrté revize selhaly: po odříznutém schodu zůstaly proužky jeho boků, lícující nálitek šikmo zneplatnil rovinnost horní stěny a další kapsa nechala blánu, strop válcového výřezu ležel 9,999988 až 10,000244 |
| Jen posun, bez návratu (první verze) | řetězené případy selhaly: nálitek na stropě tunelu byl samostatná komponenta |
| Bez úprav | selhává většina šikmých případů |

S návratem leží strop tunelu přesně na zadané výšce (bez něj o 0,002 až 0,003 výš).

**Náhodné testy.** Generátor skládá na kvádr 40 × 30 × 10 jednu až čtyři operace (sjednocení nebo rozdíl) s kvádry, trojbokými hranoly a válci. Rozměry bere z hrubé mřížky, takže stěny často lícují, dosedají nebo se překrývají zčásti; 80 % případů běží v náhodně natočené a posunuté soustavě a 30 % kvádrů má bok vychýlený: o ±3e-6 (napodobuje přichycení na bod s přesností float32), nebo o ±3e-5 (pásmo mezi přesností float32 a tolerancí, mimo návrhový rozsah). Výsledek se porovnává se dvěma orákuly nezávislými na adaptéru:
- mřížkový model (případy jen z kvádrů): přesný objem a pro každé číslo stěny rozsah plochy, kterou smí mít,
- řezy po vrstvách přes 2D booleany: objem a povrch (všechny případy),
- u případů s válci a šikmými stěnami navíc shoda čísel stěn s během téhož případu v osové poloze.

Každý výsledek musí být uzavřený, bez přeloženého trojúhelníku a jádro ho musí načíst se stejným objemem. Adaptér smí případ odmítnout vlastní chybou (neuzavřená nebo přeložená síť); odmítnutí se počítají zvlášť a test hlídá, že jsou vzácná.

Poslední běh (2026-11-14, po opravách z revize): 30 000 případů, žádný vadný výsledek. Tři případy adaptér odmítl chybou: jeden v návrhovém rozsahu (válec, kvádry s odchylkou 3e-6) a dva s odchylkou boku 3e-5. Tisíc případů běží při každém `pnpm test`; rozsah jde změnit proměnnými `FUZZ_COUNT` a `FUZZ_FIRST`.

Vedle toho běží případy z revize (`test/review.test.ts`), každý v desítkách náhodných poloh: mezera a průnik pod rozlišením adaptéru, dotyk hranou následovaný dalšími operacemi, model 450 a 1300 mm od počátku.

Co náhodné testy našly a pevné případy ne:
- Jádro síť, která není uzavřenou plochou, načte bez chyby, část trojúhelníků zahodí a změní objem. Stav knihovny zůstane `NoError`. Proto adaptér uzavřenost kontroluje sám.
- Vrácení posunutých vrcholů „do roviny" nechávalo průsečíky natočených hran o zlomek přesahu vedle; pozdější nástroj se stěnou přesně v tom místě síť přeložil. Návrat se proto počítá z původní geometrie.
- Kde se nástroj tělesa dotkne jen hranou a nic se neposouvá, nechává jádro nulové trojúhelníky s číslem stěny nástroje. Čistí se proto vždy.
- Sloučení vrcholů podle polohy vytvoří v místě, kde se těleso samo sebe dotýká hranou, hranu se čtyřmi trojúhelníky; dělit jen koncové vrcholy nestačilo.
- Průsečík hrany, která rovinu protíná pod malým úhlem, vyšel 1e-4 vedle skutečného vrcholu a vznikl přeložený trojúhelník. Bod blízko konce hrany se bere jako ten konec.
- Jehlové trojúhelníky se při čištění zahazovaly jako nulové (14 případů z 30 000, všechny v natočené poloze s válci). Opraveno přísnějším určením nulového trojúhelníku; po revizi se navíc dělí jen hrany bez protějšku.

Adaptér má asi 900 řádků TypeScriptu; zhruba třetinu tvoří čištění sítě.

### planegcs (`@salusoft89/planegcs` 1.3.0)

Skript: `planegcs-spike.mjs`. Prošlo 36 z 37 kontrol; neprošlá je kontrola referenčních kót, viz tabulka.

| Předpoklad | Výsledek |
|---|---|
| Stupně volnosti | Platí (`dof()`). |
| Konfliktní vazby | Platí. Vrací celou skupinu vazeb v konfliktu, ne jen tu naposled přidanou. Stav řešení je pak většinou `Failed`, ale ne vždy: konflikt se objevil i se stavem `Success`. Adaptér proto rozhoduje podle seznamu konfliktních vazeb. |
| Nadbytečné vazby | Platí. |
| Pevné body | Platí (`fixed: true`), nepohnou se ani o bit. |
| Pevný poloměr promítnuté kružnice | Platí přes vazbu `circle_radius`; soustředná díra i tečna k pevné kružnici fungují. |
| Podmínky oblouku | Platí přes `arc_rules`. Adaptér musí dopočítat poloměr a úhly z bodů, planegcs je chce na vstupu. |
| Mapování variant vazeb | Všechny varianty mají protějšek (24 kombinací vazby a druhu křivky v testech adaptéru). `horizontalDistance` a `verticalDistance` se mapují na vazbu `difference` nad souřadnicemi bodů. |
| Znaménka | Ověřeno testy adaptéru: `difference` dává b − a včetně záporných hodnot, `l2l_angle_ll` měří od první úsečky ke druhé proti směru hodin. |
| Splněný vstup se vrátí beze změny | Platí bitově, pro plně určenou i podurčenou skicu. |
| Determinismus | Platí bitově. |
| Tažení přes dočasné vazby | Platí. 30 kroků, vazby drží, bod sleduje cíl ve volném směru, žádné skoky. Ověřeno navazujícími kroky i bezstavově, kdy každý krok začíná z uložených poloh a cíl se vzdaluje (tak to volá `preview`). |
| Referenční kóty | **Neplatí.** Neřídicí kóta přidala stupeň volnosti a vrátila nesmyslnou hodnotu. Engine je proto solveru neposílá. |
| Vazba jen mezi pevnými entitami | **Solver ji tiše ignoruje.** Šikmá pevná úsečka s vazbou `horizontal` skončí úspěchem bez konfliktu. Takovou vazbu proto odmítá validace příkazů. |
| Diagnostika konfliktu | Mezi konfliktními vazbami se vracejí i pomocné vazby adaptéru; `dof()` při konfliktu nemá význam (pozorováno −1 i 0 až 2). Adaptér pomocné vazby odfiltruje a vrací 0. |
| Běh v Node | Platí. |

Poznámky pro adaptér:
- Solver při hledání nadbytečných vazeb vypisuje ladicí text na standardní výstup. Vypíná se nastavením `debug_mode` na `DebugMode.NoDebug` (ověřeno).
- Úspěšné řešení hlásí knihovna stavem `Success` nebo `Converged`. `Converged` ale znamená jen to, že vazba, kterou knihovna vyhodnotila jako nadbytečnou, nebyla ve výchozím odhadu splněná; nikdo neověří, že je splněná ve výsledku. Adaptér proto řeší znovu z výsledku, dokud nedostane `Success`.
- Paměť WASM se uvolňuje ručně (`destroy_gcs_module`).
- Tečnost s obloukem (`tangent_la`, `tangent_ca`, `tangent_aa`), bod na oblouku (`point_on_arc`) a kóty oblouku jsou ověřené až testy adaptéru (`packages/solver-planegcs/test`), ve spiku nebyly.

Známá omezení solveru, která adaptér neřeší (z revize 2026-11-14, náhodné skici proti nezávislé kontrole zbytků vazeb):
- Nadbytečná vazba, která ve výchozím odhadu není splněná, může skončit konfliktem, i když řešení existuje (nepřesně nakreslený obdélník a k němu rovnoběžnost protějších stran). Z přesnějšího odhadu projde. Není to obecné: kolmost nebo druhá kóta ze stejného odhadu projdou.
- Kóta vzdálenosti mezi dvěma body, které ve výchozím odhadu leží na sobě, skončí konfliktem.
- Oblouk se může překlopit na svůj doplněk (konce si vymění strany) a výsledek je přesto řešením vazeb. Port o rozsahu oblouku nic neříká; engine to zatím nekontroluje.
- U tečnosti dvou kružnic drží knihovna vnější nebo vnitřní dotyk podle výchozího odhadu. Kde druhá varianta vede k zápornému poloměru, vrací adaptér `failed`.
- Výchozí algoritmus selhal (`failed`, bez seznamu vazeb) asi u 4 % náhodných skic. Záložní Levenberg–Marquardt z nich vyřeší asi desetinu; zbytek zůstává `failed`.
