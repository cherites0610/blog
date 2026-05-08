---
title: NestJS 的單元測試初體驗
description: 從零開始學習 NestJS 單元測試，涵蓋測試環境建立、Mock 技巧，以及實戰 CRUD Service 測試。
pubDate: 2026-05-04
tags: ["學習歷程"]
draft: false
---

#### 前言
撰寫單元測試-老生常談的後端工程師一定要具備的技能，
可是在台灣的web中，又有多少是真的有單元測試的呢？

以前production要是遇到bug，只能祈求自己有留Logger、
在development時，就只能祈求console.log還在，
不然復現又是一場戰爭。

上線前三天總是睡不著覺，後三天總是時刻緊張著。
但若有單元測試一切都不一樣了。

每個業務邏輯都能被測試，不會再出現莫名其妙的「小問題」，
更動底層業務邏輯，也不會在因為忘記改父層邏輯而報500。

這是「建立信心」的行為

#### NestJS 測試環境概覽
NestJS中本身就具有@nestjs/testing套件，以Jest做為默認的測試框架。

但由於我已習慣專案全面擁抱ESM，還需額外的Jest/global及引入方法來處理

在NestJs中，我們習慣以*.spec.ts做為測試檔案的命名慣例，

而我的初體驗會把每個module的測試文件都放在期__test__中
```
-admin
-- __test__
--- admin.service.spec.ts
--- admin.controller.spec.ts
-- admin.service.ts
-- admin.controller.ts
```

#### 建立第一個測試：Service 單元測試
在建立單元測試前，我們已完成基礎的Admin管理員module，具備基礎的CRUD，並且有CryptoUtil的引用。

##### 使用 `Test.createTestingModule()` 建立隔離模組
我們正常的Module中會import外部的模組，provider內部的service，以及使用controllers

而單元測試也一樣需要Module來當作我們的「大腦」

```
//運用Test.createTestingModule即可創建
const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        {
          provide: getRepositoryToken(Admin),
          useFactory: mockAdminRepository,
        },
        {
          provide: ConfigService,
          useFactory: mockConfigService
        }
      ],
    }).compile();
```
一樣需要把AdminService中需要注入的服務提供在provider中。

##### 注入依賴 vs. Mock 依賴
在正常的NestJS中，在建構子中若帶上具有Token的class，NestJS則會自動注入。

但我們單元測試中，會自行撰寫一個mock class，以TypeORM常見標準repository為例
```
const mockAdminRepository = () => ({
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    softRemove: jest.fn(),
    find: jest.fn(),
  });
```

##### 撰寫第一個 `describe` / `it` 區塊
以createAdmin當作第一個挑戰
```
describe('createAdmin', () => {
    it('應該在郵箱重複時拋出 BadRequestException', async () => {
      const dto = {
        email: 'test@test.com',
        password: 'password',
        name: 'Test',
        role: Role.Editor,
      };

      repo.findOneBy.mockResolvedValue({ id: 'some-id', ...dto });

      await expect(service.createAdmin(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('應該成功建立管理員並回傳', async () => {
      const dto = {
        email: 'new@test.com',
        password: 'password',
        name: 'New Admin',
        role: Role.Editor,
      };

      repo.findOneBy.mockResolvedValue(null);
      repo.create.mockReturnValue(dto);
      repo.save.mockResolvedValue({ id: 'uuid', ...dto });

      jest.spyOn(CryptoUtil, 'hash').mockResolvedValue('hashed_pass');

      const result = await service.createAdmin(dto);

      expect(repo.findOneBy).toHaveBeenCalledWith({ email: dto.email });
      expect(result).toHaveProperty('id');
      expect(result.email).toBe(dto.email);
    });
  });
```
當中，有幾個第一次看見的調用
- mockResolvedValue：用來控制該函數的返回值
- spyOn：監聽
- toHaveBeenCalledWith：是否有被呼叫並且傳入參數XX
- toHaveProperty：是否有該欄位

#### Mock 的藝術
寫到這裡，你可能會想：為什麼不直接連真實資料庫跑？

因為單元測試的核心精神是「隔離」，我只想測試這段邏輯本身，而不是整個系統。

##### 為何要 Mock？（隔離、速度、可控）
理由很簡單，三個字：**隔、快、控**。

**隔**：AdminService 的邏輯對不對，跟資料庫怎麼存沒有關係。把依賴換成 Mock，就能只驗證這一層。

**快**：不需要啟動資料庫、不需要網路，整個測試套件幾百毫秒跑完。

**控**：想讓 `findOneBy` 回傳 null？想讓 `save` 拋錯？Mock 讓你任意控制情境，包含那些在正式環境很難復現的邊界條件。

##### `jest.fn()` 與 `jest.spyOn()` 的差異與使用時機
這兩個是初學最常搞混的。

`jest.fn()` 是創造一個全新的空函數，沒有任何原本的實作：
```typescript
findOneBy: jest.fn() // 回傳 undefined，除非你用 mockResolvedValue 控制
```

`jest.spyOn()` 則是監聽一個**已存在**的物件方法，預設仍會呼叫原本的實作，但你可以選擇覆蓋：
```typescript
jest.spyOn(CryptoUtil, 'hash').mockResolvedValue('hashed_pass')
// CryptoUtil 是真實的 class，spyOn 讓我們偷換掉 hash 這個靜態方法
```

簡單判斷原則：
- 注入的依賴（Repository、ConfigService）→ 用 `jest.fn()` 組成 mock 物件
- 真實存在的 class 上的方法 → 用 `jest.spyOn()`

##### 覆蓋率報告解讀
執行 `jest --coverage`，跑完後會看到這樣的表格：

```
----------|---------|----------|---------|---------|
File      | % Stmts | % Branch | % Funcs | % Lines |
----------|---------|----------|---------|---------|
admin.service.ts | 91.3 | 75 | 100 | 91.3 |
```

四個欄位代表不同維度：
- **Stmts**（語句）：有多少行程式碼被執行到
- **Branch**（分支）：if/else、三元運算子等分支，兩側都跑到了嗎
- **Funcs**（函式）：有多少函式被呼叫過
- **Lines**（行數）：和 Stmts 類似，但以物理行計算

Branch 通常是最難拉高的，因為每個 if 都有兩條路，每條都要有測試案例覆蓋。

追求 100% 不是目標，但 Branch coverage 低代表你的邏輯有死角沒被測到，值得重點關注。

#### 總結
單元測試不是一道很高的門檻，NestJS 把環境都準備好了，剩下的只是思維的轉換：

從「這樣寫能不能跑」，變成「這樣寫能不能被驗證」。

第一次寫的時候會很不習慣，Mock 要怎麼設、斷言要怎麼下、覆蓋率低要怎麼補。但寫過幾個 Service 之後，節奏就會慢慢建立起來。

上線不再靠祈禱，而是靠測試通過的那條綠線。
