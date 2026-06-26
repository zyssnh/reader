/**
 * IndexedDB 存储模块 (v2)
 * 使用 idb 封装，支持 hash 去重、每书样式、书签/高亮
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BookMeta, BookStyle, Chapter, Bookmark, Highlight } from '../types/index';

interface ReaderDB extends DBSchema {
  books:      { key: string; value: BookMeta; indexes: { 'by-hash': string } };
  chapters:   { key: string; value: Chapter;  indexes: { 'by-book': string } };
  styles:     { key: string; value: BookStyle };
  bookmarks:  { key: string; value: Bookmark; indexes: { 'by-book': string } };
  highlights: { key: string; value: Highlight; indexes: { 'by-book': string } };
}

let _db: IDBPDatabase<ReaderDB> | null = null;

async function getDb(): Promise<IDBPDatabase<ReaderDB>> {
  if (_db) return _db;
  _db = await openDB<ReaderDB>('reader-v2', 1, {
    upgrade(db) {
      const books = db.createObjectStore('books', { keyPath: 'id' });
      books.createIndex('by-hash', 'hash', { unique: true });

      const chapters = db.createObjectStore('chapters', { keyPath: 'id' });
      chapters.createIndex('by-book', 'bookId');

      db.createObjectStore('styles', { keyPath: 'bookId' });

      const bm = db.createObjectStore('bookmarks', { keyPath: 'id' });
      bm.createIndex('by-book', 'bookId');

      const hl = db.createObjectStore('highlights', { keyPath: 'id' });
      hl.createIndex('by-book', 'bookId');
    },
  });
  return _db;
}

/**
 * 计算文件 hash（取前 64KB SHA-256），用于去重
 */
export async function calcHash(file: File): Promise<string> {
  const slice = file.slice(0, 65536);
  const buf = await slice.arrayBuffer();
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 检查是否已存在相同 hash 的书籍 */
export async function findByHash(hash: string): Promise<BookMeta | undefined> {
  const db = await getDb();
  return db.getFromIndex('books', 'by-hash', hash);
}

/** 保存书籍元数据 */
export async function saveBook(meta: BookMeta): Promise<void> {
  const db = await getDb();
  await db.put('books', meta);
}

/** 根据 ID 获取书籍 */
export async function getBook(id: string): Promise<BookMeta | undefined> {
  const db = await getDb();
  return db.get('books', id);
}

/** 获取所有书籍（按最后阅读时间排序） */
export async function getAllBooks(): Promise<BookMeta[]> {
  const db = await getDb();
  const all = await db.getAll('books');
  return all.sort((a, b) => (b.lastReadAt ?? b.addedAt) - (a.lastReadAt ?? a.addedAt));
}

/**
 * 批量保存章节（逐个写入，单个失败不影响整体）
 */
export async function saveChapters(chapters: Chapter[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('chapters', 'readwrite');
  const store = tx.objectStore('chapters');

  const errors: Array<{ index: number; error: string }> = [];
  for (let i = 0; i < chapters.length; i++) {
    try {
      await store.put(chapters[i]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ index: i, error: msg });
      console.warn(`章节 ${i} 保存失败:`, msg);
    }
  }

  try {
    await tx.done;
  } catch (err) {
    console.warn('章节事务提交失败:', err);
  }

  if (errors.length > 0) {
    console.error(`${errors.length}/${chapters.length} 章节保存失败`);
  }
}

/** 获取书籍的所有章节（按 index 排序） */
export async function getChapters(bookId: string): Promise<Chapter[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('chapters', 'by-book', bookId);
  return all.sort((a, b) => a.index - b.index);
}

/** 删除书籍及其所有关联数据 */
export async function deleteBook(bookId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['books', 'chapters', 'styles', 'bookmarks', 'highlights'], 'readwrite');

  await tx.objectStore('books').delete(bookId);

  const chapterKeys = await tx.objectStore('chapters').index('by-book').getAllKeys(bookId);
  await Promise.all(chapterKeys.map(k => tx.objectStore('chapters').delete(k)));

  await tx.objectStore('styles').delete(bookId);

  const bmKeys = await tx.objectStore('bookmarks').index('by-book').getAllKeys(bookId);
  await Promise.all(bmKeys.map(k => tx.objectStore('bookmarks').delete(k)));

  const hlKeys = await tx.objectStore('highlights').index('by-book').getAllKeys(bookId);
  await Promise.all(hlKeys.map(k => tx.objectStore('highlights').delete(k)));

  await tx.done;
}

/** 更新阅读进度 */
export async function updateProgress(bookId: string, chapterId: string, scrollY: number): Promise<void> {
  const db = await getDb();
  const book = await db.get('books', bookId);
  if (!book) return;
  await db.put('books', {
    ...book,
    lastChapterId: chapterId,
    lastScrollY: scrollY,
    lastReadAt: Date.now(),
  });
}

/** 更新书籍元数据字段 */
export async function updateBookMeta(id: string, patch: Partial<BookMeta>): Promise<void> {
  const db = await getDb();
  const book = await db.get('books', id);
  if (!book) return;
  await db.put('books', { ...book, ...patch });
}

// ── 每书样式 ──

/** 获取某本书的样式 */
export async function getBookStyle(bookId: string): Promise<BookStyle | undefined> {
  const db = await getDb();
  return db.get('styles', bookId);
}

/** 保存某本书的样式 */
export async function saveBookStyle(style: BookStyle): Promise<void> {
  const db = await getDb();
  await db.put('styles', style);
}

// ── 书签 ──

/** 获取某本书的所有书签 */
export async function getBookmarks(bookId: string): Promise<Bookmark[]> {
  const db = await getDb();
  return db.getAllFromIndex('bookmarks', 'by-book', bookId);
}

/** 添加书签 */
export async function addBookmark(bm: Bookmark): Promise<void> {
  const db = await getDb();
  await db.put('bookmarks', bm);
}

/** 删除书签 */
export async function deleteBookmark(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('bookmarks', id);
}

// ── 高亮 ──

/** 获取某本书的所有高亮 */
export async function getHighlights(bookId: string): Promise<Highlight[]> {
  const db = await getDb();
  return db.getAllFromIndex('highlights', 'by-book', bookId);
}

/** 添加高亮 */
export async function addHighlight(hl: Highlight): Promise<void> {
  const db = await getDb();
  await db.put('highlights', hl);
}

/** 删除高亮 */
export async function deleteHighlight(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('highlights', id);
}

// ── 导入导出 ──

/** 导出书籍所有数据（不含文件内容） */
export async function exportBookData(bookId: string): Promise<string> {
  const [meta, style, bookmarks, highlights] = await Promise.all([
    getBook(bookId),
    getBookStyle(bookId),
    getBookmarks(bookId),
    getHighlights(bookId),
  ]);
  return JSON.stringify({ meta, style, bookmarks, highlights }, null, 2);
}

/** 检查存储配额 */
export async function checkStorageQuota(): Promise<{ usage: number; quota: number } | null> {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  }
  return null;
}
