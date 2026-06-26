/**
 * 每书样式管理模块
 * 加载、应用、更新书籍专属阅读样式，同步到 IndexedDB
 */
import { getBookStyle, saveBookStyle } from './storage';
import { DEFAULT_STYLE, type BookStyle } from '../types/index';

/**
 * 为指定书籍加载样式，返回完整样式对象
 */
export async function loadStyle(bookId: string): Promise<BookStyle> {
  try {
    const saved = await getBookStyle(bookId);
    if (saved) return saved;
  } catch {
    /* 使用默认值 */
  }
  return { bookId, ...DEFAULT_STYLE };
}

/**
 * 将样式应用到 DOM
 */
export function applyStyle(style: Omit<BookStyle, 'bookId'>): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', style.theme);
  root.style.setProperty('--font-size', `${style.fontSize}px`);
  root.style.setProperty('--line-height', String(style.lineHeight));
  root.style.setProperty('--para-spacing', `${style.paragraphSpacing}em`);
  root.style.setProperty('--reader-width', `${style.readerWidth}px`);

  const fontMap: Record<string, string> = {
    sans: 'var(--font-sans)',
    serif: 'var(--font-serif)',
    mono: 'var(--font-mono)',
  };
  root.style.setProperty('--reader-font', fontMap[style.fontFamily] ?? fontMap.sans);
  root.style.setProperty('--text-indent', style.indent ? '2em' : '0');
}

/**
 * 更新单本书样式并保存
 */
export async function updateStyle(bookId: string, partial: Partial<Omit<BookStyle, 'bookId'>>): Promise<BookStyle> {
  const current = await loadStyle(bookId);
  const updated: BookStyle = { ...current, ...partial, bookId };
  await saveBookStyle(updated);
  applyStyle(updated);
  return updated;
}

/**
 * 将某本书的样式复制到所有书
 */
export async function applyStyleToAll(sourceBookId: string): Promise<void> {
  const style = await getBookStyle(sourceBookId);
  if (!style) return;
  // 注意：这个方法只能在有所有 bookId 列表时使用，
  // 调用方应从书架获取所有 bookId，逐个更新。
  // 这里只提供样式数据的复制来源。
  window.dispatchEvent(new CustomEvent('style-apply-all', {
    detail: { theme: style.theme, fontSize: style.fontSize, lineHeight: style.lineHeight,
      paragraphSpacing: style.paragraphSpacing, fontFamily: style.fontFamily,
      readerWidth: style.readerWidth, indent: style.indent,
      hyphenation: style.hyphenation, vertical: style.vertical },
  }));
}
