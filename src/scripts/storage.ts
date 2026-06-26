/**
 * IndexedDB 存储模块
 * 使用 idb 库封装，管理书籍、章节、进度、书签、高亮和设置。
 */
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'reader-db';
const DB_VERSION = 1;

/** 书籍记录 */
export interface BookRecord {
  id?: number;
  title: string;
  author: string;
  cover: string;       // base64
  format: 'epub' | 'txt';
  fileData: ArrayBuffer;
  addedAt: number;
  lastRead: number;
}

/** 章节内容（Blob 存储） */
export interface ChapterRecord {
  id?: number;
  bookId: number;
  href: string;
  content: Blob;
}

/** 阅读进度 */
export interface ProgressRecord {
  id?: number;
  bookId: number;
  chapterHref: string;
  scrollY: number;
  updatedAt: number;
}

/** 书签 */
export interface BookmarkRecord {
  id?: number;
  bookId: number;
  chapterHref: string;
  scrollY: number;
  text: string;
  color: string;
  createdAt: number;
}

/** 高亮标注 */
export interface HighlightRecord {
  id?: number;
  bookId: number;
  chapterHref: string;
  rangeData: string;   // serialized
  color: string;
  note: string;
  createdAt: number;
}

/** 设置键值对 */
export interface SettingsRecord {
  key: string;
  value: unknown;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

/**
 * 获取数据库实例（单例）
 */
function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('books')) {
          const booksStore = db.createObjectStore('books', { keyPath: 'id', autoIncrement: true });
          booksStore.createIndex('addedAt', 'addedAt');
        }
        if (!db.objectStoreNames.contains('chapters')) {
          const chaptersStore = db.createObjectStore('chapters', { keyPath: 'id', autoIncrement: true });
          chaptersStore.createIndex('bookId+href', ['bookId', 'href'], { unique: true });
        }
        if (!db.objectStoreNames.contains('progress')) {
          const progressStore = db.createObjectStore('progress', { keyPath: 'id', autoIncrement: true });
          progressStore.createIndex('bookId', 'bookId', { unique: true });
        }
        if (!db.objectStoreNames.contains('bookmarks')) {
          const bookmarksStore = db.createObjectStore('bookmarks', { keyPath: 'id', autoIncrement: true });
          bookmarksStore.createIndex('bookId', 'bookId');
        }
        if (!db.objectStoreNames.contains('highlights')) {
          const highlightsStore = db.createObjectStore('highlights', { keyPath: 'id', autoIncrement: true });
          highlightsStore.createIndex('bookId', 'bookId');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

// ── 书籍操作 ──

/** 获取所有书籍，按添加时间倒序 */
export async function getAllBooks(): Promise<BookRecord[]> {
  const db = await getDB();
  return db.getAllFromIndex('books', 'addedAt');
}

/** 根据 ID 获取单本书 */
export async function getBook(id: number): Promise<BookRecord | undefined> {
  const db = await getDB();
  return db.get('books', id);
}

/** 添加书籍，返回新 ID */
export async function addBook(book: Omit<BookRecord, 'id'>): Promise<number> {
  const db = await getDB();
  return db.add('books', book) as Promise<number>;
}

/** 删除书籍及其关联数据 */
export async function deleteBook(id: number): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['books', 'chapters', 'progress', 'bookmarks', 'highlights'], 'readwrite');
  await tx.objectStore('books').delete(id);

  // 删除关联章节
  const chapterKeys = await tx.objectStore('chapters').index('bookId+href').getAllKeys();
  for (const key of chapterKeys) {
    await tx.objectStore('chapters').delete(key);
  }

  // 删除进度
  const progressKeys = await tx.objectStore('progress').index('bookId').getAllKeys();
  for (const key of progressKeys) {
    await tx.objectStore('progress').delete(key);
  }

  // 删除书签
  const bookmarkKeys = await tx.objectStore('bookmarks').index('bookId').getAllKeys();
  for (const key of bookmarkKeys) {
    await tx.objectStore('bookmarks').delete(key);
  }

  // 删除高亮
  const highlightKeys = await tx.objectStore('highlights').index('bookId').getAllKeys();
  for (const key of highlightKeys) {
    await tx.objectStore('highlights').delete(key);
  }

  await tx.done;
}

/** 更新书籍最后阅读时间 */
export async function updateBookLastRead(id: number): Promise<void> {
  const db = await getDB();
  const book = await db.get('books', id);
  if (book) {
    book.lastRead = Date.now();
    await db.put('books', book);
  }
}

// ── 章节操作 ──

/** 保存章节内容 */
export async function saveChapter(record: Omit<ChapterRecord, 'id'>): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('chapters', 'readwrite');
  const store = tx.objectStore('chapters');
  const index = store.index('bookId+href');
  const existing = await index.getKey([record.bookId, record.href]);
  if (existing) {
    await store.put({ ...record, id: existing as number });
  } else {
    await store.add(record);
  }
  await tx.done;
}

/** 获取章节内容 */
export async function getChapter(bookId: number, href: string): Promise<ChapterRecord | undefined> {
  const db = await getDB();
  const index = db.transaction('chapters').store.index('bookId+href');
  return index.get([bookId, href]);
}

// ── 进度操作 ──

/** 保存/更新阅读进度 */
export async function saveProgress(record: Omit<ProgressRecord, 'id'>): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('progress', 'readwrite');
  const store = tx.objectStore('progress');
  const index = store.index('bookId');
  const existing = await index.getKey(record.bookId);
  if (existing) {
    await store.put({ ...record, id: existing as number });
  } else {
    await store.add(record);
  }
  await tx.done;
}

/** 获取阅读进度 */
export async function getProgress(bookId: number): Promise<ProgressRecord | undefined> {
  const db = await getDB();
  const index = db.transaction('progress').store.index('bookId');
  return index.get(bookId);
}

// ── 书签操作 ──

/** 获取某本书的所有书签 */
export async function getBookmarks(bookId: number): Promise<BookmarkRecord[]> {
  const db = await getDB();
  return db.getAllFromIndex('bookmarks', 'bookId', bookId);
}

/** 添加书签，返回新 ID */
export async function addBookmark(record: Omit<BookmarkRecord, 'id'>): Promise<number> {
  const db = await getDB();
  return db.add('bookmarks', record) as Promise<number>;
}

/** 删除书签 */
export async function deleteBookmark(id: number): Promise<void> {
  const db = await getDB();
  await db.delete('bookmarks', id);
}

// ── 高亮操作 ──

/** 获取某本书某章的所有高亮 */
export async function getHighlights(bookId: number, chapterHref?: string): Promise<HighlightRecord[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('highlights', 'bookId', bookId);
  if (chapterHref) {
    return all.filter(h => h.chapterHref === chapterHref);
  }
  return all;
}

/** 添加高亮，返回新 ID */
export async function addHighlight(record: Omit<HighlightRecord, 'id'>): Promise<number> {
  const db = await getDB();
  return db.add('highlights', record) as Promise<number>;
}

/** 删除高亮 */
export async function deleteHighlight(id: number): Promise<void> {
  const db = await getDB();
  await db.delete('highlights', id);
}

// ── 设置操作 ──

/** 获取所有设置 */
export async function getAllSettings(): Promise<Map<string, unknown>> {
  const db = await getDB();
  const all = await db.getAll('settings');
  const map = new Map<string, unknown>();
  for (const item of all) {
    map.set(item.key, item.value);
  }
  return map;
}

/** 保存单个设置 */
export async function saveSetting(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put('settings', { key, value });
}

/** 获取单个设置 */
export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  const record = await db.get('settings', key);
  return record ? (record.value as T) : undefined;
}

/** 检查存储配额并估算用量 */
export async function checkStorageQuota(): Promise<{ usage: number; quota: number } | null> {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
    };
  }
  return null;
}
