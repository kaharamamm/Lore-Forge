/**
 * The 3D model viewer (three.js), bundled on its own as dist/renderer/viewer.js and loaded the first time the
 * 3D model tab opens. It sets window.LoreViewer. Models arrive as bytes over IPC and are parsed in memory; glTF
 * textures become blob: and data: URLs, which the page's CSP allows for images and fetches (no eval, no remote).
 */
import { AmbientLight, Box3, Color, DirectionalLight, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, PMREMGenerator, Scene, Sphere, SRGBColorSpace, Vector3, WebGLRenderer, type Object3D } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export interface ViewerHandle {
  /** Back to the framed starting view. */
  reset(): void;
  setAutoRotate(on: boolean): void;
  /** Smoke test: render once and count the canvas pixels the model covers. */
  probe(): { meshes: number; triangles: number; drawn: number };
  dispose(): void;
}
export interface LoreViewerApi {
  mount(host: HTMLElement, bytes: Uint8Array, ext: string): Promise<ViewerHandle>;
}

async function parse(bytes: Uint8Array, ext: string): Promise<Object3D> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  if (ext === '.glb' || ext === '.gltf') {
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    return gltf.scene;
  }
  if (ext === '.obj') return new OBJLoader().parse(new TextDecoder().decode(bytes));
  if (ext === '.fbx') return new FBXLoader().parse(buffer, '');
  throw new Error(`Unsupported model type: ${ext}`);
}

async function mount(host: HTMLElement, bytes: Uint8Array, ext: string): Promise<ViewerHandle> {
  const model = await parse(bytes, ext.toLowerCase());
  let meshes = 0;
  let triangles = 0;
  model.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    meshes++;
    const g = m.geometry;
    triangles += (g.index ? g.index.count : (g.attributes['position']?.count ?? 0)) / 3;
    // OBJ files without a material library come in flat grey: give them a soft clay look under the studio light.
    if (ext === '.obj' && !Array.isArray(m.material) && m.material.type === 'MeshPhongMaterial') m.material = new MeshStandardMaterial({ color: 0xc9b48a, roughness: 0.7 });
  });
  if (!meshes) throw new Error('The file has no meshes to show.');

  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.domElement.className = 'viewer-canvas';
  host.appendChild(renderer.domElement);

  // Studio lighting: a neutral room as the environment, plus a key and a fill light for unlit (OBJ, FBX) materials.
  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  scene.add(new AmbientLight(new Color(0xffffff), 0.35));
  const key = new DirectionalLight(0xfff1d6, 1.6);
  key.position.set(3, 5, 4);
  const fill = new DirectionalLight(0xbfd4ff, 0.6);
  fill.position.set(-4, 2, -3);
  scene.add(key, fill);

  // Centre the model on the origin inside a pivot, then frame it.
  const pivot = new Group();
  const box = new Box3().setFromObject(model);
  model.position.sub(box.getCenter(new Vector3()));
  pivot.add(model);
  scene.add(pivot);
  const sphere = new Box3().setFromObject(pivot).getBoundingSphere(new Sphere());
  const radius = sphere.radius || 1;

  const camera = new PerspectiveCamera(40, 1, radius / 100, radius * 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotateSpeed = 1.5;
  const frame = (): void => {
    const fit = radius / Math.sin((camera.fov * Math.PI) / 360);
    camera.position.set(fit * 0.55, fit * 0.35, fit * 0.85);
    controls.target.set(0, 0, 0);
    controls.minDistance = radius * 0.2;
    controls.maxDistance = radius * 20;
    controls.update();
  };

  const resize = (): void => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  frame();

  let raf = 0;
  const loop = (): void => {
    raf = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  };
  loop();

  return {
    reset: frame,
    setAutoRotate: (on) => {
      controls.autoRotate = on;
    },
    probe: () => {
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let drawn = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i]! > 0) drawn++;
      return { meshes, triangles: Math.round(triangles), drawn };
    },
    dispose: () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
      });
      scene.environment?.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

(window as unknown as { LoreViewer: LoreViewerApi }).LoreViewer = { mount };
