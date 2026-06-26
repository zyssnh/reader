/**
 * 阅读器核心控制器
 * 管理阅读状态：当前书籍、章节导航、快捷键、工具栏。
 */
import type { Rendition } from 'epubjs';
import { getSettings, type ReaderSettings } from './settings';
import {
  addBook,
  addBookmark,
  addHighlight,
  deleteBookmark,
  deleteHighlight,
  getBookmarks,
  getHighlights,
  getProgress,
  saveChapter,
  saveProgress,
  updateBookLastRead,
  checkStorageQuota,
} from './storage';
import { loadEpub, renderChapter, getChapterHrefs, destroyRendition, type BookMeta } from './epub-loader';
import { loadTxt, renderTxtChapter, type TxtChapter, type TxtMeta } from './txt-loader';

// ── 状态类型 ──

export interface ReaderState {
  bookId: number | null;
  format: 'epub' | 'txt' | null;
  epubBook: unknown | null;   // epub.js Book
  meta: BookMeta | TxtMeta | null;
  rendition: Rendition | null;
  currentChapterHref: string;
  currentChapterIndex: number;
  chapterHrefs: string[];
  scrollY: number;
}

// ── 全局状态 ──

const state: ReaderState = {
  bookId: null,
  format: null,
  epubBook: null,
  meta: null,
  rendition: null,
  currentChapterHref: '',
  currentChapterIndex: 0,
  chapterHrefs: [],
  scrollY: 0,
};

/** 获取当前阅读状态 */
export function getReaderState(): Readonly<ReaderState> {
  return state;
}

// ── 事件发射 ──

type EventHandler = (...args: unknown[]) => void;
const listeners = new Map<string, Set<EventHandler>>();

/**
 * 注册事件监听
 */
export function on(event: string, handler: EventHandler): void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(handler);
}

/**
 * 取消事件监听
 */
export function off(event: string, handler: EventHandler): void {
  listeners.get(event)?.delete(handler);
}

function emit(event: string, ...args: unknown[]): void {
  listeners.get(event)?.forEach(h => h(...args));
}

// ── Toast 提示 ──

/**
 * 显示顶部 Toast 通知，3 秒自动消失
 */
export function showToast(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
  const toast = document.createElement('div');
  toast.className = `reader-toast reader-toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('reader-toast--visible');
  });

  setTimeout(() => {
    toast.classList.remove('reader-toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── 模态框 ──

/**
 * 显示模态提示框
 */
export function showModal(message: string, actions?: Array<{ label: string; onClick: () => void }>): void {
  const overlay = document.createElement('div');
  overlay.className = 'reader-modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'reader-modal';
  dialog.innerHTML = `<p>${message}</p>`;

  if (actions && actions.length > 0) {
    const btnRow = document.createElement('div');
    btnRow.className = 'reader-modal-actions';
    for (const action of actions) {
      const btn = document.createElement('button');
      btn.className = 'reader-modal-btn';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        overlay.remove();
        action.onClick();
      });
      btnRow.appendChild(btn);
    }
    dialog.appendChild(btnRow);
  } else {
    const btn = document.createElement('button');
    btn.className = 'reader-modal-btn';
    btn.textContent = '确定';
    btn.addEventListener('click', () => overlay.remove());
    dialog.appendChild(btn);
  }

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

// ── 文件加载 ──

/**
 * 加载书籍文件（EPUB 或 TXT 格式）
 * @returns 是否加载成功
 */
export async function loadBook(file: File): Promise<boolean> {
  // 检查文件大小
  if (file.size > 50 * 1024 * 1024) {
    showToast('文件过大（超过 50MB），请压缩后重试', 'error');
    return false;
  }

  // 检查存储配额
  const quota = await checkStorageQuota();
  if (quota && quota.usage + file.size > quota.quota * 0.9) {
    showModal('存储空间不足，建议清理书架后重试', [
      { label: '查看书架', onClick: () => emit('navigate', 'bookshelf') },
      { label: '取消', onClick: () => {} },
    ]);
    return false;
  }

  const ext = file.name.split('.').pop()?.toLowerCase();

  try {
    if (ext === 'epub') {
      return await loadEpubBook(file);
    } else if (ext === 'txt') {
      return await loadTxtBook(file);
    } else {
      showToast('不支持的文件格式（仅支持 .epub 和 .txt）', 'error');
      return false;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '解析失败';
    showToast(`文件加载失败：${msg}`, 'error');
    console.error('loadBook error:', err);
    return false;
  }
}

async function loadEpubBook(file: File): Promise<boolean> {
  showToast('正在解析 EPUB...', 'info');
  const { book, meta } = await loadEpub(file);

  // 保存文件数据到 IndexedDB
  const fileData = await file.arrayBuffer();
  const bookId = await addBook({
    title: meta.title,
    author: meta.author,
    cover: meta.cover,
    format: 'epub',
    fileData,
    addedAt: Date.now(),
    lastRead: Date.now(),
  });

  state.bookId = bookId;
  state.format = 'epub';
  state.epubBook = book;
  state.meta = meta;
  state.chapterHrefs = getChapterHrefs(meta);
  state.currentChapterIndex = 0;
  state.currentChapterHref = state.chapterHrefs[0] ?? '';

  // 恢复进度
  const savedProgress = await getProgress(bookId);
  if (savedProgress && savedProgress.chapterHref) {
    const idx = state.chapterHrefs.indexOf(savedProgress.chapterHref);
    if (idx >= 0) {
      state.currentChapterIndex = idx;
      state.currentChapterHref = savedProgress.chapterHref;
      state.scrollY = savedProgress.scrollY;
    }
  }

  emit('book-loaded', meta);
  showToast(`已加载：${meta.title}`, 'success');
  return true;
}

async function loadTxtBook(file: File): Promise<boolean> {
  showToast('正在解析 TXT...', 'info');
  const meta = await loadTxt(file);

  const fileData = await file.arrayBuffer();
  const bookId = await addBook({
    title: meta.title,
    author: meta.author,
    cover: '',
    format: 'txt',
    fileData,
    addedAt: Date.now(),
    lastRead: Date.now(),
  });

  state.bookId = bookId;
  state.format = 'txt';
  state.epubBook = null;
  state.meta = meta;
  state.chapterHrefs = meta.chapters.map((_, i) => String(i));
  state.currentChapterIndex = 0;
  state.currentChapterHref = '0';

  emit('book-loaded', meta);
  showToast(`已加载：${meta.title}（${meta.chapters.length} 章）`, 'success');
  return true;
}

// ── 章节导航 ──

/**
 * 跳转到指定章节
 */
export async function goToChapter(index: number, container: HTMLElement): Promise<void> {
  if (!state.meta || index < 0 || index >= state.chapterHrefs.length) return;

  // 保存当前进度
  await saveCurrentProgress();

  state.currentChapterIndex = index;
  state.currentChapterHref = state.chapterHrefs[index];
  state.scrollY = 0;

  await renderCurrentChapter(container);
  emit('chapter-changed', index, state.currentChapterHref);
}

/**
 * 下一章
 */
export async function nextChapter(container: HTMLElement): Promise<void> {
  if (state.currentChapterIndex < state.chapterHrefs.length - 1) {
    await goToChapter(state.currentChapterIndex + 1, container);
  }
}

/**
 * 上一章
 */
export async function prevChapter(container: HTMLElement): Promise<void> {
  if (state.currentChapterIndex > 0) {
    await goToChapter(state.currentChapterIndex - 1, container);
  }
}

/**
 * 渲染当前章节到容器
 */
async function renderCurrentChapter(container: HTMLElement): Promise<void> {
  if (!state.meta || !state.bookId) return;

  const settings = getSettings();

  try {
    if (state.format === 'epub' && state.epubBook) {
      if (state.rendition) {
        destroyRendition(state.rendition);
      }
      state.rendition = await renderChapter(
        state.epubBook as Parameters<typeof renderChapter>[0],
        state.currentChapterHref,
        container,
        {
          fontSize: settings.fontSize,
          lineHeight: settings.lineHeight,
          fontFamily: getFontCSS(settings.fontFamily),
          width: getWidthCSS(settings.readerWidth),
        },
      );
    } else if (state.format === 'txt') {
      const txtMeta = state.meta as TxtMeta;
      const chapter = txtMeta.chapters[state.currentChapterIndex];
      if (chapter) {
        renderTxtChapter(chapter, container);
      }
    }
  } catch (err) {
    console.error('渲染章节失败:', err);
    showToast('章节渲染失败', 'error');
  }
}

/**
 * 将文件数据重新加载为书籍（用于从 IndexedDB 恢复）
 */
export async function restoreBook(bookId: number, fileData: ArrayBuffer, format: 'epub' | 'txt'): Promise<boolean> {
  const blob = new Blob([fileData]);
  const file = new File([blob], `book.${format}`, { type: format === 'epub' ? 'application/epub+zip' : 'text/plain' });

  state.bookId = bookId;
  return await loadBook(file);
}

/** 保存当前阅读进度 */
async function saveCurrentProgress(): Promise<void> {
  if (!state.bookId) return;
  await saveProgress({
    bookId: state.bookId,
    chapterHref: state.currentChapterHref,
    scrollY: state.scrollY,
    updatedAt: Date.now(),
  });
  await updateBookLastRead(state.bookId);
}

/** 更新滚动位置 */
export function updateScrollY(y: number): void {
  state.scrollY = y;
}

// ── 书签操作 ──

/** 添加书签 */
export async function bookmarkCurrentPosition(text?: string): Promise<void> {
  if (!state.bookId) return;
  const selection = window.getSelection();
  const selectedText = text ?? (selection ? selection.toString().trim() : '');

  await addBookmark({
    bookId: state.bookId,
    chapterHref: state.currentChapterHref,
    scrollY: state.scrollY,
    text: selectedText || `位置 ${Math.round(state.scrollY)}`,
    color: 'var(--accent-amber)',
    createdAt: Date.now(),
  });
  emit('bookmarks-updated');
  showToast('书签已添加', 'success');
}

/** 获取当前书籍所有书签 */
export async function getCurrentBookmarks(): Promise<ReturnType<typeof getBookmarks>> {
  if (!state.bookId) return [];
  return getBookmarks(state.bookId);
}

/** 删除书签 */
export async function removeBookmark(id: number): Promise<void> {
  await deleteBookmark(id);
  emit('bookmarks-updated');
}

// ── 高亮操作 ──

/** 添加高亮 */
export async function highlightSelection(color: string, note?: string): Promise<void> {
  if (!state.bookId) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  const range = selection.getRangeAt(0);
  try {
    await addHighlight({
      bookId: state.bookId,
      chapterHref: state.currentChapterHref,
      rangeData: JSON.stringify({
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        startContainer: getNodePath(range.startContainer),
        endContainer: getNodePath(range.endContainer),
        text: selection.toString(),
      }),
      color,
      note: note ?? '',
      createdAt: Date.now(),
    });
    emit('highlights-updated');
    showToast('高亮已添加', 'success');
  } catch (err) {
    console.error('添加高亮失败:', err);
    showToast('高亮添加失败', 'error');
  }
}

/** 获取当前书籍高亮 */
export async function getCurrentHighlights(): Promise<ReturnType<typeof getHighlights>> {
  if (!state.bookId) return [];
  return getHighlights(state.bookId, state.currentChapterHref);
}

/** 删除高亮 */
export async function removeHighlight(id: number): Promise<void> {
  await deleteHighlight(id);
  emit('highlights-updated');
}

/** 获取节点在 DOM 中的路径 */
function getNodePath(node: Node): string {
  const parts: string[] = [];
  let current: Node | null = node;
  while (current && current !== document.body) {
    if (current.parentNode) {
      const index = Array.from(current.parentNode.childNodes).indexOf(current as ChildNode);
      parts.unshift(`${index}`);
    }
    current = current.parentNode;
  }
  return parts.join('/');
}

// ── 快捷键 ──

/**
 * 处理键盘快捷键
 * @returns 是否被处理
 */
export function handleShortcut(e: KeyboardEvent, container: HTMLElement): boolean {
  const key = e.key;
  const meta = e.metaKey || e.ctrlKey;

  // 在输入框中不处理
  if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') {
    return false;
  }

  const handlers: Record<string, () => void> = {
    ArrowRight: () => { nextChapter(container); },
    ArrowLeft: () => { prevChapter(container); },
    b: () => { bookmarkCurrentPosition(); },
    f: () => { emit('toggle-fullscreen'); },
  };

  if (meta && key === 'k') {
    e.preventDefault();
    emit('open-command-palette');
    return true;
  }

  if (meta && key === 'f') {
    e.preventDefault();
    emit('open-search');
    return true;
  }

  const handler = handlers[key];
  if (handler) {
    e.preventDefault();
    handler();
    return true;
  }

  return false;
}

// ── 辅助函数 ──

function getFontCSS(font: ReaderSettings['fontFamily']): string {
  switch (font) {
    case 'sans': return 'var(--font-sans)';
    case 'serif': return 'var(--font-serif)';
    case 'mono': return 'var(--font-mono)';
  }
}

function getWidthCSS(width: ReaderSettings['readerWidth']): string {
  switch (width) {
    case 'narrow': return '480px';
    case 'medium': return '640px';
    case 'wide': return '800px';
  }
}

// ── 初始化 ──

/**
 * 初始化阅读器核心（绑定全局键盘事件）
 */
export function initReaderCore(container: HTMLElement): void {
  document.addEventListener('keydown', (e) => {
    handleShortcut(e, container);
  });

  // 滚动位置追踪
  container.addEventListener('scroll', () => {
    state.scrollY = container.scrollTop;
  }, { passive: true });

  // 文字选中工具栏
  document.addEventListener('mouseup', () => {
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        emit('selection-cleared');
        return;
      }
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      emit('selection-made', {
        text: selection.toString(),
        x: rect.left + rect.width / 2,
        y: rect.top - 8,
      });
    }, 50);
  });
}
