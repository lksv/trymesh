// 3D pohled: vykreslí popis scény přes three.js a nabízí pomůcky pro výběr (paprsek, průmět na
// obrazovku, zásah tělesa). O dokumentu a enginu neví nic kromě tvaru sítě tělesa.
import type { Frame, Id, Solid, Vec3 } from '@trymesh/engine';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

export interface LineSet {
  segments: ArrayLike<number>; // úsečky ve světových souřadnicích, 6 čísel na úsečku
  color: number;
  width: number; // v pixelech
  dashed?: boolean;
  onTop?: boolean; // kreslit přes tělesa
  overFills?: boolean; // drawn after the fills, so that a fill in the plane of the line does not cover it
}
// A half-space that is cut away: what lies on the side the normal points to.
export interface HalfSpace {
  origin: Vec3;
  normal: Vec3;
}
export interface SceneModel {
  bodies: { id: Id; solid: Solid }[];
  lines: LineSet[];
  points: { positions: number[]; color: number; size: number }[]; // vždy přes tělesa
  fills: { frame: Frame; loops: ArrayLike<number>[]; color: number; opacity: number; onTop?: boolean }[]; // první smyčka obrys, další díry
  faces: { solid: Solid; faceId: number; color: number; opacity: number }[]; // zvýrazněné stěny
  labels: { at: Vec3; text: string; tone?: 'driving' | 'reference' | 'problem' }[];
  // The model is cut: the bodies and their highlighted faces are not drawn in this half-space,
  // and a body is not picked there. Lines and fills are drawn as given: who builds the scene cuts
  // the lines that belong to a body (`keptSegments` of draw.ts).
  clip?: HalfSpace;
}
export interface BodyHit {
  body: Id;
  triangle: number;
  point: Vec3;
  depth: number; // vzdálenost od roviny kamery ve směru pohledu
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
}

const DISTANCE = 5000; // kamera stojí daleko, aby žádná část modelu nebyla za ní

export class Viewport implements View {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2 * DISTANCE);
  private readonly controls: OrbitControls;
  private readonly content = new THREE.Group();
  private readonly labelLayer = document.createElement('div');
  private bodyMeshes = new Map<Solid, THREE.Mesh>();
  private readonly lineMaterials = new Map<string, LineMaterial>();
  private readonly bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xaab7c6, roughness: 0.75, metalness: 0.05, flatShading: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  private readonly raycaster = new THREE.Raycaster();
  private bodies: { id: Id; mesh: THREE.Mesh }[] = [];
  private labels: { at: THREE.Vector3; element: HTMLElement }[] = [];
  private disposable: { dispose(): void }[] = [];
  private pending = false;
  private clip: HalfSpace | undefined;

  constructor(private readonly container: HTMLElement) {
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0xf2f4f7);
    this.renderer.localClippingEnabled = true; // a material may carry clipping planes (a cut model)
    container.append(this.renderer.domElement, this.labelLayer);
    this.labelLayer.className = 'labels';

    this.camera.up.set(0, 0, 1);
    this.camera.position.set(0.55, -0.7, 0.45).normalize().multiplyScalar(DISTANCE);
    this.camera.zoom = 6;
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(0.4, 0.7, 1); // v souřadnicích kamery: svítí od pozorovatele
    this.camera.add(light, light.target);
    light.target.position.set(0, 0, -1);
    this.scene.add(this.camera, new THREE.AmbientLight(0xffffff, 1.1), this.content);

    // Bez myši (touchpad): Alt/Option + tažení levým otáčí, se Shiftem posouvá. Musí být zaregistrováno
    // před OrbitControls, aby se přiřazení levého tlačítka změnilo dřív, než ho ovladač přečte.
    this.renderer.domElement.addEventListener(
      'pointerdown',
      (event) => (this.controls.mouseButtons.LEFT = event.altKey ? THREE.MOUSE.ROTATE : (null as unknown as THREE.MOUSE)),
      { capture: true },
    );
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    // levé tlačítko patří výběru a kreslení; otáčení pravým, posun prostředním nebo Shift + pravým
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
    this.renderer.setPixelRatio(window.devicePixelRatio); // mění se s přiblížením stránky i s monitorem
    this.renderer.setSize(width, height);
    Object.assign(this.camera, { left: -width / 2, right: width / 2, top: height / 2, bottom: -height / 2 });
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  // ---------------------------------------------------------------- scéna

  setScene(model: SceneModel): void {
    this.content.clear();
    for (const item of this.disposable) item.dispose();
    this.disposable = [];

    // A cut model: three.js keeps what lies on the side the normal of a clipping plane points to,
    // so the plane is the half-space turned round. The bodies are drawn two-sided while they are
    // cut: a cavity would otherwise show through its back faces, which are not drawn.
    this.clip = model.clip;
    const clipping = model.clip ? [new THREE.Plane(new THREE.Vector3(...model.clip.normal).negate(), new THREE.Vector3(...model.clip.normal).dot(new THREE.Vector3(...model.clip.origin)))] : null;
    const side = clipping ? THREE.DoubleSide : THREE.FrontSide;
    if (this.bodyMaterial.side !== side) {
      this.bodyMaterial.side = side;
      this.bodyMaterial.needsUpdate = true;
    }
    this.bodyMaterial.clippingPlanes = clipping;

    // Síť tělesa se staví jednou pro každý objekt Solid; engine nezměněná tělesa vrací stejná.
    const meshes = new Map<Solid, THREE.Mesh>();
    this.bodies = model.bodies.map(({ id, solid }) => {
      const mesh = this.bodyMeshes.get(solid) ?? new THREE.Mesh(triangleGeometry(solid), this.bodyMaterial);
      meshes.set(solid, mesh);
      this.content.add(mesh);
      return { id, mesh };
    });
    for (const [solid, mesh] of this.bodyMeshes) if (!meshes.has(solid)) mesh.geometry.dispose();
    this.bodyMeshes = meshes;

    for (const face of model.faces) {
      const geometry = this.own(triangleGeometry(face.solid, face.faceId));
      const material = this.own(new THREE.MeshBasicMaterial({ color: face.color, transparent: true, opacity: face.opacity, side: THREE.DoubleSide, depthWrite: false, clippingPlanes: clipping }));
      this.content.add(new THREE.Mesh(geometry, material));
    }
    for (const fill of model.fills) {
      const mesh = this.fillMesh(fill);
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

  private fillMesh(fill: SceneModel['fills'][number]): THREE.Mesh | undefined {
    const path = (loop: ArrayLike<number>) => Array.from({ length: loop.length / 2 }, (_, i) => new THREE.Vector2(loop[2 * i], loop[2 * i + 1]));
    if (fill.loops.length === 0 || fill.loops[0].length < 6) return undefined;
    const shape = new THREE.Shape(path(fill.loops[0]));
    for (const hole of fill.loops.slice(1)) shape.holes.push(new THREE.Path(path(hole)));
    const geometry = this.own(new THREE.ShapeGeometry(shape));
    const material = this.own(
      new THREE.MeshBasicMaterial({ color: fill.color, transparent: true, opacity: fill.opacity, side: THREE.DoubleSide, depthWrite: false, depthTest: !fill.onTop, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    );
    const mesh = new THREE.Mesh(geometry, material);
    const { origin, x, y, normal } = fill.frame;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...normal)).setPosition(...origin);
    mesh.renderOrder = 2;
    return mesh;
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
      // délka čárek je ve světových jednotkách; přepočet drží čárkování stejné při každém přiblížení
      for (const material of this.lineMaterials.values()) if (material.dashed) material.dashScale = this.camera.zoom;
      this.renderer.render(this.scene, this.camera);
      const [width, height] = [this.container.clientWidth, this.container.clientHeight];
      const projected = new THREE.Vector3();
      for (const label of this.labels) {
        projected.copy(label.at).project(this.camera);
        label.element.style.transform = `translate(${((projected.x + 1) / 2) * width}px, ${((1 - projected.y) / 2) * height}px) translate(-50%, -50%)`;
      }
    });
  }

  // ---------------------------------------------------------------- výběr

  private ndc(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, 1 - ((clientY - rect.top) / rect.height) * 2);
  }

  // Paprsek pod kurzorem; směr je směr pohledu (kamera je rovnoběžná).
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

  // Funkce pro průmět bodů při současném pohledu: poloha v okně prohlížeče (px) a hloubka ve směru
  // pohledu (stejná míra jako BodyHit.depth).
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

  // Kolik světových jednotek je jeden pixel.
  pixelSize(): number {
    return 1 / this.camera.zoom;
  }

  // ---------------------------------------------------------------- kamera

  // Pohled kolmo na rovinu; osa Y roviny míří na obrazovce nahoru, pokud to svislá osa Z dovolí.
  lookAt(frame: Frame): void {
    const target = new THREE.Vector3(...frame.origin);
    const normal = new THREE.Vector3(...frame.normal);
    // Při pohledu podél svislé osy určuje natočení malý úklon: shora proti ose Y roviny, zdola po ní
    // (kamera pod rovinou má „nahoře“ tu stranu, ke které je ukloněná).
    const tilt = new THREE.Vector3(...frame.y).multiplyScalar((normal.z < 0 ? 1 : -1) * 1e-3 * DISTANCE);
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(normal, DISTANCE).add(tilt);
    this.controls.update();
    this.requestRender();
  }

  // Přiblíží tak, aby byl vidět celý kvádr.
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

// Trojúhelníky tělesa (nebo jen jedné stěny) bez sdílení vrcholů, s normálou plošky.
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
