---
title: '深入理解 Node.js Event Loop'
description: '從 libuv 的角度拆解 Event Loop 的六個階段，理解 setTimeout、Promise、process.nextTick 的執行順序。'
pubDate: '2026-05-01'
tags: ['學習歷程']
---

Node.js 是單執行緒的，但它能同時處理大量 I/O 請求。這背後的核心機制就是 **Event Loop**，由底層的 C 函式庫 [libuv](https://libuv.org/) 實作。

#### 為什麼要理解 Event Loop？

看過這段程式碼嗎？

```js
setTimeout(() => console.log('setTimeout'), 0);
Promise.resolve().then(() => console.log('Promise'));
process.nextTick(() => console.log('nextTick'));
console.log('sync');
```

輸出順序是：

```
sync
nextTick
Promise
setTimeout
```

如果不清楚 Event Loop 的運作，這個結果會讓人困惑。看完這篇文章你會完全理解原因。

---

#### Event Loop 的六個階段

libuv 的 Event Loop 每跑一圈（tick），會依序經過六個階段：

```
   ┌───────────────────────────┐
┌─>│         timers            │  ← setTimeout / setInterval callback
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │     pending callbacks     │  ← 上一輪延遲的 I/O error callback
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │       idle, prepare       │  ← libuv 內部使用
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │           poll            │  ← 取得新的 I/O 事件，執行 I/O callback
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │           check           │  ← setImmediate callback
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
└──│      close callbacks      │  ← socket.on('close', ...) 等
   └───────────────────────────┘
```

##### 1. timers

執行 `setTimeout` 和 `setInterval` 的 callback。但「delay 到期」只是進入候補資格，實際執行時間取決於 poll 階段花了多久。

```js
// 這個 callback 不保證剛好 100ms 後執行
// 只保證「至少」100ms 後才會執行
setTimeout(() => console.log('timer'), 100);
```

##### 2. pending callbacks

執行上一輪 Event Loop 延遲的 I/O error callback，例如 TCP 連線錯誤的通知。通常不需要直接處理這個階段。

##### 3. idle, prepare

libuv 內部使用，Node.js 層不暴露。

##### 4. poll

這是最重要的階段，負責兩件事：

1. 計算需要 block 多久等待 I/O
2. 執行 I/O 相關的 callback（檔案讀取、網路請求等）

如果 timers 有到期的 callback，poll 會結束並跳回 timers 階段。如果沒有，則會在這裡等待新的 I/O 事件。

##### 5. check

執行 `setImmediate` 的 callback。`setImmediate` 保證在當前 poll 階段結束後、下一輪 timers 之前執行。

```js
const fs = require('fs');

fs.readFile('file.txt', () => {
  setTimeout(() => console.log('setTimeout'), 0);
  setImmediate(() => console.log('setImmediate'));
});

// 在 I/O callback 內，setImmediate 永遠先於 setTimeout
// 輸出：setImmediate → setTimeout
```

##### 6. close callbacks

執行 `close` 事件的 callback，例如 `socket.destroy()` 後觸發的 `socket.on('close', ...)`。

---

#### Microtask Queue：在每個階段之間執行

除了六個階段，還有兩個特殊的 queue 會在**每個階段切換之前**清空：

1. **`process.nextTick` queue**
2. **Promise microtask queue**（`Promise.then`、`async/await`）

執行優先序：`process.nextTick` > Promise microtask > 下一個 Event Loop 階段

```js
setTimeout(() => console.log('1. setTimeout'), 0);

Promise.resolve()
  .then(() => console.log('2. Promise'));

process.nextTick(() => console.log('3. nextTick'));

console.log('4. sync');
```

執行順序：

```
4. sync        ← 同步程式碼先跑完
3. nextTick    ← nextTick queue 清空
2. Promise     ← microtask queue 清空
1. setTimeout  ← 進入下一個 Event Loop，timers 階段
```

---

#### `process.nextTick` 的陷阱

`process.nextTick` 不屬於 Event Loop 的任何一個階段，它在**當前操作完成後立即執行**，優先度最高。

這也意味著：濫用 `process.nextTick` 可能讓 I/O 永遠無法執行。

```js
function infiniteNextTick() {
  process.nextTick(infiniteNextTick);
}

infiniteNextTick();
fs.readFile('file.txt', () => {
  // 這行永遠不會執行
  console.log('file read');
});
```

Node.js 官方建議：能用 `setImmediate` 就用 `setImmediate`，除非你明確需要在 I/O 之前執行。

---

#### async/await 的本質

`async/await` 是 Promise 的語法糖，`await` 之後的程式碼等同於 `.then()` callback，進入 microtask queue。

```js
async function main() {
  console.log('1. async start');
  await Promise.resolve();
  console.log('3. after await'); // microtask
}

main();
console.log('2. sync after main()');

// 輸出：1 → 2 → 3
```

---

#### 總結

| 機制 | 所屬佇列 | 執行時機 |
|------|----------|----------|
| 同步程式碼 | Call Stack | 立即 |
| `process.nextTick` | nextTick Queue | 當前操作結束後，最優先 |
| `Promise.then` / `await` | Microtask Queue | nextTick 清空後 |
| `setImmediate` | check 階段 | poll 階段結束後 |
| `setTimeout(fn, 0)` | timers 階段 | 下一輪 Event Loop |
| I/O callback | poll 階段 | 依事件觸發 |

理解了這張表，Node.js 裡所有非同步行為的執行順序都能推導出來。
