// Hand-audited L2 semantics; scope and perSurface are filled from the pinned registry snapshot.
const ui = 'packages/ui/src/';
const state = `${ui}stores/ui/initialState.ts`;
const action = `${ui}stores/ui/appearanceActions.ts`;
const fonts = `${ui}lib/fontOptions.ts`;
const fontEffects = `${ui}apps/useAppFontEffects.ts`;
const sidebar = `${ui}stores/useSessionDisplayStore.ts`;
const chat = `${ui}components/sections/openchamber/ChatSettings.tsx`;
const chatParser = `${ui}lib/settings/parsers.ts`;
const live = 'immediate';
const legacy = 'migration';
const settings = [];
const unit = (min, max, step, name) => ({ min, max, step, unit: name });
function setting(group, key, zh, en, type, defaultValue, allowed, apply, hintZh, hintEn, ...evidence) {
  settings.push({ group, key, type, label: { zh, en }, hint: { zh: hintZh, en: hintEn }, default: defaultValue, allowed, apply, evidence });
}
export const settingsGroups = [
  ['theme-selection', '主题选择', 'Theme selection'],
  ['typography', '字体与字号', 'Typography'],
  ['density', '间距与动效', 'Density and motion'],
  ['conversation', '聊天布局', 'Conversation layout'],
  ['sidebar-layout', '侧栏结构', 'Sidebar structure'],
  ['code-layout', '代码与终端视图', 'Code and terminal views'],
  ['window', '窗口外框', 'Window frame'],
  ['identity', '提供商标志', 'Provider identity'],
].map(([id, zh, en], index) => ({ id, order: index + 1, label: { zh, en } }));

const sel = 'theme-selection';
setting(sel, 'useSystemTheme', '跟随系统', 'Follow system', 'boolean', true, [true, false], live, '系统切换浅色或深色时，应用也会切换。关闭后固定使用你选的主题。', 'Switch between the light and dark slot using system preference.', `${ui}contexts/theme-storage.ts:94`, `${ui}contexts/ThemeSystemContext.tsx:347`);
setting(sel, 'lightThemeId', '浅色主题', 'Light theme', 'theme-id', 'openchamber-light', { variant: 'light' }, live, '系统使用浅色外观时选用的主题。', 'Theme ID in the light slot.', `${ui}lib/theme/themes/index.ts:15`, `${ui}contexts/theme-storage.ts:94`);
setting(sel, 'darkThemeId', '深色主题', 'Dark theme', 'theme-id', 'openchamber-dark', { variant: 'dark' }, live, '系统使用深色外观时选用的主题。', 'Theme ID in the dark slot.', `${ui}lib/theme/themes/index.ts:16`, `${ui}contexts/theme-storage.ts:95`);
setting(sel, 'themeId', '固定主题', 'Pinned theme', 'theme-id', null, { source: 'registered theme IDs' }, live, '关闭「跟随系统」后使用；没选时会沿用可用的浅色或深色主题。', 'Used when Follow system is off. If none is chosen, OpenChamber keeps an available light or dark theme.', `${ui}contexts/theme-storage.ts:91`, `${ui}contexts/ThemeSystemContext.tsx:348`);
setting(sel, 'themeVariant', '当前外观', 'Current appearance', 'enum', null, ['light', 'dark'], 'derived', '显示现在是浅色还是深色，随当前主题切换。', 'Shows whether your current theme is light or dark.', `${ui}lib/settings/registry.ts:176`);

const typo = 'typography';
setting(typo, 'fontSize', '界面字号', 'Interface scale', 'range', 100, unit(50, 200, 5, '%'), live, '放大或缩小大部分界面文字；固定尺寸的控件不一定跟随。', 'Root font size; scales rem-based UI, not unrelated pixel sizes.', `${action}:27`, `${action}:79`, `${state}:345`);
setting(typo, 'chatFontSize', '聊天字号', 'Chat text scale', 'range', 100, unit(50, 200, 5, '%'), live, '聊天正文和输入区，在界面字号的基础上再放大或缩小。', 'Separate scale for chat text and composer, combined with the interface scale.', `${action}:33`, `${ui}components/chat/ChatContainer.tsx:93`, `${state}:346`);
setting(typo, 'editorFontSize', '编辑器字号', 'Editor font size', 'range', 12, unit(9, 32, 1, 'px'), live, '文件编辑器，也影响部分代码预览。', 'File editor and code views that share the editor metric.', `${ui}stores/ui/preferences.ts:26`, `${action}:43`, `${ui}components/sections/openchamber/OpenChamberVisualSettings.tsx:591`);
setting(typo, 'terminalFontSize', '终端字号', 'Terminal font size', 'range', 14, unit(9, 52, 1, 'px'), live, '只改终端文字，实际显示最大为 32 px。', 'Changes terminal text only, up to 32 px on screen.', `${action}:37`, `${state}:348`, `${ui}components/views/TerminalView.tsx:1438`, `${ui}lib/ghostty/surface.ts:99`);
setting(typo, 'uiFont', '界面字体', 'Interface font', 'enum', 'system', ['system', 'inter', 'fixel', 'geist-sans', 'atkinson-hyperlegible', 'source-sans-3', 'roboto', 'noto-sans', 'dm-sans', 'manrope', 'custom'], live, '界面、正文和普通标题共用；覆盖主题中的普通 sans / heading 值。', 'Shared by the UI, prose and ordinary headings; overrides ordinary theme font values.', `${fonts}:42`, `${fonts}:193`, `${fontEffects}:17`);
setting(typo, 'monoFont', '等宽字体', 'Monospace font', 'enum', 'system-mono', ['system-mono', 'jetbrains-mono', 'fira-code', 'geist-mono', 'commit-mono', 'source-code-pro', 'cascadia-code', 'roboto-mono', 'iosevka', 'custom'], live, '代码、编辑器与终端共用；终端可能要重新打开后才看到变化。', 'Used in code, the editor, and the terminal. You may need to reopen the terminal to see a change.', `${fonts}:122`, `${fontEffects}:22`, `${ui}components/views/TerminalView.tsx:1077`);
setting(typo, 'customUiFont', '自定义界面字体', 'Custom interface font', 'local-font-names', '', { maxLength: 100, separator: ',', when: { uiFont: 'custom' } }, live, '本机已安装字体名，可用逗号指定回退；不加载字体文件或远端 URL。', 'Comma-separated installed family names; no font files or remote URLs.', `${fonts}:204`, `${fontEffects}:19`, `${action}:57`);
setting(typo, 'customMonoFont', '自定义等宽字体', 'Custom monospace font', 'local-font-names', '', { maxLength: 100, separator: ',', when: { monoFont: 'custom' } }, 'contextual', '代码和编辑器会立即换字；终端可能要切换字体选项或重新打开。', 'The editor and code update at once. In the terminal, you may need to switch font options or reopen it.', `${fonts}:204`, `${fontEffects}:22`, `${action}:61`, `${ui}components/views/TerminalView.tsx:1077`);
setting(typo, 'uiFontWeight', '常规字重', 'Regular text weight', 'enum', 'regular', ['regular', 'balanced', 'strong'], live, '界面常规文字和正文有 400、450、500 三档。固定字重的标题和按钮不随之改变。', '400/450/500; regular UI/body text, not fixed-weight headings, buttons or code.', `${fonts}:27`, `${fontEffects}:33`, `${ui}styles/design-system.css:224`);

const density = 'density';
setting(density, 'padding', '布局密度', 'Spacing density', 'range', 100, unit(50, 200, 5, '%'), live, '让界面的留白整体变宽或变窄。少数地方的行高也会略微变化。', 'Spacing multiplier is sqrt(scale); some line-height utilities shift slightly.', `${action}:69`, `${action}:100`, `${ui}styles/design-system.css:1002`);
setting(density, 'cornerRadius', '圆角', 'Corner radius', 'number', 18, { finite: true, uiRange: null, unit: null }, 'none', '这一版不能改控件圆角。', 'OpenChamber does not let you change corner radius in this version.', `${action}:75`, `${state}:360`, `${ui}styles/design-system.css:975`);
setting(density, 'layoutAnimations', '布局动效', 'Layout motion', 'boolean', true, [true, false], live, 'Web / 桌面部分布局开合、换位过渡；不是全站动画、淡入或状态反馈总开关。', 'Controls selected layout transitions on web/desktop, not all animations.', `${state}:332`, `${ui}hooks/useLayoutAnimationMs.ts:5`, `${ui}components/sections/openchamber/GeneralWorkspaceSettings.tsx:348`);
setting(density, 'inputBarOffset', '移动输入栏偏移', 'Mobile composer offset', 'range', 0, unit(0, 100, 5, 'px'), live, '窄屏输入条底部偏移，供移动触控布局微调。', 'Bottom offset of the touch/mobile composer.', `${state}:361`, `${ui}components/sections/openchamber/OpenChamberVisualSettings.tsx:647`);

const convo = 'conversation';
setting(convo, 'chatWidth', '聊天栏宽度', 'Conversation width', 'enum', 'default', ['default', 'wider', 'full'], live, '默认阅读宽度、加宽、填满可用区。仍受设备及侧栏宽度限制。', 'Reading column, wider or fill; constrained by the device and open panels.', `${chatParser}:400`, `${ui}hooks/useChatWidthAttribute.ts:8`, `${ui}styles/typography.css:88`);
setting(convo, 'wideChatLayoutEnabled', '旧版全宽', 'Full-width chat (older setting)', 'boolean', null, [true, false], legacy, '兼容旧设置；现在请用「聊天栏宽度」。', 'Kept for older setups. To change this now, use Conversation width.', `${chatParser}:402`, `${ui}stores/ui/persistence.ts:43`);
setting(convo, 'activityRenderMode', '活动呈现', 'Activity display', 'enum', 'summary', ['summary', 'text', 'collapsed'], live, '活动摘要、文本或折叠，影响工具与推理的信息密度。', 'Summary, text, or collapsed tool/reasoning activity.', `${state}:326`, `${chatParser}:412`, `${ui}components/chat/MessageList.tsx:78`);
setting(convo, 'chatRenderMode', '旧版聊天布局', 'Chat layout (older setting)', 'enum', null, ['sorted', 'live'], legacy, '兼容旧设置；旧版选过排序时，工具和推理活动会折叠。', 'If you chose sorted chat in an older version, tool and reasoning notes are collapsed.', `${chatParser}:413`, `${chat}:177`);
setting(convo, 'userMessageRenderingMode', '用户消息格式', 'User message format', 'enum', 'markdown', ['markdown', 'plain'], live, '仅用户发送的消息；切换 Markdown 样式与纯文本。', 'Markdown or plain text for outgoing messages only.', `${state}:460`, `${ui}components/chat/message/parts/UserTextPart.tsx:96`);
setting(convo, 'collapsibleUserMessages', '折叠长消息', 'Collapse long messages', 'boolean', true, [true, false], live, '允许折叠长用户消息，不改气泡形状。', 'Allows long user messages to collapse; does not change bubble shape.', `${state}:461`, `${chat}:153`);
setting(convo, 'stickyUserHeader', '固定用户消息', 'Sticky user message', 'boolean', false, [true, false], live, '滚动时固定当前轮用户消息标题，不影响颜色。', 'Keeps the current turn’s user header visible while scrolling.', `${state}:462`, `${ui}components/chat/MessageList.tsx:96`, `${ui}components/chat/timeline/useTimelineRows.ts:110`);
setting(convo, 'promptNavigatorEnabled', '消息导航', 'Prompt navigation', 'boolean', true, [true, false], live, '控制长对话快捷定位入口，不改变卡片皮肤。', 'Controls long-conversation navigation, not card styling.', `${state}:463`, `${chat}:155`);
setting(convo, 'showToolFileIcons', '工具文件图标', 'Tool file icons', 'boolean', true, [true, false], live, '显示/隐藏工具行文件类型图标；不是图标替换。', 'Shows or hides file-type icons in tool rows; not icon replacement.', `${state}:453`, `${ui}components/chat/message/parts/toolRow/ToolPartContent.tsx:210`);
setting(convo, 'showSplitAssistantMessageActions', '分段消息操作', 'Per-segment message actions', 'boolean', false, [true, false], live, '分别显示助手各段操作，改变控件密度。', 'Show assistant actions on separate response segments.', `${state}:464`, `${chat}:142`);
setting(convo, 'showTurnChangedFiles', '改动文件摘要', 'Changed files summary', 'boolean', false, [true, false], live, '在轮次中加入改动文件摘要。', 'Adds a changed-file summary to a turn.', `${state}:454`, `${chat}:160`);
setting(convo, 'showReasoningTraces', '推理显示', 'Show reasoning', 'boolean', true, [true, false], live, '开关推理块的可见性。', 'Show or hide reasoning blocks.', `${state}:313`, `${ui}components/chat/MessageList.tsx:73`);
setting(convo, 'collapsibleThinkingBlocks', '折叠推理块', 'Collapsible reasoning', 'boolean', true, [true, false], live, '推理内容可折叠，不影响模型思考。', 'Allows reasoning blocks to collapse, without changing the model.', `${state}:324`);
setting(convo, 'expandReasoningWhileStreaming', '流式展开推理', 'Expand streamed reasoning', 'boolean', false, [true, false], live, '流式生成时暂时展开推理。', 'Expand reasoning during streaming.', `${state}:325`);

const sb = 'sidebar-layout';
const sidebarOption = (...args) => setting(sb, ...args);
sidebarOption('sidebarViewMode', '侧栏视图', 'Sidebar view', 'enum', 'timeline', ['timeline', 'projects'], live, '时间线或项目结构。', 'Choose timeline or project view.', `${sidebar}:118`);
sidebarOption('sidebarProjectDisplayMode', '项目显示范围', 'Visible projects', 'enum', 'all', ['all', 'single'], live, '显示全部或单一项目。', 'Display all projects or a single project.', `${sidebar}:114`);
sidebarOption('sidebarListSessionGrouping', '列表分组', 'List grouping', 'enum', 'project', ['project', 'time'], live, '侧栏列表按项目或时间分组。', 'Group sidebar lists by project or time.', `${sidebar}:120`);
sidebarOption('sidebarGrouping', '当前侧栏分组', 'Grouping in this sidebar', 'enum', null, ['project', 'time'], 'contextual', '在当前侧栏按项目或时间显示。', 'Group this sidebar by project or time.', `${sidebar}:122`);
sidebarOption('sidebarKeepWorkInPlace', '工作会话留原位', 'Keep work in place', 'boolean', false, [true, false], live, '不开启时工作会话进入独立区。', 'Keep work sessions in their ordinary position.', `${sidebar}:124`);
sidebarOption('sidebarKeepPinnedInPlace', '固定会话留原位', 'Keep pinned in place', 'boolean', true, [true, false], live, '固定会话可同时保留在原区。', 'Keep pinned sessions in their ordinary section as well.', `${sidebar}:126`);
sidebarOption('sidebarSessionBatchSize', '每批会话数', 'Sessions per batch', 'range', 7, unit(3, 50, 1, 'items'), live, '在侧栏展开更多会话时，一次显示几条。', 'How many more sessions appear at once when you expand the list.', `${sidebar}:128`, `${ui}lib/sidebarSections.ts:53`);
sidebarOption('sidebarProjectSortOrder', '项目排序', 'Project order', 'enum', 'manual', ['manual', 'a-z', 'z-a', 'date-added', 'recent'], live, '项目列表排序。', 'Sort the sidebar project list.', `${sidebar}:143`);
for (const [key, zh, en, value, line, hint, eng] of [
  ['sidebarShowChatsSection', '显示聊天区', 'Show chats section', true, 130, '在侧栏保留「聊天」区。', 'Show the Chats section in the sidebar.'],
  ['sidebarShowWorkSection', '显示工作区', 'Show work section', true, 131, '在侧栏单独列出正在工作的会话。', 'List sessions marked as work in their own sidebar section.'],
  ['sidebarShowPinnedSection', '显示固定区', 'Show pinned section', true, 132, '在侧栏单独列出固定的会话。', 'List pinned sessions in their own sidebar section.'],
  ['sidebarDetailedZoneRows', '显示会话详情', 'Show session details', { mobile: true, otherwise: false }, 133,
    '侧栏会话多显示一行时间、分支等信息。', 'Show a second line with details such as the time and branch.'],
  ['sidebarWorktreeNameByBranch', '优先显示分支名', 'Prefer branch names', false, 134,
    '侧栏先显示工作树所用的分支名。', 'Show a worktree’s branch name first in the sidebar.'],
]) sidebarOption(key, zh, en, 'boolean', value, [true, false], live, hint, eng, `${sidebar}:${line}`);
sidebarOption('sidebarSections', '侧栏分区', 'Sidebar sections', 'section-list', 'DEFAULT_SIDEBAR_SECTIONS', { maxItems: 24, nameMax: 60 }, 'contextual', '内置与自定义分区定义；经官方分区编辑器管理。', 'Built-in and custom sections; use the native section editor.', `${sidebar}:135`, `${ui}lib/sidebarSections.ts:130`);
sidebarOption('sidebarPinLists', '固定列表', 'Pinned lists', 'section-list', [], { maxItems: 24, nameMax: 60 }, 'contextual', '自定义固定列表；只管内容组合。', 'Custom pinned lists; controls content grouping only.', `${sidebar}:136`, `${ui}lib/sidebarSections.ts:163`);
sidebarOption('sidebarHiddenSections', '隐藏分区', 'Hidden sections', 'string-list', [], { values: 'existing section ids' }, 'contextual', '在当前侧栏隐藏所选分区。', 'Hide the chosen sections in this sidebar.', `${sidebar}:137`, `${ui}lib/sidebarSections.ts:175`);
sidebarOption('isSidebarOpen', '打开侧栏', 'Open sidebar', 'boolean', true, [true, false], live, '在这台设备上打开或收起侧栏。', 'Open or close the sidebar on this device.', `${state}:244`, `${ui}components/layout/Sidebar.tsx:24`);
sidebarOption('sidebarWidth', '侧栏宽度', 'Sidebar width', 'range', 280, unit(264, 500, 1, 'px'), live, '桌面侧栏可拖动；平板实现有不同尺寸约束。', 'Resizable via drag on desktop; tablet has different limits.', `${state}:246`, `${ui}components/layout/Sidebar.tsx:11`);
sidebarOption('sidebarFoldedForExpandedZone', '扩展视图临时折叠', 'Auto-fold sidebar', 'boolean', false, [true, false], 'derived', '展开区布局管理的本地状态，不建议单独编辑。', 'Local state managed by the expanded layout; not a theme control.', `${state}:245`, `${ui}stores/ui/workspaceActions.ts:58`);
sidebarOption('sidebarSection', '当前侧栏页', 'Current sidebar page', 'navigation-state', 'sessions', { source: 'built-in sidebar sections' }, 'contextual', '当前导航页，本地状态，非可保存的主题维度。', 'Local navigation state; not part of saved appearance.', `${state}:301`, `${ui}stores/ui/navigationActions.ts:246`);

const code = 'code-layout';
setting(code, 'diffLayoutPreference', '差异布局', 'Diff layout', 'enum', 'inline', ['dynamic', 'inline', 'side-by-side'], live, '统一、并排或动态，取决于 diff 视图和可用宽度。', 'Unified, split, or dynamic, subject to view and available width.', `${state}:375`, `${ui}lib/settings/registry.ts:403`);
for (const [key, zh, en, value, line, hint, eng] of [
  ['diffWrapLines', '差异自动换行', 'Wrap diff lines', false, 377, '差异视图里太长的行自动换行。', 'Wrap long lines in the change view.'],
  ['diffHideWhitespace', '隐藏空白改动', 'Hide whitespace changes', false, 378, '比较改动时忽略只变了空格或缩进的行。', 'Ignore lines that only change spaces or indentation.'],
  ['fileEditorWrapLines', '编辑器自动换行', 'Wrap editor lines', true, 330, '文件编辑器里太长的行自动换行。', 'Wrap long lines in the file editor.'],
  ['codeBlockLineWrap', '代码块自动换行', 'Wrap code blocks', true, 449, '聊天里的代码块在栏宽内自动换行。', 'Wrap code blocks to the width of the chat.'],
  ['tableCellWrap', '表格单元格换行', 'Wrap table cells', true, 450, '聊天表格里的长文字可以换行。', 'Wrap long text in chat table cells.'],
]) setting(code, key, zh, en, 'boolean', value, [true, false], live, hint, eng, `${state}:${line}`);
setting(code, 'gitChangesViewMode', '改动列表布局', 'Changes layout', 'enum', 'flat', ['flat', 'tree'], live, '改动文件使用列表或树。', 'List or tree for changed files.', `${state}:382`);
setting(code, 'fileTreeSide', '文件树位置', 'File tree side', 'enum', 'right', ['left', 'right'], live, 'Web/桌面的文件树在左或右。', 'File tree on the left or right in web/desktop.', `${state}:256`, `${ui}lib/settings/registry.ts:424`);
setting(code, 'toolJsonViewMode', '工具数据视图', 'Tool data view', 'enum', 'summary', ['summary', 'formatted', 'raw'], live, '原始工具数据的显示形态。', 'Choose how textual tool data is displayed.', `${state}:383`, `${ui}lib/settings/registry.ts:399`);
setting(code, 'mermaidRenderingMode', '图表绘制方式', 'Mermaid rendering', 'enum', 'svg', ['svg', 'ascii'], live, 'SVG 或字符式 Mermaid；不开放任意配色或样式表。', 'SVG or character diagrams; no arbitrary chart palette or stylesheet.', `${state}:459`, `${ui}components/chat/markdown/MarkdownMermaid.tsx:62`);

const window = 'window';
setting(window, 'desktopLinuxNativeFrame', 'Linux 原生边框', 'Linux native frame', 'boolean', false, [true, false], 'restart', 'Linux 桌面在系统装饰与自绘窗口框之间切换；应用重启才生效。', 'Switch Linux system decorations vs app window chrome; requires restart.', `${ui}components/sections/openchamber/DesktopAppSettings.tsx:87`, `${ui}components/sections/openchamber/DesktopAppSettings.tsx:179`);
setting(window, 'desktopWindowControlsPosition', '窗口按钮位置', 'Window control position', 'enum', 'right', ['left', 'right'], live, '非原生框可调整左右；原生外框由系统控制。', 'Moves custom chrome controls; native chrome stays system-controlled.', `${state}:457`, `${ui}hooks/useDesktopWindowControlsLayout.ts:14`);
setting(window, 'desktopWindowControlsStyle', '窗口按钮样式', 'Window control shape', 'enum', 'classic', ['classic', 'traffic-lights'], live, '自绘框经典或信号灯按钮；原生外框不受影响。', 'Classic or traffic lights on custom frames only.', `${state}:458`, `${ui}lib/settings/registry.ts:589`);

const identity = 'identity';
setting(identity, 'customProviderIcons', '提供商图标', 'Provider icons', 'provider-icon-map', {}, { control: 'native provider settings' }, 'contextual', '按提供商选内置图标；与导出主题分开。', 'Choose a built-in icon per provider; independent of theme export.', `${state}:367`, `${ui}components/ui/ProviderLogo.tsx:35`, `${ui}components/sections/providers/ProvidersPage.tsx:761`);
setting(identity, 'customProviderLogos', '提供商标志', 'Provider logos', 'provider-logo-map', {}, { control: 'native provider logo settings' }, 'contextual', '给模型列表里的某个提供商上传自己的标志。', 'Upload a logo for one provider in the model list.', `${state}:368`, `${ui}components/ui/ProviderLogo.tsx:36`, `${ui}components/sections/providers/ProviderLogoImageControl.tsx:5`);

export const settingsSpec = settings;
