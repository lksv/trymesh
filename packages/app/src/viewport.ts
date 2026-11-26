// 3D view: draws the description of the scene through three.js and offers helpers for selection (a ray,
// projection onto the screen, a hit on a body). It knows nothing about the document and the engine except
// the shape of a body's mesh.
import type { Frame, Id, RigidTransform, Solid, Vec2, Vec3 } from '@trymesh/engine';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { currentScale, fittedCamera, keptSide, topDown } from './camera';
import { stretchInView, toWorld } from './draw';

export interface LineSet {
  segments: ArrayLike<number>; // lines in world coordinates, 6 numbers per line
  color: number;
  width: number; // in pixels
  dashed?: boolean;
  onTop?: boolean; // draw over the bodies
  overFills?: boolean; // drawn after the fills, so that a fill in the plane of the line does not cover it
}
// A half-space that is cut away: what lies on the side the normal points to.
export interface HalfSpace {
  origin: Vec3;
  normal: Vec3;
}
export interface SceneModel {
  // `color`: the colour of the body's properties (D48), else the colour of every body; `opacity`
  // below 1 draws it see-through (an auxiliary body). `transform`: where the pose of the mechanism
  // puts the body (D49), applied to its mesh as it is drawn and picked; none: as modelled.
  bodies: { id: Id; solid: Solid; color?: number; opacity?: number; transform?: RigidTransform }[];
  lines: LineSet[];
  points: { positions: number[]; color: number; size: number }[]; // always over the bodies
  fills: { frame: Frame; loops: ArrayLike<number>[]; color: number; opacity: number; onTop?: boolean }[]; // the first loop is the outline, the others holes
  faces: { solid: Solid; faceId: number; color: number; opacity: number; transform?: RigidTransform }[]; // highlighted faces; `transform` that of the body
  labels: { at: Vec3; text: string; tone?: 'driving' | 'reference' | 'problem' }[];
  // Lines without ends through the origin of a frame, each along a direction of the frame: the
  // axes of the origin of an open sketch (D71). The view draws each as its stretch inside what it
  // shows, made again whenever the camera moves, so it is neither cut by the depth the camera sees
  // nor lost far away. Always over the bodies; the fit of the camera does not read them.
  axes?: { frame: Frame; direction: Vec2; color: number; width: number }[];
  // The model is cut: the bodies and their highlighted faces are not drawn in this half-space,
  // and a body is not picked there. Lines and fills are drawn as given: who builds the scene cuts
  // the lines that belong to a body (`keptSegments` of draw.ts).
  clip?: HalfSpace;
}
// The model of a picture (D43): bodies each in its colour, lines and fills, and the half-space
// that is cut away. Nothing of a user's view is in it: no labels, points or highlighted faces.
export interface PictureModel {
  bodies: { solid: Solid; color: number; transform?: RigidTransform }[]; // `transform`: the pose of the body (D49)
  lines: LineSet[];
  fills: SceneModel['fills'];
  clip?: HalfSpace;
}
// The camera of a picture: a direction it looks from and what is up, fitted to the bodies of
// the picture; or the camera of the user as it stands.
export type PictureCamera = { from: Vec3; up: Vec3 } | 'current';
export interface Picture {
  base64: string; // PNG
  scale: number; // mm per pixel
}
export interface BodyHit {
  body: Id;
  triangle: number;
  point: Vec3;
  depth: number; // distance from the camera's plane in the direction of view
}

// What the app uses of the view. `Viewport` below is the one that draws; a test of the app hands
// the app another, because a DOM without layout and without WebGL cannot run this one.
export interface View {
  readonly element: HTMLElement; // where the pointer events of the view arrive
  setScene(model: SceneModel): void;
  ray(clientX: number, clientY: number): { origin: Vec3; direction: Vec3 };
  pickBody(clientX: number, clientY: number): BodyHit | undefined;
  projector(): (x: number, y: number, z: number) => { x: number; y: number; depth: number };
  pixelSize(): number;
  lookAt(frame: Frame): void;
  fit(min: Vec3, max: Vec3): void;
  // The mark of the last click (D74): a small square drawn over everything at a point of the
  // model, kept across scenes until it is moved or removed (undefined).
  mark(at: Vec3 | undefined): void;
  // A picture of a model, drawn off the screen at the size given: what the user sees is not
  // touched, and the picture depends on neither the window nor the user's camera (but for
  // `current`).
  image(model: PictureModel, camera: PictureCamera, width: number, height: number): Promise<Picture>;
}

// The corners of the view in normalised device coordinates, in order around it.
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
const DISTANCE = 5000; // the camera stands far away so that no part of the model is behind it
const BACKGROUND = 0xf2f4f7;
const MARK = { color: 0xdb2777, edge: 0xffffff, size: 9 } as const; // the mark of the last click: magenta with a white rim
const BODY_MATERIAL = { roughness: 0.75, metalness: 0.05, flatShading: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } as const;
// The light of a camera: it hangs on the camera, so the model is lit from where it is seen.
function lit(camera: THREE.Camera): void {
  const light = new THREE.DirectionalLight(0xffffff, 2.2);
  light.position.set(0.4, 0.7, 1); // in the coordinates of the camera: from the observer
  camera.add(light, light.target);
  light.target.position.set(0, 0, -1);
}
// A cut model in three.js: it keeps what lies on the side the normal of a clipping plane points
// to (`keptSide`).
function clippingOf(clip: HalfSpace | undefined): THREE.Plane[] | null {
  if (!clip) return null;
  const { normal, constant } = keptSide(clip);
  return [new THREE.Plane(new THREE.Vector3(...normal), constant)];
}

export class Viewport implements View {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2 * DISTANCE);
  private readonly controls: OrbitControls;
  private readonly content = new THREE.Group();
  private readonly labelLayer = document.createElement('div');
  private bodyMeshes = new Map<Solid, THREE.Mesh>();
  private readonly lineMaterials = new Map<string, LineMaterial>();
  private readonly bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xaab7c6, ...BODY_MATERIAL });
  private readonly raycaster = new THREE.Raycaster();
  private bodies: { id: Id; mesh: THREE.Mesh }[] = [];
  private labels: { at: THREE.Vector3; element: HTMLElement }[] = [];
  private axes: (NonNullable<SceneModel['axes']>[number] & { line: LineSegments2 })[] = [];
  private disposable: { dispose(): void }[] = [];
  private pending = false;
  private clip: HalfSpace | undefined;
  private readonly marked = new THREE.Group(); // the mark of the last click, outside the content of a scene

  constructor(private readonly container: HTMLElement) {
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(BACKGROUND);
    this.renderer.localClippingEnabled = true; // a material may carry clipping planes (a cut model)
    container.append(this.renderer.domElement, this.labelLayer);
    this.labelLayer.className = 'labels';

    this.camera.up.set(0, 0, 1);
    this.camera.position.set(0.55, -0.7, 0.45).normalize().multiplyScalar(DISTANCE);
    this.camera.zoom = 6;
    lit(this.camera);
    this.scene.add(this.camera, new THREE.AmbientLight(0xffffff, 1.1), this.content, this.marked);
    // the mark: a white square with a smaller magenta one on it, over everything (no depth test)
    const markGeometry = new THREE.BufferGeometry();
    markGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    for (const [color, size, order] of [[MARK.edge, MARK.size + 4, 5], [MARK.color, MARK.size, 6]] as const) {
      const points = new THREE.Points(markGeometry, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false, transparent: true }));
      points.renderOrder = order;
      points.frustumCulled = false;
      this.marked.add(points);
    }
    this.marked.visible = false;

    // Without a mouse (touchpad): Alt/Option + drag with the left button rotates, with Shift it pans. It
    // must be registered before OrbitControls, so that the assignment of the left button changes before the
    // control reads it.
    this.renderer.domElement.addEventListener(
      'pointerdown',
      (event) => (this.controls.mouseButtons.LEFT = event.altKey ? THREE.MOUSE.ROTATE : (null as unknown as THREE.MOUSE)),
      { capture: true },
    );
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    // the left button belongs to selection and drawing; rotating with the right, panning with the middle or
    // Shift + right
    this.controls.mouseButtons = { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('change', () => this.requestRender());
    this.renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  get element(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  private resize(): void {
    const [width, height] = [Math.max(1, this.container.clientWidth), Math.max(1, this.container.clientHeight)];
    this.renderer.setPixelRatio(window.devicePixelRatio); // changes with the zoom of the page and with the monitor
    this.renderer.setSize(width, height);
    Object.assign(this.camera, { left: -width / 2, right: width / 2, top: height / 2, bottom: -height / 2 });
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  // ---------------------------------------------------------------- scene

  setScene(model: SceneModel): void {
    this.content.clear();
    for (const item of this.disposable) item.dispose();
    this.disposable = [];

    // A cut model. The bodies are drawn two-sided while they are cut: a cavity would otherwise
    // show through its back faces, which are not drawn.
    this.clip = model.clip;
    const clipping = clippingOf(model.clip);
    const side = clipping ? THREE.DoubleSide : THREE.FrontSide;
    if (this.bodyMaterial.side !== side) {
      this.bodyMaterial.side = side;
      this.bodyMaterial.needsUpdate = true;
    }
    this.bodyMaterial.clippingPlanes = clipping;

    // The mesh of a body is built once for each Solid object; the engine returns unchanged bodies as the same objects.
    const meshes = new Map<Solid, THREE.Mesh>();
    this.bodies = model.bodies.map(({ id, solid, color, opacity, transform }) => {
      const mesh = this.bodyMeshes.get(solid) ?? new THREE.Mesh(triangleGeometry(solid), this.bodyMaterial);
      placed(mesh, transform); // the pose of the body (D49): drawn and picked there
      // a body with a colour or an opacity of its own has a material of its own for this scene
      const translucent = opacity !== undefined && opacity < 1;
      mesh.material =
        color === undefined && !translucent
          ? this.bodyMaterial
          : this.own(new THREE.MeshStandardMaterial({ color: color ?? 0xaab7c6, ...BODY_MATERIAL, side, clippingPlanes: clipping, ...(translucent ? { transparent: true, opacity, depthWrite: false } : {}) }));
      mesh.renderOrder = translucent ? 2 : 0;
      meshes.set(solid, mesh);
      this.content.add(mesh);
      return { id, mesh };
    });
    for (const [solid, mesh] of this.bodyMeshes) if (!meshes.has(solid)) mesh.geometry.dispose();
    this.bodyMeshes = meshes;

    for (const face of model.faces) {
      const geometry = this.own(triangleGeometry(face.solid, face.faceId));
      const material = this.own(new THREE.MeshBasicMaterial({ color: face.color, transparent: true, opacity: face.opacity, side: THREE.DoubleSide, depthWrite: false, clippingPlanes: clipping }));
      this.content.add(placed(new THREE.Mesh(geometry, material), face.transform));
    }
    for (const fill of model.fills) {
      const mesh = fillMesh(fill, (item) => this.own(item));
      if (mesh) this.content.add(mesh);
    }
    for (const set of model.lines) {
      if (set.segments.length === 0) continue;
      const geometry = this.own(new LineSegmentsGeometry());
      geometry.setPositions(Float32Array.from(set.segments as ArrayLike<number>));
      const line = new LineSegments2(geometry, this.lineMaterial(set));
      if (set.dashed) line.computeLineDistances();
      line.renderOrder = set.onTop ? 3 : set.overFills ? 2.5 : 1; // fills are drawn at 2 and write no depth
      this.content.add(line);
    }
    // the lines without ends: their stretch in the view is made at every frame (`placeAxes`)
    this.axes = (model.axes ?? []).map((axis) => {
      const geometry = this.own(new LineSegmentsGeometry());
      geometry.setPositions(new Float32Array(6)); // one segment, written in place at every frame
      const line = new LineSegments2(geometry, this.lineMaterial({ segments: [], color: axis.color, width: axis.width, onTop: true }));
      line.renderOrder = 3;
      line.frustumCulled = false;
      this.content.add(line);
      return { ...axis, line };
    });
    for (const set of model.points) {
      if (set.positions.length === 0) continue;
      const geometry = this.own(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(set.positions, 3));
      const material = this.own(new THREE.PointsMaterial({ color: set.color, size: set.size, sizeAttenuation: false, depthTest: false }));
      const points = new THREE.Points(geometry, material);
      points.renderOrder = 4;
      this.content.add(points);
    }

    this.labelLayer.replaceChildren();
    this.labels = model.labels.map((label) => {
      const element = document.createElement('span');
      element.className = `label ${label.tone ?? 'driving'}`;
      element.textContent = label.text;
      this.labelLayer.append(element);
      return { at: new THREE.Vector3(...label.at), element };
    });
    this.requestRender();
  }

  private own<T extends { dispose(): void }>(item: T): T {
    this.disposable.push(item);
    return item;
  }

  private lineMaterial(set: LineSet): LineMaterial {
    const key = `${set.color}/${set.width}/${set.dashed ? 1 : 0}/${set.onTop ? 1 : 0}`;
    let material = this.lineMaterials.get(key);
    if (!material) {
      material = new LineMaterial({ color: set.color, linewidth: set.width, dashed: set.dashed === true, depthTest: !set.onTop, transparent: true });
      if (set.dashed) Object.assign(material, { dashSize: 6, gapSize: 4, dashScale: this.camera.zoom });
      this.lineMaterials.set(key, material);
    }
    return material;
  }

  requestRender(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      // the length of dashes is in world units; recomputing keeps the dashing the same at every zoom
      for (const material of this.lineMaterials.values()) if (material.dashed) material.dashScale = this.camera.zoom;
      this.placeAxes();
      this.renderer.render(this.scene, this.camera);
      const [width, height] = [this.container.clientWidth, this.container.clientHeight];
      const projected = new THREE.Vector3();
      for (const label of this.labels) {
        projected.copy(label.at).project(this.camera);
        label.element.style.transform = `translate(${((projected.x + 1) / 2) * width}px, ${((1 - projected.y) / 2) * height}px) translate(-50%, -50%)`;
      }
    });
  }

  // The lines without ends of the scene (`SceneModel.axes`), each as its stretch inside the part of
  // its plane the view shows now: the corners of the view are cast onto the plane. The objects of
  // three.js are made once (`axisWork`); a frame makes only a few small arrays. A known limit: an
  // axis is hidden while a corner ray misses its plane (a plane seen edge-on or nearly so, where
  // an axis in it would be a line seen end-on or a sliver anyway).
  private readonly axisWork = { ray: new THREE.Raycaster(), plane: new THREE.Plane(), normal: new THREE.Vector3(), origin: new THREE.Vector3(), ndc: new THREE.Vector2(), hit: new THREE.Vector3() };
  private placeAxes(): void {
    if (this.axes.length === 0) return;
    this.camera.updateMatrixWorld();
    const { ray, plane, normal, origin, ndc, hit } = this.axisWork;
    for (const axis of this.axes) {
      const { frame } = axis;
      plane.setFromNormalAndCoplanarPoint(normal.set(...frame.normal), origin.set(...frame.origin));
      const corners: Vec2[] = [];
      for (const [x, y] of CORNERS) {
        ray.setFromCamera(ndc.set(x, y), this.camera);
        if (!ray.ray.intersectPlane(plane, hit)) break;
        const p = [hit.x - frame.origin[0], hit.y - frame.origin[1], hit.z - frame.origin[2]];
        corners.push([p[0] * frame.x[0] + p[1] * frame.x[1] + p[2] * frame.x[2], p[0] * frame.y[0] + p[1] * frame.y[1] + p[2] * frame.y[2]]);
      }
      const stretch = corners.length === 4 ? stretchInView(corners, axis.direction) : undefined;
      axis.line.visible = stretch !== undefined;
      if (!stretch) continue;
      const buffer = (axis.line.geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute).data;
      buffer.array.set([...toWorld(frame, ...stretch[0]), ...toWorld(frame, ...stretch[1])]);
      buffer.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- selection

  private ndc(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, 1 - ((clientY - rect.top) / rect.height) * 2);
  }

  // The ray under the cursor; its direction is the direction of view (the camera is orthographic).
  ray(clientX: number, clientY: number): { origin: Vec3; direction: Vec3 } {
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    return { origin: this.raycaster.ray.origin.toArray() as Vec3, direction: this.raycaster.ray.direction.toArray() as Vec3 };
  }

  pickBody(clientX: number, clientY: number): BodyHit | undefined {
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    let best: BodyHit | undefined;
    // what is cut away is not drawn, so it is not hit either: the first hit that is left
    const clip = this.clip;
    const cutAway = (point: THREE.Vector3): boolean => clip !== undefined && (point.x - clip.origin[0]) * clip.normal[0] + (point.y - clip.origin[1]) * clip.normal[1] + (point.z - clip.origin[2]) * clip.normal[2] > 0;
    for (const { id, mesh } of this.bodies) {
      const hit = this.raycaster.intersectObject(mesh, false).find((candidate) => !cutAway(candidate.point));
      if (hit && hit.faceIndex != null && (!best || hit.distance < best.depth)) best = { body: id, triangle: hit.faceIndex, point: hit.point.toArray() as Vec3, depth: hit.distance };
    }
    return best;
  }

  // A function for projecting points in the current view: the position in the browser window (px) and the
  // depth in the direction of view (the same measure as BodyHit.depth).
  projector(): (x: number, y: number, z: number) => { x: number; y: number; depth: number } {
    this.camera.updateMatrixWorld();
    const rect = this.renderer.domElement.getBoundingClientRect();
    const view = this.camera.matrixWorldInverse.clone();
    const projection = this.camera.projectionMatrix.clone();
    const v = new THREE.Vector3();
    return (x, y, z) => {
      v.set(x, y, z).applyMatrix4(view);
      const depth = -v.z;
      v.applyMatrix4(projection);
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, depth };
    };
  }

  // How many world units one pixel is.
  pixelSize(): number {
    return 1 / this.camera.zoom;
  }

  // ---------------------------------------------------------------- camera

  // A view perpendicular to a plane; the plane's Y axis points up on the screen if the vertical Z axis allows it.
  lookAt(frame: Frame): void {
    const target = new THREE.Vector3(...frame.origin);
    const normal = new THREE.Vector3(...frame.normal);
    // When looking along the vertical axis, a small tilt decides the rotation: from above against the
    // plane's Y axis, from below along it (a camera below the plane has as "up" the side it is tilted
    // towards).
    const tilt = new THREE.Vector3(...frame.y).multiplyScalar((normal.z < 0 ? 1 : -1) * 1e-3 * DISTANCE);
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(normal, DISTANCE).add(tilt);
    this.controls.update();
    this.requestRender();
  }

  mark(at: Vec3 | undefined): void {
    this.marked.visible = at !== undefined;
    if (at) this.marked.position.set(...at);
    this.requestRender();
  }

  // ---------------------------------------------------------------- a picture

  // A picture of a model (D43), drawn into a render target of the size asked for, with a scene,
  // a camera and a light of its own, and read back. Nothing of the user's view takes part but
  // the renderer (and, for `current`, where the user's camera stands), so the user's view does
  // not flash, and the picture does not depend on the size of the window or on the pixel ratio
  // of the screen. It does not wait for a frame: a tab in the background still answers.
  async image(model: PictureModel, camera: PictureCamera, width: number, height: number): Promise<Picture> {
    const owned: { dispose(): void }[] = [];
    const own = <T extends { dispose(): void }>(item: T): T => {
      owned.push(item);
      return item;
    };
    try {
      const scene = new THREE.Scene();
      const clipping = clippingOf(model.clip);
      for (const { solid, color, transform } of model.bodies) {
        const material = own(new THREE.MeshStandardMaterial({ color, ...BODY_MATERIAL, side: clipping ? THREE.DoubleSide : THREE.FrontSide, clippingPlanes: clipping }));
        scene.add(placed(new THREE.Mesh(own(triangleGeometry(solid)), material), transform));
      }
      for (const fill of model.fills) {
        const mesh = fillMesh(fill, own);
        if (mesh) scene.add(mesh);
      }
      for (const set of model.lines) {
        if (set.segments.length === 0) continue;
        const geometry = own(new LineSegmentsGeometry());
        geometry.setPositions(Float32Array.from(set.segments as ArrayLike<number>));
        const material = own(new LineMaterial({ color: set.color, linewidth: set.width, depthTest: !set.onTop, transparent: true }));
        const line = new LineSegments2(geometry, material);
        // The width of a line is in pixels of a resolution the material is told. three.js tells
        // it the size of the canvas before every draw; a picture has its own size.
        line.onBeforeRender = () => material.resolution.set(width, height);
        line.renderOrder = set.onTop ? 3 : set.overFills ? 2.5 : 1;
        scene.add(line);
      }

      const eye = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 1, 2 * DISTANCE);
      let scale: number;
      if (camera === 'current') {
        // where the user's camera stands and looks, and at least all it shows
        this.camera.updateMatrixWorld();
        eye.position.copy(this.camera.position);
        eye.quaternion.copy(this.camera.quaternion);
        scale = currentScale(this.camera.zoom, this.container.clientWidth, this.container.clientHeight, width, height);
      } else {
        // fitted to the bodies, and turned as the three vectors of the fitted camera say
        const fitted = fittedCamera(camera.from, camera.up, model.bodies, width, height);
        const back = new THREE.Vector3(...fitted.back);
        eye.position.set(...fitted.center).addScaledVector(back, DISTANCE);
        eye.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...fitted.right), new THREE.Vector3(...fitted.up), back));
        scale = fitted.scale;
      }
      eye.zoom = 1 / scale;
      eye.updateProjectionMatrix();
      lit(eye);
      scene.add(eye, new THREE.AmbientLight(0xffffff, 1.1));

      // The colours of a target are those of the canvas only when the target says so: the output
      // colour space of the renderer is used for the screen alone.
      const target = own(new THREE.WebGLRenderTarget(width, height, { samples: 4 }));
      target.texture.colorSpace = THREE.SRGBColorSpace;
      const pixels = new Uint8Array(4 * width * height);
      const before = this.renderer.getRenderTarget();
      try {
        this.renderer.setRenderTarget(target);
        this.renderer.clear();
        this.renderer.render(scene, eye);
        this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      } finally {
        this.renderer.setRenderTarget(before);
      }
      const canvas = document.createElement('canvas');
      Object.assign(canvas, { width, height });
      const context = canvas.getContext('2d');
      if (!context) throw new Error('the browser gave no canvas to encode the picture with');
      const data = context.createImageData(width, height);
      data.data.set(topDown(pixels, width, height));
      context.putImageData(data, 0, 0);
      return { base64: canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''), scale };
    } finally {
      for (const item of owned) item.dispose();
      this.requestRender(); // the state of the renderer was used by another scene
    }
  }

  // Zooms so that the whole box is visible.
  fit(min: Vec3, max: Vec3): void {
    const center = new THREE.Vector3().addVectors(new THREE.Vector3(...min), new THREE.Vector3(...max)).multiplyScalar(0.5);
    const size = Math.max(1, new THREE.Vector3(...max).distanceTo(new THREE.Vector3(...min)));
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(offset);
    this.camera.zoom = (0.8 * Math.min(this.container.clientWidth, this.container.clientHeight)) / size;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.requestRender();
  }
}

// A mesh put where a rigid transform takes it (the pose of a body, D49), or as modelled. The world
// matrix is brought up to date at once, so that a pick before the next frame hits it there.
function placed(mesh: THREE.Mesh, transform: RigidTransform | undefined): THREE.Mesh {
  mesh.matrixAutoUpdate = false;
  if (!transform) mesh.matrix.identity();
  else {
    const [a, b, c] = transform.matrix;
    const t = transform.translation;
    mesh.matrix.set(a[0], a[1], a[2], t[0], b[0], b[1], b[2], t[1], c[0], c[1], c[2], t[2], 0, 0, 0, 1);
  }
  mesh.updateMatrixWorld(true);
  return mesh;
}

// A filled polygon in the plane of a frame: the first loop is the outline, the others are holes.
// `own`: who disposes of what the mesh is made of.
function fillMesh(fill: SceneModel['fills'][number], own: <T extends { dispose(): void }>(item: T) => T): THREE.Mesh | undefined {
  const path = (loop: ArrayLike<number>) => Array.from({ length: loop.length / 2 }, (_, i) => new THREE.Vector2(loop[2 * i], loop[2 * i + 1]));
  if (fill.loops.length === 0 || fill.loops[0].length < 6) return undefined;
  const shape = new THREE.Shape(path(fill.loops[0]));
  for (const hole of fill.loops.slice(1)) shape.holes.push(new THREE.Path(path(hole)));
  const geometry = own(new THREE.ShapeGeometry(shape));
  const material = own(
    new THREE.MeshBasicMaterial({ color: fill.color, transparent: true, opacity: fill.opacity, side: THREE.DoubleSide, depthWrite: false, depthTest: !fill.onTop, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  );
  const mesh = new THREE.Mesh(geometry, material);
  const { origin, x, y, normal } = fill.frame;
  mesh.matrixAutoUpdate = false;
  mesh.matrix.makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...normal)).setPosition(...origin);
  mesh.renderOrder = 2;
  return mesh;
}

// Triangles of a body (or of only one face) without shared vertices, with the normal of the facet.
function triangleGeometry(solid: Solid, faceId?: number): THREE.BufferGeometry {
  const count = solid.triangles.length / 3;
  const positions: number[] = [];
  const normals: number[] = [];
  const [a, b, c, n] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let t = 0; t < count; t++) {
    if (faceId !== undefined && solid.faceIds[t] !== faceId) continue;
    a.fromArray(solid.positions, 3 * solid.triangles[3 * t]);
    b.fromArray(solid.positions, 3 * solid.triangles[3 * t + 1]);
    c.fromArray(solid.positions, 3 * solid.triangles[3 * t + 2]);
    n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let k = 0; k < 3; k++) normals.push(n.x, n.y, n.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}
