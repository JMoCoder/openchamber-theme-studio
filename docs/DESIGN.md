# 主题工坊（Theme Studio）设计定稿

> 依据：在 OpenChamber 2.8.0 上对「主题能改什么」和「怎么生效」的实测（研究记录留在作者本地，未随公开仓库发布）；147 个字段的分类见 `data/fields.json`。
> 宿主基线：OpenChamber 2.8.0。凡与研究文档冲突，以实测为准并回写本文。

## 0. 一句话

右侧边栏里的**主题**编辑器：一套主题 = **配色 × 风格 × 微调 × 精修**，外加可复制的字体和布局搭配建议。选色或编辑即预览；独立作品用「保存为文件」留下。面板即时更新，整窗需等宿主重读；实际窗口更新与文件落盘分别判断。

## 1. 无损边界（不可突破）

- 只写自己命名空间的主题文件：`~/.config/openchamber/themes/theme-studio-*.json`，以及用户主动导出的文件。不改宿主设置、不改用户其他主题、不改程序文件。
- 命名作品仅在能确定窗口选中它时临时改写；同一次写入须保留 ID 和原始字节，供「还原」使用。未参与预览的作品不动（包括修改时间）；工坊的作品入口始终读取原作。
- 不注入、不打补丁、不走调试口、不调宿主内部 HTTP、不用 `!important`、不把未知键当成宿主样式配置。扩展自身的可编辑作品只放进约定的 `themeStudio` 附加字段。
- 不需要删除权限：预览起点仍在时可还原原配色（见 §3）。卸载会清除扩展存储；0.3.1 后可从保留的预览文件找回已验证的起点，但不恢复只存在于扩展存储的旧草稿。
- 做不到的维度放在 README，不在侧栏占一块空间，也不做假控件：背景图/渐变/纹理、直角、边框粗细、硬投影、独立标题字体、700+ 字重、独立行高字距、全局动效、窗口透明。

## 2. 清单与授权

```jsonc
"contributes": {
  "panel": { "entry": "panel/index.html" },          // 只有右侧边栏面板
  "filesystem": [
    "~/.config/openchamber/themes",                    // 仅用于列目录（名字）
    "~/.config/openchamber/themes/theme-studio-*.json", // 槽位与另存的主题
    "~/Downloads",                                    // 先 stat：仅向已存在的下载目录导出
    "~/Downloads/openchamber-theme-studio-*.json",     // 导出
    "~/下载",
    "~/下载/openchamber-theme-studio-*.json"
  ]
}
```

- 不声明 statusSection（不进工作状态栏）、page、service、background、capabilities。
- `id: theme-studio`，`name: Theme Studio`，`icon: palette`，`engines.openchamber: ">=2.8.0"`。
- 宿主允许面板运行、但文件能力不可用时，降级为面板预览 + 复制 JSON。安装时若宿主因尚未批准扩展而不启用面板，则没有编辑入口。
- 主题目录的精确授权用于检查目录与枚举文件名；只读取工坊命名空间的候选，以识别自己创建的文件。
- 下载目录只有文件通配时，`stat` 父目录会被拒绝，而 `writeFile` 会创建缺失的父目录。额外精确声明父目录供 `stat`；SDK 没有按操作的授权，但扩展代码不对这两个路径 `listDir` 或写入，也不尝试写不存在的目录。

## 3. 生效通道

### 3.1 槽位文件

每个明暗一份：`theme-studio-live-light.json`、`theme-studio-live-dark.json`。文件有**两种身份**，由 `metadata.id` 决定，随时可换：

| 身份 | `metadata.id` | 作用 |
| --- | --- | --- |
| **槽位** | `theme-studio-live-<variant>` | 宿主主题列表里的一个普通主题。用户在「设置 → 外观」选它一次，之后长期生效。 |
| **试穿** | 当前内置主题的 ID（如 `flexoki-light`） | 官方支持「同 ID 自定义覆盖内置」。不必到设置里另选主题；换回槽位 ID 后，宿主重读并还原内置主题。 |

- 快照唯一匹配内置主题时可暂借槽位；唯一匹配命名作品时直接预览到该作品。选中未知主题或有命名作品参与同色歧义时只更新小样。宿主不提供当前主题 ID，颜色相同不是选中某个文件的证明。
- 文件名不变、只换 ID，所以还原不需要删除权限。
- 主动编辑即可开始整窗预览，不限标签：编辑的那一版**按它自己的明暗完整解析**后，写进窗口真实明暗正在用的那一份文件（`metadata.variant` 保持窗口的明暗，另附 `previewVariant` 记住来源）；不碰另一份文件。预览进行中切标签，窗口跟着换；没有预览时切标签不写。用户在宿主里切换真实明暗时不自动补写。关闭面板、保存作品、重启均不等于还原；页脚「还原」一次处理两版。
- 旧版本写过的暂借标记继续识别。自有槽位文件与独立命名作品是两类文件，保存、还原、列表移除分别有自己的目标。
- 顶层附带 `themeStudio: { schemaVersion, project, rev, writer, borrowedApplied?, borrowBaseline?, previewVariant?, origin? }`。预览时的 `origin: { writer, raw }` 保存同一轮 `writer` 的原文；仅槽位允许 `raw: null` 表示原先无文件。重开时核对来源、文件归属、明暗和大小，拒绝把其他作品或另一层预览当作起点。普通文件与起点各不超过 512 KiB，只有预览文件为原文引号转义额外留量。2.8.0 的文件 API 保留信封，宿主主题渲染器忽略该字段。

### 3.2 识别当前主题

宿主不给主题 ID，但给颜色原值快照。用这 24 个**直取原值**的 token 全等比对（忽略大小写）：
`elevated foreground muted subtle border hover selection focus primary elevatedForeground active primaryForeground success warning error info syntaxKeyword syntaxString syntaxNumber syntaxFunction syntaxType syntaxComment syntaxVariable syntaxOperator`。
（`background`、`mutedSurface`、`*Text`、`selectionForeground`、字体类是混合或推导值，不参与。）

候选包括本明暗的自有槽位、命名作品和 62 个随包内置主题（源自 v2.8.0）。当还原前没有文件时，工坊不能删槽位；它把临时槽改回自己的 ID，并在仅属于该槽的默认配色副本上微调一个语法运算符色通道，以避开已知同色指纹。不改出厂主题、作品原色或已经存在的起点文件。

2.8.0 的 SDK `ready.theme` 只给出窗口模式和颜色，未给出所选主题 ID。匹配用磁盘上宿主实际显示的配色（包含预览色）；作品列表和编辑读取另取原作。命名作品与内置、工坊槽或其他作品同色时，不能靠最近一次写入确认身份，也不试写任何候选。存在无法通过授权读取的外部主题文件时，无法排除它与已知候选同色，因此也不自动写。已明确不匹配工坊候选的外部主题只显示小样。旧版槽与内置的同色（不涉及作品）仍保留一次有界的自有槽恢复探测。到原生外观选用不同配色可解除同色歧义。验证见 `src/core/studio.test.mjs` 的 `post-restore matrix` 和命名作品同色用例。

### 3.3 连接状态（每个明暗各一份）

| connection | 含义 | 主操作 |
| --- | --- | --- |
| `checking` | 正在确认主题目录和槽位文件，尚不能判断如何应用 | 等待读取；不写主题 |
| `read-error` | 没能读清文件状态；这不是写入失败，也不是主题身份无法识别 | 重新检查文件 / 复制 JSON；草稿保留 |
| `unavailable` | 没有文件授权、宿主不支持或默认目录不存在 | 复制 JSON；有宿主连接时也可重新检查 |
| `off` | 槽位文件不存在 | 当前内置主题可唯一识别时，主动编辑可开始预览；否则仅小样 |
| `idle` | 槽位存在但没被选用 | 同上；已有文件必须先核对身份与内容 |
| `tryon` | 正在暂借某个内置主题的身份 | 编辑继续预览；「还原」结束本轮预览 |
| `active` | 宿主正选用槽位 | — |
| `hidden` | 该明暗不是宿主当前模式，无法确认；状态栏只显示窗口真实明暗那一份的状态 | — |
| `conflict` | 文件被别处改过 | 载入它 / 用我的覆盖 |
| `prepare-error` | 写前准备未完成，例如无法取得协作锁，或预览起点无法找回 | 可确认借用内置 ID 的旧残留可主动恢复内置配色；其他无可靠起点的情况只提供保留文件的指引，不提供无效重试 |
| `error` | 已发出写请求，看到失败且读回仍为原内容 | 重试原操作 |
| `verify-error` | 写请求可能已生效，读回不足以确认 | 重试先核对原目标与版本，不自动重发 |
| `saved-error` | 无法核对选中的作品文件或它的原作 | 重新检查文件；不写未经验证的起点 |

`sync`：`idle → preflight → writing → waiting → applied`。写入并读回后，超过 12 秒未在快照里看到新颜色 → `timeout`。仍接受迟到快照并自动确认。这个期限与单次 SDK 请求的 6.5 秒无关：后者超时只对幂等的槽位／目录读取再试一次，不自动重发写请求。
24 项未变化（仅改名称、身份或其他未暴露字段）时可确认文件已写，但不声称宿主已更新；Web 的宿主事件流未就绪时只能提示刷新，不调用内部接口。

### 3.4 草稿、预览、保存与还原

- **草稿**：编辑即时反映在面板；存 `host.storage`（instance，去抖），关面板、重开、重载不丢。
- **实时**默认开。已连接的工坊主题可继续写自己的槽位；能唯一识别正在使用的内置主题时，第一次主动改色即可暂借。尾沿合并快速输入，不靠定时轮询猜测当前主题。关闭整窗预览时只改草稿；重新打开开关本身不会补写旧改动。
- **命名作品（0.4.0）**：只有能唯一识别当前窗口模式选中的作品时才允许临时改写；保持文件路径、主题 ID、显示名称和属浅／深版不变，不动其他作品。第一笔写入必须把原始 UTF-8 全文与对应 `writer` 一起写进同文件 `themeStudio.origin`，读回核对；以后继续试色沿用第一份备份。不存在授权范围内的删文件操作，也不写原生外观设置。同一服务器上使用该作品的其他窗口也看到预览。
- **跨明暗预览（0.3）**：2.8.0 的 `ensureThemeById` 在浅色模式只接受 `variant=light` 的主题，但颜色不受限；因此把目标版本的颜色写进当前明暗的文件即可整窗看到。宿主仍按窗口明暗派生的是 `.dark` 类、`color-scheme`、提供方图标反相、阴影与少数组件底。载入、另存、导出、复制一律取作品真正的两版，`previewVariant` 不等于文件明暗时，不把文件颜色当作该明暗的作品。写入等待中的新操作合并到最后一次；超时后新的点选会重写，不会被吞掉。
- **只读边界**：切页、切语言、打开面板、文件重查、用户切换宿主明暗都不写主题文件。浅／深编辑标签只在已有预览时跟随。文件状态未读清、没有可验证的目标或无权限时不退成「写个个人槽」；已挂载的面板仍可编辑、看小样和复制。重查成功后需新一次主动编辑。只有保存/导出操作才创建命名副本。
- **保存为文件**＝原 `saveAs`。复制当前作品的指定明暗到主题目录；不确认暂借，不改变当前选项，不覆盖同名文件。长期使用命名副本由用户在原生外观里选择。无全窗预览能力并不妨碍看小样。
- **还原**：先取消尚未送出的预览；对浅、深槽位及有有效预览备份的命名作品，等正在进行的写入结束后分别核对、恢复。命名作品逐字节写回原内容，未参与预览的作品和下载副本不动。原先没有槽文件时，撤下暂借的内置 ID（SDK 无 unlink）。草稿回到起点；用户在原生外观自行更改的选项不动。文件冲突或不可确认时不能显示成功。
- **原字节与文件时间**：2.8.0 的 `packages/sdk/src/host.ts` 提供 `writeFile(path, content)` 与 `stat(path)`，后者能读 `mtime`。`packages/web/server/lib/guests/files.ts` 把 UTF-8 内容写到临时文件再原子替换，未提供设置文件时间的参数或方法。还原因此逐字节恢复内容，文件修改时间会更新。
- **卸载不是还原**：在 v2.8.0，宿主先撤销扩展授权和存储，再发宿主内部的停用通知（`packages/web/server/lib/guests/{install,routes}.ts`）；面板没有可在卸载前完成还原的 SDK 回调。预览文件在主题目录，不随扩展删除。`pagehide` 也会在正常关闭或重载时发生，不能拿来判断卸载。状态说明和清理入口须提醒「先还原、看到原配色后再卸载」；不能把移除面板称为恢复窗口。
- **误卸载后重装**：从经过校验的 `origin` 找回本轮备份，不依赖扩展存储；打开、重查均不写主题。旧槽文件没有起点、但确认在借用内置 ID 时，由用户点「恢复内置配色」，只把预览文件撤回到区分过的自有占位。旧文件若使用工坊实时主题自身 ID，或原文验证失败，不覆盖。
- 「默认」是恢复出厂**配色**的可撤销编辑；「无风格」只去风格层；二者都不是上述「还原」。暂借对同一服务器上使用同一内置主题的其他窗口同样可见。
- 写前后核对文件字节，加上同实例两个面板之间的短期协作锁；文件不同即 `conflict`，不硬盖。不替换无工坊标记的文件。SDK 没有原子比较并交换（CAS），无法排除外部程序在最后一次检查与原子写之间插入。

### 3.5 另存、导出、导入

| 动作 | 结果 |
| --- | --- |
| 保存为文件 | `themes/theme-studio-<slug>-<variant>.json`，ID 与文件名（不含扩展名）一致，宿主重读后出现在「设置 → 外观」；同名自动加序号，不覆盖已有文件。用同组作品整窗预览期间，另存、导出或复制 JSON 取原作配色，即使窗口正在显示另一版。 |
| 我的作品 · 从当前主题开始 | 预览文件只为身份匹配提供宿主显示色。这两个入口打开 `origin.raw` 的原作，不回读临时配色。 |
| 我的作品 · 删除入口 | 可从列表移除并撤回。隐藏不改变身份识别，也不删文件。作品版本以原始内容为准；旧版 `mtime`／`size` 标记在写前迁移，改写或还原不产生新作品或重复项。应先还原，再通过原生外观删除；面板按原路径逐版核实。 |
| 导出文件 | 写到宿主已存在的下载目录（`stat` 判断 `~/下载` 与 `~/Downloads`，中文界面优先前者），显示可复制的宿主路径（`~/…`，SDK 不返回 HOME 的绝对路径）；两个目录均不可用时提示复制 JSON，不新建目录。浅/深/两者可选。 |
| 复制 JSON | 先用 `host.writeClipboard`；超过 32 000 字符或剪贴板拒绝时，面板提供已选中的只读 JSON，可用 Ctrl/Cmd+C 手动复制。 |
| 导入 | 选文件、拖入、粘贴。接受 OpenChamber 原生主题 JSON（含我们导出的、可还原可编辑作品）。先过 `inspectThemeImport`：未知键剔除并逐条列出。识别到 VS Code 主题则提示用宿主的导入。≤512 KiB。 |

手动导入的正确说明：**放进 `~/.config/openchamber/themes/`**；宿主「选择 JSON 文件」只认 VS Code 主题。

## 4. 作品模型（非破坏式分层）

```ts
type Variant = 'light' | 'dark';
interface Project {
  schemaVersion: 1;
  id: string; name: string;
  origin: { kind: 'default'|'preset'|'builtin'|'saved'|'import'|'seeds'|'image'|'random'; ref?: string };
  base: Record<Variant, ThemeDefinition>;            // 配色基底
  linked: boolean;                                    // 浅深联动：风格/微调一起改
  style: Record<Variant, { id: string | null; strength: number; options: Record<string, unknown> }>;
  tune:  Record<Variant, TuneState>;                  // 整体微调（S 引擎的参数）
  overrides: Record<Variant, Record<string, string>>; // 精修：字段路径 → 值
  matching: { uiFont?, monoFont?, uiFontWeight?, fontSize?, padding?, chatWidth?, layoutAnimations? };
}
resolveProject(project, variant) = overrides ∘ tune ∘ style ∘ base  → ThemeDefinition（经 compactThemeLossless）
```

- 先点普通工坊／内置配色：清掉先前风格、保留手工调色与精修。风格随后作用于这个基底；「无风格」只去掉配方。打开已保存或导入作品保留它自己的图层。「默认」复原两版原装配色并清除这些编辑，可撤销。
- 精修命中的字段显示「自定义」标记；删掉即回到上游自动值。
- 整条管线单次 < 10 ms；拖动时面板每帧只算当前明暗。

## 5. 界面

宽 320–720 px 自适应；外观取宿主 token，像原生的一部分；中英双语跟随 `ready.locale`。

```
┌ 页眉（固定）：作品名（可改）· 浅/深分段 · 状态点（连接+同步，一句人话）· ⋯ ┐
├ 迷你预览（可折叠，固定）：忠实的 OpenChamber 小样，点哪个区域就跳到哪个字段  ┤
├ 标签：主题 · 风格 · 调色 · 精修 · 搭配                                        ┤
│ 内容（滚动）                                                                   │
└ 页脚（固定）：撤销/重做 · 还原 · 保存为文件                                  ┘
```

1. **主题**：第一张「默认」＋11 套工坊配色（浅深合一的缩略卡）；从当前主题开始；我的作品及删除入口；31 对宿主内置主题；图片取色、随机灵感与导入。点选后可撤销。
2. **风格**：「无风格」在前，后接 17 种配方；缩略图用**当前配色**渲染。选中的强度和专属选项固定在列表底部，点选任何卡片都不让列表移位。
3. **调色**：种子（底色、强调、第二色等，以 S 引擎为准）+ 整体微调滑杆（色相/彩度/明度/对比/色温，全局与分组）；从浅生成深、从深生成浅；体检分数与一键修复（修复前后对照，可撤销）。
4. **精修**：全部 L1 可见字段，按组折叠、可搜索、常用/进阶/专家分层、只看已改；行内展开取色器（不用浮层，窄栏更稳）：色面 + 色相 + 透明度 + HEX + 高级 CSS 值 + 「跟随自动」+ 相关底色对比度。死字段不出现。
5. **搭配**：界面/等宽字体（本机已装检测与试读）、字重、字号、间距、聊天宽度、布局动效的推荐值与当前值（能从快照读到的才显示），逐项「复制」与必要的设置路径，不陈列不支持项。

卡片网格（主题页的工坊精选、我的作品、内置主题，以及风格页）按面板宽度排列。320 / 420 / 720 px 三档窄栏保持 0.3.0 的 2 / 3 / 3–5 列。更宽时每张卡不超过 240 px，列数取「不超过 240 px 的最少列数」，最多 16 列；面板宽 ≥1031 px 起两页列数一致。阈值为面板宽 (k−1)×248−8+46+1 px，248 是卡宽加 8 px 间距，46 是两侧留白与滚动轨道。`scripts/ui-verify.mjs` 的 `wideGrid` 逐档核对。
状态行区分仅小样、待窗口更新、已预览以及各种不可确认状态。附加说明按需打开；日常界面不需要读教程才能切换主题。滚动区域在悬停、滚动、离开及失焦时维持相同轨道宽度。切语言刷新标题、按钮、无障碍标签、反馈和已打开的对话框，不更改作品内容或用户输入。

其余：全键盘可用、可见焦点、`prefers-reduced-motion`、拖动用指针捕获、滑杆支持方向键与双击归位、危险操作可撤销优先于确认框。文案说人话，不出现 token、slot、schema 等内部词。

## 6. 模块与契约

```
panel/index.html, panel/main.js(构建产物，入库), panel/style.css
src/core/   project.mjs history.mjs studio.mjs        ← 工作线 I1
src/host/   sdk-host.mjs mock-host.mjs identify.mjs live.mjs library.mjs   ← I1
src/data/   presets / builtins / fields（构建时生成） ← I1
src/i18n/   zh.mjs en.mjs / ui.zh.mjs ui.en.mjs          ← I1 / U 分开
src/ui/     …                                          ← 工作线 U
src/main.mjs（装配）                                   ← U
shared/     theme-core.mjs theme-derive.mjs style-recipes.mjs ← 工作线 S
scripts/build.mjs（bun 打包为单个 IIFE）               ← I1
dev/index.html（普通浏览器打开，mock-host 驱动）       ← I1 提供壳，U 使用
```

界面只依赖 `createStudio()`：

```ts
createStudio(deps: { host: HostAdapter; now?: () => number; timers?: … }): Studio
interface Studio {
  getState(): StudioState;                 // 不可变快照
  subscribe(fn: (s: StudioState) => void): () => void;
  start(): Promise<void>; dispose(): void;
  // 编辑
  setVariant(v: Variant): void; setLinked(on: boolean): void; rename(name: string): void;
   loadDefault(): Promise<WriteReport>; loadPreset(slug): void; loadBuiltin(id): void; loadSaved(id): Promise<void>; loadProject(p): void;
   loadCurrent?(): boolean | Promise<boolean>; // 已唯一识别，且有对应双变体/可编辑作品
  seedFrom(seeds): void; seedFromPixels({data,width,height}): Candidate[]; randomize(seed?): void;
   setStyle(patch, opts?: {phase:'drag'|'commit'}): void; setTune(patch, opts?: {phase:'drag'|'commit'}): void;
  setOverride(path, value, opts?: {phase}): void; clearOverride(path): void; clearOverrides(group?): void;
  makeCounterpart(target: Variant): void; repair(variant): RepairReport;
  setMatching(patch): void;
  undo(): void; redo(): void;
   restoreOriginal(): Promise<WriteReport>; // 页脚的一键还原：草稿与两版已触及槽位
   recoverBuiltin(variant, id): Promise<WriteReport>; // 明确撤下仍匹配该内置 ID 的旧预览，不改编辑器
   // 兼容 0.1 已有槽位/恢复的底层接口；不作为 0.2 页脚「应用」
  setLive(on: boolean): void; tryOn(variant): Promise<WriteReport>; endTryOn(variant): Promise<WriteReport>; // endTryOn = 还原原主题
  prepareSlot(variant): Promise<WriteReport>; // 若已暂借，先恢复原主题；返回长期使用所需的主题名称
  apply(variant?): Promise<WriteReport & { mode?: 'live'|'borrow'|'slot'|'copy'; name?: string }>; revert(variant?): Promise<WriteReport>; resolveConflict(variant, 'load'|'overwrite'): Promise<WriteReport>;
  recheck(variant?): Promise<WriteReport>;  // 只读：不创建主题，不应用草稿，不推进基线
  retry?(variant): Promise<WriteReport>;    // 读状态未知时只复查；写不确定时核对原尝试，不把新草稿当作旧操作重发
   keepPreview(): boolean | Promise<boolean>; // 对暂借落一次确认修订，支持重启恢复
  // 文件
   saveAs({name, variants}): Promise<SaveReport>; exportFiles({variants}): Promise<SaveReport>;
   removeSaved(id): Promise<WriteReport>; undoRemoveSaved(id): Promise<WriteReport>;
   checkSavedFiles(card): Promise<{ok:boolean; remaining:string[]; missing:string[]; code?:string}>;
   copyJson(variant): Promise<void>; importText(text, filename): ImportReport;
   getJson?(variant): string;               // 旧宿主/剪贴板拒绝时可显示只读 JSON，供手动复制
  copyText?(text: string): Promise<boolean | void>; // 路径与搭配建议共用已授权的宿主剪贴板
   setUiPreferences?(patch: { onboardingDismissed?: boolean; previewCollapsed?: boolean; borrowNoticeSeen?: boolean }): void;
}
interface StudioState {
  phase: 'booting'|'ready'|'degraded'; locale: 'zh'|'en';
  host: { mode: Variant; tokens: Record<string,string>; active: Record<Variant, ActiveTheme|null>; matching?: Partial<Project['matching']> };
  project: Project; variant: Variant;
  resolved: Record<Variant, ThemeDefinition>; parsed: Record<Variant, Theme>; cssVars: Record<Variant, Record<string,string>>;
  audit: Record<Variant, AuditReport>;
  dirty: Record<Variant, boolean>; history: { canUndo: boolean; canRedo: boolean; undoLabel?: string };
  live: { enabled: boolean; light: LiveState; dark: LiveState; banner: null | { kind:'unapplied-preview'|'tryon-left'|… } };
   library: { presets: PresetCard[]; builtins: BuiltinCard[]; saved: SavedCard[]; removed: SavedCard[] };
  notice: null | { id, tone, textKey, params };
  uiPreferences?: { onboardingDismissed?: boolean; previewCollapsed?: boolean; borrowNoticeSeen?: boolean };
}
interface LiveState {                       // 只列界面要用的
  connection: 'checking'|'read-error'|'unavailable'|'off'|'idle'|'tryon'|'active'|'hidden'|'conflict'|'prepare-error'|'error'|'verify-error';
  sync: 'idle'|'preflight'|'writing'|'waiting'|'applied'|'timeout';
  canRecheck: boolean;
  readError: {code:string; message?:string} | null;
  recovery: 'builtin'|'preserve'|null;       // 旧预览可撤下，或原配色无法确认、保留文件
  canTryOn: boolean;                        // 点「应用」会以暂借身份整窗生效（已唯一识别到内置主题、可写）
  borrowed: null | {                        // 该明暗的文件此刻是暂借身份
    id: string; name: string;               // 被暂借的内置主题
    applied: boolean;                       // 用户点过「应用」确认；false = 只是预览
     inUse: boolean | null;                  // 宿主此刻正显示它；隐藏、等待回执或指纹多义时为 null
  };
}
```

`HostAdapter`（真实与 mock 同形）：`onReady(cb)`、`readFile/writeFile/stat/listDir`、`storage.get/set/delete/keys`、`writeClipboard`、`toast`、`openUrl`。真实适配器打包官方 `@openchamber/sdk@2.8.0`。

`TuneState` 以 `global`、`groups` 和两个保护标记 `protectStatus`/`protectSyntax` 存放旋钮；旧式一层旋钮加载时迁移。写报告用 `ok` 表示磁盘结果，`code/message` 表示失败、`path/name` 表示成功；`observable` 只有快照能区分新旧颜色时才为真，实际整窗结果看 `live.sync`。面板装配用 `flushDraft()` 尝试在退出前落盘，但不能依赖宿主在强杀时完成请求。

`mock-host` 要能模拟：约 2 s 延迟的整窗生效、主题选择（内置/槽位/自定义）、跟随系统切换、无授权、写失败、外部改文件、快照迟到。

**U → I1（界面消费说明）：**以上可选能力用于「从当前主题开始」、复制路径/搭配、保存界面折叠/引导偏好。没有 `loadCurrent` 时仅在能从已识别的 ID 直接定位内置/我的作品时显示入口；没有可靠快照时 `host.matching` 不填，不以猜测冒充当前设置。`setStyle` 和 `setOverride` 都应接受与 `setTune` 一致的 `opts.phase`（`drag` 更新草稿、`commit` 结束本次撤销事务）。文件报告须携带真实路径（可复制）或可识别的失败；冲突、失败不得被 UI 当作成功。样式预览与调色参数以 S 的公开配方/描述符为准，UI 不另造双色算法。若没有 `retry`，界面只重放自身记录的动作，无法识别动作时明确提供「再次应用」。相同颜色存在多个主题时提示无法识别，不把写入等同整窗生效。

## 7. 质量线

- 纯逻辑 `node --test` 全覆盖（Node 22）；核心状态机用 mock-host 做时序测试（拖动合并、并发写、冲突、超时、试穿进出、崩溃恢复、无授权降级、重装恢复）。
- 隔离宿主端到端（网页 + 桌面）：原生安装授权 → 选配色／风格 → 无风格 → 换主题 → 默认 → 命名保存 → 两版预览及跨重开一键还原 → 移除、撤回、原生删除 → 宿主切语言。测量面板外真实 CSS、文件内容和时间；在原生分隔条 320/420/720 px 测滚轴几何。区分扩展操作、宿主原生缓存和测试者主动更改设置。
- 面板首屏 < 400 ms；拖动 60 fps（面板内）；`panel/main.js` ≤ 600 KB（内置主题目录可另置一个懒加载的经典脚本）。
- 320 / 420 / 720 px × 浅/深宿主 × 中/英 截图走查。
- 运行时不访问外网、无需外部依赖；按需载入的是已安装的本地经典脚本。

## 8. 不做（本期）

手机面板、整页编辑器、后台服务、代改宿主设置、VS Code 主题转换、在线分享。

## 变更记录

- 0.2：以用户确认的 `11df8e0` 为先行检查点。用主动编辑预览、独立命名保存及一键还原替代旧页脚的「应用／另存」；消除风格抢占、滚轴跳宽和说明堆叠。以下为 0.1 历史记录。

- I1：隔离默认数据目录实测，下载文件通配不授权父目录 `stat`，SDK 写入会自动创建缺失父目录；补两个精确目录模式，导出先检查，路径按宿主 `~/…` 显示。
- I1：补齐 `setStyle.phase`、调色命名与写报告；明确快照不可观测、协作锁非 CAS、原生启动色缓存及独立明暗基线的边界。
- I1：补齐旧宿主的只读 JSON 复制后备，`loadCurrent` 允许异步，加载工作读取宿主文件时不会覆盖后一次选源。
- 主控：重定「应用」语义（§3.3、§3.4）并写死字段名（§6：`apply().mode`、`LiveState.canTryOn/borrowed`、`uiPreferences.borrowNoticeSeen`）。超时（`timeout`）后若宿主稍后更新，状态要自动转为已生效。
- U：界面按 `mode` 区分整窗已应用、待在外观里选用与剪贴板；`prepareSlot` 的写入报告用于显示实际长期主题名。另一明暗提示从当前 `canTryOn` 与对侧 `borrowed.applied`／本次面板中实际观察到的 `active` 状态推导，不持久化或猜测非当前明暗的宿主选用。
- I1：确认暂借标记与文件同次写入；用户换主题后清掉未使用的暂借时不等待另一内置颜色。扩展不判断宿主真的开启了系统跟随，只观察实际明暗。
- I1：补充确认修订同写和 `keepPreview()` 可异步，覆盖原子写后、实例存储回执前断开；保留未确认实时预览的恢复提示。
- I1：自有槽位只与另存副本同色时保持连接，下一次改色用快照校验；若错把用户选用的副本当槽位，超时后停写。涉及内置主题的多义仍保持保守判断。
- I1：确认超时统一为 12 秒，避免网页首轮约 10 秒的实测通知延时触发虚假告警。逾时后仍接收回执，重试语义不变。
- 首用修订：文件状态是否已读清、当前主题身份是否可辨、宿主是否呈现新颜色分别判断。重查只读；真实写前重新核验；不能用个人槽或“写失败”来代替未知的读取结果。
