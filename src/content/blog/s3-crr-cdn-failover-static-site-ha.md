---
title: "S3 跨區域備援 + CDN Failover：靜態網站的高可用架構實踐"
description: "從 S3 CRR 到 CDN Origin Group Failover，一步步打造靜態網站的高可用架構，並分享踩坑心得。"
pubDate: 2026-05-08
tags: ["實戰紀錄"]
---

#### 一、前言：為什麼靜態網站也需要高可用
很多人認為靜態網站「不會掛」，畢竟沒有 server runtime、沒有資料庫連線，只是一堆 HTML、CSS、JS 檔案而已。

但這個認知有個盲點：檔案放在哪裡，哪裡就是你的單點故障。

以 Nuxt SSG 搭配 S3 + CDN 的架構為例，如果 S3 所在的 AWS 區域發生服務中斷，或是 CDN 與 origin 之間的連線出現問題，你的網站一樣會完全無法存取。對於純展示性的行銷官網來說，這段停機時間可能就是直接的業務損失。

這篇文章要介紹的，是一套以 S3 跨區域複製（CRR）搭配 CDN Origin Group Failover 為核心的靜態網站高可用架構。不需要複雜的 infra，成本也相對可控，但可用性能有效提升到接近 99.99%。

#### 二、架構總覽
在進入細節之前，先看整體架構長什麼樣子：
![架構圖](/images/s3-crr-cdn-failover/architecture.png)

各角色的職責：
- Nuxt SSG：前台靜態網站，build 出純靜態的 HTML/CSS/JS
- S3 主 bucket：存放目前上線版本的靜態檔案，位於主要服務區域
- S3 備用 bucket：由 CRR 自動從主 bucket 同步，位於另一個 AWS 區域
- CDN Origin Group：設定主備兩個 origin，主 origin 掛掉時自動切換-
- 部署伺服器：負責執行 Nuxt build、上傳到主 S3、觸發 CDN invalidation

整條流程的設計原則是：部署只寫主 bucket，備援完全依賴 AWS 服務本身處理，不需要自己寫雙寫邏輯。

#### 三、S3 跨區域複製（CRR）設定
前置條件:
開啟 CRR 之前，主備兩個 bucket 都必須先開啟 S3 Versioning，這是 CRR 運作的必要條件。
```
# 開啟主 bucket versioning
aws s3api put-bucket-versioning \
  --bucket my-site-primary \
  --versioning-configuration Status=Enabled

# 開啟備用 bucket versioning
aws s3api put-bucket-versioning \
  --bucket my-site-replica \
  --versioning-configuration Status=Enabled
```

設定 CRR 規則
在主 bucket 的 Management → Replication rules 新增規則：

Source：主 bucket 的所有物件（或指定 prefix）
Destination：備用 bucket（選擇另一個 AWS region）
IAM role：讓 S3 有權限把物件複製過去，AWS console 可以自動建立

透過 AWS CLI 的設定範例：
```
{
  "Role": "arn:aws:iam::ACCOUNT_ID:role/s3-replication-role",
  "Rules": [
    {
      "Status": "Enabled",
      "Filter": { "Prefix": "" },
      "Destination": {
        "Bucket": "arn:aws:s3:::my-site-replica"
      }
    }
  ]
}
```

備用 bucket 設成 read-only
這點很容易被忽略，但非常重要。備用 bucket 應該設成只有 CDN 可以讀取，不允許任何寫入，原因有兩個：

避免部署流程出 bug 時意外寫進備用 bucket，導致主備內容不一致
明確區分資料流向：只有 CRR 可以寫入備用 bucket

做法是在備用 bucket 的 Bucket Policy 只允許 CloudFront OAC（Origin Access Control）的 s3:GetObject，拒絕所有其他來源的寫入操作。
CRR 的延遲特性
CRR 不是即時同步，通常有 幾分鐘的延遲。這個特性在設計部署流程時很重要，後面的章節會說明如何在這個限制下正確操作 CDN invalidation。

#### 四、CDN Origin Group 與 Failover 設定
以 AWS CloudFront 為例，Origin Group 的概念是：把多個 origin 組成一個群組，讓 CloudFront 在主 origin 失敗時自動切換到備用 origin。
建立 Origin Group
在 CloudFront Distribution 的設定中：

先分別新增主 S3 bucket 和備用 S3 bucket 作為兩個獨立的 origin（都使用 OAC 方式存取）
在 Origin groups 建立一個新的 group，把這兩個 origin 加進去
指定哪個是 primary，哪個是 secondary

Failover Criteria 的設定
這裡有一個容易踩的坑：failover criteria 要設對，否則正常的請求也會觸發切換。
建議只設以下 HTTP status code 觸發 failover：

- 500 Internal Server Error
- 502 Bad Gateway
- 503 Service Unavailable
- 504 Gateway Timeout

不要加 404。如果你的網站有頁面不存在的情況（例如用戶直接輸入錯誤 URL），主 bucket 回傳 404 是正常行為，不應該切換到備用 origin，備用 bucket 一樣找不到那個檔案。
Failover 不是瞬間的
CloudFront 切換 origin 需要一段 health check 時間，通常是幾秒到數十秒。這套架構解決的是「區域中斷」這種等級的故障，不適合用來保護毫秒級的 availability SLA。

#### 五、部署流程：build 完怎麼更新到 S3
部署流程設計的核心原則是：只寫主 bucket，讓 CRR 和 CDN failover 各自做自己的事。
完整步驟
```
# 1. Nuxt build
npm run generate

# 2. 上傳到主 S3 bucket
aws s3 sync .output/public/ s3://my-site-primary/ \
  --delete \
  --cache-control "public, max-age=31536000, immutable"

# 3. 立即觸發 CDN invalidation
aws cloudfront create-invalidation \
  --distribution-id YOUR_DISTRIBUTION_ID \
  --paths "/*"

```
為什麼 invalidation 不用等 CRR 同步完
這個問題很常見：備用 bucket 的檔案還沒更新，這時候 invalidation 先發出去，如果 failover 切到備用 bucket，用戶不就看到舊版本了？
實際上不會有問題，原因是：

正常狀況（主 origin 可用）：CDN 從主 bucket 拿到新版本，CRR 在幾分鐘內把新版本同步到備用 bucket
Failover 狀況（主 origin 掛掉）：這代表主 bucket 所在的區域出問題了，這個情境下用戶看到幾分鐘的舊版本，相較於完全無法存取，是可以接受的取捨

換句話說，CRR 的延遲只在「主 origin 在 CRR 同步完成之前就掛掉」這個極短的時間窗口內才有影響，而這種情況的機率極低。


atomic swap 避免部署中斷上傳過程中，舊版本的檔案仍在服務中。aws s3 sync 是逐檔上傳的，上傳到一半時如果有用戶請求，可能拿到新舊混合的狀態。
解決方式有兩種：
- 方式一：上傳到暫存 prefix，完成後再 copy 到根目錄（適合檔案量少的情況）
- 方式二：利用 CloudFront 的 cache 特性，搭配帶 hash 的檔案名稱（Nuxt build 預設就會做這件事），入口的 index.html 最後才上傳，讓用戶在切換瞬間拿到一致的版本

#### 六、結語
這套架構的適用場景是：對可用性有要求、但流量規模不需要多 region active-active 的靜態網站。

一個行銷官網、產品展示頁、文件站，用這套做法可以在相對低的成本下，把單點故障風險從「S3 區域中斷就整個掛掉」降低到「CDN failover 幾秒內自動切換到備用 origin」。
延伸可以做的事：

- 監控 failover 事件：設定 CloudWatch alarm，當 CloudFront 開始使用備用 origin 時發送通知
- 定期驗證備用 bucket 內容：寫一個簡單的 cron job 比對主備 bucket 的檔案數量和最後修改時間
- 搭配資料驅動的自動部署：如果前台內容由後台 CMS 管理，可以在資料更新後透過 debounce + webhook 自動觸發 Nuxt build，讓整條流程全自動化

靜態網站的高可用不需要複雜的架構，選對 AWS 服務、設定對 failover 條件、部署流程不踩坑，就能達到相當不錯的可用性。
