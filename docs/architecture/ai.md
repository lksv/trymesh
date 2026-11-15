# Architecture: the interface for AI

Part of [architecture.md](../architecture.md), the design as implemented. The MCP server, its tools and the bridge to the running app.

## Rozhraní pro AI (D33)

```
klient AI ──stdio──▶ MCP server (Node) ──┬─▶ vlastní engine (dokument ze souboru)
                                         └─▶ most HTTP 127.0.0.1 ──▶ engine běžící aplikace
```

**Nástroje** jsou čisté funkce nad `Engine` (`tools.ts`), takže tentýž kód obsluhuje engine v serveru i engine aplikace. Server k nim přidává nástroje pro soubory, které potřebují disk.

| Nástroj | Co dělá |
|---|---|
| `describe_api` | Konvence, katalog vazeb s operandy a příklady, typy dokumentu a příkazů. Generuje se ze zdrojů enginu. |
| `get_model` | Časová osa se stavy a chybami, tělesa s objemem a rozměry; `at` = stav po dané feature. An extrusion with a generated profile carries its `facts`. |
| `get_document` | Dokument tak, jak se ukládá, nebo jedna feature. |
| `get_sketch` | Body s polohami, křivky, vazby, promítnutá geometrie, oblasti, diagnostika a slovní rada (`advice`). A constraint with expressions lists them by value name (`expressions: { value: "module * Zs" }`), so a constraint with more than one value stays unambiguous. |
| `get_parameters` | Parameters with expressions, values and errors; checks with their result. |
| `explain_constraint` | Jestli vazba plyne z ostatních a ze kterých. |
| `get_body` | Stěny (rovinnost, plocha, normála) a hrany (druh, délka; u přímé krajní body, u kruhové střed a poloměr) se jmény použitelnými v odkazech. |
| `check_interference` | Colliding pairs of bodies with the shared volume, and pairs the kernel could not compute; `bodies`, `threshold`, `at`. |
| `query` | Asks any query of the catalog of the engine: `query` (its name), `args`, `at` (the state after a feature) and `after` (a command previewed first; the query is asked about the result and nothing is written; with both, the document after the command is evaluated up to `at`). Numbers of the answer are rounded to six decimal places, and the keys a query lists in `significant` to that many significant digits. An error is a text that starts with its code. The queries with their arguments are in `describe_api`, section Queries (D37). |
| `execute`, `preview` | Příkaz enginu (i `batch`); `preview` nezapisuje. Výsledek shrne, co není v pořádku, a u každé skici řekne, jestli je vyřešená a kolik má volnosti. It also reports what is not a feature state: `failedChecks`, `parameterErrors`, and `fieldErrors` of features. |
| `sketch_tool` | Runs a sketch tool of the engine (`sketchTool`) in a sketch: `{ sketch, tool, input, prefix?, preview? }`. It generates the IDs with `freshIds` (optionally with a prefix), writes the batch as one command (or only computes it with `preview: true`) and returns `ids` with what `execute` returns. |
| `undo`, `redo` | Historie příkazů. |
| `session_status` | Jestli nástroje pracují nad aplikací, nebo nad vlastním dokumentem serveru. |
| `export` | Exports the model in a format of the catalog `EXPORT_FORMATS`: `format`, `path`, `options` (of the format, checked by the engine), `overwrite`, and `at` and `after` as for `query`. The engine (of the server or of the app) answers the hidden tool `_export` with the files as base64 (`ToolAnswer` of the kind `files`), and the server writes them with the writer of `export_stl` (`export-writer.ts`): a `file` layout to `path`, which is overwritten; a `directory` layout into the folder `path` with the same guarantees as `export_stl` per body. An export with nothing in it is refused with the text of the format. In `options`, and in `args` of the tool `query`, a `null` at the top level counts as not given, as for the arguments of every tool. The writer knows only files directly in the folder: a path with a folder is refused until the first format that has one adds the folders to the writer. |
| `open_document`, `save_document`, `export_stl` | Soubory na disku; dokument může být v aplikaci. `export_stl` takes a list of bodies and with `perBody` writes one file per body into a directory, named by `bodyFileName`. Per body it writes nothing when a file already exists (unless `overwrite`) or when two names differ only in the case of letters: the names come from IDs, so the caller did not choose them one by one. The files are written into a directory of the call inside the target (`mkdtemp`) under their final names and moved once all are on disk, so a failure while writing leaves the target as it was (directories the export had to create are removed again; the path has to leave room for the 23 characters of that directory; a directory of the call that cannot be removed is named in the answer); if a move fails after others succeeded, the new files that replaced nothing are removed again and the files that replaced old ones are named in the error. Exports run one after another, and a call the tools refuse (an unknown argument) does not reach the app over the bridge. |

Chyba volání (neznámá skica, špatný argument, neplatný příkaz) se vrací jako text s příznakem chyby, ne jako výjimka protokolu. Malý výsledek se vypisuje s odsazením, velký úsporně.

`describe_api` lists the profile generators from `GENERATORS` (operands, parameters with ranges and defaults, references, side names, facts and an example profile). It also lists the expression syntax (operators, functions, constants) and the numeric fields that accept an expression; both come from the engine (`EXPRESSION_FUNCTIONS`, `FEATURE_TYPE_INFO[type].fields`, `CONSTRAINTS[type].values`), so a new field or function shows up without touching the server.

`describe_api` has a section *Sketch tools* generated from `SKETCH_TOOLS`: every tool with its inputs (kind, range, optional), the lists of IDs it returns and an example of input, which a test runs through `sketch_tool`.

**Proč se nové vazby a příkazy objeví samy.** `execute` bere jakoukoli hodnotu typu `Command` a validuje ji engine. `describe_api` skládá text ze tří zdrojů: z ručně psaných konvencí, z katalogu vazeb (`CONSTRAINTS`: jméno, shrnutí, operandy a jejich druhy, pravidlo hodnoty) a ze zdrojového textu `engine/src/types.ts` bez sekce portů. Vazba přidaná do enginu je tedy v popisu i v nástrojích bez změny v `packages/mcp`.

**Most.** Server otevře HTTP na `127.0.0.1` (výchozí port 4517). Aplikace se po zapnutí propojení připojí na `GET /events` (proud událostí) a na každý požadavek odpoví `POST /reply`. Dokud je připojená, nástroje se provádějí nad jejím enginem; po odpojení nad vlastním enginem serveru. Platí poslední připojená aplikace; požadavek bez odpovědi do 30 s skončí chybou. Aplikace, kterou jiná vytlačila, dostane událost `displaced` a sama se znovu nepřipojuje (propojení se v ní vypne a jde zapnout zase jen tlačítkem); po výpadku serveru se naopak připojuje sama. Připojit se smí jen stránka z tohoto počítače: server ověřuje původ (`Origin`), cílovou adresu (`Host`) a vlastní hlavičku `x-trymesh-bridge`, kterou musí mít každý požadavek kromě `GET /status`.

**Soubory.** Server si pamatuje soubor vlastního dokumentu a zvlášť soubor dokumentu v aplikaci. Ten platí jen po dobu jednoho připojení a jen pro dokument, který v aplikaci byl, když se do souboru ukládalo nebo z něj načítalo: aplikace s každou odpovědí posílá pořadové číslo dokumentu, které zvýší při každé jeho výměně (Nový, Otevřít, načtení od AI). `save_document` bez cesty ukládá do souboru toho dokumentu, se kterým se právě pracuje; nemá-li žádný, je to chyba. Nástroj složený z více kroků pracuje celý nad enginem zjištěným na svém začátku.

**Spuštění.** `pnpm mcp:build`, pak v klientu AI příkaz `node packages/mcp/dist/server.js` (volby `--file model.json`, `--port`, `--no-bridge`). Pro Claude Code je v kořeni repa `.mcp.json`. V aplikaci se propojení zapíná tlačítkem AI na liště.

**What a tool may answer (D37).** A result of a tool goes through JSON (`callTool`, the bridge), so bytes do not survive it. `ToolAnswer` (`tools.ts`) is the envelope for what is not plain data: `data`, `files` (a layout and files as base64, written by the server: the tool `export`) and `image` (returned to the client as image content of the protocol). A tool or an operation says by its definition that it answers with one; the server does not guess from the shape of a result.

**Operations of the app (D37).** Something only a running app can do, such as a picture of the viewport, is not a query: the engine has no renderer and the operation is asynchronous. It is an entry of `HOST_OPERATIONS` (`host.ts`, shared by the server and the app): a title, a summary, what it returns, its arguments described like those of a query, and `run(host, args)` that answers with a promise of `QueryOutcome<ToolAnswer>`. The registry is empty until the first operation. A package adds an entry, a line in the map `HostOperations` and what the operation needs of the app as a member of `AppHost`; both interfaces grow by declaration merging, and the app (`connectBridge(engine, { host })`) does not compile until it supplies the new member. The host is the app's own object with its engine (`AppHost & { engine }`); an operation gets it as it is, not a copy, so it may be an instance of a class.

- The server lists every operation as a tool of its own under its key, with a schema generated from the description of its arguments, and `describe_api` has the section *Operations of the app*. (A tool per operation, unlike the queries, because one is planned; if they multiply they get one general tool.)
- Without a connected app the tool answers `notAvailable`: the server's own engine has no host. With one, the call crosses the bridge under the name of the operation, and the bridge client runs `callHostOperation` next to `callTool`: the arguments are checked with the checker of queries in the state of the app's document, the defaults are filled in, and a refusal comes back as `code: operation: message`. `Tool.run`, `callTool` and `connectBridge(engine, …)` stay synchronous and carry only the engine.
- A call is looked up among the operations first, so an operation must not have the name of a tool or a leading underscore (`hostOperationProblems`); the server and `connectBridge` refuse to start with a set that breaks it.
- An operation has to answer within the 30 s the bridge waits for any call.
- An exception while the app serves a call is reported by what the call was: a tool that changes the document keeps the warning that the change may have been made; a question (a query, a read, an operation) says that the app failed to answer and that nothing was changed.
- Guards (`packages/mcp/test/host-operations.test.ts`): two tables typed by the map of operations, the rule that the name of an operation is not the name of a tool, and the whole way of a call with operations made up for the test (the server and `connectBridge` take the set of operations as an option).

**Coverage of the engine (D36).** `packages/mcp/test/coverage.test.ts` holds a table typed over the methods of `Engine` that names the tools reaching each one. A new method without an entry does not compile; the test calls each named tool through the server and checks that the engine method ran. Commands need no such table: `execute` takes any `Command` and the description is generated from the engine.
