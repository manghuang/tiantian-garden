import { defineConfig } from 'vite';
export default defineConfig({
  // Avoid ancestor-directory scanning on locked-down Windows installations.
  optimizeDeps: { noDiscovery: true, include: [] },
  build: { rollupOptions: { output: { manualChunks: { 'three-core': ['three'], 'three-addons': ['three/addons/loaders/GLTFLoader.js', 'three/addons/controls/OrbitControls.js', 'three/addons/environments/RoomEnvironment.js'] } } } },
});
