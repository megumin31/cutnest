# 裁板软件架构文档（定稿 v1.0）

> 本文档是项目的唯一权威设计依据。所有开发 session 开工前必须先读本文档 + `AGENTS.md`。
> 修改任何架构决策必须先更新本文档，再改代码。

---

## 1. 产品概述

木工裁板优化商业软件：输入零件清单（部件）和板材规格，自动计算最优排布方案（用板最少、余料最集中），输出给客户看的图纸（PDF）和给机器执行的切割文件（DXF）。

**目标平台**：Web、Windows、Linux、**Android（必做，Tauri 原生打包，重要性与 Windows 同等）**、iOS（后续评估）
**核心定位**：单机优先。计算全部本地运行，离线可用。服务端承载三个服务：账号/授权 + AI 手写部件单识别 + 付费。

## 2. 商业模型

| 形态 | 定价 | 说明 |
|---|---|---|
| 桌面端（Windows/Linux） | **买断制** | 账号登录后长期凭证离线可用；同一账号最多同时登录 3 台设备 |
| Web 端 | **付费解锁** | 免费 = 体验版（≤20 零件 + PDF 品牌水印 + 无 DXF）；登录付费账号后全功能 |
| Android 移动端（原生应用） | **付费解锁** | 与 Web 端同一功能闸门（免费 = 体验版；登录付费账号后全功能）；买断标记挂账号，买断用户移动端同样全功能 |
| AI 手写部件单识别 | **增值按量计费** | 按次扣费（**成功才扣**），买断版附赠初始次数 |

**关键决策：账号系统。** 支持**邮箱注册（密码）+ Google 账号**两种登录。身份 = 账号，买断标记与识别次数余额都挂账号，天然多端共享。盗版用户只能用核心功能、用不了增值服务——盗版是转化通道。

**功能闸门按付费分，不按端分**：登录 + 买断后 Web 和桌面全部功能可用；未登录/未付费在所有端都是体验版。

**设备限制**：同一账号最多**同时登录 3 台设备**（桌面/Web/Android 合计；iOS 上线后纳入），滚动淘汰（最新 3 台）。

## 3. 技术栈（定稿）

| 层 | 选型 | 理由 |
|---|---|---|
| 核心语言 | TypeScript（strict） | AI 训练数据最丰富，vibe coding 首选 |
| 前端框架 | React + Vite | 同上 |
| UI 组件库 | Ant Design（token 定制，见 UI-DESIGN.md） | 表格/表单齐全，商业工具成熟 |
| 状态管理 | Zustand（按 feature 拆分 store） | 轻量 |
| 本地存储 | Dexie (IndexedDB) | Web 与 Tauri webview 通用，离线可用 |
| 计算并发 | Web Worker（web）/ Tauri command（桌面，未来） | 几百零件不卡 UI |
| 桌面壳 / 移动端 | **Tauri 2** | 5~15MB 安装包（不含字体资源，见 §6.3 约 +30MB）、低内存；Windows/Linux 桌面与 Android 原生打包共用同一套壳与适配器（同一代码后续可出 iOS）；已知代价：Android WebView 渲染性能弱于 Chrome 直跑（切割图降级 + quality 降档应对，见阶段 11） |
| Web 附加能力 | **PWA**（Service Worker + Web App Manifest） | Web 端同时提供可安装/离线/扫码即用能力——补充分发渠道（微信/浏览器直达），**非移动端主线**；拍照（<input capture>）与文件分享（Web Share API）仅 PWA/浏览器环境使用 |
| Web 托管 | Cloudflare Pages | 免费静态托管 |
| 服务端函数 | Cloudflare Workers | 免费 10 万次请求/天 |
| 服务端数据库 | Cloudflare D1 (SQLite) | 免费 5GB / 500 万行读每天 |
| 账号/登录 | 邮箱注册（Argon2 密码哈希）+ **Google OAuth**（第三方登录） | 邮箱 = 基础通道，Google = 低摩擦主流通道 |
| 国际化 | **react-i18next**（词条 + 语言包按需加载） | 13 门语言（见 §6.3），与 PDF 导出词条/字体共用一套资源机制 |
| AI 手写识别 | OCR 供应商抽象（默认 Qwen-OCR / DashScope） | 统一 `RecognizedSheet` 输出契约，环境变量切换供应商（见 §9），不写死单一厂商 |
| 测试 | Vitest | 与 Vite 同生态 |

**替代路径（留档）**：服务端若需迁国内云（阿里云函数计算 + 云数据库），由于 API 已抽象在 `infra/api`，是平移操作。Supabase 曾作为备选，因"后端过小 + Cloudflare 全家桶统一管理"而弃用。

## 4. 分层架构与依赖规则

```
ui (React 组件)
  → features (业务工作流 + Zustand store)
      → domain (纯逻辑，零框架依赖)   ← 核心，所有规则在这里
      → infra (storage / worker / api / platform)
```

**硬性规则：**
1. `src/domain/` 禁止 import React、浏览器 API、任何 UI 库——必须能在纯 Node 环境跑单测
2. 每个模块只通过 `index.ts` 暴露公共接口，内部实现可替换（接口即契约）
3. 零件/板材**尺寸**为 mm 整数（cm/in 输入边界四舍五入）；切缝/余量等**工艺参数**允许小数（如 trim=1.5）；所有浮点比较统一 `epsilon = 0.001mm`
4. 平台差异（Web vs Tauri）一律走 `infra/platform` 适配器，业务代码禁止平台分支
5. 新模块先写类型和接口，再写实现（interface-first）
6. 所有方案输出必须先通过 `optimizer/validator.ts`
7. 随机算法（模拟退火）必须固定种子，保证**确定性**（同样输入同样输出）
8. 数据实体落 storage 表，Zustand store 只存会话状态
9. `optimizer`、`exporter`、`pricing` 必须有单测
10. storage schema 变更必须写迁移函数，禁止直接改表

## 5. 目录结构

```
cut/
├── src/
│   ├── domain/            # 领域层（纯 TS，可独立测试）
│   │   ├── types.ts       # 全局领域类型（先定死，所有模块引用）
│   │   ├── optimizer/     # 自由排样引擎
│   │   ├── exporter/      # PDF/DXF 导出
│   │   ├── pricing/       # 成本核算
│   │   ├── materials/     # 板材规格库
│   │   ├── palette.ts     # 零件切割图色板（网页 SVG 与 PDF 共用，纯数据）
│   │   └── units/         # 单位换算
│   ├── features/          # 特性层（页面 + store + 组件）
│   │   ├── projects/      # 项目与零件清单
│   │   ├── cutting/       # 裁板工作台（主页面）
│   │   ├── recognition/   # AI 手写识别
│   │   ├── licensing/     # 授权管理
│   │   └── settings/      # 设置
│   ├── infra/             # 基础设施层
│   │   ├── storage/       # 本地持久化（Dexie + 迁移）
│   │   ├── worker/        # 计算 Worker（消息协议）
│   │   ├── api/           # Cloudflare Workers 客户端
│   │   └── platform/      # Web/Tauri 适配
│   └── ui/                # 共享组件（零件表、切割图、审查表…）
├── src-tauri/             # Tauri 壳（Rust 极少，仅打包 + 原生能力）
├── functions/             # Cloudflare Workers（服务端：auth/oauth/heartbeat/recognize/buy）
├── tests/fixtures/        # 测试数据（500 零件基准集）
└── docs/                # ARCHITECTURE.md（架构） + UI-DESIGN.md（视觉规范）
```

## 6. 领域层模块规范

### 6.1 `types.ts` — 全局领域类型

```ts
// 零件 —— 长×宽（行业惯例：长度 = 纹理方向轴，宽度 = 垂直方向）
interface Part {
  id: string
  name: string                 // "侧板"、"抽屉面板"…
  length: number               // 长 (mm，整数)
  width: number                // 宽 (mm，整数)
  quantity: number
  grain?: 'alongLength' | 'any'   // 旋转标记：'any' = 可旋转；缺省/'alongLength' = 禁止旋转（默认）
  sheetId?: string             // 指定板材（项目板材库中的规格 id）；缺省 = 板材库中任意规格均可
  edgeBand?: ('L'|'R'|'T'|'B')[]  // 封边需求：仅用于 PDF 标注 + 成本核算，不参与排样
  note?: string
}

// 板材规格 —— "长度/宽度"与零件同语义：方向标签（长度边沿 X 轴、宽度边沿 Y 轴），不要求 length ≥ width
interface SheetSpec {
  id: string
  name: string                 // "颗粒板"（尺寸由独立字段表达，名称不含规格，避免与长宽属性重复）
  length: number               // 长度（X 轴方向），如 2440
  width: number                // 宽度（Y 轴方向），如 1220
  price: number                // 元/张，供成本核算
}

// 优化设置 —— 评价函数唯一、不可配置（字典序，见 §6.2），无 strategy 字段
interface OptimizeSettings {
  kerf: number                 // 切缝宽度（统一参数：精密锯锯缝 / 雕刻机刀径共用），默认 3mm；零件间净距 = kerf
  trimAllowance: number        // 修边余量：每边切掉量（含边缘预留场景），可用区域 = (长−2×trim)×(宽−2×trim)，默认 0（不修边）
  quality: 'fast'|'standard'|'fine'  // 计算质量（搜索强度）三档：语义 = 每零件迭代预算，与零件数量无关
  minReusableWaste: number     // 最小可再用余料尺寸阈值，默认 200×200（余料集中度用）
  seed: number                 // 随机种子（确定性）
}

// 排样结果 —— 纯裁板数据，不含任何导出/品牌信息（导出参数见 §6.3 ExportPrefs）
interface CutPlan {
  id: string
  createdAt: number             // epoch ms，历史方案列表排序用
  sheets: SheetLayout[]        // 每张板的布局
  /** 板材库快照（排样时的可用规格全集；每张板按 sheetSpecId 引用）——历史方案重导出不依赖项目当前板材库 */
  sheetLibrary: SheetSpec[]
  stats: PlanStats
  settings: OptimizeSettings
}
interface SheetLayout {
  sheetIndex: number
  /** 该板实际使用的板材规格 id（对应 plan.sheetLibrary） */
  sheetSpecId: string
  placements: Placement[]
}
interface Placement {
  partId: string
  instance: number             // 该零件的第几块（quantity 展开后）
  x: number; y: number         // 左下角坐标（X 沿板材长度方向）
  len: number; wid: number     // 实际摆放后的长度/宽度方向尺寸（可能已旋转）
  rotated: boolean
}
interface PlanStats {
  sheetCount: number
  utilization: number          // 材料利用率 %
  totalCost: number            // 总成本（由 pricing 核算）
  wasteArea: number            // 余料总面积 mm²（含碎料）
  reusableWasteBlocks: number  // 可再利用余料块数（≥ minReusableWaste，越少越好）
  largestReusableWaste: number // 最大可再利用余料块面积 mm²（越大越好）
}
// 余料三字段关系：wasteArea = 全部余料；可再利用部分由块数/最大块描述；
// 碎料（< minReusableWaste）计入 wasteArea 但不计入可再利用块
// 注：utilization = 已用面积 / Σ(每板规格可用面积)，多规格下按板实算

// 项目 —— 板材库（多选组合，至少 1 种规格）
interface Project {
  id: string
  name: string
  parts: Part[]
  sheets: SheetSpec[]          // 板材库：排样时可用的规格集合（≥1）
  settings: OptimizeSettings
  exportPrefs: ExportPrefs
  createdAt: number
  updatedAt: number
}

// 历史方案条目（cutPlans 表）—— sheets 为板材库快照
interface PlanRecord {
  id: string
  projectId: string
  projectName: string
  plan: CutPlan
  sheets: SheetSpec[]
  createdAt: number
  partNames?: Record<string, string>
}
```

### 6.2 `optimizer/` — 自由排样引擎（最大风险点，最先做）

**核心决策：一套自由排样算法，不区分设备算法。**
- 精密锯场景（满长件、规整件为主）下自由排样结果天然可切；
- 复杂多样部件在实际车间里用雕刻机，不需要"可切性"约束。
- **不做**：切割树、可切性校验、切割顺序编号、设备模式字段。
- **零件间距**：一律 = kerf（一刀切透：锯缝/刀径本身即净距），无额外安全间距字段。

```
optimizer/
├── index.ts          # createOptimizer(): Optimizer 接口（settings 唯一来源 = OptimizeInput.settings）
├── stripPacker.ts    # skyline 排样：按长度降序 → 逐块堆叠（零件向板材一端挤，余料集中在尾部成整块）
├── search.ts         # 模拟退火：扰动（交换/旋转/改顺序），固定 seed，timeLimitMs 预算
├── evaluate.ts       # 字典序评分：① 用板张数最少 ② 余料最集中
└── validator.ts      # 校验：无重叠、无越界、间距 ≥ kerf（任何方案必须过校验才输出）
```

```ts
export interface Optimizer {
  optimize(input: OptimizeInput, ctx: OptCtx): Promise<CutPlan>
}
export interface OptimizeInput {
  parts: Part[]
  sheets: SheetSpec[]          // 板材库（多选组合，≥1；每张板排样时从中选规格）
  settings: OptimizeSettings
  pricing?: PricingPrefs       // 价格核算配置（缺省 = 不核算，totalCost 记 0）
}
export interface OptCtx {
  onProgress?: (p: number) => void
  signal?: AbortSignal          // 用户取消
}
```

**多板材排样规则**（v1.1 评审新增）：
- **开板贪心选型**：需要新开一张板时，从板材库中选择「能装下当前零件、可用面积最小」的规格（省料优先、确定性保持）；该板后续零件继续按 skyline 填充
- **零件指定板材**（`part.sheetId`）：指定了板材的零件只能放入 `sheetSpecId === part.sheetId` 的板；开新板时直接开指定规格
- **板内混合**：未指定（任意）的零件可放入任何规格的板——指定件定板型，任意件可混
- **评价语义**：字典序第①层「用板张数最少」= **物理张数**（与规格无关，一张板就是一张板）；规格只影响利用率/成本核算，不改变张数语义（v1.1 用户确认）
- validator 增加校验：指定板材的零件出现在非指定规格的板 → 拦截

**quality 语义（强度锚定）**：`search.ts` 的迭代预算 = **每零件迭代数 × 零件数**（快速/标准/精细 = 1.2/2.4/7 次/零件），搜索强度与零件数量无关——5000 零件的"精细档"与 50 零件的"精细档"深度一致；总耗时随零件数自然增长（单次重排 ≈ n²×1.76e-5 ms）。上下限保护（200~6000 次迭代）。迭代次数只由输入派生、不读时钟——确定性优先（v1.1：原 timeLimitMs 固定时间语义已废弃——零件多时同时间只能做极浅搜索，档位名不副实；旧数据迁移见 §8.1 v3）。

**评价函数（字典序，产品价值观，唯一且不可配置）**：
1. **用板张数最少**——少一张板永远更好（一张板即成本）
2. **同类聚排**——同样张数下，同零件（同 partId）实例共享边总长越大越好（同尺寸零件整排聚块、不散落，对应 `evaluate.compactness`；驱动"零件贴在一起"的布局整齐度，v1.0 评审用户诉求）
3. **余料最集中**——再比"可再利用余料"：块数越少越好、最大块越大越好（对应 `stats.reusableWasteBlocks` / `stats.largestReusableWaste`）。碎料（< minReusableWaste）算废料，整块才是钱

**成本不参与优化**：`minCost` 不做评价策略——板材规格由用户选定，软件只优化排布；成本由 `pricing/calcCost()` 在排样完成后按 `PricingPrefs` 核算展示（可整体关闭，v1.1 用户诉求）：
- `itemized` 每样精算：板材费（Σ 每张实际规格单价）+ 封边费（Σ 零件封边长度×单价，按米）+ 加工费（板数×单张加工费）
- `byArea` 按面积计价：零件实际总面积 × 面积单价
- `enabled=false`：不核算（totalCost 记 0，UI 不展示成本）
- **PDF 永不输出价格**（成本属商业报价，不入交付图纸）——首页摘要统计与网页方案总览一致，但固定不含成本卡片
- 每零件分摊成本一律按面积占比

**确定性**：模拟退火用固定种子（settings.seed），同样输入必产出同样输出。

**性能验收**（`tests/fixtures/benchmark.ts`）：
- fixture：500 零件（尺寸固定硬编码，覆盖满长件/中小件/同尺寸多数量/旋转冲突件），零件总面积 ≈ 15~25 张 2440×1220 板量级；单板材规格 + 标准设置 + 固定 seed
- 验收四条件**同时满足**：
  1. **时间**：<15s 出结果（含退火预算内优化），进度可取消
  2. **利用率**：≥ 85%（验证退火在预算内真实优化，而非草草收场）
  3. **确定性**：同输入两次运行结果完全一致
  4. **完整性**：全部 500 零件（quantity 展开后）都出现在结果中，且过 validator（无重叠/无越界/间距 ≥ kerf）
- 张数作为 sanity check（落在 fixture 设计的板数区间内），**不是硬约束**
- 注：性能基准集 ≠ 评价函数正确性测试——后者用"已知最优解"的小用例走 Vitest 单测

### 6.3 `exporter/` — 导出（按用途分，与设备无关）

**核心决策：出图只分两种用途，不绑定设备模式：**
- **PDF = 给人看**：交付客户、沟通确认、存档。含零件标注（名称/尺寸/数量）、统计信息（板材数/利用率/零件总面积/封边长度/余料面积/可再利用块/最大余料块，与网页方案总览一致；**无成本**）、美观排版、可打印、水印/公司信息。
- **DXF = 给机器执行**：精确坐标、闭合轮廓、毫米单位、**按切割顺序组织好 + 空行程优化**，机器控制系统直接生成刀路可跑。

**CutPlan 纯净原则**：`CutPlan` 只含裁板数据（零件/板材/排布/统计），**不含任何品牌或导出信息**——导出参数在独立对象 `ExportPrefs` 中，随**项目**存储（项目下所有历史方案共享）。

```ts
// 导出偏好（项目级，不含排样数据）
interface ExportPrefs {
  pdf: {
    watermark: { enabled: boolean; text: string }              // 水印（付费版默认关；免费版强制品牌水印覆盖）
    companyInfo: { name: string; logo?: string; address?: string; phone?: string }  // 公司抬头，进页眉
  }
  dxf: {
    cutDirection: 'climb' | 'conventional'                     // 顺铣/逆铣，默认 climb（顺铣，表面质量好）
  }
  unit: 'mm' | 'cm' | 'in'                                     // 跟随全局设置，导出时可覆盖
}
// 免费/付费联动：导出时判断登录 + 付费状态——免费版强制品牌水印（忽略项目偏好）；付费版按项目偏好（默认关）
```

**PDF 国际化（v1 支持 13 门语言）**：
- 语言清单：英、德、法、意、西、波兰、俄、乌克兰、越（拉丁组 + 西里尔）｜中、日、韩（CJK）｜泰——默认英语兜底
- 程序文案（统计标签/水印/图例/页眉）走 i18n 词条，跟随界面语言（settings 可单独指定导出语言）
- **字体按实际字符集加载**（不依赖界面语言）：渲染前扫描整份文档文本（词条 + 用户输入的零件名/备注 + 格式化动态字符 ×·%m² 等），按字符归组加载字体——拉丁组（Noto Sans，含西里尔）/ SC / JP / KR / Thai 共 5 组；运行时子集化（subset-font，纯 JS+wasm，本地跑不联网）只嵌用到的字符
- **字体分发策略**：
  - 桌面端：**全量打包 5 组字体（~30MB）**，离线零依赖（Tauri 安装包大点可接受）
  - Web 端：**UI 零预加载**（系统字体栈，不引 web 字体）；CJK 字体随构建产物部署在 `public/fonts/`（本地优先 + CDN 兜底，国内网络不依赖外网 CDN），用户点"导出 PDF"时才按需解码 + 子集化（首次含 ~17MB 字体下载，带进度提示）→ IndexedDB 缓存，之后离线导出可用
  - 与 i18n 语言包共用"按需下载 + 缓存"机制
- **CJK 无空格断行**：jsPDF 需实现按字符断行（v1 最大坑）；泰文 v1 保证"不崩不挤字、可读"即可，不追求完美断词
- DXF 图层名/标注用英文（行业惯例，机器不认中文）

```
exporter/
├── toScene.ts       # 排样结果 → 统一场景模型（零件矩形轮廓 + 标注）
├── renderPDF.ts     # 人看版（jsPDF 矢量 + 字体子集化）
└── renderDXF.ts     # 机器执行版（dxf-writer）
```

**DXF 路径组织（v1 必做）**：
1. 提取所有零件闭合轮廓
2. 切割顺序优化：最近邻起手 → 2-opt 局部改进（空行程减少 20~40%）
3. 按切割顺序输出：实体按序排列 + 图层按切割次序组织
4. 所有轮廓统一方向（`ExportPrefs.dxf.cutDirection`，默认顺铣）
5. 首刀切入点默认在角上（避开易崩边位置）

### 6.4 小模块

```ts
// pricing/index.ts —— 纯函数
export function calcCost(
  plan: CutPlan,
  priceBySpecId: Map<string, number>,                  // 板材规格 id → 单价
  prefs: PricingPrefs,                                 // 计价模式（enabled/mode/三项单价）
  edgeBands?: Map<string, ('L'|'R'|'T'|'B')[]>,        // partId → 封边需求（Placement 无此字段，由输入零件传入）
): CostBreakdown
// 输出: 板材数、利用率、余料、总成本（itemized=板费+封边费+加工费 / byArea=面积×单价）、构成明细、每零件分摊
// 注：CutPlan.stats.totalCost 由 optimizer 在排样完成后调用 calcCost 回填
//    （stats 其余字段由 optimizer 直接产出）

// materials/index.ts
export const DEFAULT_SHEETS: SheetSpec[]        // 内置 2440×1220 / 2400×1200 等
export const DEFAULT_KERF = 3
export const DEFAULT_TRIM_ALLOWANCE = 0         // 修边余量默认 0（不修边）

// units/index.ts —— 仅输入输出边界使用
export function toMm(value: number, unit: 'mm'|'cm'|'in'): number
export function formatLength(mm: number, unit: 'mm'|'cm'|'in', precision?: number): string
```

## 7. 特性层规范

每个 feature = 页面/工作流 + Zustand store + 组件。store 只存会话状态，数据实体落 storage。

| 模块 | 职责 |
|---|---|---|
| `projects/` | 项目列表、零件表（行内编辑 + **Excel/文本批量粘贴**："侧板 1200 400 4"）、板材配置、切缝参数、导出偏好（ExportPrefs）、**历史方案列表**（按项目分组：项目名/日期/板材数/利用率/成本；操作：重新打开只读查看 + 重新导出 PDF/DXF、删除；每项目保留最近 50 个方案） |
| `cutting/` | 配置 → 点计算（顶栏按钮，进度条+可取消）→ 结果（中央切割图 + 右栏统计，导出走顶栏入口，参数走 ExportPrefs；布局见 UI-DESIGN §6.2） |
| `recognition/` | 拍照/选图 → 识别（提示将扣 1 次额度，**识别失败不扣**）→ **审查表**（AI 识别格子高亮，用户逐格确认）→ 导入零件表 |
| `licensing/` | 登录/注册（邮箱密码 + Google）/账号状态/剩余次数/购买入口/设备管理（显示当前账号的 3 台设备，可主动退出某台）。状态机：`loggedOut → loggingIn → loggedIn → loggedOut`（被设备淘汰时强制退出） |
| `settings/` | 默认板材、切缝、单位（mm/cm/in）、**价格核算配置**（开关 + 每样精算/按面积两种模式 + 单价参数）、界面语言、**导出语言**（默认跟随界面语言，可单独指定，见 §6.3） |

## 8. 基础设施层规范

### 8.1 `storage/` — 本地持久化
- Dexie (IndexedDB)，Tauri webview 下同样可用，初期仅一套实现
- 表：`projects`（含 ExportPrefs）、`cutPlans`（历史方案，含**零件名快照** partNames，重新导出不依赖当前零件表）、`materials`（自定义板材）、`settings`、`auth`（登录凭证：长期 token + 本机设备指纹 + 到期时间）
- **schema 版本迁移机制**（version + migrate 函数），禁止直接改表
- **v2 迁移**（v1.1 板材库）：`projects.sheet`（单规格）→ `projects.sheets`（数组，旧值包成 `[sheet]`）；`cutPlans.sheet` → `cutPlans.sheets`；`Part.sheetId` 可选字段无需迁移（缺省即"任意"）
- **v3 迁移**（v1.1 计算质量）：`projects.settings.timeLimitMs`（ms）→ `settings.quality`（三档，≤3000ms→fast / ≤8000ms→standard / 其余→fine）

### 8.2 `worker/` — 计算 Worker 消息协议

```ts
// 主线程 → Worker
{ type: 'optimize', id, payload: OptimizeInput }
{ type: 'cancel', id }
// Worker → 主线程
{ type: 'progress', id, progress }
{ type: 'result', id, plan: CutPlan }
{ type: 'error', id, code, message }
```

主线程侧 `useOptimizer()` hook 封装发起/进度/取消/结果。

### 8.3 `api/` — Cloudflare Workers 客户端
- `auth.ts`：登录（邮箱密码）/ Google OAuth / 注册 / 找回密码 / 登出
- `recognition.ts`：调 `/recognize`（携带登录态 + 设备指纹 + 图片）
- `session.ts`：登录态刷新（心跳，滚动设备列表）/ 余额查询 / 设备管理
- **错误码协议**（前端按码提示）：
  - `401 UNAUTHORIZED` → "登录已失效，请重新登录"
  - `402 INSUFFICIENT_CREDITS` → "次数不足，去购买"
  - `422 RECOGNITION_FAILED` → "识别失败，重拍一张"（不扣次）
  - 网络错误 → "网络异常，请联网后重试"
  - 注：设备超限**不报错**——新设备登录自动踢最旧（滚动淘汰），旧设备下次联网才发现被踢

### 8.4 `platform/` — Web/Tauri 适配
- `isDesktop(): boolean`
- `saveFile(bytes, filename)`：Web=浏览器下载（PWA 环境追加 Web Share API 分享入口，一键分享微信/QQ/邮件）；Tauri=原生保存对话框（Android 走 SAF 系统文件选择器，另提供分享面板入口）
- `print()`：Web=window.print，Tauri=原生打印
- `getDeviceFingerprint(): string` —— **设备指纹按端降级**：
  - 桌面：主板序列号 + 磁盘序列号 + MAC 组合（硬件级，不可伪造）
  - iOS 原生（v2）：Keychain 持久 UUID（重装不清）
  - Web：localStorage 生成的 UUID（清缓存即变，重新登录即可）

## 9. 服务端规范（functions/，Cloudflare Workers + D1）

```
functions/
├── auth.ts          # 邮箱注册/登录（Argon2 密码哈希）+ 密码找回 + 登出
├── oauth.ts         # Google OAuth：授权回调 → 建立/关联账号
├── heartbeat.ts     # 登录态刷新 + 设备滚动列表（同一账号最多 3 台，最新 3 台）
├── recognize.ts     # 验登录态 + 查余额 → 调 OCR 适配器 → 成功才扣次 → 返回结构化零件表
├── buy.ts           # 支付回调 → 买断打标（paid）/ 充值识别次数
└── shared/
    ├── session.ts   # 长期凭证签发/验签（Ed25519 签名 token）
    └── ocr.ts       # OCR 供应商抽象：接口 + 工厂，环境变量切换（不写死 Qwen）
```

**D1 schema：**

```sql
users (
  id            text primary key,     -- 内部 UUID
  email         text unique,          -- 邮箱（Google 登录用户也建邮箱记录）
  password_hash text,                 -- Argon2；Google 登录用户为空（禁密码登录）
  google_sub    text unique,          -- Google OAuth subject（未绑定则为 NULL）
  paid          boolean default false,-- 买断标记（付款后置 true）
  credits       int default 0,        -- 识别剩余次数
  created_at    timestamp
)
devices (
  user_id       text,
  device_fp     text,                 -- 设备指纹（见 §8.4 层级）
  last_seen_at  timestamp,
  PRIMARY KEY (user_id, device_fp)    -- 同一用户最多 3 行，超限滚动淘汰
)
recognize_logs ( user_id, image_hash, ts, status, error_code )
```

**授权体系：账号登录 + 长期凭证 + 设备滚动列表**
- 登录：邮箱密码 或 Google OAuth → 服务端签发**长期凭证**（Ed25519 签名 token，含有效期 180 天）
- 桌面离线：登录后本地存凭证 → 离线期间本地验签可用 → 每 24h/启动时联网刷新 → **180 天不联网才需重新登录**（木工车间场景几乎碰不到）
- **设备限制：同一账号最多同时登录 3 台**（桌面/Web/Android 合计；iOS 上线后纳入）——每次登录/心跳把设备指纹写入 `devices`（去重）→ 超 3 台踢 `last_seen_at` 最旧 → 被踢设备下次联网发现不在列表 → 本地失效并提示重新登录
- Web 端也占设备名额（登录态存 cookie/token），换浏览器/清缓存 = 重新登录（账号系统下重登成本低，无"找激活码"问题）
- 未登录 = 体验版（≤20 零件 + 水印 + 无 DXF）；登录 + paid = 全功能
- 防破解边界：**完全不联网的盗版环境防不住**——物理极限，接受（联网即被治理；付费识别按账号扣余额，盗版账号没有余额 = 转化通道）
- 设备管理界面：账号下可见当前 3 台设备，用户可主动退出某台（腾出名额）

**扣次规则（识别链路）**：
- **成功才扣**：`验登录态 → 查余额 → 调 OCR → 成功 → 扣次 → 返回`；失败返回 422，不扣次（用户重拍不心疼）
- 原子性：`UPDATE users SET credits = credits - 1 WHERE id = ? AND credits >= 1`
- 幂等：`(user_id, image_hash)` 唯一约束，重复请求返回缓存结果（防双击/网络重试重复扣次）
- 扣次与 `recognize_logs` 写入同一事务

**OCR 供应商抽象**（不写死 Qwen）：
```ts
export interface OcrProvider {
  recognize(imageBytes: Uint8Array): Promise<RecognizedSheet>
}
export interface RecognizedSheet {
  items: { name: string; length: number; width: number; quantity: number; confidence: number }[]
  rawText: string              // 原始识别文本，供审查表对照
}
export function getOcrProvider(env: Env): OcrProvider  // 按 env.OCR_PROVIDER 选择（'qwen' 默认）
```
- 换供应商 = 改 Workers 环境变量（`OCR_PROVIDER` + `OCR_API_KEY`）+ 新增 adapter，业务编排代码零改动
- 统一 `RecognizedSheet` 契约 = 审查表 ↔ 零件表导入的唯一数据格式

**登录安全**：Argon2 密码哈希（不存明文）；登录/找回密码接口限频防爆破；Google OAuth 用官方 SDK 校验 token；长期凭证私钥只在服务端。

**OAuth 端差异**：Web 端 = 标准 OAuth 重定向流程；**桌面端（Tauri）需系统浏览器打开 Google 授权页 + 本地回调端口**接收 code（tauri-plugin-oauth），回调用 `http://localhost:端口/callback` 白名单。

**OAuth 回调契约（客户端已实现，服务端待建）**：
1. 客户端 `googleLogin()` → 跳转 `GET /api/oauth/google?returnTo=<编码后的当前地址>`
2. 服务端完成 Google 授权后重定向回 `returnTo` 并携带一次性 `?oauthCode=<code>`（短时效，不落 URL 太长凭证）
3. 客户端启动时检测到 `oauthCode` → `POST /api/oauth/exchange { code, deviceFp }` → 返回标准 `AuthResult` → 写入本地凭证，`history.replaceState` 清除一次性 code（防刷新重复兑换）
4. `oauthCode` 兑换失败静默处理（清除参数，用户可手动登录）

**支付**：需要商户资质（微信/支付宝商户号，或境外 Paddle/Lemon Squeezy）。支付回调 → `buy.ts` 置 paid 或充值 credits。

## 10. 三条核心数据流

```
① 优化链路（全离线）：
零件表(features) → OptimizeInput(domain) → worker → createOptimizer
  → CutPlan → toScene() → SVG预览 / renderPDF / renderDXF

② 识别链路（仅此链路联网）：
拍照(recognition) → api.recognize(登录态+图) → Worker 验登录态查余额
  → OCR 适配器 → 成功才扣次 → JSON → 审查表 → 人工修正 → 导入零件表

③ 授权链路（登录 + 周期性联网刷新）：
邮箱/Google 登录 → 服务端签发长期凭证（180 天）→ 设备入滚动列表（最多 3 台）
→ 持久化到 storage/auth → 每 24h/启动时联网刷新：在列表则续用；被踢则本地失效并要求重新登录
```

## 11. 开发顺序（风险优先）

| 阶段 | 内容 | 理由 |
|---|---|---|
| 1 | `domain/types` + `units` + `materials` | 类型先行，地基 |
| 2 | `optimizer` v1 + **500 零件基准测试** | 最大技术风险，最早验证性能与评价函数 |
| 3 | `exporter`（toScene + PDF + DXF + ExportPrefs + 字体子集化） | 核心输出 |
| 4 | `storage` + `projects`（零件录入/批量粘贴）+ **i18n 词条体系**（首个 UI 页面即用词条，避免后期硬编码返工） | 用户第一个能用的界面 |
| 5 | `cutting` 全链路（优化→预览→导出） | 主线打通，MVP 成形 |
| 5.5 | `projects` 历史方案列表 | 高价值低成本，结果页后顺手做 |
| 6 | worker 化 + 进度/取消 | 体验升级 |
| 7 | Tauri 打包（Windows/Linux 安装包，含 5 组字体全量） | 桌面端落地 |
| 8 | 服务端（auth/oauth/heartbeat/recognize/buy）+ licensing（登录/设备管理） | 商业化闭环 |
| 9 | recognition 特性（拍照→审查→导入） | 增值服务上线 |
| 10 | 打磨（打印、导出偏好、i18n 翻译分批、Google OAuth 完善、历史方案上限策略） | 收尾 |
| 11 | Android 原生打包（Tauri APK）：相机插件（Kotlin，兜底 input capture）+ 文件保存走 SAF + 分享面板（导出后一键分享微信/QQ/邮件）+ Android 设备指纹（私有存储 UUID + Android ID）+ 切割图移动端降级（静态预览/分板查看）+ quality 默认降档 + minSdk 策略 + 真机 500 零件基准实测；Web 端同步补 PWA 能力（manifest + SW 离线预缓存 + 安装引导，作为补充分发渠道） | **Android 必做（与 Windows 同等重要）**；依赖 8/9 服务端与识别链路完备后价值最大，亦可提前并行验证 |

## 12. 领域术语表

| 术语 | 含义 |
|---|---|
| 长 / 宽 | 零件与板材一律"长×宽"（**不是**宽×高），两者同语义：**方向标签**——长度边沿 X 轴（纹理方向）、宽度边沿 Y 轴，不要求 length ≥ width |
| 切缝 | 统一参数：精密锯的锯缝 / 雕刻机的刀径，本质都是"每刀吃掉多宽"；零件间净距 = kerf |
| 满长件 | 长度 = 板材长度的部件（如 2440×400 侧板） |
| 余料集中 | 同板数下，可再利用余料块数越少、最大块越大越好；碎料（<minReusableWaste）算废料 |
| 字典序评价 | 先比用板张数，再比余料集中度，顺序不可颠倒 |
| 账号即身份 | 邮箱/Google 登录账号 = 身份 + 买断标记 + 识别次数，服务端 users 表存权威数据；同一账号最多同时登录 3 台设备（滚动淘汰） |
| 审查表 | AI 识别结果的人工修正界面，AI 格子高亮、用户逐格确认 |

## 13. 已知待确认项（不阻塞开工）

**已确认：**
- ✅ 默认切缝（kerf）= **3mm**（精密锯锯路 / 雕刻机刀径共用字段，用户可在设置中覆盖）；**零件间净距 = kerf**，无额外安全间距
- ✅ 修边余量（trimAllowance）：四边全修，**默认 0（不修边）**，用户可设置；可用区域 = (长−2×trim)×(宽−2×trim)
- ✅ ~~板材留边（sheetMargin）~~：v1.1 精简中**已删除**——与修边数学作用相同（边缘扣除），并入修边语义
- ✅ 旋转控制收敛到**零件级勾选**（grain='any'），全局开关（allowRotation）**已删除**——双开关 AND 逻辑造成"勾了不转"困惑，零件级已完整表达纹理约束
- ✅ 免费体验版边界：≤ 20 零件 + PDF 品牌水印 + 无 DXF（登录付费后 Web/桌面全端全功能）
- ✅ 账号系统：邮箱注册 + Google OAuth 登录；同一账号最多同时登录 3 台设备（滚动淘汰）
- ✅ PDF 国际化 v1：13 门语言（英/德/法/意/西/波兰/俄/乌克兰/越/中/日/韩/泰），字体分组 + 运行时子集化；桌面全量打包 ~30MB，Web 导出时按需下载缓存
- ✅ OCR 供应商抽象：环境变量切换，不写死 Qwen
- ✅ 扣次规则：成功才扣 + 幂等去重
- ✅ 目标平台优先级：**Android 与 Windows 同等必做**，路线 = **Tauri 原生打包（APK）**（见 §3；Tauri 同一代码可出 iOS，为 iOS 留后路）；**Web 端同时具备 PWA 能力**（可安装/离线/扫码即用，补充分发渠道，非移动端主线）；**iOS 为后续考虑**（已知风险：iOS 系统可能回收 7 天不活跃站点的 IndexedDB 数据）

**待确认（v1 开工前不阻塞，默认值先按下方括号内假设实现）：**
- 异形零件（圆弧/斜角）为 v2 预留，v1 仅矩形
