/**
 * 阅读器设置模块
 * 管理所有可配置的阅读参数，默认值定义在此。
 * 每次变更同步到 IndexedDB 并派发自定义事件以更新 UI。
 */
import { getAllSettings, saveSetting } from './storage';

/** 阅读器设置接口 */
export interface ReaderSettings {
  theme: 'dark' | 'light' | 'sepia' | 'hacker';
  fontSize: number;        // 12–28，默认 16
  lineHeight: number;      // 1.4–2.2，默认 1.8
  paragraphSpacing: number; // 0–2，默认 1.2（em）
  fontFamily: 'sans' | 'serif' | 'mono';
  readerWidth: 'narrow' | 'medium' | 'wide'; // 480/640/800px
  indent: boolean;         // 段落缩进
  hyphenation: boolean;    // 连字符断词
  vertical: boolean;       // 竖排模式
}

/** 默认设置 */
export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'dark',
  fontSize: 16,
  lineHeight: 1.8,
  paragraphSpacing: 1.2,
  fontFamily: 'serif',
  readerWidth: 'medium',
  indent: true,
  hyphenation: false,
  vertical: false,
};

/** 主题列表 */
export const THEMES: ReaderSettings['theme'][] = ['dark', 'light', 'sepia', 'hacker'];

/** 当前设置缓存 */
let currentSettings: ReaderSettings = { ...DEFAULT_SETTINGS };

/** 获取当前设置快照 */
export function getSettings(): ReaderSettings {
  return { ...currentSettings };
}

/**
 * 从 IndexedDB 加载设置并合并默认值
 */
export async function loadSettings(): Promise<ReaderSettings> {
  try {
    const saved = await getAllSettings();
    const merged: ReaderSettings = { ...DEFAULT_SETTINGS };
    for (const [key, value] of saved) {
      if (key in merged) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
    currentSettings = merged;
    applySettings(merged);
  } catch {
    // IndexedDB 不可用时使用默认值
    console.warn('无法加载设置，使用默认值');
    applySettings(DEFAULT_SETTINGS);
  }
  return { ...currentSettings };
}

/**
 * 更新单个设置项，同步到 DOM 和 IndexedDB
 */
export async function updateSetting<K extends keyof ReaderSettings>(
  key: K,
  value: ReaderSettings[K],
): Promise<void> {
  currentSettings[key] = value;
  await saveSetting(key, value);
  applySettings(currentSettings);
  dispatchSettingsChange();
}

/**
 * 批量更新设置
 */
export async function updateSettings(partial: Partial<ReaderSettings>): Promise<void> {
  for (const [key, value] of Object.entries(partial)) {
    currentSettings[key as keyof ReaderSettings] = value as never;
    await saveSetting(key, value);
  }
  applySettings(currentSettings);
  dispatchSettingsChange();
}

/**
 * 将设置应用到 DOM（data-theme、CSS 变量、body class）
 */
function applySettings(s: ReaderSettings): void {
  const root = document.documentElement;

  // 主题
  root.setAttribute('data-theme', s.theme);

  // 读者区域 CSS 变量
  const readerStyles = root.style;
  readerStyles.setProperty('--reader-font-size', `${s.fontSize}px`);
  readerStyles.setProperty('--reader-line-height', String(s.lineHeight));
  readerStyles.setProperty('--reader-paragraph-spacing', `${s.paragraphSpacing}em`);
  readerStyles.setProperty('--reader-font-family', getFontFamilyCSS(s.fontFamily));
  readerStyles.setProperty('--reader-width', getReaderWidthCSS(s.readerWidth));

  // Body class
  root.classList.toggle('reader-indent', s.indent);
  root.classList.toggle('reader-hyphenation', s.hyphenation);
  root.classList.toggle('reader-vertical', s.vertical);
}

/** 字体映射 */
function getFontFamilyCSS(family: ReaderSettings['fontFamily']): string {
  switch (family) {
    case 'sans': return 'var(--font-sans)';
    case 'serif': return 'var(--font-serif)';
    case 'mono': return 'var(--font-mono)';
  }
}

/** 宽度映射 */
function getReaderWidthCSS(width: ReaderSettings['readerWidth']): string {
  switch (width) {
    case 'narrow': return '480px';
    case 'medium': return '640px';
    case 'wide': return '800px';
  }
}

/** 派发设置变更事件 */
function dispatchSettingsChange(): void {
  window.dispatchEvent(new CustomEvent('settings-changed', { detail: currentSettings }));
}
