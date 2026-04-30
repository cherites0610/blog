# 技術部落格需求文檔

## 專案目標

建立一個個人技術部落格，記錄 Node.js / TypeScript 底層原理的學習成果，以及工作中累積的實務心得，作為履歷的技術深度佐證。

## 技術棧

- **框架**：Astro
- **部署**：自有 Linux EC2
- **域名**：自有域名
- **文章格式**：Markdown（`.md`）

## 功能需求

### 核心功能
- 文章列表頁（首頁）
- 文章詳細頁，支援 Markdown 渲染
- 程式碼高亮（技術文章必備）
- RWD，支援手機瀏覽
- 文章標籤分類
- 閱讀時間估算

### 第二階段
- RSS Feed
- SEO meta tags（og:title、og:description）
- 文章自動同步到 Dev.to（GitHub Actions + Dev.to API）

## 部署架構

```
本地開發
  ↓ git push
GitHub
  ↓ SSH / GitHub Actions
EC2（Linux）
  ↓
Caddy（自動處理域名 + SSL）
  ↓
自有域名（HTTPS）
```

## 開發順序

1. 用 Astro 官方 blog starter 建立專案
2. 客製化樣式（簡潔即可，不過度設計）
3. 寫第一篇文章（Event Loop）驗證流程
4. 設定 EC2 + Caddy + 域名 + SSL
5. 建立部署流程（手動或 GitHub Actions）
6. 陸續補齊其餘四篇文章

## 非功能需求

- Lighthouse 效能分數 > 90
- 首頁載入時間 < 1s（Astro 靜態輸出天生快）
