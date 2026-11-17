# Architecture: the sketch

Part of [architecture.md](../architecture.md), the design as implemented. The sketch, its solution, its diagnosis and the sketch tools.

## Skica

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

**Points and circles as operands of a generator (D61).** A profile generator of an extrusion reads entities of a sketch by the kinds its catalog lists: a circle (an own one, construction or not, or a projected one) with its solved centre and radius, or a point (an own point, the origin, or a point of projected geometry such as `<id>/center`) with its solved position. A command verifies the kind (`entityOf`); an entity removed later is a broken reference of the extrusion, not of the sketch ([extrude.md](extrude.md), "Profile generators").

**Připravenost na elipsu.** Promítání do šikmé roviny přidá variantu `ellipse` do `Curve`, do `kind` a `Projected` a do portu solveru odpovídající vazby. Zbytek návrhu se nemění: `fixed` v `SolveInput` pracuje s obecnými ID a kód, který zpracovává křivky, musí neznámou variantu odmítnout chybou, ne ji tiše přeskočit. Kružnice promítnutá s `kind: 'circle'`, jejíž rovina se později naklonila, skončí varováním a zůstane zmrazená; uživatel promítnutí založí znovu jako elipsu.

## Řešení skici (D12)

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

Since D35 point 1 the same write-back and re-hanging also carries the values of expressions, for every feature type (see Parameters and expressions).

**Determinismus.** `evaluate` je čistá deterministická funkce dokumentu. Po uložení a načtení se razítko shoduje, solver se pro proměnné nevolá a výsledek je bitově stejný (scénář 4). Opírá se to jen o determinismus solveru a jádra, které spiky potvrdily.

**Vědomý důsledek.** Kvůli zápisu výsledku počítá `execute` vždy celý model, i když uživatel kreslí ve skice uprostřed logu; šetří jen `preview(cmd, at)` a `getState(at)`. Pro PoC je to přijatelné. Pozdější optimalizace: zápis odložit a dopočítat zbytek modelu až při opuštění skici.

## Diagnostika skici (D32)

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

**A fixed point and equal radius (D35, point 6).** `fixed` is two equations over an ordinary variable point: its coordinates relative to the origin of the sketch minus `x` and `y`. It therefore removes two degrees of freedom, a dimension that repeats a coordinate is redundant and explained by the fixed point, and one that contradicts it is a conflict that names both. The list `fixed` of `SolveInput` (the origin and projected geometry) is something else: its points are not variables at all, which is why a constraint on them could not be diagnosed and why `fixed` on the origin or on a projected point is an invalid command. `equalRadius` is one equation, the difference of the two radii; the radius of an arc is the distance of its start from its centre.

**Values of a fixed point.** `x` and `y` are numeric fields like the value of a driving dimension: they take expressions, `setField` changes one of them, `renameParameter` rewrites them and removing the constraint or its point removes them. `setConstraintValue` is for dimensions only. `addConstraint` may leave a coordinate out (`FixedInput`): the engine fills in the position the document has for the point, which is the last solved one (for a point added earlier in the same batch it is the estimate of its `addPoint`, because the sketch is solved once after the whole batch); `null` is not "left out". Only an own point can be fixed: the origin and projected geometry are refused with that reason, with or without coordinates. A point can be fixed once.

Ostatní takové případy rozbor nepozná:

- Vazbu, která z ostatních plyne jen díky konkrétním hodnotám, jako nadbytečnou neoznačí (vzdálenost dvou bodů rovná jejich vodorovné vzdálenosti dělá úsečku vodorovnou). Výsledek tu může záviset na šumu ve vyřešených polohách.
- Společný bod tečnosti, který není koncem úsečky ani oblouku (samostatný bod přichycený na obě křivky), nebo který na kružnici drží až jiná tečnost: volnost vyjde o jedna větší.
- Plyne-li v trojici tečnost, bod na kružnici a kolmost poloměru kterákoli vazba ze zbylých dvou, označí rozbor jako zaměnitelné jen tečnost a kolmost.
- Skica blízko singulárního stavu (řádky závislé s odchylkou řádu 1e-7 až 1e-6) leží na hraně prahu a výsledek může záviset na pořadí vazeb.

**Proč ne solver.** První verze se ptala solveru: řešila skicu znovu bez každé vazby a porovnávala stupně volnosti. Revize ukázala, že počet ze solveru není spolehlivý (cyklus shodných délek v trojúhelníku ohlásí jako plně určený, u úsečky stažené do bodu volnost s přidanou vazbou vzroste, šum ve vyřešených polohách mění výsledek) a že desítky řešení jsou u větších skic pomalé (sekundy až desítky sekund při stovkách vazeb).

**Cena.** Rozbor (derivace a jedna ortogonalizace řádků) se počítá při každém vyhodnocení vyřešené skici, tedy i při každém kroku tažení. Roste se třetí mocninou počtu vazeb: do stovky vazeb jednotky milisekund, 240 vazeb kolem 15 ms, 480 kolem 0,1 s, 960 kolem 0,8 s. Skici v PoC mají desítky vazeb; pro stovky by se rozbor musel počítat až na vyžádání nebo po souvislých částech skici. Diagnostika a vysvětlení k němu přidají další lineární algebru stejného řádu. Výsledek diagnostiky se pamatuje podle vyhodnocené skici: dokud se skica ani stav před ní nezmění, nepočítá se znovu.

**Omezení solveru, které diagnostika odhalí, ale neodstraní.** Nadbytečnou vazbu, kterou solver sám nepozná (třetí rovnost délek v trojúhelníku), bere solver jako plnohodnotnou; skica se pak chová jako plně určená a bodem nejde táhnout, dokud se vazba neodebere.

## Sketch tools (D35, point 7)

A sketch tool draws a whole shape with its constraints from a few inputs. It is a pure function that returns a batch of commands; it does not execute them and the engine itself does not change. The app calls the tools from its drawing tools and MCP offers them as the tool `sketch_tool`, so a shape is drawn the same way from both and a new tool is on both sides at once.

```ts
interface Anchor { at: Vec2; snap?: { kind: 'point'; id: Id } | { kind: 'curve'; id: Id } }   // a place in the sketch and what it snaps to
interface SketchToolContext { sketch: SketchFeature; result?: SketchResult; parameters? }        // the sketch, its solved state, values of parameters
interface SketchToolCall extends SketchToolContext { document: Document }                       // what sketchTool takes (D52)
type NewId = (prefix: string) => Id;                                                            // `p` point, `c` curve, `k` constraint

sketchTool(tool, context: SketchToolCall, input, newId): { ok: true; commands: Command[]; ids: Record<string, Id[]> } | { ok: false; message: string }
nearestCurvePoint(context, curve, to): CurvePointName | undefined                               // which point of a curve is nearest (D52)
SKETCH_TOOLS: Record<SketchToolName, { title; summary; inputs; ids }>                           // the catalog
freshIds(document, prefix?): NewId                                                              // IDs the document does not have
placeAnchor(context, anchor, newId): { id; commands; constraints }                              // the point for an end of a curve
```

- **Where it lives.** `packages/engine/src/sketch-tools.ts`. The tools work only with types of the engine (sketch, solved state, commands), the engine package has no dependency, and both the app and MCP depend on it already. A package of its own would add a boundary and nothing else.
- **The tools of the app's sketch bar are a catalog of their own** (`SKETCH_TOOL_UI` in `packages/app/src/sketch-tools/`, D64, [ui/sketch.md](../ui/sketch.md)): most of them are interactions (select, a chain of lines, project), and an engine tool reaches MCP without the app. A tool of the bar that draws a shape of the engine (rectangle, polygon, fillet) calls `sketchTool`.
- **The catalog** `SKETCH_TOOLS` is the single source of truth: the inputs of a tool (an anchor, a number with its `NumberSpec`, one of a list of options; optional or not; a number that may be an expression) and the names of the lists of IDs it returns, with their order. `sketchTool` checks the input against it (a missing input, an input the tool does not have, a number out of range, an unknown option) before it draws; the MCP description is generated from it.
- **Anchors** are what the drawing tools of the app always did, now shared: an own point or the origin is used as it is; a point of projected geometry gets a new own point with a `coincident` constraint (a curve must not refer to a projected point); a curve gets a point on it nearest to `at` with a `pointOnCurve` constraint. Positions come from the solved state, because projected geometry has them only there.
- **IDs** are supplied by the caller, as in every command. `freshIds` hands out `<prefix><kind><number>` that the whole document does not have (features and the entities of all sketches) and does not repeat itself. It also leaves alone every text the features contain: a region of a profile may still name a curve that was removed (the extrusion is then in error on purpose), and a new curve under that ID would quietly become its profile. The app uses its own counter; MCP uses `freshIds`.
- **What a tool returns.** `ids` name what was made, in a documented order, so the caller can go on: the lines as a region of an extrusion, one line for a horizontal constraint, the size dimension for `setField`.
- **The document in the context (D52).** `sketchTool` takes the context with the document the sketch is in, as a required field (`SketchToolCall`). A tool that changes curves other features name (the fillet) reads it to change those features in the same batch; the rectangle and the polygon do not read it. It is required so that a fillet cannot be drawn without its patches. The functions that never read a document (`placeAnchor`, `anchorPosition`, `nearestCurvePoint`) keep the plain context, and so does the view of a sketch in the app.
- **Input kinds.** An anchor (a place, which may make a point), a number, an option, and `point` (D52): the ID of a point that is there, an own point or `origin`, checked like the snap of an anchor (the sketch has it, it is a point, not one of projected geometry, and it has a position).

**Rectangle** `{ first, opposite }`: four lines, two horizontal and two vertical constraints; the width and the height stay free. `ids.points` are `first`, the corner beside it along x, `opposite`, the corner beside `first` along y; `ids.lines[i]` goes from `points[i]` to `points[i + 1]`. Corners that do not differ in both coordinates are refused.

**Regular polygon** `{ center, vertex, sides, sizeKind?, size? }`, 3 to 64 sides:

- A construction circumscribed circle around `center`, the vertices on it (`pointOnCurve`) and sides of the same length as the first one (`equalLength`). The regular polygon satisfies these and has four degrees of freedom: the centre, the size and the rotation. (An inscribed circle with tangent sides was rejected in D35: a tangent polygon with equal sides need not be regular.)
- `vertex` gives the size and the rotation as drawn. `ids.points[0]` is the vertex, the others follow counter-clockwise; `ids.lines[i]` goes from `points[i]` to `points[i + 1]`.
- `sizeKind` adds a driving dimension of the size, returned as `ids.size`: `circumscribed` is the diameter of the circle, `acrossFlats` the distance from `points[0]` to the line of the opposite side (`distancePointLine`), which exists for an even number of sides only and is the wrench size of a nut. `size` is its value, a number or an expression; `size` without `sizeKind` means `circumscribed`. A size that is given is also the size drawn (an expression through the values of the parameters in the context, when it has them), so the solver starts from a shape that already holds. A vertex that snaps keeps its place: with a centre that does not snap the centre is drawn where the size holds, on the line from the vertex to where it was given, and the start still holds. With both anchors snapped it cannot: the other vertices are drawn at the larger of the given size and the distance of the anchors (drawing them at a size several times smaller than that distance folded polygons of many sides, drawing them as far as the anchors with a size several times larger folded across flats), and the solver brings the rest together. One case of 3888 run against the solver still folds: twelve sides across flats, both anchors on points ten times further apart than the size. Without `size` the dimension takes the size as drawn: rounded to 0.01 with a free vertex, as it is with a vertex that snaps, because a rounded value against a vertex that cannot move is a conflict.
- The rotation is the direction from `center` to `vertex`; a constraint on a side (horizontal, vertical, an angle) then holds it there.
- **The limit of this construction.** Vertices on a circle with equal chords are not only the regular polygon: every step between two vertices may also go backwards, and all vertices may fall into one point. These folded shapes satisfy the same constraints, so the regular polygon is one isolated solution among them, and the solver stays on it only while it is not asked for a big jump. Measured in the review of point 7:
  - A side held horizontal or vertical always worked when it was within 30° of that direction (45° from four sides up); beyond that about half of the cases ended folded. So the polygon is drawn turned as it should be and the constraint only holds it.
  - The dimension of the circumscribed circle took every change (3 to 64 sides, a hundred times smaller or larger). The size across flats took the range of wrench sizes in steps (5.5 to 24), but a change by five to ten times folded polygons of eight sides and more, and a start far from the size did the same; hence the drawing at the given size above.
  - Dragging a vertex exactly through the centre collapses the polygon.
  - A folded polygon is "solved" with status `ok`; it shows by having no region (`regions: 0` in what `execute` and `sketch_tool` return), and undo brings the regular one back. The description of the tool for the AI says all of this.
  - FreeCAD builds its polygon the same way. A construction without folded solutions would fix the oriented angle between neighbouring sides (n − 3 angle dimensions with n − 1 equal lengths); it was not taken because the angles would show as dimensions in the sketch, and it changes what D35 decided. It is the way to go if the limit hurts in practice.

**Fillet** `{ corner, radius }` (D52; the design with its measurements is [2d-sketch-fillet/design.md](../d36/2d-sketch-fillet/design.md)):

- **The corner.** The curves that count are the own curves whose end (a line by `a` or `b`, an arc by `start` or `end`) is in the vertex of the corner: the class of the corner in `pointJoins`, which is how the profile joins points (satisfied `coincident` constraints, through `origin` and projected points too). Projected curves never count and a centre is not an end. Of the curves that count the ones that are not construction curves are taken, or if there are none the construction ones; they have to be exactly two lines, and both have to end at the corner point itself (a line that ends at another point of the vertex is refused with that point named: the caller makes the corner one point first, by `setCurvePoint`). So a construction diagonal of a rectangle stays on its corner, and the bend of a wall along construction lines gets a construction arc.
- **The geometry**, from the solved positions: with `u1`, `u2` the directions along the two lines from the corner, `θ` the angle between them and `r` the radius, the ends of the arc are `r / tan(θ/2)` from the corner along each line and the centre is `r / sin(θ/2)` from it on the bisector. The arc runs counter-clockwise the short way round and is a construction curve when its lines are.
- **The batch**, in this order: `addPoint` × 3 (`ends[0]`, `ends[1]`, the centre), `setCurvePoint` × 2 (the end of each line that was the corner becomes its end of the arc), `addCurve` of the arc, `addConstraint` × 5 (`tangent` of each line with the arc, `pointOnCurve` of the corner with each line, a driving `radius` with the number or expression given), then the patches. A `pointOnCurve` the sketch has already is not added again; `ids.constraints` names the one there. The sketch is already solved as drawn, the freedom does not change (six coordinates, six equations), and one undo takes the whole batch back.
- **The virtual corner.** The corner point stays, held on both lines (a point on a line is on its extension too), so every dimension and constraint on it keeps its meaning: the size of an outline is still measured between its sharp corners. It stays also when nothing else uses it.
- **The patches.** The profile sources are read by feature type (`PROFILE_SOURCES` in `sketch-tools.ts`, typed over the feature types, so a new type does not compile until it says whether it has one; today the extrusion alone). A feature over this sketch whose region names both lines in its outer loop gets the arc into that loop (`updateFeature` with the whole list of regions, sorted loops), and one whose wall names both gets it into its curves. Suppressed features and features in error are patched like the others. A region that has the corner only on the rim of a hole needs no patch (a region is named by its outer loop, its holes are found again at every recompute), so a feature that reads the corner through holes alone gets the round corner by itself and is in no list.
- **What it names.** `ids.patched`: the patched features. `ids.moved`: the sketches whose plane, and the plane features whose base, is a face in the role `side` or `wallSide` of a line of the two that starts (`a`) at the corner: a planar side face starts at the start of its line, so the plane moved along it. `ids.shortened`: the extrusions whose wall names exactly one of the two lines (the wall ends at the arc now, and its straight end is named by the end of the arc), and the sketches that project an edge one of whose faces is `side` or `wallSide` of either line (the edge at the far end of the line and the edge between the two side faces, which is gone and reported as `brokenProjection`, are named as well). The lists are made from the names in the document alone, in the order of the timeline, and say what to look at; they are not a statement about the state after the batch. A face of a pattern copy carries the curve in its name and is read the same way.
- **Refused**, with the tolerances of the engine (`LENGTH_TOLERANCE`, `ANGLE_TOLERANCE`): a corner that is not one (the message lists what ends there), a corner of two points, a line shorter than the length tolerance, lines within the angle tolerance of 0 or π, a radius that does not fit (what would be left of the shorter line is not above the length tolerance; the message gives the bound, the shorter line times `tan(θ/2)`), a radius too small to draw (the radius, the distance from the corner to an end of the arc, or the chord not above the length tolerance), a point out of the range ±`MAX_NUMBER`, a radius as an expression the parameters give no value to (or no parameters), and `equalLength` or `midpoint` on one of the lines (they would measure the shortened line). Whether the arc crosses another curve is not checked.
- **Known limits.** Nothing keeps the arc a fillet afterwards: the sketch holds an arc, two tangencies and a radius, not "the ends of the arc lie between the corner and the far ends of the lines". A later change that leaves the arc no room is often a conflict or an invalid profile, but it can be solved into an arc that runs past the end of a line with no message and a body made from it (measured: open construction lines, a concave outline, the plate 80 × 50 with a radius of 250; pinned in `packages/scenarios/test/fillet.test.ts`). A fillet of two lines needs the solver adapter's rule for a tangency at a common end ([ports.md](ports.md)); without it the fillet cannot be changed after it is drawn.

**Re-pointing a curve.** The command `setCurvePoint` ([api.md](api.md)) gives one place of a curve another point and keeps the ID of the curve, its kind, direction, construction flag and constraints. The fillet uses it; trim and extend will. The table `CURVE_POINTS` (`sketch-content.ts`) names the points of each kind of curve; its type is checked against `CurveShape`.
