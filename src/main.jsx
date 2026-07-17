import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// 防止 Chrome／Edge 內建翻譯與多數翻譯外掛誤改姓名、店名與金額文字。
// 保留原本精簡的「$」顯示，不增加字寬、不改變既有版面。
const applyNoTranslateProtection = () => {
  const html = document.documentElement
  html.lang = 'zh-Hant-TW'
  html.setAttribute('translate', 'no')
  html.classList.add('notranslate')

  let googleNoTranslateMeta = document.head.querySelector('meta[name="google"]')
  if (!googleNoTranslateMeta) {
    googleNoTranslateMeta = document.createElement('meta')
    googleNoTranslateMeta.setAttribute('name', 'google')
    document.head.appendChild(googleNoTranslateMeta)
  }
  googleNoTranslateMeta.setAttribute('content', 'notranslate')

  ;[document.body, document.getElementById('root')].filter(Boolean).forEach((element) => {
    element.setAttribute('translate', 'no')
    element.classList.add('notranslate')
  })
}

applyNoTranslateProtection()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
