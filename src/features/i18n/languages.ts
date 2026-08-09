/**
 * 界面语言定义 —— v1 支持 13 门语言（架构文档 §6.3）。
 * zh/en 全量翻译；其余语言按需加载，缺失词条兜底 en（默认英语兜底）。
 */
export interface LanguageDef {
  code: string
  /** 本地化名称（以其母语书写） */
  label: string
  /** PDF 语言组：latin / cjk / thai */
  group: 'latin' | 'cjk' | 'thai'
}

export const LANGUAGES: LanguageDef[] = [
  { code: 'zh', label: '中文', group: 'cjk' },
  { code: 'en', label: 'English', group: 'latin' },
  { code: 'de', label: 'Deutsch', group: 'latin' },
  { code: 'fr', label: 'Français', group: 'latin' },
  { code: 'it', label: 'Italiano', group: 'latin' },
  { code: 'es', label: 'Español', group: 'latin' },
  { code: 'pl', label: 'Polski', group: 'latin' },
  { code: 'ru', label: 'Русский', group: 'latin' },
  { code: 'uk', label: 'Українська', group: 'latin' },
  { code: 'vi', label: 'Tiếng Việt', group: 'latin' },
  { code: 'ja', label: '日本語', group: 'cjk' },
  { code: 'ko', label: '한국어', group: 'cjk' },
  { code: 'th', label: 'ไทย', group: 'thai' },
]
