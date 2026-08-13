# FIX-PLAN.md — 代码全面体检报告与修复计划（2026-08-13）

> 来源：全量代码审查（domain / features / infra / ui / tests / 配置），含运行验证。
> 基线：`tsc -b` 零错误、17 个测试文件 150 用例全绿、500 零件基准 1456ms / 利用率 91.88%。
> 硬性违规扫描：`as any` / `@ts-ignore` / 空 catch / domain 层浏览器 API / `Math.random` —— **全部为零**。
>
> 本文档只列问题与方案，**未改任何代码**。标注 ⚠️ 的条目需产品拍板后才动手（AGENTS.md 纪律）。

## 0. 总览

| 级别 | 数量 | 内容 |
|---|---|---|
| P0 功能正确性 | 4 | B1 旋转件误报无法排样、B7 DXF 跨板切序、B6 防抖竞态丢编辑、B2 余料判定虚增 ⚠️ |
| P1 显示/交互缺陷 | 5 | B5 单位链路、B3 板材覆盖不显示、B4 审查表撞键、B9 错误信息不可读、B8 迁移语义 |
| P2 改进项 | 9 | I1~I9 见 §3 |

---

## 1. P0 — 功能正确性缺陷

### B1. 可旋转零件"仅旋转后才能放入"被误报 `PART_TOO_LARGE`（已实证）⭐ 最严重

> 本节为深度分析（2026-08-13 二次研究），含根因拆解、方案取舍与验证门禁。
> **结论先行**：这不是单个函数的错，而是**"可旋转零件的可行性"在三层之间无人负责**（责任空洞）。修复原则 = **可行性判定下沉到 packer 最底层 + 单一共享谓词**，上层（search）继续只负责质量优化。

---

#### 1. 问题复现（实证）

板材 2440×1220，零件 1210×2430 勾选「可旋转」→ 旋转后 2430×1210 完全放得下，但计算直接抛 `零件 p1 大于板材库中可用规格`。已用脚本复现（`vite-node` 直调 `createOptimizer`）。

#### 2. 根因：三层各自假设了不同的"旋转归属"，导致责任空洞

架构文档 §6.2 的职责划分：`search.ts` 负责扰动（交换/**旋转**/改顺序）；`stripPacker.ts` 是"给定方向已定的有序实例序列 → 布局"的纯函数；`optimizer` 负责预检（可行性闸门）。三层合起来必须保证：**预检通过的输入，任何搜索路径都能排出**。

实际三层各有一个假设，组合起来刚好漏掉"旋转后才可行"的实例：

| 层 | 代码 | 假设 | 后果 |
|---|---|---|---|
| ① 预检 | `optimizer/index.ts` | 方向恒为未旋转（`expandInstances` 全部 `rotated=false`，只验未旋转槽尺寸） | 旋转-only-fit 实例在此被拒（**报错原因错误**） |
| ② packer | `stripPacker.ts` | 方向是上游定好的、不可变；"当前方向放不下" = "排不了" | 从不尝试旋转，`pickSpec` 同样只测当前方向 |
| ③ search | `search.ts` | 旋转由 ROTATE/ROTATE_GROUP 扰动负责 | **初始阶段（15 个序）从不旋转**；且初始全失败直接走退化分支返回空结果，**退火根本不会执行** |

三个细节让"只修某一层"必然失败：
- **search 永远救不了初始可行性**：初始阶段 `tryPack` 全 null 即返回空结果（`bestResult` 为 null 时直接走"退化输入"分支），退火在它之后、永远不会跑到。已实证：绕过预检直调 search，返回 0 板。
- **n=1 时 search 完全没有扰动**：`anneal` 内 `if (n <= 1) break`，单零件问题连 ROTATE 都做不了。
- **预检与 packer 是两套独立的"能不能装"判定**：本次是预检过宽/过窄与 packer 行为不匹配；这种重复实现本身就是 bug 温床（漂移类缺陷）。

#### 3. 修复方案（最佳实践：可行性下沉 + 单一事实来源）

**设计原则**：
1. **可行性判定只有一份**，且放在 packer 层（最底层）：`stripPacker.ts` 导出纯谓词 `fitsSlot(slotLen, slotWid, usableLen, usableWid, kerf)`（单方向，含 EPSILON）与 `fitsAnyOrientation(item, entry, kerf)`（rotatable 时两个方向都试）。预检与 pickSpec 都调它——杜绝"预检说能装、packer 装不下"这类漂移 bug。
2. **packer 只做"保证性 fallback"，不做贪婪旋转**：当前方向可行就完全保持现状（历史行为逐字节不变）；只有当前方向在**所有合格板**（含 `sheetId` 约束）都放不下时，才用旋转方向重试一轮；仍不行才开新板（`pickSpec` 先测当前方向，无规格匹配且 rotatable 时再测旋转方向）。确定性 = 严格"先原方向、后旋转"，无随机。
3. **search 退化守卫改抛错**：初始阶段全失败（修复后不可达）改为 `throw new Error(...)`，让契约漂移在正确的位置炸，而不是落到 validator 的误导信息。

**逐文件改动**：

```text
stripPacker.ts
  + export function fitsSlot(...): boolean                      // 单方向可行性（唯一谓词）
  + export function fitsAnyOrientation(item, entry, kerf)       // 双方向（rotatable）
  - PackItem 增加可选字段 rotatable?: boolean                  // 缺省 false = 不可旋转
  ~ packSequence 主循环：当前方向全板失败 →（rotatable）旋转方向全板重试 →
    仍失败 → pickSpec(当前方向) / pickSpec(旋转方向) 开新板
  ~ 旋转时生成副本 { ...item, slotLen: swapped, slotWid: swapped,
    len: swapped, wid: swapped, rotated: true } 放入 placements

optimizer/index.ts
  ~ 预检改为按 part 粒度（天然拿到 name，顺带修 B9）：
    validParts.some(part => library.some(spec =>
      spec 匹配 part.sheetId && fitsAnyOrientation(part槽尺寸, spec, kerf)))
    失败报错带名称尺寸：「零件"侧板"1210×2430 任何方向都放不进板材库」

search.ts
  ~ 退化分支：return { sheets: [] } → throw（防御深度，正常不可达）
```

**⚠️ 关键易错点（务必写进实现）**：packSequence 旋转时**必须产生副本**，不能原地改 `item`。search 的 `mutated = [...curItems]` 只复制数组、不复制对象，curItems 与调用方共享实例引用——原地改会把旋转状态泄漏进 search 的"当前解"，破坏退火状态机。

**为什么不做贪婪双方向（每次放置都试两个方向取更低位）**：会覆盖 search 的 ROTATE/ROTATE_GROUP 定向意图（"同类同向整排"的整齐度控制失效）、改变基准输出需全量重验、且超出最小改动纪律。列为演进项（见 §4）。

#### 4. 备选方案与取舍（研究记录）

| 方案 | 思路 | 结论 |
|---|---|---|
| A 贪婪双方向 | packer 每次放置两方向取更低位 | 可能提升密度，但与 search 旋转扰动冲突、改基准输出；**不做**，演进项 |
| B 初始序含旋转变体 | heuristicOrders 生成部分已旋转的序 | 2^k 组合只能采样、不保证可行、不解决预检；**不做** |
| C 仅放宽预检 + 靠 search 旋转 | 可行性寄托于搜索运气 | n=1 无扰动、初始阶段到不了退火；**已实证失败** |
| **D（采用）** | 预检/选型共用单一谓词 + packer 保证性 fallback + search 守卫抛错 | 可行性有数学保证、历史行为逐字节不变、职责清晰 |

#### 5. 验证门禁（AGENTS.md §7）

1. 新增单测（`optimizer.test.ts`）：
   - 旋转-only-fit（1210×2430 'any'）→ 成功、`rotated=true`、过 validator；
   - 同尺寸 `alongLength` → 仍 `PART_TOO_LARGE`（fallback 不越权）；
   - 旋转-only-fit + `sheetId` → 只进指定规格板；
   - 两方向都可行 → 保持原方向（`rotated=false`，钉死"不贪婪"行为）；
   - packSequence 级：入参实例对象不被修改（引用不变性）；
   - 确定性：同输入两次运行结果完全一致。
2. **500 零件基准回归 + 张数锚点（2026-08-13 实证修订）**：fallback 触发条件是"塞不进当前 skyline 状态的现有板"，而非"塞不进空板"——即使基准集可旋转件全部原方向可放进空板，排样中途也必然触发（实测初始序阶段触发 87 次、8/15 序输出不同），“逐字节一致”不可达，此门禁作废。且 fallback 打开"旋转填侧洞"的搜索空间后，启发式序从 25 张降到 24 张（字典序第①层更优）。**修订门禁**：修复后 `stats.sheetCount ≤ 25`（不劣化）+ 其余四条件（<15s / ≥85% / 确定性 / 完整性）不变；记录新基线（张数/利用率/耗时）作为后续确定性回归锚点。
3. `npx tsc -b` + 全量 `npm test`。
4. **文档同步先行**：ARCHITECTURE.md §6.2 stripPacker 一行注明"可旋转零件原方向不可行时 packer 自动旋转 fallback（仅保证可行性，不参与质量决策）"；本项不改评价函数（evaluate.ts 字典序规则不动，无需用户确认），但按 AGENTS.md §7 算法变更纪律需先更文档再动手。

---

### B2. ⚠️ 余料"可再用"判定在板材右/上边缘虚增一个 kerf（已实证）

**现象**：板右侧剩 200mm 槽宽余料条 → 被计为 1 个可再利用块，但真实可用宽只有 197mm（200−kerf3）。`reusableWasteBlocks` / `largestReusableWaste` 在边缘区域系统性偏乐观，且这两个值直接展示在统计面板和 PDF 摘要里。

**根因**：`evaluate.ts` 的 `regionStrips`/`containsSquare` 在**槽空间**判定。槽空间 = 可用区 + 右/上各一条 kerf 走廊；贴右/上边缘的余料区域白捡这层 kerf。

**修复方案**：`containsSquare` 判定前把区域条带裁剪到真实可用矩形（条带右缘 cap 到 `slotLen−kerf`、顶缘 cap 到 `slotWid−kerf`），`area` 同步按真实空间累计。注意 `wasteArea` 统计是独立计算的（totalUsable−usedArea），不受影响。

**⚠️ 需确认**：`evaluate.ts` 属 AGENTS.md §4.3"改动必须问用户"的范围。本项不改字典序**规则**（层级/顺序不动），只修第③层的**测量口径**——仍请拍板后再动。

**验证**：单测——边缘 197mm 条带 → 0 块；内部 200×200 → 1 块；benchmark 回归（块数/最大块可能变化，利用率/张数/确定性不变）。

---

### B6. 防抖写库竞态：500ms 窗口内重开项目，最后一次编辑丢失（D4 关联）

**现象**：编辑零件 → 500ms 防抖窗口内返回列表并重开项目 → `openProject` 从 IndexedDB 读到**旧**数据；随后 pending 定时器把新数据落库，但 store 里 `current` 已是旧快照；此时再编辑，会基于旧快照整体覆盖，**第一次编辑永久丢失**。

**根因**：`projectStore.scheduleSave` 防抖只挂定时器，`openProject` 读取前不 flush pending 写。

**修复方案**：`scheduleSave` 时把待写快照存入 `pendingSaves`（Map<id, {timer, snapshot}>），`openProject(id)` 先 `await flushPendingSave(id)`（清定时器 + 立即写库）再读。改动集中在 projectStore 一处，约 15 行。
与 BACKLOG D4（关闭应用丢写）是同一族问题：本修复覆盖"应用内重开"场景；D4 的 pagehide/Tauri close 出口仍待产品拍板，可顺势在本次一起做掉（D4 选项 a）。

**验证**：planStore/projectStore 单测加用例——编辑后立即 openProject，读到的 parts 含最新编辑。

---

### B7. DXF 切割顺序跨板交错（机器执行正确性）

**现象**：`renderDXF` 对**全部板**的零件合并做一次最近邻+2-opt。板间 100mm 偏移使其大概率按板聚簇，但不保证——多规格板宽不同、一块板尾刀恰离下块板头刀更近时，切割顺序会在板间来回跳。机器一次只切一张板，交错的刀序无法直接执行。

**修复方案**：按 `sheetIndex` 分组，组内分别 `optimizeCutOrder`（最近邻+2-opt 不变），按板序拼接输出。逻辑改动 <10 行，行为更确定。

**验证**：exporter 单测——构造两板方案，断言 DXF 实体绘制顺序的板号单调不交错；现有 DXF 测试回归。

---

## 2. P1 — 显示 / 交互缺陷

### B5. ⚠️ 单位链路两处断裂（规格："unit 跟随全局设置"）

1. **导出**：`ExportPrefs.unit` 在项目创建时写死 `'mm'`，且 `updateExportPrefs` 在全工程**没有任何调用方**（导出偏好编辑 UI 属阶段 10 未做）→ 全局切 cm/in 后，PDF/DXF 仍按 mm 出图，与规格"跟随全局设置，导出时可覆盖"不符。
   **修复**：`buildPdfLabels`/`renderDXF` 调用处把 `project.exportPrefs.unit` 改为可空回退——导出时读 `settingsStore.settings.unit`（全局）作为缺省；`ExportPrefs.unit` 语义保留给阶段 10 的"导出时覆盖"UI。
2. **零件表输入**：`PartsWorkspace` 长/宽输入写死 `toMm(x, 'mm')`，表头无单位标识 → 全局单位为 cm/in 时用户输入语义混乱（输入 120 到底是 120mm 还是 120cm？）。
   **修复（二选一，⚠️ 需产品拍板）**：a) 零件表跟随全局单位（表头加单位后缀、输入 `toMm(x, unit)`、回显按单位换算）；b) 零件表恒 mm（行业习惯，表头标注「mm」明示）。建议 b（木工现场 mm 是母语），改动最小。

### B3. 板材库面板不显示"内置规格的项目级覆盖"

**现象**：在板材库面板编辑内置规格（如把颗粒板改成 2000×1000）→ 排样实际用新尺寸，但面板列表仍显示 2440×1220（显示数据只取自定义库+内置库，同 id 的项目覆盖被跳过）；取消勾选再勾上，覆盖**静默丢失**（重新勾入的是内置默认值）；再点编辑看到的也是默认值。

**修复**：`SheetConfigPanel` 构建显示表时项目 `sheets` 覆盖优先（先放项目内条目，再补自定义/内置）；`toggleSheet` 勾选时优先复用项目已有的覆盖条目。

### B4. 审查表 `rowKey` 撞键（已实证）

`ReviewModal` 行 key = `name-length-width`，AI 识别出两行同名同尺寸零件（很常见，如分两行写的"侧板 2440 400"）→ React key 重复 → 行状态错乱风险。**修复**：rowKey 加行索引。

### B9. `PART_TOO_LARGE` 错误信息只有 partId

报错文案 `零件 part-1723… 大于板材库中可用规格`——用户看不懂是哪个零件。**修复**：预检报错带零件名称 + 尺寸（`零件「侧板」1210×2430 超过所有板材规格…`），optimizer 预检处 join `validParts` 的 name 即可。

### B8. storage v4 迁移清洗与 `qty()` 语义不一致

v4 迁移用 `Math.trunc(q)`：负数/NaN 不归 0，与 `qty()`"非有限/负数 → 0"语义有缝。**修复**：迁移函数改调 `qty()`（domain 纯函数，可在迁移里用）。影响面仅限存量脏数据，但"迁移与入口语义一致"是原则问题。

---

## 3. P2 — 改进项（不阻塞，可随手做）

| # | 位置 | 问题 | 方案 |
|---|---|---|---|
| I1 | `palette.ts sheetPartColors` | 第二次比较仍对 `colors[i-1]`（恒 false，死代码）；注释承诺"最多试 12 次"未实现 | 实现循环避让（与前一放置不同色为止，上限 12 次），或简化注释 |
| I2 | `planSnapshot.ts` | 注释"以首见为准"但代码取 `Math.max` | 统一为"以首见为准"（删 max 逻辑），异常路径简化 |
| I3 | `StatusBar` | 网络状态恒显示"在线"（未接 `navigator.onLine`） | 接 online/offline 事件 + `navigator.onLine` 初值 |
| I4 | `main.tsx` | `system` 主题一次性求值，系统切换深浅色不跟随 | `matchMedia('(prefers-color-scheme: dark)')` 加 change 监听 |
| I5 | `CutDiagram` 大图 | 滚轮缩放以左上角为原点（应锚定光标）；wheel 为 passive 未 preventDefault | 以光标为锚点换算 pan；容器已 overflow hidden，可接受现状，仅调锚点 |
| I6 | `runOptimize` 内联回退 | fallback 路径无中间进度（只在结束时 onProgress(1)） | 把 `cb.onProgress` 传进 optimize ctx |
| I7 | `infra/fonts` | CJK+泰文并发下载时 onProgress 互相覆盖（百分比来回跳） | 两路各占 0.5 权重分段上报 |
| I8 | `renderDXF` | 零件文字高度固定 50mm，小零件文字溢出轮廓 | `min(50, len/5, wid/2)` clamp |
| I9 | `runOptimize` | 每次计算新建 Worker（重复加载脚本/WASM 级开销） | Worker 单例复用（消息协议已带 id，天然支持） |

---

## 4. 已排除项（审查确认无问题 / 已有台账，不重复立项）

- **`storage.listPlans` 的 `reverse().sortBy()` 方向**：已实证 Dexie 4 返回降序，契约正确。
- **CSV 导入"替换"语义**：确认文案已明示"替换当前 N 个零件"，无误导。
- **search.ts `curResult`**：在 `bestResult = curResult` 处被读取，非死代码。
- **`specOf` 静默兜底 vs toScene 抛错（4 处不一致）**：BACKLOG #5 在案，待确认，不重复。
- **D4 防抖丢写（关应用场景）**：BACKLOG 在案待产品拍板；B6 只覆盖"应用内重开"场景。
- **硬规则扫描**：`as any`/`@ts-ignore`/空 catch/domain 浏览器 API/`Math.random` 均为零。
- **i18n zh/en 词条**：完全对称（脚本比对 0 缺失）。

## 5. 建议执行顺序与验证门禁

| 批次 | 内容 | 验证 |
|---|---|---|
| 1 | B1（三层修复）+ B9（顺手，同函数） | 新增单测 + benchmark 回归（张数 ≤ 25，记录新基线） |
| 2 | B2 ⚠️ 拍板后修 + B7 | evaluate 单测 + DXF 顺序单测 + benchmark 回归 |
| 3 | B6（联动 D4 拍板）+ B3 + B4 + B8 | projectStore/迁移单测 |
| 4 | B5 ⚠️ 拍板后修 | 导出单位回归（exporter 测试） |
| 5 | P2 改进项择需 | 逐项小测 |

**全程门禁**：每批次 `npm test` 全绿 + `npx tsc -b` 零错误；动 optimizer/exporter 必须跑 500 零件基准（AGENTS.md §7）。
**待拍板清单**：B2（evaluate 口径）、B5-b（零件表单位策略）、D4 是否顺带实施。
拍板结果请同步 `docs/BACKLOG.md` 后再开工。
