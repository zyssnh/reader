# 存储系统

## IndexedDB 数据库

数据库名: `reader-v2`，版本 1，使用 [idb](https://github.com/jakearchibald/idb) 封装 promise API。

### Object Stores

```
reader-v2
├── books            keyPath: 'id'
│   └── index: 'by-hash' (unique) → 按文件 hash 去重
├── chapters         keyPath: 'id'
│   └── index: 'by-book' → bookId
├── styles           keyPath: 'bookId'
├── bookmarks        keyPath: 'id'
│   └── index: 'by-book' → bookId
└── highlights       keyPath: 'id'
    └── index: 'by-book' → bookId
```

### Books Store

```typescript
interface BookMeta {
  id: string;            // crypto.randomUUID()
  hash: string;          // SHA-256 前 64KB，唯一索引
  title: string;         // 从文件元数据提取
  author: string;
  cover?: string;        // base64 data URL
  format: 'epub' | 'txt';
  totalChapters: number;
  addedAt: number;       // Date.now()
  lastReadAt?: number;
  lastChapterId?: string;
  lastScrollY?: number;
  customTitle?: string;   // 用户自定义
  customAuthor?: string;
  tags?: string[];
  description?: string;
}
```

**去重机制**: 导入时计算文件前 64KB 的 SHA-256，通过 `by-hash` 唯一索引查重。相同 hash → 拒绝导入，Toast 提示"已在书架中"。

### Chapters Store

```typescript
interface Chapter {
  id: string;            // `${bookId}-${index}`
  bookId: string;
  index: number;         // 排序依据
  title: string;         // 从 TOC/标题标签提取
  content: string;       // HTML 字符串
  depth: number;         // TOC 层级 0-2
  parentId?: string;
}
```

**保存策略**: 逐个 `put`，单个章节失败仅 console.warn，不影响其他章节。事务提交失败时已写入的数据保留。

### Styles Store

```typescript
interface BookStyle {
  bookId: string;        // 主键
  theme: 'dark' | 'light' | 'sepia' | 'hacker';
  fontSize: number;       // 14-26，默认 18
  lineHeight: number;     // 1.4-2.2，默认 1.8
  paragraphSpacing: number; // 0.5-2.0 em
  fontFamily: 'sans' | 'serif' | 'mono';
  readerWidth: number;    // 480 | 640 | 800
  indent: boolean;
  hyphenation: boolean;
  vertical: boolean;
}
```

每书独立样式。loadStyle() 从 DB 读取，不存在时返回 `DEFAULT_STYLE`。变更实时写 DB + 更新 CSS 变量。

### Bookmarks Store

```typescript
interface Bookmark {
  id: string;
  bookId: string;
  chapterId: string;
  scrollY: number;       // 精确滚动位置
  text: string;          // 选中文字快照（前 60 字）或位置描述
  createdAt: number;
}
```

### Highlights Store

```typescript
interface Highlight {
  id: string;
  bookId: string;
  chapterId: string;
  startOffset: number;
  endOffset: number;
  text: string;          // 高亮文字内容
  color: 'yellow' | 'blue' | 'green' | 'red';
  note?: string;
  createdAt: number;
}
```

## API 参考

### Books

| 函数 | 说明 |
|------|------|
| `calcHash(file: File): Promise<string>` | 计算文件前 64KB 的 SHA-256 |
| `findByHash(hash: string): Promise<BookMeta \| undefined>` | 按 hash 查重 |
| `saveBook(meta: BookMeta): Promise<void>` | 保存书 |
| `getBook(id: string): Promise<BookMeta \| undefined>` | 取单本 |
| `getAllBooks(): Promise<BookMeta[]>` | 全取，按最后阅读时间倒序 |
| `deleteBook(id: string): Promise<void>` | 删书 + 关联数据级联删除 |
| `updateProgress(bookId, chapterId, scrollY): Promise<void>` | 更新进度 |
| `updateBookMeta(id, patch): Promise<void>` | 更新元数据字段 |

### Chapters

| 函数 | 说明 |
|------|------|
| `saveChapters(chapters: Chapter[]): Promise<void>` | 批量保存，逐条容错 |
| `getChapters(bookId: string): Promise<Chapter[]>` | 按 index 排序返回 |

### Styles

| 函数 | 说明 |
|------|------|
| `getBookStyle(bookId): Promise<BookStyle \| undefined>` | 取样式 |
| `saveBookStyle(style: BookStyle): Promise<void>` | 存样式 |

### Bookmarks / Highlights

| 函数 | 说明 |
|------|------|
| `getBookmarks(bookId): Promise<Bookmark[]>` | 取书签 |
| `addBookmark(bm): Promise<void>` | 加书签 |
| `deleteBookmark(id): Promise<void>` | 删书签 |
| `getHighlights(bookId): Promise<Highlight[]>` | 取高亮 |
| `addHighlight(hl): Promise<void>` | 加高亮 |
| `deleteHighlight(id): Promise<void>` | 删高亮 |

### 导入导出

| 函数 | 说明 |
|------|------|
| `exportBookData(bookId): Promise<string>` | 导出 JSON（书签+高亮+样式+元数据） |
| `checkStorageQuota(): Promise<{usage,quota} \| null>` | 检查存储配额 |
