// vite.config.js
    import { defineConfig } from 'vite'
    import react from '@vitejs/plugin-react'

    // https://vitejs.dev/config/
    export default defineConfig({
      plugins: [react()],
      // 移除 build.rollupOptions.external 和 resolve.alias 部分
    })