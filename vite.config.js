import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/recursing-haze-tsq2kq/',  // ⚠️ 請注意：這裡一定要改成您 GitHub 舊專案的「倉庫名稱」
})