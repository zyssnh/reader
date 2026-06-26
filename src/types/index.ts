/** 书籍元数据 */
export interface BookMeta {
  id: string;
  hash: string;
  title: string;
  author: string;
  cover?: string;
  format: 'epub' | 'txt';
  totalChapters: number;
  addedAt: number;
  lastReadAt?: number;
  lastChapterId?: string;
  lastScrollY?: number;
  customTitle?: string;
  customAuthor?: string;
  tags?: string[];
  description?: string;
  /** JSON 序列化的 TocEntry[]，用于阅读页重建目录面板 */
  tocJson?: string;
}

/** 每书独立样式 */
export interface BookStyle {
  bookId: string;
  theme: 'dark' | 'light' | 'sepia' | 'hacker';
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  fontFamily: 'sans' | 'serif' | 'mono';
  readerWidth: number;
  indent: boolean;
  hyphenation: boolean;
  vertical: boolean;
}

/** 章节（内容渲染单元，按 spine 顺序） */
export interface Chapter {
  id: string;
  bookId: string;
  index: number;
  title: string;
  content: string;
  depth: number;         // TOC 层级 0-2，0=顶级章节/卷
  parentId?: string;     // 父章节 id，用于 TOC 折叠
}

/** TOC 目录条目（用于面板渲染，可层级化） */
export interface TocEntry {
  chapterIndex: number;  // 对应 chapters[index]
  title: string;
  depth: number;         // 0=卷/部, 1=章, 2=节
  children?: TocEntry[]; // 子目录（递归）
}

/** 书签 */
export interface Bookmark {
  id: string;
  bookId: string;
  chapterId: string;
  scrollY: number;
  text: string;
  createdAt: number;
}

/** 高亮 */
export interface Highlight {
  id: string;
  bookId: string;
  chapterId: string;
  startOffset: number;
  endOffset: number;
  text: string;
  color: 'yellow' | 'blue' | 'green' | 'red';
  note?: string;
  createdAt: number;
}

/** 默认样式 */
export const DEFAULT_STYLE: Omit<BookStyle, 'bookId'> = {
  theme: 'dark',
  fontSize: 18,
  lineHeight: 1.8,
  paragraphSpacing: 1.2,
  fontFamily: 'sans',
  readerWidth: 640,
  indent: false,
  hyphenation: false,
  vertical: false,
};
