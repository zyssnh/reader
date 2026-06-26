/**
 * EPUB 文件解析与渲染模块
 * 使用 epub.js 解析 EPUB 2.x / 3.x
 */
import Epub, { type Book as EpubBook, type Rendition } from 'epubjs';

export interface TocItem {
  id: string;
  label: string;
  href: string;
  depth: number;
  children?: TocItem[];
}

export interface BookMeta {
  title: string;
  author: string;
  cover: string;  // base64
  toc: TocItem[];
  spineItems: string[];
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * 检查文件大小是否超限
 */
export function isFileTooLarge(file: File): boolean {
  return file.size > MAX_FILE_SIZE;
}

/**
 * 将 epub.js 的导航对象递归展平为 TocItem 树
 */
function flattenToc(rawToc: Array<Record<string, unknown>>, depth: number = 0): TocItem[] {
  const items: TocItem[] = [];
  for (const entry of rawToc) {
    const item: TocItem = {
      id: String(entry.id ?? ''),
      label: String(entry.label ?? ''),
      href: String(entry.href ?? ''),
      depth,
    };
    if (entry.subitems && Array.isArray(entry.subitems) && entry.subitems.length > 0) {
      item.children = flattenToc(entry.subitems as Array<Record<string, unknown>>, depth + 1);
    }
    items.push(item);
  }
  return items;
}

/**
 * 提取封面图为 base64
 */
async function extractCover(book: EpubBook): Promise<string> {
  try {
    const coverUrl = await book.coverUrl();
    if (!coverUrl) return '';
    const response = await fetch(coverUrl);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch {
    console.warn('无法提取封面');
    return '';
  }
}

/**
 * 加载 EPUB 文件，返回元数据和书籍对象
 */
export async function loadEpub(file: File): Promise<{ book: EpubBook; meta: BookMeta }> {
  if (isFileTooLarge(file)) {
    throw new Error('文件过大（超过 50MB）');
  }

  const blobUrl = URL.createObjectURL(file);
  const book = Epub(blobUrl);

  await book.ready;

  // 获取元数据
  const metadata = book.packaging?.metadata ?? {};
  const title = String(metadata.title ?? file.name.replace(/\.epub$/i, ''));
  const author = String(metadata.creator ?? '未知作者');

  // 获取目录
  const nav = book.navigation ?? {};
  const rawToc = (nav.toc ?? []) as Array<Record<string, unknown>>;
  const toc = flattenToc(rawToc);

  // 获取 spine 列表
  const spine = book.spine as unknown as { items: Array<{ href: string }> };
  const spineItems = spine?.items?.map((item: { href: string }) => item.href) ?? [];

  // 提取封面
  const cover = await extractCover(book);

  return {
    book,
    meta: { title, author, cover, toc, spineItems },
  };
}

/**
 * 将章节内容渲染到指定容器
 */
export async function renderChapter(
  book: EpubBook,
  href: string,
  container: HTMLElement,
  settings?: {
    fontSize?: number;
    lineHeight?: number;
    fontFamily?: string;
    width?: string;
  },
): Promise<Rendition> {
  // 清空容器
  container.innerHTML = '';

  const rendition = book.renderTo(container, {
    width: settings?.width ?? '100%',
    height: '100%',
    spread: 'none',
    flow: 'paginated',
    manager: 'default',
  });

  if (settings?.fontSize) {
    rendition.themes.fontSize(`${settings.fontSize}px`);
  }
  if (settings?.lineHeight) {
    rendition.themes.register('line-height', { body: { 'line-height': String(settings.lineHeight) } });
  }
  if (settings?.fontFamily) {
    rendition.themes.register('font-family', { body: { 'font-family': settings.fontFamily } });
  }

  await rendition.display(href);
  return rendition;
}

/**
 * 获取书籍的所有章节点（spine items 或 TOC 叶子）
 */
export function getChapterHrefs(meta: BookMeta): string[] {
  if (meta.spineItems.length > 0) {
    return meta.spineItems;
  }
  // 回退：使用 TOC 中的 href
  const hrefs: string[] = [];
  function collect(items: TocItem[]): void {
    for (const item of items) {
      if (item.href) hrefs.push(item.href);
      if (item.children) collect(item.children);
    }
  }
  collect(meta.toc);
  return hrefs;
}

/**
 * 销毁渲染实例
 */
export function destroyRendition(rendition: Rendition): void {
  try {
    rendition.destroy();
  } catch {
    // 忽略销毁错误
  }
}
