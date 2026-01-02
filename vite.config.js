    // vite.config.js
    import { defineConfig } from 'vite';
    import react from '@vitejs/plugin-react';

    export default defineConfig({
      plugins: [react()],
      // 確保這裡沒有 build.rollupOptions.external 和 resolve.alias
      // 除非是針對特定問題的精確解決方案
    });
    
