# 1f View image for the AI

**Decision D43. State: implemented and merged into `master` on 2026-11-15 (the operation `view_image`, the capability of the view of the app, the button that saves a picture). See "As implemented" at the end, which says where the code differs from the text below. The design is in its fourth version, after three rounds of reviews.** Step 1 of [D36](../../decisions/D36-order-after-d35.md), track A of [the plan](../README.md). Written against the sixth version of the contract of [the preparatory step](../00-prep/design.md), at commit `0dc424b`. The types are in [contract.ts](contract.ts), the scenario and the operation as calls in [calls.ts](calls.ts); both are type-checked by `npx tsc -p docs/d36/tsconfig.json`.

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

- **Is the app normally connected when the AI works? Decided by the owner on 2026-11-15:** yes. A picture comes only from the connected app; over a document from a file the operation answers that it is not available. The rasteriser in the server stays out of this package.
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

## As implemented

### The operation and the view (2026-11-15)

`packages/mcp/src/view-image.ts`: the views (`VIEWS`), the capability (`ViewCapability`, `ImageRequest`, `RenderedImage`), the arguments, `cutOf` and the operation `viewImage`, which `host.ts` puts into `HOST_OPERATIONS`. `packages/app/src/picture.ts`: what a request draws (`pictureModel`), the capability over a view (`viewCapability`), the palette, and `savePicture` behind the button. `packages/app/src/viewport.ts`: `View.image(model, camera, width, height)`, the picture drawn off the screen; its arithmetic (the camera of a view fitted to bodies, the scale of a picture from the user's camera, the rows read back, the side of a cut that is kept) is in `packages/app/src/camera.ts`, as plain numbers. `app.ts` hands the host its `view` and has the button.

Tests: `packages/mcp/test/view-image.test.ts` (what the operation asks of a view that writes its requests down: the state, the bodies, the camera of every named view, `at`, the cut against the answer of the query `section`; the refusals; and a picture on its way from the app through a real bridge and the server to a client, as image content with its text), the rows of the operation in `host-operations.test.ts`, `packages/app/test/picture.test.ts` (what a request draws and what the button asks for, over states written by hand), `packages/app/test/camera.test.ts` (the camera of every named view, the fit, the rows, the cut), six recorded steps of `packages/app/test/app.test.ts` (the button; the button while a section is shown and a body is hidden; while another answer is shown; a picture the view cannot draw; a picture taken by the AI over the bridge; one refused) and two cases of scenario 11 on the joint.

What differs from the design and from `contract.ts`:

- **Next to the picture the answer says what pixels do not** (the need "Data next to a picture" of the design, taken up): a `ToolAnswer` of the kind `image` may carry `about`, and the server returns it as a text next to the image content. `view_image` puts there the size, the scale in millimetres per pixel and, for every body of which something is drawn, its colour as `#rrggbb` and as a word, with the colour of its cut when the section goes through it. So an AI that sees an orange part is told it is the plate. With a section the answer also lists the bodies the plane goes through and the bodies it removes whole (after the review, below): a picture with nothing in it then says why.
- **A cut is filled with a darker shade of the colour of its body**, not with one grey as in the app, and a region of the cut therefore comes with its body (`ImageCut.regions[i].body`; the contract dropped it). Seen from above, a model cut across its axis is nothing but fills: in one grey the gears of the joint would run into each other again, which is what the colours are for.
- **The module is `view-image.ts`**, next to `host.ts`, where the preparatory step put the registry (the design wrote `operations.ts`); the app imports it as `@trymesh/mcp/view-image`. What a request draws is in `picture.ts` of the app, not in `scene.ts`: it shares nothing with the scene of the user's view but the helpers of `draw.ts`.
- **Who checks what.** `callHostOperation` checks the arguments against the description in the state of the document now, as the preparatory step built it: the shape, the ranges, and every body, feature and plane named. The operation then looks the bodies up again in the state after `at`, which is the state it draws. So a body that the document has and the earlier state does not is refused by the operation (`bodies[1]: the body "late" is not in the state after "pin"`), and a body that only an earlier state had cannot be named at all (see the limits).
- **The codes of the query `section` pass through as they are**: a plane that is not planar is `notAvailable`, as the query answers since 1b. The design mapped them to `failed`, the stand-in of its time. The path of the argument gets `section` in front, in the text as well (`section.plane: the face is not planar`): the answer of a tool is a text, and the path as a value does not reach a client.
- **Without an app the server answers before the operation runs** (`noAppText` of the preparatory step: "the operation runs in the app and no app is connected"). The refusal of the operation itself is for a host without a view, which only a test has.
- **The camera.** A named view is fitted to the whole of the bodies drawn, with a margin of a twentieth on every side, also when most of them is cut away: two pictures of the same bodies with and without a cut then line up. `current` is where the user's camera stands and looks, at a scale that shows at least all the window shows, whatever the shape of the picture.
- **The button** is labelled *Save picture* (its tooltip says that it is of the model, and what is left out) and saves `model.png` at 1600 by 1200.
- **The status bar says when the AI took a picture**: nothing else on the screen shows it. It does not replace an error the user has not dealt with, and a picture that was refused says nothing, as any question of the AI.
- **The palette** has ten named colours, none of them dark, so that the edges show; an eleventh body gets the first again.

**Run in a browser** (the list under "Open"), on a plate with a ledge and a pin and on the joint of scenario 9:

- A picture is drawn into a render target of its own size with four samples and read back; nothing waits for a frame. The first picture of a session took 850 ms (the shaders are compiled then), the others 20 to 115 ms.
- The width of the edges is right at every size: the material of a line is told the size of the picture before each draw (three.js tells it the size of the canvas otherwise).
- The colours are those of the canvas once the texture of the target is marked sRGB.
- The size of a picture of the joint, as the length of its base64 text: 101 948 characters at 800 by 600 (the whole joint), 72 584 cut through the gears from above, 351 880 at 1600 by 1200, 245 032 cut at 1600 by 1600. The guard is 2 000 000.
- The three pictures of the scenario show what they are for: the whole joint with its parts in their colours, the gears from above, and the cut through the gears with the sun, the planets, the pins of the carrier and the ring gear each in its own shade. A cut along the axis from the front shows the motor recess, the flange of the sun and the pins.
- The button with a section shown saves the picture the view shows, in colours, without the planes and the sketches.
- Not run: a tab in the background, and a call from a real client of the server to the app in a browser (the port of the bridge was taken by another session; the tests go that way with a real bridge and a view that does not draw, and with a real server).

**Known limits.**

- A picture of a previewed change (`after`) or of a pose is not possible: the path of an operation has no state but the document (the need of the design stands).
- A body that only an earlier state had (one that a later feature merged into another) cannot be named with `at`: the arguments are checked in the state of the document now first.
- `view: 'current'` takes only the camera of the user: not the bodies the user has hidden, and not a section the app shows. The button of the app takes both.
- More than ten bodies share colours. A colour goes by the place of a body among the bodies of the state drawn, so with `at` a body may have another colour than in a picture of the whole model; the legend comes with every picture.
- The darker shade of a light colour is near the plain colour of another body (the cut of the orange plate and the brown of a ninth body). The answer names the colour of every cut, and a cut is outlined.
- The picture is of bodies only: no sketches, planes, dimensions or highlighted faces.

### Review (2026-11-15)

One full review by a subagent that did not write the code, read-only, with probes of its own in Node (the operation over a view that draws nothing, the lines of the camera copied over three.js). No serious finding. It found the camera of every named view, the clipping, the colour space of the target, the state of the renderer after a picture and the choice of the answer the button saves right.

| Finding | Held | What was done |
|---|---|---|
| A cut that removes everything, or misses, is answered as a picture with a legend of bodies "drawn": a wrong sign of the offset gives an empty picture and nothing says why (moderate) | Yes | The answer lists the bodies the plane goes through (`section.cut`) and the bodies it removes whole (`section.cutAway`: by their boxes, in the view); `bodies` are those of which something is drawn; the description of `section` says from where a cut is seen |
| The rule of a complete section is not tested at the level of the operation, and three mutations pass (an uncut picture for a section over its budget; the section asked of all bodies; the path of a refusal) (moderate) | Yes | The request of the operation is a function with the budget as an argument (`imageRequest`), tested over its budget, with the bodies named against the section of those bodies, and for its refusals |
| The camera, the fit, the rows read back and the sign of the clipping are tested by nothing; five mutations pass (moderate) | Yes | The arithmetic is in `camera.ts` and has a test; the viewport turns its camera by the three vectors that test checks. Run in a browser again after the change |
| The path of the argument of a refusal reaches nobody, and the texts name an argument two ways (`bodies[1]:` by the check, `bodies:` by the operation; `section:` in front of the text of the query is the name of the query) | Yes | A refusal names its argument in its text as the check does |
| With `view: current` nothing is fitted, the user's hidden bodies are drawn and a section of the app is not applied; the description did not say so | Yes | It says so |
| "Of one lightness" is false for the palette (L* 50 to 82); the shade of a cut may be taken for another body | Yes; the second is a suspicion | The wording; the answer gives `cutColor` for every body that is cut; recorded as a limit |
| A colour is stable only within one state | Yes | Said in the description of the answer and in the limits |
| A comment points to the wrong file of the docs | Yes | Corrected |
| A picture taken by the AI replaces an error in the status bar the user has not read | Yes | It does not, and a refused picture says nothing |
| No test for the button while another answer is shown, and for a picture that cannot be drawn | Yes | Two recorded steps |

No second round: no serious finding, and the fixes are additions to the answer and tests.

