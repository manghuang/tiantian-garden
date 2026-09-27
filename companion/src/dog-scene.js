import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ACTIONS, MODEL_ACTIONS } from '../shared/behavior.js';
import { expressiveClip, motionLevel, performancePose } from './motion.js';

const DISPLAY_MODEL_HEIGHT = 2.65;

export class DogScene {
  constructor(container, { onLoad, onProgress, onError, onAction, level, modelUrl = '/assets/dog.glb', modelId = 'balanced' }) {
    this.container = container; this.onAction = onAction; this.level = level; this.onLoad = onLoad; this.onProgress = onProgress; this.onError = onError;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.15;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.setAttribute('aria-label', '天天的三维模型，可拖动旋转，滚轮缩放');
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.dataset.modelUrl = modelUrl;
    this.statsStarted = performance.now(); this.statsFrames = 0;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(33, 1, 0.1, 100);
    this.camera.position.set(3.1, 2.75, 8.0);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.45, 0); this.controls.enableDamping = true;
    this.defaultCameraOffset = this.camera.position.clone().sub(this.controls.target);
    this.controls.enablePan = false; this.controls.minDistance = 5; this.controls.maxDistance = 12;
    this.controls.minPolarAngle = 0.55; this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.update(); this.controls.saveState();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04); this.scene.environment = this.environment.texture;
    room.dispose(); pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x889379, 2.4));
    const sun = new THREE.DirectionalLight(0xfff8ed, 3.4); sun.position.set(-3, 7, 5); this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xd8edff, 1.8); fill.position.set(4, 3, -2); this.scene.add(fill);
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(2.08, 2.15, 0.16, 80), new THREE.MeshStandardMaterial({ color: 0xfaf9eb, roughness: 0.95 }));
    platform.position.y = -0.12; this.scene.add(platform);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.97, 0.013, 8, 100), new THREE.MeshBasicMaterial({ color: 0xd3dac5 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = -0.031; this.scene.add(rim);
    // Soft contact shadow avoids re-rendering millions of fur triangles into a shadow map.
    const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 128;
    const ctx = shadowCanvas.getContext('2d'); const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(72,81,55,.28)'); gradient.addColorStop(1, 'rgba(72,81,55,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 2.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -0.026; this.scene.add(shadow);
    this.clock = new THREE.Clock(); this.actions = {}; this.groom = []; this.mouth = 0; this.motionLevel = 'lively';
    this.performance = new THREE.Group(); this.scene.add(this.performance); this.performanceTime = 0;
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container); this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
    this.loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    this.modelUrl = ''; this.modelId = modelId; this.modelLoadId = 0;
    void this.setModel(modelUrl, modelId);
    this.renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); this.onError('图形设备暂时不可用，请刷新页面或换用桌面浏览器。'); });
  }
  disposeModel(root) {
    if (!root) return;
    const geometries = new Set(), materials = new Set(), textures = new Set();
    root.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      const list = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of list) if (material) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    textures.forEach(texture => texture.dispose());
  }
  frameModel(model) {
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y <= 1e-4) return false;

    const scale = DISPLAY_MODEL_HEIGHT / size.y;
    const frame = new THREE.Group();
    frame.name = 'Model framing';
    frame.scale.setScalar(scale);
    frame.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    frame.add(model);
    this.performance.add(frame);
    this.modelFrame = frame;

    this.controls.target.set(0, DISPLAY_MODEL_HEIGHT / 2, 0);
    this.camera.position.copy(this.controls.target).add(this.defaultCameraOffset);
    this.controls.update();
    this.controls.saveState();
    return true;
  }
  setModel(modelUrl, modelId = 'balanced') {
    if (this.model && this.modelUrl === modelUrl) return Promise.resolve(true);
    const requestId = ++this.modelLoadId;
    this.modelUrl = modelUrl; this.modelId = modelId;
    clearTimeout(this.idleTimer);
    this.mixer?.stopAllAction();
    if (this.model) {
      this.mixer?.uncacheRoot(this.model);
      this.performance.remove(this.modelFrame || this.model);
      this.disposeModel(this.model);
    }
    this.model = null; this.modelFrame = null; this.mixer = null; this.activeAction = null; this.activeName = null;
    this.performance.position.set(0, 0, 0); this.performance.rotation.set(0, 0, 0);
    this.jaw = null; this.jawOpen = null; this.jawClosed = null; this.head = null; this.groom = []; this.actions = {};
    this.renderer.domElement.dataset.modelUrl = modelUrl;
    return new Promise(resolve => this.loader.load(modelUrl, gltf => {
      if (requestId !== this.modelLoadId) { this.disposeModel(gltf.scene); resolve(false); return; }
      this.model = gltf.scene;
      this.model.traverse(node => {
        if (node.isMesh) {
          node.castShadow = false; node.receiveShadow = false;
          if (/Groom/.test(node.name)) this.groom.push(node);
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          materials.forEach(m => { m.envMapIntensity = 0.65; });
        }
      });
      const eyes = [];
      this.model.traverse(node => { if (node.isMesh && /(Iris|Ocular[\s_.-]*surface)/i.test(node.name)) eyes.push(node); });
      const eyeTextureCount = eyes.filter(node => {
        const list = Array.isArray(node.material) ? node.material : [node.material];
        return list.some(material => material && Object.values(material).some(value => value?.isTexture && value.image));
      }).length;
      this.renderer.domElement.dataset.eyeTextures = String(eyeTextureCount);
      if (eyes.length !== 2 || eyeTextureCount === 0) {
        this.disposeModel(this.model); this.model = null;
        this.onError('眼部模型或贴图没有加载成功，请刷新页面重试。'); resolve(false); return;
      }
      if (!this.frameModel(this.model)) {
        this.disposeModel(this.model); this.model = null;
        this.onError('模型尺寸无效，请刷新页面重试。'); resolve(false); return;
      }
      this.jaw = this.model.getObjectByName('jaw');
      this.head = this.model.getObjectByName('head'); this.speechNod = new THREE.Quaternion(); this.speechEuler = new THREE.Euler();
      this.mixer = new THREE.AnimationMixer(this.model);
      this.sourceClips = gltf.animations; this.rebuildActions();
      const jawTrack = gltf.animations.flatMap(clip => clip.tracks).find(track => track.name === 'jaw.quaternion');
      if (jawTrack) {
        this.jawClosed = new THREE.Quaternion().fromArray(jawTrack.values, 0);
        this.jawOpen = this.jawClosed.clone(); let angle = 0;
        for (let i = 0; i < jawTrack.values.length; i += 4) {
          const q = new THREE.Quaternion().fromArray(jawTrack.values, i); const distance = this.jawClosed.angleTo(q);
          if (distance > angle) { angle = distance; this.jawOpen.copy(q); }
        }
      }
      this.mixer.addEventListener('finished', e => { if (e.action === this.activeAction) this.play('idle'); });
      this.play('idle');
      this.onLoad({ animations: gltf.animations.map(c => c.name), jaw: Boolean(this.jawOpen), modelId });
      resolve(true);
    }, event => {
      if (requestId === this.modelLoadId) this.onProgress(event.total ? Math.round(event.loaded / event.total * 100) : null);
    }, () => {
      if (requestId === this.modelLoadId) this.onError('模型暂时没有加载成功，请刷新页面重试。');
      resolve(false);
    }));
  }
  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  play(name) {
    const spec = ACTIONS[name];
    if (!spec || !MODEL_ACTIONS[this.modelId]?.includes(name)) return false;
    const next = (spec.clips || [spec.clip]).map(clip => this.actions[clip]).find(Boolean);
    if (!next) return false;
    clearTimeout(this.idleTimer);
    if (this.activeAction === next && name === 'idle') return true;
    const previous = this.activeAction;
    next.reset().setEffectiveTimeScale(['wave', 'happy'].includes(name) ? 1.12 : 1).setEffectiveWeight(1);
    next.setLoop(spec.loop ? THREE.LoopRepeat : THREE.LoopOnce, spec.loop ? Infinity : 1); next.clampWhenFinished = true;
    next.fadeIn(0.3).play();
    if (previous && previous !== next) previous.fadeOut(0.3);
    this.activeAction = next; this.activeName = name; this.performanceTime = 0; this.onAction(name);
    if (['walk', 'trot', 'run'].includes(name)) { next.setLoop(THREE.LoopRepeat, Infinity); this.idleTimer = setTimeout(() => this.play('idle'), 4500); }
    return true;
  }
  rebuildActions() {
    this.mixer.stopAllAction();
    for (const action of Object.values(this.actions)) this.mixer.uncacheClip(action.getClip());
    this.actions = {};
    for (const clip of this.sourceClips) this.actions[clip.name] = this.mixer.clipAction(expressiveClip(clip, this.motionLevel));
    this.activeAction = null;
  }
  setMotionLevel(value) {
    const next = motionLevel(value); if (this.motionLevel === next) return;
    this.motionLevel = next;
    if (this.mixer) { const action = this.activeName || 'idle'; this.rebuildActions(); this.play(action); }
  }
  setLightweight(enabled) { this.groom.forEach(mesh => { mesh.visible = !enabled; }); this.renderer.setPixelRatio(enabled ? 1 : Math.min(devicePixelRatio, 1.5)); }
  resetView() { this.controls.reset(); }
  tick() {
    const delta = Math.min(this.clock.getDelta(), 0.05);
    if (document.hidden) return;
    this.mixer?.update(delta); this.controls.update();
    this.performanceTime += delta;
    const pose = performancePose(this.activeName, this.activeAction?.time || 0, this.activeAction?.getClip().duration || 1, this.motionLevel);
    this.performance.position.y = THREE.MathUtils.damp(this.performance.position.y, pose.y, 16, delta);
    this.performance.rotation.y = THREE.MathUtils.damp(this.performance.rotation.y, pose.yaw, 12, delta);
    const target = this.speaking ? this.level() : 0;
    this.mouth = THREE.MathUtils.damp(this.mouth, target, this.speaking ? 22 : 15, delta);
    if (this.jaw && this.jawOpen && (this.speaking || this.mouth > 0.005)) this.jaw.quaternion.slerpQuaternions(this.jawClosed, this.jawOpen, Math.min(0.95, this.mouth * 1.2));
    if (this.head && this.speaking && this.activeName === 'idle') {
      this.speechEuler.set(Math.sin(this.performanceTime * 5) * 0.045 * this.mouth, 0, Math.sin(this.performanceTime * 2) * 0.035);
      this.head.quaternion.multiply(this.speechNod.setFromEuler(this.speechEuler));
    }
    this.renderer.render(this.scene, this.camera);
    // Read-only diagnostics on the canvas support browser/device acceptance
    // without exposing application objects or recording any conversation data.
    const now = performance.now(); this.statsFrames++;
    if (now - this.statsStarted >= 250) {
      const canvas = this.renderer.domElement;
      canvas.dataset.fps = String(Math.round(this.statsFrames * 1000 / (now - this.statsStarted)));
      canvas.dataset.triangles = String(this.renderer.info.render.triangles);
      canvas.dataset.action = this.activeName || 'loading';
      const progress = (this.activeAction?.time || 0) / (this.activeAction?.getClip().duration || 1);
      canvas.dataset.phase = progress > 0.2 && progress < 0.75 ? 'middle' : 'edge';
      this.statsStarted = now; this.statsFrames = 0;
    }
  }
  dispose() {
    clearTimeout(this.idleTimer); this.observer.disconnect(); this.controls.dispose(); this.renderer.setAnimationLoop(null);
    this.scene.traverse(o => { o.geometry?.dispose(); const mats = Array.isArray(o.material) ? o.material : [o.material]; mats.filter(Boolean).forEach(m => { Object.values(m).forEach(v => { if (v?.isTexture) v.dispose(); }); m.dispose(); }); });
    this.environment.dispose(); this.renderer.dispose();
  }
}
