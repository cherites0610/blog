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

## 文章撰寫規範

### 標題層級
文章內文的主章節標題一律使用 `####`，不使用 `##` 或 `###`，以符合網站顯示比例。

## 文章撰寫工作流程

新增文章時，**必須**遵守以下流程，不可跳過任何步驟：

1. 使用者給題目 → 提出文章結構（大綱）讓使用者審核
2. 審核通過 → 在 `src/content/blog/` 建立 `.md` 檔，填好 frontmatter，內文留空
3. 使用者撰寫內文完成後告知 → 整理版面與內容
4. 呈現最終內容讓使用者審核，等待明確核准
5. 審核通過 → commit（**禁止**加 `Co-Authored-By`）→ push

## 開發進度

| # | 階段 | 狀態 |
|---|------|------|
| 1 | 建立 Astro 專案（blog template） | ✅ 完成 |
| 2 | 客製化樣式（簡潔版型、RWD） | ✅ 完成 |
| 3 | 寫第一篇文章（Event Loop），驗證 Markdown + code highlight | ✅ 完成 |
| 4 | EC2 + Caddy + 域名 + SSL | ✅ 完成 |
| 5 | GitHub Actions 部署腳本 | ✅ 完成 |
| 7 | （第二階段）RSS、SEO og tags、Dev.to 同步 | 🔄 RSS + SEO 完成，Dev.to 待處理 |
