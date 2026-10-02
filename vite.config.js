import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const RELEASE_IDENTITY_SCHEMA_VERSION = 'release-identity-v1'

const normalizeReleaseText = (value = '', maxLength = 160) =>
  String(value ?? '').trim().slice(0, maxLength)

const resolveSourceCommit = () => {
  const explicit = normalizeReleaseText(process.env.DRCYJ_RELEASE_COMMIT || '', 40)
  if (/^[0-9a-f]{40}$/i.test(explicit)) return explicit.toLowerCase()

  try {
    const resolved = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return /^[0-9a-f]{40}$/i.test(resolved) ? resolved.toLowerCase() : 'unknown'
  } catch {
    return 'unknown'
  }
}

const resolveCurrentAppVersion = () => {
  try {
    const appSource = fs.readFileSync(new URL('./src/App.jsx', import.meta.url), 'utf8')
    const match = appSource.match(/const CURRENT_APP_VERSION = "([^"]+)";/)
    return normalizeReleaseText(match?.[1] || 'unknown', 40)
  } catch {
    return 'unknown'
  }
}

const createReleaseIdentityPlugin = () => ({
  name: 'drcyj-release-identity',
  generateBundle(_options, bundle) {
    const entryChunk = Object.values(bundle).find(
      (item) => item?.type === 'chunk' && item.isEntry
    )
    const payload = {
      schemaVersion: RELEASE_IDENTITY_SCHEMA_VERSION,
      appVersion: resolveCurrentAppVersion(),
      sourceCommit: resolveSourceCommit(),
      entryAsset: normalizeReleaseText(entryChunk?.fileName || '', 240),
    }

    this.emitFile({
      type: 'asset',
      fileName: 'release.json',
      source: `${JSON.stringify(payload, null, 2)}\n`,
    })
  },
})

export default defineConfig({
  // ★ 這是您 GitHub Pages 的專屬路徑，絕對不能漏掉！
  base: '/recursing-haze-tsq2kq/',
  plugins: [
    react(),
    createReleaseIdentityPlugin(),
    VitePWA({
      registerType: 'autoUpdate', // 只要您發佈新版，背景會自動默默幫使用者更新
      includeAssets: ['vite.svg'], // 把您現有的 icon 加入快取
      workbox: {
        // release.json 必須每次向正式站重新確認，不能被舊 Service Worker precache。
        globIgnores: ['**/release.json'],
      },
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
