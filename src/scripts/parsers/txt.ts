/**
 * TXT 文件解析器
 * 支持多种内置章节标题格式 + 用户自定义正则。
 */

/** 内置章节标题检测规则（按优先级排序） */
const BUILTIN_PATTERNS: string[] = [
  String.raw`^第[零一二三四五六七八九十百千万\d]+[章节回集部卷篇]`,
  String.raw`^\s*第[零一二三四五六七八九十百千万\d]+[章节回集部卷篇]`,
  String.raw`^Chapter\s+\d+`,
  String.raw`^CHAPTER\s+[IVXLCDM]+`,
  String.raw`^[（(]\s*\d+\s*[)）]`,
  String.raw`^\d+\s*[、.．。]\s*\S`,
  String.raw`^【[^】]{1,30}】`,
  String.raw`^［[^］]{1,30}］`,
  String.raw`^[■◆●▶▼▲★☆▪▸►]\s*\S`,
  String.raw`^={2,}\s*\S.*\S\s*={2,}$`,
  String.raw`^-{2,}\s*\S.*\S\s*-{2,}$`,
  String.raw`^\*{2,}\s*\S.*\S\s*\*{2,}$`,
  String.raw`^[#＃]{1,4}\s+\S`,
  String.raw`^第[零一二三四五六七八九十百千万\d]+[节]`,
  String.raw`^序[章节言]?\s*$`,
  String.raw`^楔子\s*$`,
  String.raw`^尾声\s*$`,
  String.raw`^后记\s*$`,
  String.raw`^番外.{0,20}$`,
  String.raw`^(内容|引言|简介|前言|附录)(\s|$)`,
];

/**
 * 从 localStorage 读取用户自定义正则，或使用内置规则。
 * 每行一个正则表达式。无效的行被忽略。
 */
function getPatterns(): RegExp[] {
  try {
    const raw = localStorage.getItem('reader-txt-patterns');
    if (raw) {
      const lines = raw.split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'));
      const regs: RegExp[] = [];
      for (const line of lines) {
        try {
          regs.push(new RegExp(line, 'i'));
        } catch { /* invalid regex, skip */ }
      }
      if (regs.length > 0) return regs;
    }
  } catch { /* ignore */ }

  // Fallback to built-in
  return BUILTIN_PATTERNS.map(p => new RegExp(p, 'i'));
}

/**
 * 清理标题中的装饰符号。
 * "===第一章 小小灵娥===" → "第一章 小小灵娥"
 * "【第三章 筑基】" → "第三章 筑基"
 * "## 第四章" → "第四章"
 */
function cleanTitle(raw: string): string {
  return raw
    .replace(/^[=\-*#＝－＊＃●◆■▶▼▲★☆\s]+/, '')
    .replace(/[=\-*#＝－＊＃●◆■▶▼▲★☆\s]+$/, '')
    .replace(/^[【［（({]\s*/, '')
    .replace(/\s*[】］）)}]\s*$/, '')
    .replace(/^[#＃]{1,4}\s*/, '')
    .replace(/^(序[章节言]?|楔子|尾声|后记|番外)$/, (m) => m)
    .trim();
}

/** 检测是否为章节标题 */
function isChapterTitle(line: string, patterns: RegExp[]): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return false;
  return patterns.some(p => p.test(trimmed));
}

/** HTML 转义 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return text.replace(/[&<>"']/g, ch => map[ch] ?? ch);
}

/** 将纯文本段落转为 HTML */
function wrapParagraphs(text: string): string {
  return text
    .split(/\n\n+/)
    .map(para => para.trim())
    .filter(Boolean)
    .map(para => {
      const lines = para.split('\n').map(l => l.trim()).filter(Boolean);
      return `<p>${lines.map(escapeHtml).join('<br>')}</p>`;
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
 * 将 TXT 文件内容解析为结构化章节。
 */
export function parseTxt(text: string, filename: string): ParsedTxt {
  const patterns = getPatterns();

  // 1. 统一换行符
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  const lines = normalized.split('\n');

  // 2. 提取书名
  const rawTitle = filename
    .replace(/\.(txt|TXT)$/, '')
    .replace(/[_\-]?(精校版?|校对版?|全本|完本|完结|v\d+\.?\d*|V\d+\.?\d*)$/g, '')
    .replace(/^[《【]|[》】]$/g, '')
    .replace(/[_\-]+/g, ' ')
    .trim();

  // 3. 分章
  const chapterChunks: Array<{ title: string; lines: string[] }> = [];
  let currentTitle = '前言';
  let currentLines: string[] = [];
  let hasDetectedChapters = false;

  for (const line of lines) {
    if (isChapterTitle(line, patterns)) {
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

  // 4. 未检测到章节 → 自动分段
  if (!hasDetectedChapters || chapterChunks.length <= 1) {
    const allText = lines.join('\n');
    const segSize = Number(localStorage.getItem('reader-txt-split')) || 3000;
    const segs: Array<{ title: string; content: string; index: number }> = [];
    for (let i = 0; i < allText.length; i += segSize) {
      const seg = allText.slice(i, i + segSize);
      segs.push({ title: `第 ${segs.length + 1} 段`, content: wrapParagraphs(seg), index: segs.length });
    }
    return { title: rawTitle, author: '未知作者', chapters: segs };
  }

  // 5. 生成最终结果
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
