/**
 * jsPDF 补充类型声明 —— jsPDF.API.TTFFont 是公开运行时可用的字体解析器
 * （官方 index.d.ts 未收录），renderPDF 用它与 jsPDF 内部同一解析器做预校验，
 * 避免 jsPDF PubSub 吞掉 addFont 解析异常后渲染期报出无意义的 "reading 'widths'"。
 */
declare module 'jspdf' {
  interface jsPDFAPI {
    TTFFont: {
      open(data: Uint8Array): unknown
    }
  }
}
