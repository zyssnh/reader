/**
 * TXT 文件解析模块
 * 自动检测章节，分段渲染为 HTML。
 */

/** 章节检测正则（按优先级匹配） */
const CHAPTER_PATTERNS: RegExp[] = [
  /^第[零一二三四五六七八九十百千\d]+[章节回集部卷篇]/,
  /^Chapter\s+\d+/i,
  /^CHAPTER\s+[IVXLCDM]+/i,
  /^\d+[\.、]\s*\S/,
  /^【.{1,20}】/,
  /^={3,}/,
];

/** 自动分段阈值（字数） */
const AUTO_SPLIT_LENGTH = 3000;

export interface TxtChapter {
  title: string;
  content: string;   // HTML 字符串
  index: number;
}

export interface TxtMeta {
  title: string;
  author: string;
  chapters: TxtChapter[];
}

/**
 * 检测一行是否为章节标题
 */
function isChapterHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  for (const pattern of CHAPTER_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

/**
 * 将纯文本内容转为 HTML 段落
 */
function textToHtml(text: string): string {
  const paragraphs = text.split(/\n+/).filter(p => p.trim());
  return paragraphs
    .map(p => `<p>${escapeHtml(p.trim())}</p>`)
    .join('\n');
}

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, ch => map[ch] ?? ch);
}

/**
 * 将文本按章节切分
 */
function splitByChapters(text: string): TxtChapter[] {
  const lines = text.split(/\r?\n/);
  const chapters: TxtChapter[] = [];
  let currentTitle = '前言';
  let currentLines: string[] = [];
  let chapterIndex = 0;

  for (const line of lines) {
    if (isChapterHeading(line) && currentLines.length > 0) {
      // 保存上一章
      chapters.push({
        title: currentTitle,
        content: textToHtml(currentLines.join('\n')),
        index: chapterIndex++,
      });
      currentTitle = line.trim();
      currentLines = [];
    } else if (isChapterHeading(line) && currentLines.length === 0) {
      currentTitle = line.trim();
    } else {
      currentLines.push(line);
    }
  }

  // 保存最后一章
  if (currentLines.length > 0 || currentTitle) {
    chapters.push({
      title: currentTitle,
      content: textToHtml(currentLines.join('\n')),
      index: chapterIndex++,
    });
  }

  return chapters;
}

/**
 * 无法检测章节时，按字数自动分段
 */
function autoSplit(text: string): TxtChapter[] {
  const paragraphs = text.split(/\n+/).filter(p => p.trim());
  const chapters: TxtChapter[] = [];
  let currentParagraphs: string[] = [];
  let charCount = 0;
  let chapterIndex = 0;

  for (const para of paragraphs) {
    currentParagraphs.push(para);
    charCount += para.length;

    if (charCount >= AUTO_SPLIT_LENGTH) {
      chapters.push({
        title: `第 ${chapterIndex + 1} 段`,
        content: textToHtml(currentParagraphs.join('\n')),
        index: chapterIndex++,
      });
      currentParagraphs = [];
      charCount = 0;
    }
  }

  if (currentParagraphs.length > 0) {
    chapters.push({
      title: `第 ${chapterIndex + 1} 段`,
      content: textToHtml(currentParagraphs.join('\n')),
      index: chapterIndex++,
    });
  }

  return chapters;
}

/**
 * 加载 TXT 文件，返回解析后的章节数据
 */
export async function loadTxt(file: File): Promise<TxtMeta> {
  if (file.size > 50 * 1024 * 1024) {
    throw new Error('文件过大（超过 50MB）');
  }

  const text = await file.text();
  let chapters = splitByChapters(text);

  // 如果检测到的章节太少或没有，自动分段
  if (chapters.length <= 1) {
    chapters = autoSplit(text);
  }

  return {
    title: file.name.replace(/\.txt$/i, ''),
    author: '未知作者',
    chapters,
  };
}

/**
 * 渲染 TXT 章节到容器
 */
export function renderTxtChapter(
  chapter: TxtChapter,
  container: HTMLElement,
): void {
  container.innerHTML = chapter.content;
}

/**
 * 获取 TXT 章节的纯文本内容（用于高亮等）
 */
export function getTxtChapterText(chapter: TxtChapter): string {
  const div = document.createElement('div');
  div.innerHTML = chapter.content;
  return div.textContent ?? '';
}
