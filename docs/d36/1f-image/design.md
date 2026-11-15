# 1f View image for the AI

**Decision D43. State: designed, not implemented; fourth version, after three rounds of reviews.** Step 1 of [D36](../../decisions/D36-order-after-d35.md), track A of [the plan](../README.md). Written against the sixth version of the contract of [the preparatory step](../00-prep/design.md), at commit `0dc424b`. The types are in [contract.ts](contract.ts), the scenario and the operation as calls in [calls.ts](calls.ts); both are type-checked by `npx tsc -p docs/d36/tsconfig.json`.

Validation scenario 11 (the queries asked about the robot joint of scenario 9), this package's part: pictures of the joint: whole, the gears alone, and cut through the gears.

It takes the cut of a model from the query `section` of [1a](../1a-section/design.md) and uses the clipping its section view adds to the viewport, so it comes after 1a, not beside it (the plan says only that the two share the viewport; see "Order inside the track" of [1b](../1b-measure/design.md)).

## What the backlog says, checked against the code

[backlog.md](../../backlog.md): the AI does not see the model and checks it by numbers; a picture of a view would give it feedback on shape. The picture can come from the viewport of the app over the bridge; without a connected app it needs a rasteriser of its own. [D36](../../decisions/D36-order-after-d35.md) lists it among the places where reaching a function through MCP needs a deliberate design. The preparatory step decides the form: an operation of the host (`HostOperation`), described like a query, offered as a tool of its own, answering `notAvailable` over a document from a file.

- **The viewport** (`packages/app/src/viewport.ts`) is one `WebGLRenderer` on the page, an orthographic camera with Z up that starts at the direction (0.55, −0.7, 0.45), and a scene built from a `SceneModel`. The renderer is created without `preserveDrawingBuffer`, so the canvas cannot be read back at an arbitrary moment. Its size follows the window and the pixel ratio of the screen. The labels of dimensions are HTML laid over the canvas, not part of it. All bodies share one material and one colour. The directional light is a child of the user's camera, so the model is lit from where the user looks. The material of the lines (`LineMaterial` of three.js) is created without a resolution. `fit(min, max)` zooms the user's camera to a box.
- **The bridge** (`bridge.ts`, `bridge-client.ts`) passes a call as an event to the app and the outcome back in a POST, both as JSON, with no limit on the size and a wait of 30 seconds. The client serves one call at a time and awaits each (`await serve(...)`), so an asynchronous operation fits. Its `beforeCall` ends a draft only for the tools that change the document; a picture is not one of them.
- **The server** (`server.ts`) answers every tool with one text. An image has to go back to the client as image content; the preparatory step adds that (`ToolAnswer` with the kind `image`).
- **Not checked here**: nothing of this was run in a browser. A design session has no installed app in its tree. What has to be confirmed in the implementation is listed under "Open".

## The cheap variant

One operation of the app, `view_image`, and one capability of the host behind it.

**The capability the viewport gives to the host** (`AppHost.view`, `ViewCapability.image`): a picture of a given model from a given camera at a given size, drawn off the screen.

- **Off the screen.** The viewport renders into a render target of the size asked for, with a camera of its own, reads the pixels back and encodes them as PNG with the canvas of the browser. The user's view does not flash, change size or lose its camera, and the picture does not depend on the size of the window or the pixel ratio of the screen. No library is needed for any of it.
- **Its own light.** The light of the app hangs on the user's camera. The camera of a picture carries a light of its own, set the same way relative to it, and the scene of a picture does not contain the user's camera. Otherwise a picture would be lit from wherever the user happens to look, and two calls with the same arguments would differ, which is what the screenshot is rejected for below.
- **What is drawn** is a model, not the user's screen: the bodies of the state with their edges, as the app draws a model. The selection, the hover, the sketches, the planes and the labels of the user's view are not in it. The AI asked about the model; what the user happens to have selected is not its business and would make two calls differ.
- **A colour per body**, from a fixed palette in the order of the bodies. In the app all bodies are one grey, which a person separates by moving the view; in one still picture of a gearbox the parts run into each other.
- **The camera** is a direction and an up vector, fitted to what is drawn, or `current`: the camera of the user as it stands, for "look at what I am looking at".
- **The cut** is the half-space that is cut away and the loops that fill it: exactly what the section view of 1a hands to the scene.
- The answer of the capability carries the picture, its size, its scale in millimetres per pixel and the colour of every body.

**The operation `view_image`** turns its arguments into that request.

- `view`: `iso` (the direction the app starts with), `front`, `back`, `left`, `right`, `top`, `bottom`, or `current`. The model has Z up; `front` is seen from −Y with X to the right, `top` from above with Y up in the picture.
- `bodies`: only these are drawn and the picture is fitted to them. This is how an AI looks inside: the gears without the housing.
- `section`: a plane, an offset and a flip, as the query `section` takes them: the three descriptions of `SECTION_ARGS` themselves, with their titles and the default of the offset. The operation asks that query (with the same state and bodies), which resolves the plane and returns the frame and the loops; the capability clips and fills. So a picture of a cut model and the section view of the app are drawn from one answer, and a plane that is not planar or not there is answered by the query, with its path put under `section`.
  - A cut is filled only from a complete answer, by the rule and the function of 1a (`completeRegions`, a function of the engine next to the query, so `packages/mcp` can import it): a region filled without one of its holes would show material where there is a cavity. A section that does not fit the budget the operation asks with (a million points) is answered as `failed` with the path `['section']`.
- `at`: the model as it was after a feature. An operation of the host has no `at` of its own (the tool `query` has), so it is an argument here; see "Needs".
- `width`, `height`: 800 by 600 by default, 64 to 1600 each.
- A body or a feature that is not in the state is `notAvailable` with the path of the argument, as for a query. The operation looks them up itself; see "Needs".

**The size of an image in a tool answer.** A picture is PNG, which keeps edges sharp and compresses flat shading well. The default of 800 by 600 is enough to tell parts and holes apart and costs a model on the order of several hundred tokens; the limit of 1600 a side is about where vision models start to scale a picture down, so more pixels would be paid for and not seen. A guard refuses a picture whose base64 text is over two million characters (`failed`: ask for a smaller one), so that no setting produces a tool answer of megabytes. The numbers are estimates until measured on the joint.

**Over a document from a file** the server's host has no `view`, and the operation answers `notAvailable` with what to do: connect the app, or ask `section` and `body`, which describe the shape in numbers without it.

**Is a rasteriser of its own worth it: not now.** What it would take, without a library: a z-buffer over triangles with flat shading in a parallel view, the edges drawn with a depth test, the fill of a cut, and a PNG writer over the deflate that Node has built in; some three to four hundred lines in the server, and a second renderer to keep in step with the first (colours, edges, the cut). What it would give: a picture in the one mode where the AI works with nobody watching. Whether that mode matters is the owner's call (see "Open"). The contract does not stand in its way: a rasteriser is a `view` capability of the server's host, and the operation, its arguments and its answer stay as they are.

**Deferred.**

- A rasteriser in the server.
- A picture of a previewed change (`after`) or of a pose (5a). The operation takes the document as it is, and the shared contract gives it no way to take anything else; see "Needs".
- Sketches, planes, dimensions and a highlighted face in the picture.
- A perspective view, a free camera given by numbers, several views in one call.
- A legend in the picture itself.

## Where it lives

```
packages/mcp/src/
  operations.ts        HOST_OPERATIONS with `view_image`: the arguments to a request, the checks
packages/app/src/
  viewport.ts          image(scene, camera, width, height): the render target, the read-back, the PNG
  scene.ts             a scene of a model alone (bodies, edges, a colour per body, a cut) from a state
  app.ts               the host of the app with `view`; the button that saves a picture
```

`operations.ts` is in `packages/mcp` because the server and the app share it, as they share `tools.ts`; it uses nothing of Node, of the browser or of the app (the app depends on `packages/mcp`, not the other way round). The picture is made in the app; the server only passes it on as image content.

The implementation of the preparatory step, begun on `master` after this branch was cut, keeps the registry and the entry of an operation in `packages/mcp/src/host.ts` (`HOST_OPERATIONS`, `callHostOperation`). The operation goes next to them, and `callHostOperation` takes the place of the stand-in `callOperation` of this design; what it checks before `run` has to be compared with the second need below when this package is implemented.

## What it adds

| To | What |
|---|---|
| The document | nothing |
| Commands | none |
| `Queries` | none |
| `HostOperations` | `view_image` |
| `AppHost` | `view`, the capability of the viewport |
| Issue codes | none |
| MCP | the tool `view_image`, listed from the registry of operations |

## What the app shows

Nothing changes on the screen when the AI takes a picture: it is drawn off the screen, and the status bar says that a picture was taken. For a person the same capability is behind one toolbar button, "Save picture of the model", that saves a PNG from the camera of the view at a fixed size (`calls.ts`, `saveImage`): the app's half of the rule that a function is reachable both ways, and a use of its own (a picture for a note or an issue).

- While the section view of 1a shows a cut, the saved picture is cut the same way: the button hands the capability the answer the view is drawn from. Bodies the user has hidden are left out of the picture, and so are the fills of their cuts (a region of the section knows its body).
- When the section shown is not complete (the view then clips without a fill and says so), nothing is saved and the status bar says why. A picture without the cut, of a view that shows one, would be the wrong picture; it is the answer `failed` of the operation, for a person.
- The picture is of the model, as every picture of the capability is: without the selection, the sketches, the planes and the labels. The label of the button says so.
- The other arguments of the operation (a named view, some bodies, an earlier state) are not behind the button. The view of the app already does each of them for a person: turn the camera, hide bodies, move the marker.

## Needs from the preparatory step

- **The path of an operation of the host.** The contract has the registry (`HOST_OPERATIONS`) and one sentence: an operation "goes through an entry of its own next to" `callTool`, "which takes the host and is awaited". It has no signature for that entry, and does not say how the app hands its host to the bridge client (`connectBridge(engine, options)` takes an engine), how the server builds the input schema of the tool from the description, or where the server turns a `ToolAnswer` of the kind `image` into image content. The case that cannot be written: calling `view_image` in a scenario at all. Stand-in: `callOperation(host, name, args)` in `contract.ts`.
- **Who checks the arguments of an operation.** `HostOperation.run` gets `RunArgsOf`, so something fills in the defaults before it, and with them presumably checks shape and range. For a query the engine also looks up every ID in the state asked about; an operation has no such state. The case: `view_image` with `bodies: ['nope']`, or with a `section.plane` on a body that is gone. Proposed: the path of an operation checks shape and range and fills in defaults, and IDs are the operation's own to look up, because only it knows which state it means. This design is written that way (`requestOf`).
- **Data next to a picture.** `ToolAnswer` of the kind `image` is a media type and the bytes. The capability knows the scale of the picture in millimetres per pixel and which colour is which body, and has no way to send them: an AI that sees a red part cannot be told it is the carrier. Proposed: an optional `about` on the image answer, as a file of an export has, printed as text next to the picture. Until then the operation drops both.
- **The state an operation works on.** The tool `query` takes `at` and `after`, and the engine takes a previewed state; an operation gets its host and its arguments, and the kinds of arguments have none for a command, so `after` cannot be written as an argument either. The case that cannot be written: a picture of the joint with the backlash stepped to 0.2 without writing the change down, and, with 5a, a picture of a posed mechanism, which is where a picture says most. Proposed: the path of an operation takes `at` and `after` as the tool `query` does and hands `run` the state to work on. `at` then leaves the arguments of `view_image`.
- It touches one need of 1b: the type of an entry of `fields` has no title. The three arguments of `section` are the descriptions of the query reused as values, so they carry their titles; a form built from the declared type still cannot read them.

## Rejected

- **A screenshot of the user's canvas** (`toDataURL` on the canvas of the page). It needs a render in the same task or a renderer that keeps its buffer, comes out at the size of the window times the pixel ratio of the screen, and shows the user's selection, sketches and hidden bodies, so two calls with the same arguments differ.
- **Moving the user's camera to the named view and back.** The view jumps in front of the user for every picture.
- **A query instead of an operation.** Decided by the preparatory step: the engine has no renderer and the operation is asynchronous.
- **A headless browser or a WebGL for Node behind the server.** Either is a new third-party library with native parts (D2), for the mode that has no app.
- **JPEG.** Smaller for photographs; for flat shading and thin edges it is larger at a quality that keeps the edges, and it blurs them.
- **One grey for all bodies, as in the app.** See above; the cost is a palette.
- **A cut computed in the renderer alone** (clip and a stencil cap). The picture would then show a cut the AI cannot get as numbers, and the operation would need its own way to resolve a plane.

## Open

- **For the owner: is the app normally connected when the AI works?** If the AI often works over a document from a file with nobody at the app, a picture is not available exactly there, and the rasteriser in the server moves from "deferred" to this package. It is the one question of scope here; no library is involved either way.
- To confirm in the implementation, in a browser:
  - rendering to a target and reading it back works while the tab is in the background (the renderer does not depend on the animation frame, but browsers throttle hidden tabs in their own ways);
  - the line material of the edges draws lines of the right width at the size of the target. The app sets no resolution on it today, and the width of such a line is in pixels of a resolution the material has to be told; a picture of another size than the canvas may need it set for the render and set back;
  - the real size of a picture of the joint at 800 by 600 and at 1600 by 1200, against the guard;
  - the colours of a target match those of the canvas (the colour space of a render target is set apart from the canvas's).
- Whether `view: 'current'` of the operation should also take the user's hidden bodies and an active section, as the button of the app does. Today it takes only the camera, so that the arguments alone say what is drawn.

## Reviews

### Round 1 (2026-11-15): first version

Two independent reviewers, read-only, at commit `b2fdf2d`: `codex` (gpt-6-astra, effort high) and an internal subagent; `agy` did not take part (out of quota). Who they were, what they covered and the findings on the track as a whole are recorded in [1b](../1b-measure/design.md). Neither ran anything in a browser, and neither checked the path of image content through the MCP SDK. The findings on this package, each checked against the code:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| A truncated section is filled as if it were whole: a region without one of its holes shows material across a cavity | codex (major) | Yes: the operation ignored `truncated` | A cut is taken only from a complete answer (`cutOf`, over `completeRegions` of 1a); otherwise `failed` in `section` |
| The button that saves a picture loses an active section, and is described as "what the view shows" | codex | Yes | The button passes the answer of the section view; it is named for what it saves, and the design says what is not behind it |
| The light hangs on the user's camera, so a picture depends on where the user looks | internal | Yes (`viewport.ts:59-63`) | The camera of a picture carries its own light; stated in the contract of the capability |
| No picture of a previewed state or of a pose, and no way to add one: an operation has no `at`, `after` or state, and no kind of argument for a command | internal | Yes (`00-prep/contract.ts`, `HostOperation.run` and `ArgKind`) | Recorded under "Needs" with its case |
| "Gears only" from the top shows the disc of the carrier | codex | Yes (`scenario9.test.ts`: radius 30 at z 46.5 to 51.5; the gears end at 46) | The carrier is left out of that picture |
| 1f needs 1a, which the plan shows only as a shared file | both | Yes | Stated at the top; the table is in 1b |
| Factual: the line material "is given the resolution of the canvas today" | internal | Yes: no resolution is set (`viewport.ts:175-184`) | Corrected, with what follows for a picture of another size |

Nothing was left without action.

### Round 2 (2026-11-15): the fixes of round 1

`codex` and a new internal subagent, on what the fix commit `7f03434` changed; `agy` did not take part (out of quota). The round as a whole is recorded in [1b](../1b-measure/design.md). Both found the mapping of the errors of `section` into errors of the operation right, the statements about the light and the line material true, and the new need (the state an operation works on) a real gap. Nothing was run in a browser in this round either. The findings on this package:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The saved picture leaves hidden bodies out but fills their cuts: `completeRegions` dropped the body of a region | both (codex: major) | Yes | A region comes with its body; `cutOf` takes the bodies that are drawn and leaves out the fills of the others |
| With a section that is not complete, the button silently saves a picture without any cut, while its comment says "the app says so" | both | Yes | Nothing is saved then, and the function returns what the status bar says |
| The three arguments of `section` need not be written again: a description that exists as a value can be a nested field | both (factual) | Yes (adopted; the drafts type-check, and the offset keeps its default) | `SECTION_ARGS.plane`, `.offset`, `.flip`; the need is narrowed |
| `completeRegions` was view code of the app, which `packages/mcp` cannot import | internal | Yes | It is a function of the engine (1a) |

Nothing was left without action.

### Round 3 (2026-11-15): the fixes of round 2, the last round

`codex` and a fresh internal subagent read only what the second fix commit (`bc6a44c`) changed; `agy` did not take part (out of quota). By the rule of the project this is the last round. Neither found a blocker. Both found `cutOf`, its two callers and the refusal to save a picture without its cut consistent, the reused arguments of the section deriving the right types (the offset a number with its default), and no import from `packages/mcp` into the app. The findings that touch this package:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The picture inherits the mismatch of 1a: the model is clipped at the plane asked for and filled with loops taken `below` under it | codex (major, on 1a) | Yes | `cutOf` hands the capability the plane the section was taken at (`takenAt` of 1a); the model is clipped there and the fills lie in it |
| The message of a section that is too large says "N points"; the number counts loops and points | internal | Yes | The message |

Nothing was left without action. Not reviewed by anyone: the change of this round (`takenAt` in `cutOf`). Still true after three rounds: nothing of this package was run in a browser.
