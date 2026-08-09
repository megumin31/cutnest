/**
 * exporter 公共入口：场景模型 / PDF / DXF。
 */
export { toScene } from './toScene'
export type { ScenePart, SceneSheet } from './toScene'
export { renderDXF, asciiLayerName, rectContour, optimizeCutOrder } from './renderDXF'
export { renderPDF, needsCjkFont, pdfTexts, PdfFontError } from './renderPDF'
export type { PdfLabels, PdfFonts, PdfResult } from './renderPDF'
