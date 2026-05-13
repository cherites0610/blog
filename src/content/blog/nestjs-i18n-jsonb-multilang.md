---
title: "NestJS 後端 i18n 的優雅解法：用 PostgreSQL JSONB + 裝飾器打造型別安全的多語系架構"
description: 用 PostgreSQL JSONB 搭配 MultiLangString 類別與 @Translate 裝飾器，在 NestJS 中實現型別安全的多語系欄位自動解析。
pubDate: 2026-05-13
tags: [實戰紀錄]
---

#### 後端 i18n 常見的爛做法：為什麼我不想再看到 name_zh / name_en

每次接手有多語系需求的專案，最常看到的做法大概是這樣：

```sql
CREATE TABLE products (
  id UUID PRIMARY KEY,
  name_zh_tw TEXT,
  name_zh_cn TEXT,
  name_en TEXT,
  description_zh_tw TEXT,
  description_zh_cn TEXT,
  description_en TEXT
);
```

欄位數量直接乘上語言數量。今天要多支援一個語言，就是一次 migration 加一批欄位，然後所有 DTO、所有 Service、所有 query 都要跟著改。

更麻煩的是，這種做法在 TS 這層幾乎沒辦法做到真正的型別約束——你很難在 type 層面表達「這三個欄位是同個概念的不同語言版本」，也很難統一處理回傳邏輯。

我現在想要的是：
- 資料庫只存一個欄位，裡面放所有語言
- TS 有嚴格的型別，不能亂塞值
- Controller 不用每次手動去撈對應語言，應該自動處理

#### 用 PostgreSQL JSONB 儲存多語系欄位：結構設計

JSONB 是這個架構的基礎。欄位定義長這樣：

```sql
CREATE TABLE products (
  id UUID PRIMARY KEY,
  name JSONB NOT NULL,
  description JSONB
);
```

實際存進去的資料：

```json
{
  "zh_tw": "產品名稱",
  "zh_cn": "产品名称",
  "en": "Product Name"
}
```

用 JSONB 而不是 JSON 的原因是 JSONB 支援索引（GIN index），如果之後有搜尋需求可以直接加上去，不需要改結構。

TypeORM 這層的 entity 定義：

```typescript
@Entity()
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'jsonb' })
  name: MultiLangString;

  @Column({ type: 'jsonb', nullable: true })
  description: MultiLangString | null;
}
```

#### 給 JSONB 加上 TypeScript 嚴格型別：從資料庫到應用層

只靠 `jsonb` 欄位沒有型別保護，塞什麼進去資料庫都不會報錯，所以在 TS 層面定義 `MultiLangString`：

```typescript
export interface MultiLangString {
  zh_tw?: string;
  zh_cn?: string;
  en?: string;
}
```

對應的 `Language` enum：

```typescript
export enum Language {
  ZH_TW = 'zh_tw',
  ZH_CN = 'zh_cn',
  EN = 'en',
}
```

這樣 entity 上的 `name: MultiLangString` 就有完整的型別推導，不能塞 `{ jp: '...' }` 這種不存在的語言 key。

#### 用類別型別判斷多語系欄位

問題是：Interceptor 在執行期拿到的是一個普通物件，它不知道哪些欄位是多語系的、哪些只是剛好長得像 `{ en: 'something' }` 的普通物件。

這裡用 `isMultiLangString` 做 runtime 型別判斷：

```typescript
function isMultiLangString(value: unknown): value is MultiLangString {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return false;

  const langKeys = Object.values(Language) as string[];
  return entries.every(
    ([k, v]) => langKeys.includes(k) && (v === undefined || typeof v === 'string')
  );
}
```

邏輯是：所有的 key 都必須是合法的語言代碼，且 value 都是 string 或 undefined。這樣就能精準識別多語系物件，不會誤判其他結構。

接著 `translateData` 遞迴遍歷整個回傳資料，遇到多語系物件就取出對應語言，遇到 array 或 plain object 就繼續往下走：

```typescript
export function translateData(data: unknown, lang: Language): unknown {
  if (isMultiLangString(data)) {
    return data[lang] ?? Object.values(data).find(Boolean) ?? '';
  }
  if (Array.isArray(data)) {
    return data.map(item => translateData(item, lang));
  }
  if (
    data !== null &&
    typeof data === 'object' &&
    Object.getPrototypeOf(data) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([k, v]) => [k, translateData(v, lang)])
    );
  }
  return data;
}
```

值得注意的是 `Object.getPrototypeOf(data) === Object.prototype` 這個判斷——這樣可以確保只遞迴 plain object，不會誤觸 Date、Buffer 這類特殊物件。

#### 在 Controller 層自動解析語言：`@Translate` 裝飾器 + Interceptor

有了 `translateData`，下一步是讓 Controller 不用手動呼叫它。

先定義裝飾器：

```typescript
export const TRANSLATE_KEY = 'translate';

export const Translate = () => SetMetadata(TRANSLATE_KEY, true);
```

然後在 `TransformInterceptor` 裡讀取這個 metadata，決定要不要做翻譯：

```typescript
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>
  ): Observable<ApiResponse<T>> {
    const shouldTranslate = this.reflector.getAllAndOverride<boolean>(
      TRANSLATE_KEY,
      [context.getHandler(), context.getClass()]
    );

    const lang = shouldTranslate
      ? parseLang(
          context
            .switchToHttp()
            .getRequest<{ headers: Record<string, string> }>()
            .headers['accept-language']
        )
      : undefined;

    return next.handle().pipe(
      map((data) => ({
        code: 200,
        message: 'ok',
        data: lang ? (translateData(data, lang) as T) : (data ?? null),
      }))
    );
  }
}
```

`parseLang` 負責解析 Accept-Language header，把 `zh-TW,zh;q=0.9` 這種格式轉成 `Language.ZH_TW`。

使用時，Controller 只需要加一個 `@Translate()`：

```typescript
@Controller('products')
@UseInterceptors(TransformInterceptor)
export class ProductController {
  @Get(':id')
  @Translate()
  findOne(@Param('id') id: string) {
    return this.productService.findOne(id);
  }
}
```

沒有加 `@Translate()` 的 endpoint，回傳的就是原始的 `MultiLangString` 物件，方便後台管理用。

#### DTO 的嚴格限制：驗證輸入的多語系欄位

寫入的時候，需要確保前端傳進來的多語系欄位格式正確。這裡用 class-validator + class-transformer 做：

```typescript
export class MultiLangDto {
  @ApiProperty({ description: '繁體中文語系' })
  @IsString()
  @IsNotEmpty()
  zh_tw!: string;

  @ApiProperty({ description: '簡體中文語系' })
  @IsString()
  @IsNotEmpty()
  zh_cn!: string;

  @ApiProperty({ description: '英文語系' })
  @IsString()
  @IsNotEmpty()
  en!: string;
}

export class UpdateMultiLangDto extends PartialType(MultiLangDto) {}
```

`MultiLangDto` 用在建立，三個語言都必填。`UpdateMultiLangDto` 繼承 `PartialType`，更新時只需要傳要改的語言。

在 Product DTO 裡使用：

```typescript
export class CreateProductDto {
  @ApiProperty({ type: MultiLangDto })
  @ValidateNested()
  @Type(() => MultiLangDto)
  name!: MultiLangDto;

  @ApiProperty({ type: MultiLangDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => MultiLangDto)
  description?: MultiLangDto;
}
```

`@ValidateNested()` + `@Type()` 這組搭配是關鍵，少了 `@Type()` 的話 class-transformer 不會做巢狀轉型，驗證就會過不了。

#### 這套做法的限制與我還在思考的取捨

`isMultiLangString` 的誤判風險：如果專案裡剛好有其他物件的 key 全部是語言代碼，就會被當成多語系物件處理。目前的判斷邏輯是 structural（看結構），不是 nominal（看型別名稱），這是一個 tradeoff。比較嚴謹的做法是在物件上加一個標記 symbol，但這樣 entity 就不能是 plain object，複雜度會上升。

`translateData` 只處理 plain object：如果 Service 回傳的是 class instance（比如 TypeORM entity），`Object.getPrototypeOf(data) === Object.prototype` 這個判斷就會 false，不會被遞迴處理。實務上通常在 Service 層做一次 `plainToInstance` 或 spread 轉換，但這個要記得。

語言 fallback 策略：目前的邏輯是 `data[lang] ?? Object.values(data).find(Boolean) ?? ''`，找不到對應語言就 fallback 到第一個有值的語言。如果有更細緻的 fallback 需求（例如 zh_cn 找不到要先試 zh_tw 再試 en），就需要另外定義 fallback chain。

多租戶支援的語言集合：如果不同客戶支援的語言不一樣，`Language` enum 就不夠用，需要改成動態設定。這個場景我目前還沒遇到，先留著。
