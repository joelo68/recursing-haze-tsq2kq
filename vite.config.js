// vite.config.js
    import { defineConfig } from 'vite';
    import react from '@vitejs/plugin-react';

    export default defineConfig({
      plugins: [react()],
      resolve: {
        alias: {
          // 之前嘗試過的針對 Firebase 的別名，如果現在還不需要，可以移除或註釋
          // './runtimeConfig': './runtimeConfig.browser',

          // 嘗試為 lucide-react 添加別名，確保它指向正確的入口點
          // 有些庫會提供不同的入口點，例如 'lucide-react/dist/esm'
          // 但通常直接 'lucide-react' 應該就可以
          // 這個通常不需要，除非庫的預設導入有問題
        },
      },
      // 由於您現在使用的是標準 Vite，我們通常不應該需要 external
      // 但如果上述 alias 無效，可以嘗試在這裡將 'lucide-react' 外部化，
      // 不過這通常不是最佳解決方案，因為圖標會無法打包
      /*
      build: {
        rollupOptions: {
          external: ['lucide-react'], // 不推薦，會導致圖標無法顯示
        },
      },
      */
    });