/**
 * TXT 文件解析器
 * 支持多种章节标题格式，自动清理多余符号
 */

/** 章节标题检测规则（按优先级排序） */
const CHAPTER_PATTERNS: RegExp[] = [
  /^第[零一二三四五六七八九十百千万\d]+[章节回集部卷篇]/,
  /^Chapter\s+\d+/i,
  /^CHAPTER\s+[IVXLCDM]+/i,
  /^[（(]\s*\d+\s*[)）]/,
  /^\d+\s*[、.．。]\s*\S/,
  /^【[^】]{1,30}】/,
  /^［[^］]{1,30}］/,
  /^[■◆●▶]\s*\S/,
  /^={2,}\s*\S.*\S\s*={2,}$/,
  /^-{2,}\s*\S.*\S\s*-{2,}$/,
  /^\*{2,}\s*\S.*\S\s*\*{2,}$/,
];

/**
 * 清理标题中的装饰符号
 */
function cleanTitle(raw: string): string {
  return raw
    .replace(/^[=\-*#＝－＊＃\s]+/, '')
    .replace(/[=\-*#＝－＊＃\s]+$/, '')
    .replace(/^[【［（(]\s*/, '')
    .replace(/\s*[】］）)]\s*$/, '')
    .trim();
}

/** 检测一行是否为章节标题 */
function isChapterTitle(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 60) return false;
  return CHAPTER_PATTERNS.some(p => p.test(trimmed));
}

/** 将纯文本段落转为 HTML */
function wrapParagraphs(text: string): string {
  return text
    .split(/\n\n+/)
    .map(para => para.trim())
    .filter(Boolean)
    .map(para => {
      const lines = para.split('\n').map(l => l.trim()).filter(Boolean);
      return `<p>${lines.join('<br>')}</p>`;
    })
    .join('\n');
}

/** 解析结果 */
export interface ParsedTxt {
  title: string;
  author: string;
  chapters: Array<{ title: string; content: string; index: number }>;
}

/**
 * 将 TXT 文件内容解析为结构化章节
 */
export function parseTxt(text: string, filename: string): ParsedTxt {
  // 1. 统一换行符，过滤连续空行
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  const lines = normalized.split('\n');

  // 2. 提取书名
  const rawTitle = filename
    .replace(/\.(txt|TXT)$/, '')
    .replace(/[_\-]?(精校版?|校对版?|全本|完本|完结)$/g, '')
    .replace(/^[《【]|[》】]$/g, '')
    .trim();

  // 3. 分章
  const chapterChunks: Array<{ title: string; lines: string[] }> = [];
  let currentTitle = '前言';
  let currentLines: string[] = [];
  let hasDetectedChapters = false;

  for (const line of lines) {
    if (isChapterTitle(line)) {
      if (currentLines.some(l => l.trim())) {
        chapterChunks.push({ title: currentTitle, lines: currentLines });
      }
      currentTitle = cleanTitle(line);
      currentLines = [];
      hasDetectedChapters = true;
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.some(l => l.trim())) {
    chapterChunks.push({ title: currentTitle, lines: currentLines });
  }

  // 4. 未检测到章节：按 3000 字自动分段
  if (!hasDetectedChapters || chapterChunks.length <= 1) {
    const allText = lines.join('\n');
    const segSize = 3000;
    const segs: Array<{ title: string; content: string; index: number }> = [];
    for (let i = 0; i < allText.length; i += segSize) {
      const seg = allText.slice(i, i + segSize);
      segs.push({ title: `第 ${segs.length + 1} 段`, content: wrapParagraphs(seg), index: segs.length });
    }
    return { title: rawTitle, author: '未知作者', chapters: segs };
  }

  // 5. 将行数组转为 HTML 段落
  return {
    title: rawTitle,
    author: '未知作者',
    chapters: chapterChunks.map((c, i) => ({
      title: c.title,
      content: wrapParagraphs(c.lines.join('\n')),
      index: i,
    })),
  };
}
