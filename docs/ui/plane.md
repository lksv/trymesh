# UI: the plane

Part of [ui.md](../ui.md); how to read the tables is said there. A plane of its own.

## Vlastní rovina

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Vybrat základ (rovina nebo rovinná stěna) | | `faces[i].planar`, `features[id].plane` |
| Náhled při zadávání posunu | `preview(addFeature)` | |
| Potvrdit | `addFeature` (plane) | |
| Změnit posun nebo základ | `updateFeature` | |
