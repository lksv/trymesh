# Architektura

Stav: odsouhlaseno 2026-11-13 (D10–D28), předpoklady ověřeny spiky. Změny z implementace (D29–D31) čekají na potvrzení; D32 až D34 jsou odsouhlaseny 2026-11-14.

Vychází z [requirements.md](requirements.md) a [decisions.md](decisions.md). Návrh UI je v [ui.md](ui.md).

Poslední úprava: 2026-11-15

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

## Where it is written

The design is split by area (D37, part 5), so that work on one area changes one file. A reference "architecture.md, section X" in the code or in an older document means the section of that name in the file of this table.

| File | What it describes | Sections |
|---|---|---|
| [architecture/repository.md](architecture/repository.md) | Packages, the modules of the engine and of the app, and which may import which | Struktura repozitáře |
| [architecture/document.md](architecture/document.md) | The two histories, the types of the document, parameters and expressions | Dvě různé historie; Dokument; Parameters and expressions (D35, point 1) |
| [architecture/sketch.md](architecture/sketch.md) | The sketch, its solution, its diagnosis and the sketch tools | Skica; Řešení skici (D12); Diagnostika skici (D32); Sketch tools (D35, point 7) |
| [architecture/naming.md](architecture/naming.md) | Names of faces and edges, the plane of a sketch on a face, profiles and regions | Pojmenování; Stěny; Hrany (D22); Rovina skici na stěně; Profily a oblasti |
| [architecture/extrude.md](architecture/extrude.md) | The extrusion, its extent and targets, the offset of a profile and a wall along curves, profile generators | Extrude; Extent and targets (D35, point 2); Profile offset and a wall (D44); Profile generators (D35, point 3) |
| [architecture/pattern.md](architecture/pattern.md) | The pattern of bodies and of features | Pattern (D35, point 4) |
| [architecture/ports.md](architecture/ports.md) | The contracts of `SketchSolver` and `SolidKernel` | Porty; SketchSolver; SolidKernel |
| [architecture/recompute.md](architecture/recompute.md) | The replay of the features, its cache and the states of errors | Přepočet |
| [architecture/api.md](architecture/api.md) | The facade, queries, export formats, bodies, the commands and their validation | API enginu; Queries (D37); Export formats (D37); Bodies: volume, export and interference (D35, point 5); Příkazy; Co z API vzešlo z návrhu UI (D24) |
| [architecture/ai.md](architecture/ai.md) | The MCP server, its tools and the bridge to the running app | Rozhraní pro AI (D33) |
| [architecture/verification.md](architecture/verification.md) | The design against the scenarios, the tests of the offset and the wall, and the results of the spikes of both libraries | Ověření proti scénářům; The offset of a profile and a wall (D44); Výsledky spiků; Manifold (`manifold-3d` 3.5.5); Koplanární stěny v adaptéru; planegcs (`@salusoft89/planegcs` 1.3.0) |

A change of the engine, an adapter, the MCP server or the app is described in the file of its area. A new area (a new feature type, a new kind of port) gets a file of its own and a row here.
