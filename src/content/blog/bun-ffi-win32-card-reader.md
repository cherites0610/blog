---
title: "Bun FFI 實戰：直接調用 Win32 API 驅動刷卡機通訊"
description: 介紹如何使用 Bun FFI 直接呼叫 Win32 API，實現刷卡機通訊。
pubDate: 2026-05-05
tags: ["Bun", "FFI", "Win32", "Windows", "TypeScript"]
---

# 緣由 : 原生模組的「單執行檔」惡夢

在開發桌面整合工具時，往往希望交付或者產出給客戶的是「一個檔案」，而不是「一個資料夾+萬惡的依賴文件」

- 編譯屏障:像 node-serialport 這類模組依賴 C++ 編譯，它們是動態連結庫。當你嘗試用 bun build --compile 或 pkg 封裝時，這些 .node 檔案通常無法被真正「靜態嵌入」到執行檔內部，導致執行時找不到路徑，或是必須額外附帶 .dll / .node 檔案。
- 依賴地獄：Node.js 的 native binding 往往需要對應的運行環境（ABI 版本），這增加了部署的風險。

## 選擇:兩條路的抉擇

### A:使用NodeJS+pkg(老牌方案)

#### 優點：
- 生態系成熟
- serialport 套件極其穩定。
-
#### 缺點：
- pkg已經進入維護模式
- 對新版的NodeJS支援度不佳
- 最終產出的檔案依然很大
- 處理C++的配置繁瑣

### B:使用 Bun:ffi + kernel32.dll (現代方案)
#### 優點：
- 真正的零依賴：kernel32.dll 是 Windows 內建的，不需要隨程式發布。
- 直接掌控：直接操作 OS 底層控制區塊（DCB），沒有中間層的效能損耗。

#### 缺點：
- 平台鎖定：kernel32.dll 是 Windows 專屬，無法跨平台移植。
- 學習門檻高：需要理解 C ABI、記憶體佈局與指標操作，型別定義出錯換來的是 Segment Fault，而非友善的錯誤訊息。
- 無型別保護：DLL 本身不提供型別資訊，所有函式簽章都要手動對照 MSDN 文件撰寫，維護成本高。

對「刷卡機Gateway」而言，開箱即用無需繁瑣配置及解決依賴地獄是現場非常重要的事情，故我選擇了B方案

## 實戰

### FFI 函數定義
透過 Bun 的 bun:ffi，我們可以直接載入 Windows 的系統核心函式庫 kernel32.dll。這不僅僅是呼叫一個函式，更是一場「跨語言的數據交換」。

1. 建立橋樑：dlopen
首先，我們必須明確定義底層函式的「長相」。在 C 語言中，每個參數佔用的記憶體空間是嚴格限制的，因此在宣告時，我們必須精確映射型別：
```
import { dlopen, FFIType } from "bun:ffi";

const { symbols: k32 } = dlopen("kernel32.dll", {
  CreateFileA: {
    args: [
      FFIType.cstring, // lpFileName: 裝置路徑
      FFIType.u32,     // dwDesiredAccess: 存取權限
      FFIType.u32,     // dwShareMode: 共享模式
      FFIType.ptr,     // lpSecurityAttributes: 安全屬性
      FFIType.u32,     // dwCreationDisposition: 建立處置
      FFIType.u32,     // dwFlagsAndAttributes: 檔案屬性
      FFIType.ptr      // hTemplateFile: 模板檔案
    ],
    returns: FFIType.u64_fast, // 回傳值為 Handle (指標)
  }
});
```

2. 為什麼型別定義如此重要？
在 JavaScript 中，數字通常以 64 位元浮點數儲存，但在 Windows API 的眼中：

u32：代表這是一個精確的 4 位元組整數。

cstring：代表一個以 \0 (Null) 結尾的字串指標。

ptr：代表一個記憶體位址。

這種映射被稱為 ABI (Application Binary Interface) 映射。如果型別定義出錯，輕則通訊失敗，重則導致整個程式當機（Segment Fault），因為你正在操作的是作業系統最核心的記憶體區塊。

3. Handle 的本質
注意這裡的 returns: FFIType.u64_fast。CreateFileA 會回傳一個 HANDLE。在底層世界裡，這並不是一個「檔案物件」，而是一個指向系統資源的指標。我們在後續的讀取與寫入動作中，都必須帶著這把「鑰匙（Handle）」，作業系統才知道你要操作的是哪一個硬體裝置。

### 硬體協議握手
拿到硬體句柄（Handle）後，就像是接通了電話，但如果兩邊說的話速（Baud Rate）不對、語法（Data Bits）不同，最終只會收到一堆亂碼。

在 Windows 底層，這一切的設定都儲存在一個名為 DCB (Device Control Block) 的結構體中。而在 TypeScript 裡，我們必須透過 Uint8Array 與 DataView 來模擬這個 C 語言結構體的記憶體佈局。

1. 記憶體的手術刀：DataView
為什麼不直接操作 Uint8Array？因為序列埠的設定是「混合型別」的。波特率是 4 bytes 的整數，而資料位元是 1 byte。DataView 讓我們能精確地在指定的偏移量（Offset）寫入正確長度的數值。
```
const dcb = new Uint8Array(28); // 分配 28 位元組的連續空間
const view = new DataView(dcb.buffer);

// 規定：結構體的第一個欄位必須是它的大小
view.setUint32(0, 28, true);

// 從第 4 個位元組開始，寫入 4 bytes 的波特率
view.setUint32(4, 9600, true);
```
這裡的 true 代表 Little-endian (小端序)。這是 Windows 與 Intel CPU 的標準排列方式：低位元組在前。如果少了這個設定，9600 進到硬體後會變成一個完全錯誤的天文數字。

2. 位元欄位與狀態獲取
通常我們不會從頭建立一個 DCB，而是先用 GetCommState 抓取現有的設定，修改我們需要的，再用 SetCommState 寫回去。這就像是先讀取設定檔，改完後存檔。
```
k32.GetCommState(this.#handle, dcb); // 抓取現狀

// 設定通訊格式：8-N-1 (8位元資料, 無校驗, 1停止位)
dcb[18] = 8; // ByteSize
dcb[19] = 0; // Parity: NOPARITY
dcb[20] = 0; // StopBits: ONESTOPBIT

k32.SetCommState(this.#handle, dcb); // 套用設定
```

3. 超時設定：防止程式「死等」
在同步通訊中，如果硬體一直沒回傳資料，ReadFile 可能會讓你的程式永久卡死。為了實現非同步的效果，我們必須設定 COMMTIMEOUTS。

我們將 ReadIntervalTimeout 設為 0xffffffff (MAXDWORD)。這在 Windows API 中是一個特殊技巧，代表：「如果緩衝區有資料就立刻拿走；如果沒資料，不要等，直接回報讀取了 0 位元組。」

### 非同步輪詢機制
1. 利用 setInterval 模擬異步監控
為了不阻塞主線程，我們使用 setInterval 定期檢查硬體緩衝區。搭配上一章提到的「非阻塞超時設定」，這讓我們的讀取循環變得非常流暢：

```
this.#pollTimer = setInterval(() => {
  const readBuf = new Uint8Array(1024); // 接收資料的籃子
  const bytesRead = new Uint32Array(1); // 用來存放「收據」的位址

  // 呼叫系統函式，這是一個非阻塞呼叫
  const ok = k32.ReadFile(this.#handle, readBuf, readBuf.length, bytesRead, null);

  if (ok && bytesRead[0] > 0) {
    // 只有在真正讀到資料時，才將資料往後傳遞
    this.#onData(Buffer.from(readBuf.buffer, 0, bytesRead[0]));
  }
}, 10); // 每 10 毫秒輪詢一次
```
2. 「收據」的藝術：bytesRead
這是初學者最容易困惑的地方：為什麼要傳入一個 Uint32Array(1)？

在 C 語言的 API 設計中，函式回傳值（ok）通常只用來告訴你「執行成功或失敗」。至於「到底讀到了多少資料」，系統會直接修改你傳進去的記憶體位址內容。這就是 「輸出參數 (Output Parameter)」 的概念。

當 bytesRead[0] 從 0 變成了 10，代表系統幫你把 10 個位元組塞進了 readBuf。這張「收據」是我們精確控制記憶體、避免讀到殘留資料的唯一依據。

3. 穩定性與生命週期管理
在建立輪詢機制的同時，我們也必須考慮到「優雅降級」。如果程序突然關閉，而硬體句柄（Handle）沒有被釋放，該 COM 埠可能會被鎖定，導致下次無法開啟。

```
// 註冊行程退出事件，確保硬體資源被釋放
process.on("exit", () => this.#close());
```
### 資料流處理
從 k32.ReadFile 拿到的資料就像斷斷續續的水流，我們稱之為 Chunk。在通訊協議中，這些 Chunk 可能會發生兩種情況：

碎片化（Fragmentation）：一個完整的封包被拆成多次才傳完。

黏包（Sticky Packets）：上一筆封包的結尾跟下一筆的開頭黏在一起送過來。

為了從這些混亂的位元組中找回真相，我們需要建立一個 「流式解析器（Stream Parser）」。

1. 建立累積緩衝區（Accumulation Buffer）
我們不能直接處理收到的 Chunk，必須先將它們「存起來」。透過 Buffer.concat，我們將新舊資料不斷拼湊，直到它足以構成一個完整的訊息。

```
// 將新收到的片段併入緩衝區
this.#readBuffer = Buffer.concat([this.#readBuffer, chunk]);
```
2. 尋找同步標記：STX 的重要性
在雜訊眾多的硬體環境中，我們如何知道「真正的封包」從哪裡開始？這時 STX (Start of Text, 0x02) 就派上用場了。這就像是在一串亂碼中尋找開頭。

```
// 尋找 STX 標記的位置
const stxIdx = this.#readBuffer.indexOf(SerialPaymentProcessor.STX);

if (stxIdx === -1) {
  // 如果完全沒看到 STX，代表這整塊資料都是垃圾，直接清空
  this.#readBuffer = Buffer.alloc(0);
  return;
}

// 如果 STX 不在開頭，代表前面有雜訊，直接切除（subarray）
if (stxIdx > 0) {
  this.#readBuffer = this.#readBuffer.subarray(stxIdx);
}
```
3. 滑動視窗：精確切割長度
當我們確定了開頭，接下來就是根據協議預定的 TOTAL_LENGTH 來判斷資料是否到齊。

如果長度不夠：什麼都不做，直接 return，等待下一次輪詢湊齊。

如果長度足夠：切出一個完整的 Frame 送往下一階段處理，並將剩下的資料保留在緩衝區（應對黏包情況）。

```
if (this.#readBuffer.length >= SerialPaymentProcessor.TOTAL_LENGTH) {
  // 切出完整的一幀
  const frame = Buffer.from(this.#readBuffer.subarray(0, SerialPaymentProcessor.TOTAL_LENGTH));

  // 保留剩下的資料，留待下次處理
  this.#readBuffer = this.#readBuffer.subarray(SerialPaymentProcessor.TOTAL_LENGTH);

  // 進入解析階段
  this.#processFrame(frame);
}
```

### 資料幀驗證與解析
拿到一組完整長度的資料幀（Frame）後，我們進入最後一關：驗證它的合法性，並將二進位數據轉化為應用程式看得懂的格式。這一步驟包含了 邊界驗證、校驗碼計算 與 雙向應答。

1. 雙重邊界驗證
除了在上一章提到的開頭 STX，標準協議通常會在結尾處加上 ETX (End of Text, 0x03)。這就像是文件上的首尾鋼印，缺一不可。

```
if (data[0] !== SerialPaymentProcessor.STX) {
  throw new Error("Invalid response: Missing STX");
}
if (data[SerialPaymentProcessor.DATA_LENGTH + 1] !== SerialPaymentProcessor.ETX) {
  throw new Error("Invalid response: Incorrect ETX");
}
```
2. LRC 校驗：偵測傳輸錯誤
LRC (Longitudinal Redundancy Check) 是一種常見的橫向校驗機制。它的原理非常簡單卻有效：將所有數據位元組進行異或（XOR）運算。如果收到的校驗位與我們根據內容計算出的結果不符，就代表這筆資料在路上「壞掉了」。

```
const receivedLrc = data[SerialPaymentProcessor.DATA_LENGTH + 2];
const calculatedLrc = this.#calculateLRC(
  data.subarray(1, SerialPaymentProcessor.DATA_LENGTH + 1), // 資料內容
  SerialPaymentProcessor.ETX // 結尾標記
);

if (receivedLrc !== calculatedLrc) {
  console.warn("LRC Mismatch - 數據完整性受損");
}
```
3. 解析與分發（Payload Parsing）
一旦驗證通過，我們就能放心地將 Buffer 轉換成具備商務意義的欄位。例如，將十六進位轉換為字串或數值。處理完畢後，透過 EventEmitter 將結果拋出，讓上層業務邏輯（例如結帳、退款）接手。

```
const parsedFields = this.#parseResponseData(data.subarray(1, SerialPaymentProcessor.DATA_LENGTH + 1));
this.#responseEmitter.emit("serialResponse", null, parsedFields);
```
4. 完成「閉環」：發送 ACK 應答
在工業級通訊中，單向接收是不夠的。當我們確認資料正確無誤後，必須主動回傳一個 ACK (0x06) 給硬體設備。這個動作告訴設備：「我收到且讀懂了，你可以安心結束這筆交易或是關閉連線。」
```
const ackBuf = new Uint8Array([0x06, 0x06]);
k32.WriteFile(this.#handle!, ackBuf, ackBuf.length, written, null);
```

## 結語

從一開始「交付一個檔案」的簡單需求，我們走過了 ABI 型別映射、DCB 結構體手術、流式解析器的碎片黏包，最終實現了一套完全無外部依賴、可直接 `bun build --compile` 的刷卡機通訊系統。

這套方案的核心思路其實不只適用於刷卡機——任何只提供 `.dll` 的 Windows 硬體（條碼機、電子秤、POS 週邊），都可以照著同樣的脈絡接入：`dlopen` 定義橋接 → DataView 模擬結構體 → 非阻塞輪詢 → 流式解析。

當然，這條路並非沒有代價：你必須直接面對記憶體的原始樣貌，型別錯一個位元組，換來的是 Segment Fault 而不是友善的錯誤訊息。但也正是因為少了所有中間層，你對硬體的掌控是透明且直接的。

如果你也曾被 node-gyp 的編譯錯誤折磨過，Bun FFI 值得一試。
