需求詳見 BLOG_REQUIREMENTS.md

## 專案架構

### 技術選型
- **框架**：Astro blog starter（SSG）
- **文章管理**：Astro Content Collections（TypeScript 型別安全）
- **程式碼高亮**：Shiki（Astro 內建）
- **閱讀時間**：remark-reading-time 插件（自動計算）

### 目錄結構
```
blog/
├── src/
│   ├── content/
│   │   ├── config.ts              ← frontmatter schema
│   │   └── blog/                  ← .md 文章放這
│   ├── layouts/
│   │   ├── BaseLayout.astro       ← HTML骨架、RWD、meta tags
│   │   └── BlogPostLayout.astro   ← 文章頁 layout
│   ├── pages/
│   │   ├── index.astro            ← 文章列表（首頁）
│   │   ├── blog/[slug].astro      ← 文章詳細頁
│   │   └── tags/[tag].astro       ← 標籤篩選頁
│   └── components/
│       ├── ArticleCard.astro
│       ├── TagBadge.astro
│       └── Header.astro
├── public/
├── astro.config.mjs
├── package.json
└── tsconfig.json
```

### 文章 Frontmatter Schema
```typescript
{
  title: string
  description: string
  pubDate: Date
  tags: string[]
  draft?: boolean   // 草稿不發布
}
// 閱讀時間由插件自動計算
```

### 部署架構
```
本地 → git push → GitHub
                    ↓ GitHub Actions (SSH)
                 EC2: git pull → npm run build
                    ↓
                 Caddy serve dist/（自動 SSL）
```

## 開發進度

| # | 階段 | 狀態 |
|---|------|------|
| 1 | 建立 Astro 專案（blog template） | ✅ 完成 |
| 2 | 客製化樣式（簡潔版型、RWD） | ✅ 完成 |
| 3 | 寫第一篇文章（Event Loop），驗證 Markdown + code highlight | ✅ 完成 |
| 4 | EC2 + Caddy + 域名 + SSL | ⬜ 待開始 |
| 5 | GitHub Actions 部署腳本 | ⬜ 待開始 |
| 6 | 補齊剩餘文章 | ⬜ 待開始 |
| 7 | （第二階段）RSS、SEO og tags、Dev.to 同步 | 🔄 RSS + SEO 完成，Dev.to 待處理 |
