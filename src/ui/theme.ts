/**
 * 主题 token —— 映射 UI-DESIGN.md §3 色彩系统。
 * 中性灰骨架 + 单一强调色（暖橙），浅/深两套，组件代码零分支（换 algorithm）。
 */
import { theme as antdTheme, type ThemeConfig } from 'antd'

/** 设计变量（与 UI-DESIGN.md §3 一一对应） */
export const palette = {
  light: {
    bg: '#F7F7F8',
    surface: '#FFFFFF',
    border: '#E4E4E7',
    textPrimary: '#18181B',
    textSecondary: '#52525B',
    textDisabled: '#A1A1AA',
    accent: '#E8590C',
    accentHover: '#F76707',
    success: '#2F9E44',
    warning: '#F59F00',
    danger: '#E03131',
    info: '#1971C2',
  },
  dark: {
    bg: '#0F1115',
    surface: '#161A20',
    border: '#2A2F38',
    textPrimary: '#F4F4F5',
    textSecondary: '#A1A1AA',
    textDisabled: '#52525B',
    accent: '#F76707',
    accentHover: '#E8590C',
    success: '#2F9E44',
    warning: '#F59F00',
    danger: '#E03131',
    info: '#1971C2',
  },
} as const

export type ThemeMode = 'light' | 'dark'

export function buildTheme(mode: ThemeMode): ThemeConfig {
  const p = palette[mode]
  return {
    algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: p.accent,
      colorInfo: p.info,
      colorSuccess: p.success,
      colorWarning: p.warning,
      colorError: p.danger,
      colorBgLayout: p.bg,
      colorBgContainer: p.surface,
      colorBorder: p.border,
      colorBorderSecondary: p.border,
      colorText: p.textPrimary,
      colorTextSecondary: p.textSecondary,
      colorTextDisabled: p.textDisabled,
      colorLink: p.accent,
      colorLinkHover: p.accentHover,
      fontFamily:
        '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
      fontSize: 13,
      borderRadius: 8,
      controlHeight: 32,
      wireframe: false,
    },
    components: {
      Button: {
        borderRadius: 8,
        fontWeight: 500,
        primaryShadow: 'none',
      },
      Card: { borderRadiusLG: 12 },
      Modal: { borderRadiusLG: 12 },
      Table: {
        headerBg: mode === 'dark' ? '#1D222B' : '#F3F3F4',
        headerColor: p.textSecondary,
        headerSplitColor: 'transparent',
        rowHoverBg: mode === 'dark' ? '#1D222B' : '#F3F3F5',
        // Excel 式紧凑行（v1.2 方向 D）：单元格内边距压至 ~24px 行高
        cellPaddingBlock: 3,
        cellPaddingInline: 8,
      },
      Layout: { siderBg: p.surface, headerBg: p.surface },
      Input: { activeBorderColor: p.accent, hoverBorderColor: p.border },
      Select: { optionSelectedBg: mode === 'dark' ? '#2A2F38' : '#F3F0EB' },
    },
  }
}

/** 主题相关 CSS 变量（挂到 :root，切割图 SVG 使用） */
export function themeCssVars(mode: ThemeMode): Record<string, string> {
  const p = palette[mode]
  return {
    '--bg': p.bg,
    '--surface': p.surface,
    '--border': p.border,
    '--text-primary': p.textPrimary,
    '--text-secondary': p.textSecondary,
    '--text-disabled': p.textDisabled,
    '--accent': p.accent,
    '--warning': p.warning,
    '--table-header-bg': mode === 'dark' ? '#1D222B' : '#F3F3F4',
    '--table-row-num-bg': mode === 'dark' ? '#171C24' : '#FAFAFB',
    '--waste': 'rgba(127,127,127,0.35)',
  }
}
