import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/recursing-haze-tsq2kq/', // 保持您的 GitHub Pages 路徑
  build: {
    chunkSizeWarningLimit: 1000, // 稍微放寬警告標準
    rollupOptions: {
      output: {
        // ★ 核心魔法：將龐大的套件切塊，加速載入時間
        manualChunks: {
          vendor: ['react', 'react-dom'],
          ui: ['lucide-react', 'recharts'],
          firebase: ['firebase/app', 'firebase/firestore', 'firebase/auth']
        }
      }
    }
  }
})