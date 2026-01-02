    // vite.config.js
    import { defineConfig } from 'vite';
    import react from '@vitejs/plugin-react';

    export default defineConfig({
      plugins: [react()],
      resolve: {
        // 嘗試添加這個別名，如果 recharts 有 Node.js 兼容性問題
        alias: {
          'recharts': 'recharts/es6', // 有些庫會提供 es6 兼容版本
        },
      },
      // 由於您現在使用的是標準 Vite，我們通常不應該需要 external
      // 但如果上述 alias 無效，可以嘗試在這裡將 'recharts' 外部化，
      // 不過這通常不是最佳解決方案，因為圖表會無法打包
      /*
      build: {
        rollupOptions: {
          external: ['recharts'],
        },
      },
      */
    });