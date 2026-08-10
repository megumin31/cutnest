/**
 * 全局领域类型 —— 所有模块的唯一数据契约。
 * 本模块禁止 import 任何 UI / 浏览器 / React 依赖（架构文档 §4）。
 * 尺寸单位：mm 整数；工艺参数可小数；浮点比较统一 epsilon = 0.001。
 */

/** 浮点比较精度（mm） */
export const EPSILON = 0.001

/** 零件 —— 长×宽（行业惯例：长度 = 纹理方向轴，宽度 = 垂直方向） */
export interface Part {
  id: string
  /** "侧板"、"抽屉面板"… */
  name: string
  /**
   * 长度方向的尺寸 (mm，整数)。"长度/宽度"是**方向标签**而非长短：
   * 长度边沿 X 轴（纹理方向）、宽度边沿 Y 轴，不要求 length ≥ width
   * （用户可能输入宽度大于长度的数值）。
   */
  length: number
  /** 宽度方向的尺寸 (mm，整数)，沿 Y 轴；不要求 ≤ length */
  width: number
  quantity: number
  /** 旋转标记：'any' = 允许 90° 旋转；缺省 / 'alongLength' = 禁止旋转（默认） */
  grain?: 'alongLength' | 'any'
  /** 指定板材（项目板材库中的规格 id）；缺省 = 板材库中任意规格均可 */
  sheetId?: string
  /** 封边需求：仅用于 PDF 标注 + 成本核算，不参与排样 */
  edgeBand?: ('L' | 'R' | 'T' | 'B')[]
  note?: string
}

/** 板材规格 —— "长度/宽度"与零件同语义：方向标签（长度边沿 X 轴、宽度边沿 Y 轴），不要求 length ≥ width */
export interface SheetSpec {
  id: string
  /** "颗粒板"（尺寸由独立字段表达，名称不含规格，避免与长宽属性重复） */
  name: string
  /** 长度（X 轴方向），如 2440 */
  length: number
  /** 宽度（Y 轴方向），如 1220 */
  width: number
  /** 元/张，供成本核算 */
  price: number
}

/** 计算质量（搜索强度）三档：快速/标准/精细 —— 语义 = 每零件迭代预算，与零件数量无关 */
export type Quality = 'fast' | 'standard' | 'fine'

/**
 * 优化设置 —— 评价函数唯一、不可配置（字典序，见 §6.2），无 strategy 字段
 */
export interface OptimizeSettings {
  /** 切缝宽度（精密锯锯缝 / 雕刻机刀径共用），默认 3mm；零件间净距 = kerf */
  kerf: number
  /** 修边余量：每边切掉量（含边缘预留场景），可用区域 = (长−2×trim)×(宽−2×trim)，默认 0（不修边） */
  trimAllowance: number
  /** 计算质量（搜索强度）三档：快速/标准/精细 */
  quality: Quality
  /** 最小可再用余料尺寸阈值，默认 200×200（余料集中度用） */
  minReusableWaste: number
  /** 随机种子（确定性） */
  seed: number
}

/** 排样结果 —— 纯裁板数据，不含任何导出/品牌信息（导出参数见 ExportPrefs） */
export interface CutPlan {
  id: string
  /** epoch ms，历史方案列表排序用 */
  createdAt: number
  /** 每张板的布局 */
  sheets: SheetLayout[]
  /** 板材库快照（排样时的可用规格全集；每张板按 sheetSpecId 引用） */
  sheetLibrary: SheetSpec[]
  stats: PlanStats
  settings: OptimizeSettings
}

export interface SheetLayout {
  sheetIndex: number
  /** 该板实际使用的板材规格 id（对应 plan.sheetLibrary） */
  sheetSpecId: string
  placements: Placement[]
}

export interface Placement {
  partId: string
  /** 该零件的第几块（quantity 展开后） */
  instance: number
  /** 左下角坐标（X 沿板材长度方向） */
  x: number
  y: number
  /** 实际摆放后的长度/宽度方向尺寸（可能已旋转） */
  len: number
  wid: number
  rotated: boolean
}

export interface PlanStats {
  /** 用板张数 */
  sheetCount: number
  /** 材料利用率 % */
  utilization: number
  /** 总成本（由 pricing 核算回填） */
  totalCost: number
  /** 余料总面积 mm²（含碎料） */
  wasteArea: number
  /** 可再利用余料块数（≥ minReusableWaste，越少越好） */
  reusableWasteBlocks: number
  /** 最大可再利用余料块面积 mm²（越大越好） */
  largestReusableWaste: number
  /** 零件封边总长度（米）——排样时快照，历史方案查看/导出不依赖当前零件表 */
  edgeMeters?: number
  /** 零件实际总面积 mm²（quantity 展开后全部实例） */
  partArea?: number
  /** 每样精算（itemized）总成本——与开关无关，排样时始终计算；UI 按当前计价模式展示 */
  costItemized?: number
  /** 按面积计价（byArea）总成本——同上 */
  costByArea?: number
}

/** 导出偏好（项目级，不含排样数据；项目下所有历史方案共享） */
export interface ExportPrefs {
  pdf: {
    watermark: { enabled: boolean; text: string }
    companyInfo: {
      name: string
      logo?: string
      address?: string
      phone?: string
    }
  }
  dxf: {
    /** 顺铣/逆铣，默认 climb（顺铣，表面质量好） */
    cutDirection: 'climb' | 'conventional'
  }
  /** 跟随全局设置，导出时可覆盖 */
  unit: 'mm' | 'cm' | 'in'
}

/** 价格核算配置（全局设置；价格功能可整体关闭） */
export interface PricingPrefs {
  /** 是否启用价格核算与展示 */
  enabled: boolean
  /** 计价模式：itemized = 每样精算（板材费+封边费+加工费）；byArea = 按面积计价 */
  mode: 'itemized' | 'byArea'
  /** itemized：封边单价（元/米） */
  edgePricePerM: number
  /** itemized：每张板材固定加工费（元/张） */
  processingFeePerSheet: number
  /** byArea：面积单价（元/平方米） */
  areaPricePerSqm: number
}

/** 成本核算输出 */
export interface CostBreakdown {
  sheetCount: number
  utilization: number
  wasteArea: number
  totalCost: number
  /** itemized 模式构成（byArea 模式下为 0）：板材费 = Σ 每张实际规格价格 */
  sheetCost: number
  /** itemized 模式构成：封边费 = Σ 封边长度 × 单价 */
  edgeCost: number
  /** itemized 模式构成：加工费 = 板数 × 单张加工费 */
  processingCost: number
  /** 每零件分摊成本（按面积占比），key = partId */
  perPartCost: Record<string, number>
}

/** AI 手写识别结果契约（OCR 供应商统一输出，审查表 ↔ 零件表导入的唯一格式） */
export interface RecognizedSheet {
  items: {
    name: string
    length: number
    width: number
    quantity: number
    confidence: number
  }[]
  rawText: string
}

/** 项目实体（落 storage.projects 表，含导出偏好） */
export interface Project {
  id: string
  name: string
  parts: Part[]
  /** 板材库（多选组合，排样时的可用规格，至少 1 种） */
  sheets: SheetSpec[]
  settings: OptimizeSettings
  exportPrefs: ExportPrefs
  createdAt: number
  updatedAt: number
}

/** 历史方案条目（落 storage.cutPlans 表，CutPlan + 所属项目 + 板材库快照） */
export interface PlanRecord {
  id: string
  projectId: string
  projectName: string
  plan: CutPlan
  /** 板材库快照 */
  sheets: SheetSpec[]
  createdAt: number
  /** 排样时的零件名快照（partId → name），重新导出不依赖当前项目零件表 */
  partNames?: Record<string, string>
}

/** 登录账号状态（会话态；权威数据在服务端） */
export type AuthStatus =
  | { state: 'loggedOut' }
  | {
      state: 'loggedIn'
      email: string
      /** 长期凭证（Ed25519 签名 token，180 天） */
      token: string
      /** 买断标记 */
      paid: boolean
      /** 识别剩余次数 */
      credits: number
      /** 本机设备指纹 */
      deviceFp: string
    }

/** 设备信息（账号页设备管理） */
export interface DeviceInfo {
  fp: string
  lastSeenAt: number
  current: boolean
}

/** 识别审查行（AI 结果 + 人工修正状态） */
export interface ReviewRow {
  name: string
  length: number
  width: number
  quantity: number
  confidence: number
  /** 用户是否已确认/修改 */
  confirmed: boolean
  /** 用户修正过（确认高亮消失） */
  edited: boolean
}
