/**
 * i18n 初始化 —— react-i18next。
 * zh/en 全量；其余语言缺失词条兜底 en（默认英语兜底，架构文档 §6.3）。
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { zh } from './zh'
import { en } from './en'
import { LANGUAGES } from './languages'

export const supportedLanguageCodes = LANGUAGES.map((l) => l.code)

export function initI18n(initialLang: string) {
  void i18n.use(initReactI18next).init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
    },
    lng: initialLang,
    fallbackLng: 'en',
    supportedLngs: supportedLanguageCodes,
    interpolation: { escapeValue: false },
  })
  return i18n
}

export { LANGUAGES }
