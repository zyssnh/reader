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

/** 章节 */
export interface Chapter {
  id: string;
  bookId: string;
  index: number;
  title: string;
  content: string;
  depth: number;
  parentId?: string;
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
