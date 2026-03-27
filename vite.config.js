import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // ★ 這是您 GitHub Pages 的專屬路徑，絕對不能漏掉！
  base: '/recursing-haze-tsq2kq/', 
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', // 只要您發佈新版，背景會自動默默幫使用者更新
      includeAssets: ['vite.svg'], // 把您現有的 icon 加入快取
      manifest: {
        name: 'CYJ 營運系統',
        short_name: 'CYJ 系統',
        description: 'DRCYJ 雲端營運戰情系統',
        theme_color: '#f59e0b', // 琥珀色主題，讓手機頂部狀態列變色
        background_color: '#F9F8F6', // App 啟動時的過場背景色
        display: 'standalone', // 呈現真正的全螢幕原生 App 模式
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ]
})