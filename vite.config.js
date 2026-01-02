    // vite.config.js
    import { defineConfig } from 'vite'
    import react from '@vitejs/plugin-react'

    // https://vitejs.dev/config/
    export default defineConfig({
      plugins: [react()],
      build: {
        rollupOptions: {
          external: [
            'firebase/app',  // 明确外部化 firebase/app
            // 如果日誌中再次出現類似錯誤並提示其他 Firebase 模組，
            // 例如 'firebase/firestore' 或 'firebase/auth'，也請將它們添加到這裡
          ],
        },
      },
    })
