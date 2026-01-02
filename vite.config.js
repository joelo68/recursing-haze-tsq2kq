// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      external: [
        'firebase/app',
        'firebase/auth',     // 添加 Auth
        'firebase/firestore', // 添加 Firestore
        // 如果您的應用還使用了其他 Firebase 服務，例如：
        // 'firebase/storage',
        // 'firebase/messaging',
        // 'firebase/functions',
        // 也請將它們添加到這裡
      ],
    },
  },
  // 嘗試添加 resolve.alias 來處理一些內部模組解析問題
  resolve: {
    alias: {
      // 這對於某些打包器來說可以解決 Node.js 內建模組的問題
      // 雖然之前試過，但和 external 一起用可能會有不同效果
      './runtimeConfig': './runtimeConfig.browser',
    },
  },
});
