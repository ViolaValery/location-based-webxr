import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      'gps-plus-slam-app-framework/sensors': path.resolve(__dirname, '../GpsPlusSlamJs_AppFramework/src/sensors/index.ts'),
      'gps-plus-slam-app-framework/ar': path.resolve(__dirname, '../GpsPlusSlamJs_AppFramework/src/ar/index.ts'),
      'gps-plus-slam-app-framework/geo': path.resolve(__dirname, '../GpsPlusSlamJs_AppFramework/src/geo/index.ts'),
      'gps-plus-slam-app-framework/storage': path.resolve(__dirname, '../GpsPlusSlamJs_AppFramework/src/storage/index.ts'),
      'gps-plus-slam-app-framework/state': path.resolve(__dirname, '../GpsPlusSlamJs_AppFramework/src/state/index.ts'),
      'gps-plus-slam-app-framework': path.resolve(__dirname, '../GpsPlusSlamJs_AppFramework/src/index.ts'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        arSceneDemo: path.resolve(__dirname, 'demos/ar-scene-demo/index.html'),
        editorDemo: path.resolve(__dirname, 'demos/editor-demo/index.html'),
      },
    },
  },
  server: {
    host: true,
    port: 5185,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: true,
  },
});
