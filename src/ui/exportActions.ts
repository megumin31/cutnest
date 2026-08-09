/**
 * 导出动作 —— PDF（含字体准备/水印策略）与 DXF。
 * 免费/付费联动（架构文档 §6.3）：体验版强制品牌水印、无 DXF；付费版按项目偏好。
 */
import i18n from 'i18next'
import type { Project, CutPlan, AuthStatus } from '../domain/types'
import { renderPDF, pdfTexts, type PdfLabels } from '../domain/exporter'
import { renderDXF } from '../domain/exporter'
import { prepareExportFonts } from '../infra/fonts'
import { platform } from '../infra/platform'
import { useSettingsStore } from '../features/settings/settingsStore'

/** 按导出语言构建 PDF 标签（词条缺失兜底 en） */
export function buildPdfLabels(project: Project, lang: string): PdfLabels {
  const t = i18n.getFixedT(lang)
  const dateText = new Date().toLocaleDateString(lang === 'zh' ? 'zh-CN' : lang, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return {
    projectName: project.name,
    companyName: project.exportPrefs.pdf.companyInfo.name,
    companyAddress: project.exportPrefs.pdf.companyInfo.address ?? '',
    companyPhone: project.exportPrefs.pdf.companyInfo.phone ?? '',
    costLabel: useSettingsStore.getState().settings.pricing.enabled ? t('pdf.cost') : '',
    sheetsLabel: t('pdf.sheets'),
    utilizationLabel: t('pdf.utilization'),
    wasteLabel: t('pdf.waste'),
    reusableLabel: t('pdf.reusable'),
    largestLabel: t('pdf.largest'),
    sheetPrefix: t('pdf.sheetPrefix'),
    sheetSuffix: t('pdf.sheetSuffix'),
    partCountLabel: t('pdf.partCount'),
    dateText,
    watermark: null,
    unit: project.exportPrefs.unit,
  }
}

/** 导出用零件名表 */
export function partNamesOf(project: Project): Map<string, string> {
  return new Map(project.parts.map((p) => [p.id, p.name]))
}

export async function exportPdf(
  project: Project,
  plan: CutPlan,
  auth: AuthStatus,
  exportLang: string,
  partNames?: Map<string, string>,
): Promise<void> {
  const paid = auth.state === 'loggedIn' && auth.paid
  const labels = buildPdfLabels(project, exportLang)
  // 水印策略：免费版强制品牌水印；付费版按项目偏好（默认关）
  const brand = i18n.getFixedT('zh')('pdf.watermark')
  labels.watermark = paid
    ? project.exportPrefs.pdf.watermark.enabled
      ? project.exportPrefs.pdf.watermark.text || brand
      : null
    : brand

  // 字体：扫描整份文档实际绘制的全部文本（词条标签 + 用户输入），
  // 与 renderPDF 内部判定共用 pdfTexts —— 缺词条字符会白字/乱码
  const names = partNames ?? partNamesOf(project)
  const texts = pdfTexts(labels, names)
  const fonts = await prepareExportFonts(texts)

  const { bytes } = await renderPDF(plan, project.sheets, names, labels, fonts)
  const date = new Date().toISOString().slice(0, 10)
  await platform.saveFile(bytes, `${project.name}-${date}.pdf`, 'application/pdf')
}

export async function exportDxf(
  project: Project,
  plan: CutPlan,
  partNames?: Map<string, string>,
): Promise<void> {
  const names = partNames ?? partNamesOf(project)
  const dxf = renderDXF(plan, project.sheets, project.exportPrefs, names)
  const bytes = new TextEncoder().encode(dxf)
  const date = new Date().toISOString().slice(0, 10)
  await platform.saveFile(bytes, `${project.name}-${date}.dxf`, 'application/dxf')
}
