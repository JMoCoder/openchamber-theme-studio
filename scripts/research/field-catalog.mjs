import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLE_PATHS } from './style-paths.mjs';
import { MINIMAL, researchArgs, UI } from './upstream.mjs';
import { settingsGroups, settingsSpec } from './settings-spec.mjs';

const { source, rest } = researchArgs();
if (rest.some((arg) => arg !== '--write')) throw new Error('仅支持 --write');
const root = new URL('../../', import.meta.url);
const file = (path) => fileURLToPath(new URL(path, root));
const { mutations } = JSON.parse(readFileSync(file('docs/research/evidence/style-mutations.json'), 'utf8'));
const { variables } = JSON.parse(readFileSync(file('docs/research/evidence/variable-consumers.json'), 'utf8'));
const measured = new Map(mutations.map((item) => [item.path, item]));
const variableRefs = new Map(variables.map((item) => [item.var, item.examples]));
const registry = JSON.parse(readFileSync(join(source, 'packages/web/server/lib/settings/settings-registry.json'), 'utf8')).fields;
const def = `${UI}/lib/theme/definition.ts`;
const gen = `${UI}/lib/theme/cssGenerator.ts`;
const syn = `${UI}/lib/theme/syntax.ts`;
const readable = `${UI}/lib/theme/readableColors.ts`;
const shiki = `${UI}/lib/shiki/textMateThemeFromAppTheme.ts`;
const zed = `${UI}/lib/shiki/zedThemeFromAppTheme.ts`;
const cm = `${UI}/lib/codemirror/flexokiTheme.ts`;
const fileEditor = `${UI}/components/views/files/view/useFileEditorExtensions.tsx`;
const mdSyntax = `${UI}/components/chat/markdown/markdownSyntaxVars.ts`;
const font = `${UI}/apps/useAppFontEffects.ts`;

const groups = [
  ['surfaces', '背景与文字', 'Surfaces'],
  ['accent', '强调与控件', 'Accent and interaction'],
  ['status', '状态提示', 'Semantic status'],
  ['chat', '聊天', 'Chat'],
  ['markdown', 'Markdown 正文', 'Markdown text'],
  ['tools', '工具与改动预览', 'Tools and change previews'],
  ['pr', '拉取请求', 'Pull requests'],
  ['syntax-base', '代码基础色', 'Base syntax'],
  ['syntax-highlights', '代码改动与行号', 'Code changes and gutters'],
  ['syntax-tokens', '细分语法色', 'Syntax roles'],
  ['config', '主题字体与过渡', 'Theme fonts and transitions'],
  ['metadata', '主题信息', 'Theme details'],
].map(([id, zh, en], i) => ({ id, order: i + 1, label: { zh, en } }));

const full = (role) => role.startsWith('metadata.') || role.startsWith('config.') ? role : `colors.${role}`;
const bases = ['surface.background', 'surface.muted', 'surface.elevated'];
const main = ['surface.background', 'surface.elevated'];
const code = ['syntax.base.background'];
const c = (against, minimum = 4.5) => ({ against: against.map(full), minimum, role: minimum === 3 ? 'non-text' : 'text' });
const noContrast = [];
const rst = (kind, summary, dependsOn = [], stage = 'resolved', value) => ({
  kind, summary, dependsOn: dependsOn.map(full), stage, ...(value === undefined ? {} : { value }),
});
const inherited = (role, stage) => rst('inherit', '没单独设置时，沿用相关颜色。', [role], stage);
const derived = (summary, deps, stage, value) => rst('derived', summary, deps, stage, value);
const none = rst('none', '没有主题默认值；保持未设置。');
const required = rst('required', '没有自动值，必须提供。', [], 'schema');
const rows = new Map();
const counts = new Map();
const quickRoles = new Set([
  'surface.background', 'surface.foreground', 'surface.muted', 'surface.elevated',
  'primary.base', 'interactive.border', 'interactive.selection', 'interactive.focusRing',
  'chat.userMessageBackground', 'syntax.base.background',
]);
const basicRoles = new Set([
  'metadata.name', 'metadata.variant', 'surface.mutedForeground', 'surface.elevatedForeground',
  'primary.foreground', 'markdown.link', 'syntax.base.foreground', 'syntax.base.comment',
  'syntax.base.keyword', 'syntax.base.string', 'syntax.base.function',
  'status.error', 'status.warning', 'status.success', 'status.info',
]);
const expertRoles = new Set([
  'metadata.id', 'surface.overlay', 'primary.hover', 'interactive.borderHover', 'interactive.cursor',
  'chat.background', 'chat.divider',
]);
function add(group, role, label, hint, fallback, effect, contrast = noContrast, evidence = [], cssPreviewVar = null) {
  const path = full(role);
  const metric = measured.get(path);
  assert.ok(metric, `missing mutation: ${path}`);
  assert.ok(!rows.has(path), `duplicate field: ${path}`);
  let present = MINIMAL;
  for (const key of path.split('.')) present = present?.[key];
  const order = (counts.get(group) ?? 0) + 1;
  counts.set(group, order);
  const schemaLine = path.startsWith('metadata.') ? 27 : path.startsWith('config.') ? 35
    : path.startsWith('colors.primary.') ? 12 : path.startsWith('colors.surface.') ? 13
      : path.startsWith('colors.interactive.') ? 14 : path.startsWith('colors.status.') ? 15
        : path.startsWith('colors.pr.') ? 30 : path.startsWith('colors.chat.') ? 31
          : path.startsWith('colors.markdown.') ? 32 : path.startsWith('colors.tools.') ? 33
            : path.startsWith('colors.syntax.base.') ? 22 : path.startsWith('colors.syntax.tokens.') ? 23 : 24;
  const publicEvidence = [...new Set([
    `${def}:${schemaLine}`,
    ...evidence,
    ...metric.directCss.flatMap((variable) => (variableRefs.get(variable) ?? []).slice(0, 1)).slice(0, 3),
  ])];
  const { type } = STYLE_PATHS.find((item) => item.path === path);
  const quick = quickRoles.has(role);
  const tier = effect === 'dead' ? 'hidden' : quick || basicRoles.has(role) ? 'basic'
    : expertRoles.has(role) || ['syntax-tokens', 'syntax-highlights', 'pr'].includes(group) ? 'expert' : 'advanced';
  rows.set(path, {
    path, group, order, tier, quick, label: { zh: label[0], en: label[1] }, hint: { zh: hint[0], en: hint[1] },
    type, required: present !== undefined, default: fallback,
    cssVars: metric.css, directCssVars: metric.directCss, cssPreviewVar,
    effect: { kind: effect, summary: { zh: hint[0], en: hint[1] } },
    contrast, evidence: publicEvidence,
    ...(path === 'metadata.variant' ? { options: ['light', 'dark'] } : {}),
  });
}
const live = 'live', partial = 'partial', dead = 'dead';
const surface = (key, ...items) => add('surfaces', `surface.${key}`, ...items);
surface('background', ['页面底色', 'Canvas'], ['聊天页和应用的底色，也影响移动浏览器顶部的颜色。', 'App and chat canvas, mobile chrome, and default editor background.'], required, live, [c(['surface.foreground','surface.mutedForeground'])], [`${gen}:68`, `${def}:46`, `${UI}/contexts/ThemeSystemContext.tsx:313`], '--background');
surface('foreground', ['正文', 'Primary text'], ['聊天正文和导航主文字。没单独设选区时，也用它来算选区色。', 'Body and main navigation text; seed for selection and interaction layers.'], required, live, [c(bases)], [`${gen}:69`, `${def}:71`], '--foreground');
surface('muted', ['侧栏底色', 'Muted surface'], ['左侧栏、次要按钮和淡色区块的底色。', 'Sidebar and subdued layers, default seed for subtle.'], required, live, [c(['surface.foreground','surface.mutedForeground'])], [`${gen}:71`, `${gen}:97`, `${gen}:125`], '--muted');
surface('mutedForeground', ['辅助文字', 'Muted text'], ['说明、占位文字、引用和部分行号。', 'Secondary text and hints; feeds quotes, tools, line numbers and draft PRs.'], required, live, [c(bases)], [`${gen}:72`, `${def}:61`, `${gen}:304`], '--muted-foreground');
surface('elevated', ['卡片底色', 'Elevated surface'], ['卡片、弹出菜单和面板；未另设时也用作你的消息底色。', 'Cards, panels and popovers; default outgoing message color.'], required, live, [c(['surface.elevatedForeground', 'surface.foreground', 'surface.mutedForeground'])], [`${gen}:74`, `${gen}:289`], '--card');
surface('elevatedForeground', ['卡片文字', 'Elevated text'], ['卡片和部分弹出菜单的文字，也用作终端的亮白色。', 'Card or popover text, and bright white in the terminal palette.'], inherited('surface.foreground'), live, [c(['surface.elevated'])], [`${def}:44`, `${gen}:75`, `${UI}/lib/terminalTheme.ts:62`], '--card-foreground');
surface('subtle', ['轻高亮底色', 'Subtle surface'], ['侧栏高亮、次要悬停和部分编辑器提示的底色。', 'Accent surfaces and editor hint backgrounds, not the main accent.'], inherited('surface.muted'), live, [c(['surface.foreground'])], [`${def}:44`, `${gen}:89`, `${shiki}:336`], '--accent');
surface('overlay', ['认证光晕', 'Auth overlay'], ['只在访问认证画面能看到，不会改变其他弹窗的遮罩。', 'Radial wash on the access gate, not the universal modal backdrop.'], derived('黑色，不透明度 60%。', [], 'resolved', '#00000099'), partial, [], [`${def}:44`, `${gen}:197`, `${UI}/components/auth/SessionAuthGate.tsx:261`], '--surface-overlay');

const primary = (key, ...items) => add('accent', `primary.${key}`, ...items);
primary('base', ['强调色', 'Accent'], ['主按钮和加载指示的颜色，也影响聊天链接和 Mermaid 图。', 'Main controls, loading indicator, link and Mermaid seed.'], required, live, [c(bases), c(['primary.foreground'])], [`${gen}:83`, `${gen}:142`, `${readable}:16`, `${UI}/components/chat/markdown/MarkdownMermaid.tsx:102`], '--primary-base');
primary('foreground', ['主按钮文字', 'On-accent text'], ['实色主按钮上的文字和图标。', 'Label/icon on solid accent controls; pair with the accent.'], derived('在强调色上选更清楚的黑色或白色；无法计算时用白色。', ['primary.base','surface.background']), live, [c(['primary.base'])], [`${def}:68`, `${gen}:84`], '--primary-foreground');
primary('hover', ['默认链接悬停', 'Default link hover'], ['仅在没有单独设置「链接悬停」时，影响 Markdown 链接。', 'Markdown links use this when no separate hover colour is set.'], derived('90% 强调色加 10% 黑色（浅色主题）或白色（深色主题）。', ['primary.base','metadata.variant']), partial, [c(main)], [`${def}:68`, `${gen}:182`, `${gen}:301`], '--primary-hover');
primary('active', ['强调色按下', 'Pressed accent'], ['这一版不会在界面显示这个颜色。', 'OpenChamber does not display this colour in this version.'], derived('80% 强调色加 20% 黑色（浅色主题）或白色（深色主题）。', ['primary.base','metadata.variant']), dead, [], [`${def}:68`, `${gen}:183`], '--primary-active');
primary('muted', ['淡强调色', 'Muted accent'], ['这一版不会在界面显示这个颜色。', 'OpenChamber does not display this colour in this version.'], derived('强调色，不透明度 50%。', ['primary.base'], 'css'), dead, [], [`${gen}:185`], '--primary-muted');

const interactive = (key, ...items) => add('accent', `interactive.${key}`, ...items);
interactive('border', ['边线', 'Border'], ['输入框、分隔线和侧栏边线；只改颜色，不改线宽。', 'Global edges, inputs and dividers; does not control stroke width.'], required, live, [c(bases, 3)], [`${gen}:80`, `${gen}:115`], '--border');
interactive('borderHover', ['悬停边线', 'Border on hover'], ['部分控件的强化边线，也用于代码里显示空白字符。', 'Brightens some borders and marks spaces in the editor.'], derived('70% 边线色加 30% 正文色。', ['interactive.border','surface.foreground']), partial, [c(main, 3)], [`${def}:71`, `${shiki}:338`, `${gen}:205`], '--interactive-border-hover');
interactive('borderFocus', ['聚焦边框', 'Focus border'], ['这一版没有效果。要改键盘聚焦提示，请用「焦点环」。', 'This has no effect in this version. To change the keyboard outline, use Focus ring.'], inherited('primary.base'), dead, [], [`${gen}:206`, `${UI}/styles/design-system.css:1094`], '--interactive-border-focus');
interactive('focus', ['聚焦色', 'Focus colour'], ['这一版没有效果。要改键盘聚焦提示，请用「焦点环」。', 'This has no effect in this version. To change the keyboard outline, use Focus ring.'], inherited('primary.base'), dead, [], [`${def}:71`, `${gen}:209`], '--interactive-focus');
interactive('focusRing', ['焦点环', 'Focus ring'], ['按 Tab 或聚焦输入框时，控件周围的提示线；不改粗细。', 'Keyboard focus indicators; does not change thickness.'], derived('强调色，不透明度 50%。', ['primary.base']), live, [c(bases, 3)], [`${def}:71`, `${gen}:95`, `${UI}/styles/design-system.css:300`], '--interactive-focus-ring');
interactive('selection', ['选中底色', 'Selection background'], ['选中的会话、菜单项和文字用这层底色。', 'The background of selected conversations, menu items, and text.'], derived('正文色，不透明度 16%。', ['surface.foreground']), live, [c(['interactive.selectionForeground', 'surface.mutedForeground']), c(['pr.open', 'pr.draft', 'pr.blocked', 'pr.merged', 'pr.closed','status.error','status.warning','status.success','status.info'],3)], [`${def}:45`, `${gen}:207`, `${UI}/styles/design-system.css:779`, `${UI}/lib/terminalTheme.ts:42`], '--interactive-selection');
interactive('selectionForeground', ['选中文字', 'Selected text'], ['选中的标题或文字会变色；时间、分支名和终端字色不变。', 'Selected titles and text change colour. Times, branch names, and terminal ink do not.'], derived('从正文色出发，让字在选中底色上清楚可读。', ['surface.foreground','interactive.selection','surface.background']), live, [c(['interactive.selection'])], [`${def}:73`, `${gen}:208`, `${gen}:282`, `${UI}/lib/terminalTheme.ts:43`, `${UI}/lib/terminalTheme.ts:92`], '--interactive-selection-foreground');
interactive('cursor', ['终端光标', 'Terminal cursor'], ['终端中提示下一个字符位置的光标。', 'The cursor marking where the next character goes in the terminal.'], inherited('syntax.base.foreground'), partial, [c(['surface.background'], 3)], [`${def}:71`, `${UI}/lib/terminalTheme.ts:39`, `${UI}/lib/terminalTheme.ts:98`], '--interactive-cursor');
interactive('hover', ['悬停底色', 'Hover background'], ['鼠标移到部分列表项或按钮上时的底色。', 'The background when you hover over some rows or buttons.'], derived('正文色，不透明度 7%。', ['surface.foreground']), live, [c(['surface.foreground'])], [`${def}:72`, `${gen}:212`, `${UI}/components/layout/PluginPane.tsx:257`], '--interactive-hover');
interactive('active', ['按下底色', 'Pressed background'], ['部分按钮按下时、或在编辑器里标记一段代码时的底色。', 'The background of some pressed buttons and marked editor ranges.'], derived('正文色，不透明度 12%。', ['surface.foreground']), live, [c(['surface.foreground'])], [`${def}:72`, `${gen}:213`, `${UI}/components/layout/PluginPane.tsx:263`], '--interactive-active');

const statuses = [
  ['error', '错误', 'Error', '删除差异、终端红色、关闭 PR', 'deletions, terminal red and closed PRs'],
  ['warning', '警告', 'Warning', '风险提示、终端黄色、阻塞 PR', 'warnings, terminal yellow and blocked PRs'],
  ['success', '成功', 'Success', '新增差异、终端绿色、Build 与开放 PR', 'additions, terminal green, Build and open PRs'],
  ['info', '信息', 'Info', '信息提示、修改差异与编辑诊断', 'information, changed lines and diagnostics'],
];
for (const [key, zh, en, zhWhere, enWhere] of statuses) {
  const stem = `status.${key}`;
  add('status', stem, [`${zh}色`, `${en} color`], [`用于${zhWhere}，也影响状态标签的字色。`, `Used for ${enWhere}; also the readable text seed.`], required, live, [c(bases)], [`${gen}:217`, `${readable}:18`, `${UI}/lib/terminalTheme.ts:46`], `--status-${key}`);
  const fg = key === 'error' ? ['实心危险按钮、Windows 窗口关闭反馈。', 'Solid destructive controls and Windows close feedback.']
    : key === 'info' ? ['移动端工作台抽屉的少数实心信息标记。', 'An info badge in the mobile workspace drawer.']
      : ['这一版不显示这个颜色，标签的字色取决于对应的状态色。', 'This setting has no effect in this version; the badge uses a colour based on its status.'];
  add('status', `${stem}Foreground`, [`${zh}色上文字`, `${en} on-color`], fg,
    derived('在实色状态按钮上选更清楚的黑色或白色。', [stem,'surface.background']),
    key === 'error' ? live : key === 'info' ? partial : dead, [c([stem])], [`${def}:49`, `${gen}:217`, `${readable}:22`], `--status-${key}-foreground`);
  add('status', `${stem}Background`, [`${zh}底色`, `${en} background`], ['通知、状态标签和改动摘要的底色。', 'The background of notices, status badges, and change summaries.'],
    derived('状态色，透明度 12.5%。', [stem]), live, [c([stem])], [`${def}:50`, `${readable}:23`, `${gen}:324`], `--status-${key}-background`);
  add('status', `${stem}Border`, [`${zh}边框`, `${en} border`], ['状态提示、按钮或标签边界；仅改颜色，不改线宽。', 'Edges of status notices or controls; color, not stroke width.'],
    derived('状态色，透明度 31.4%。', [stem]), live, [c(bases, 3)], [`${def}:51`, `${gen}:217`], `--status-${key}-border`);
}

for (const [key, zh, en, fallback] of [
  ['open','开放','Open', inherited('status.success')], ['draft','草稿','Draft',inherited('surface.mutedForeground')],
  ['blocked','阻塞','Blocked',inherited('status.warning')], ['merged','已合并','Merged',derived('深色用 #8957e5，浅色用 #8250df。',['metadata.variant'])],
  ['closed','已关闭','Closed',inherited('status.error')],
]) add('pr', `pr.${key}`, [`${zh}标记`, `${en} badge`], ['仅相应 PR 徽标、引用选择器或工作区状态。', 'Specific PR badges, reference pickers or workspace status.'], fallback, partial, [c(bases, 3)], [`${def}:81`, `${gen}:243`, `${UI}/components/references/PullStackRows.tsx:11`], `--pr-${key}`);

const syntaxBase = [
  ['background','代码底色','Code background'], ['foreground','代码正文','Code text'], ['comment','注释','Comments'],
  ['keyword','关键字','Keywords'], ['string','字符串','Strings'], ['number','数字','Numbers'], ['function','函数','Functions'],
  ['variable','变量','Variables'], ['type','类型','Types'], ['operator','运算符','Operators'],
];
for (const [key, zh, en] of syntaxBase) {
  const terminal = ['foreground','comment','keyword','function','type'].includes(key);
  const agent = ['keyword','string','number','function','variable','type','operator'].includes(key);
  const role = `syntax.base.${key}`;
  add('syntax-base', role, [zh, en], key === 'background'
    ? ['右侧文件编辑器的底色；聊天里的代码块不跟着换底。', 'The file editor background. This does not change the background of chat code blocks.']
    : key === 'foreground' ? ['代码里没有特别着色的文字，也影响终端正文。', 'Code that has no special highlighting, and regular terminal text.']
      : [`代码里的${zh}${terminal ? '，也影响部分终端文字' : ''}${agent ? '；OpenChamber 也会用它区分 Agent' : ''}。`, `${en} in code${terminal ? ', and some terminal text' : ''}${agent ? '; OpenChamber also uses it to distinguish agents' : ''}.`],
  ['background','foreground'].includes(key) ? inherited(`surface.${key}`) : required, live,
  [c(key === 'background' ? ['syntax.base.foreground'] : terminal ? [...code, 'surface.background'] : code)],
  [`${def}:46`, `${gen}:254`, `${cm}:23`, `${shiki}:311`, ...(terminal ? [`${UI}/lib/terminalTheme.ts:31`] : []), ...(agent ? [`${UI}/lib/agentColors.ts:9`] : [])], `--syntax-${key}`);
}

for (const [key, zh, en, parent, hint, eng, effect, contrast, line] of [
  ['diffAdded','新增标记','Added marker','status.success','编辑器行号旁的新增长条，部分差异视图也用作新增文字色。','The mark beside added lines in the editor; some diff views also use it for added text.',partial,[c(code)],54],
  ['diffAddedBackground','新增语法底色','Inserted syntax background','syntax.highlights.diffAdded','仅传给 TextMate 的新增背景；工具预览的底色另设。','TextMate diff background metadata only, not tool/Pierre row tint.',partial,[c(['syntax.base.foreground'])],58],
  ['diffRemoved','删除标记','Deleted marker','status.error','编辑器行号旁的删除长条，部分差异视图也用作删除文字色。','The mark beside removed lines in the editor; some diff views also use it for removed text.',partial,[c(code)],55],
  ['diffRemovedBackground','删除语法底色','Removed syntax background','syntax.highlights.diffRemoved','仅传给 TextMate 的删除背景；工具预览的底色另设。','TextMate diff background metadata only, not tool/Pierre row tint.',partial,[c(['syntax.base.foreground'])],59],
  ['diffModified','修改标记','Modified marker','status.info','编辑器行号旁的修改长条。','Modified marker in file editor gutter; also retained in TextMate mapping.',partial,[c(code,3)],56],
  ['diffModifiedBackground','修改语法底色','Modified syntax background','syntax.highlights.diffModified','这一版不会显示这个底色。','Resolved by the parser but not read by current renderers.',dead,[],60],
  ['lineNumber','行号','Line numbers','surface.mutedForeground','编辑器、部分代码显示的行号。','Editor gutter and some code-line numbers.',partial,[c(code)],61],
  ['lineNumberActive','活动行号','Active line number','syntax.base.foreground','CodeMirror 当前活动行号，另通过 TextMate 适配器输出。','Active CodeMirror line number; also emitted to TextMate.',partial,[c(code)],61],
]) {
  add('syntax-highlights', `syntax.highlights.${key}`, [zh, en], [hint,eng],
    key.endsWith('Background') ? derived(`以 ${parent} 设透明度 12.5%。`, [parent]) : inherited(parent),
    effect, contrast, [`${def}:${line}`, ...((key === 'diffModifiedBackground') ? [] : [`${shiki}:319`, `${fileEditor}:199`, `${cm}:106`])],
    key === 'lineNumber' ? '--syntax-line-number' : null);
}

// Each dependency begins with @ for another detailed role; ordered from left to right.
const tokenSpecs = [
  ['commentDoc','文档注释','Documentation comment','comment'],
  ['stringEscape','转义字符','String escape','foreground'], ['stringInterpolation','插值','String interpolation','variable'], ['stringRegex','正则字符串','String regex','string'],
  ['keywordControl','控制关键字','Control keyword','keyword'], ['keywordOperator','运算关键字','Operator keyword','operator'], ['keywordImport','导入关键字','Import keyword','operator'], ['keywordReturn','返回关键字','Return keyword','keyword'],
  ['storageModifier','声明修饰符','Storage modifier','keyword'],
  ['functionCall','函数调用','Function call','function'], ['functionBuiltin','内置函数','Built-in function','function'], ['method','方法','Method','function'], ['methodCall','方法调用','Method call','@method','function'],
  ['variableBuiltin','内置变量','Built-in variable','variable'], ['variableProperty','对象属性','Object property','variable'], ['variableReadonly','只读变量','Read-only variable','number'],
  ['variableOther','其他变量','Other variable','variable'], ['variableGlobal','全局变量','Global variable','string'], ['variableLocal','局部变量','Local variable','variable'],
  ['parameter','参数','Parameter','@stringEscape','foreground'],
  ['typePrimitive','原始类型','Primitive type','type'], ['typeInterface','接口类型','Interface type','@interface','type'], ['interface','接口','Interface','type'],
  ['class','类','Class','@className','type'], ['className','类名','Class name','@class','type'], ['struct','结构体','Struct','@className','@class','type'], ['enum','枚举','Enum','@className','@class','type'], ['typeParameter','泛型参数','Type parameter','type'],
  ['boolean','布尔值','Boolean','keyword'], ['null','空值','Null','number'], ['constant','常量','Constant','number'],
  ['punctuation','标点','Punctuation','comment'], ['delimiter','分隔符','Delimiter','@punctuation','comment'], ['bracket','括号','Bracket','foreground'],
  ['tag','标签','Tag','keyword'], ['jsxTag','JSX 标签','JSX tag','@tag','keyword'], ['tagAttribute','标签属性','Tag attribute','@variableProperty','variable'], ['tagAttributeValue','属性值','Attribute value','string'],
  ['tagBracket','标签括号','Tag bracket','@punctuation','comment'],
  ['decorator','装饰器','Decorator','function'], ['annotation','注解','Annotation','function'], ['namespace','命名空间','Namespace','type'], ['module','模块','Module','operator'],
  ['label','标签名','Label','operator'], ['macro','宏','Macro','keyword'], ['preprocessor','预处理','Preprocessor','operator'], ['regex','独立正则','Standalone regular expression','string'], ['url','URL 字面量','URL literal','string'],
  ['key','对象键','Object key','@variableProperty','variable'], ['exception','异常类型','Exception','operator'],
];
const cmLines = readFileSync(join(source, cm), 'utf8').split('\n');
const synLines = readFileSync(join(source, syn), 'utf8').split('\n');
for (const [key, zh, en, ...chain] of tokenSpecs) {
  const path = `syntax.tokens.${key}`;
  const sample = measured.get(full(path));
  const adapters = sample.directThemeAdapters;
  const cmIndex = cmLines.findIndex((line) => new RegExp(`\\btokens\\.${key}\\b`).test(line));
  const manual = cmIndex >= 0 || adapters.markdown?.includes('--md-syntax-property');
  const where = [adapters.textMateScopes?.length && 'Shiki/TextMate', adapters.zed?.length && 'Zed/Pierre', cmIndex >= 0 && 'CodeMirror',
    adapters.markdown?.includes('--md-syntax-property') && 'Markdown'].filter(Boolean);
  const chosen = where.length > 0 || manual;
  const deps = chain.map((name) => name.startsWith('@') ? `syntax.tokens.${name.slice(1)}` : `syntax.base.${name}`);
  const locations = [...new Set(where.map((name) => name === 'CodeMirror' ? '编辑器' : name === 'Zed/Pierre' ? '差异视图' : '代码块'))];
  const locationsEn = [...new Set(where.map((name) => name === 'CodeMirror' ? 'the editor' : name === 'Zed/Pierre' ? 'diff views' : 'code blocks'))];
  const hint = chosen ? [`${locations.join('、')}里的${zh}，具体哪些文字着色取决于编程语言。`, `${en} in ${locationsEn.join(', ')}; the exact highlighting depends on the language.`]
    : ['这一版不会在代码中显示这个颜色。', 'OpenChamber does not show this colour in code in this version.'];
  const synIndex = synLines.findIndex((line) => new RegExp(`\\b${key}\\b`).test(line));
  add('syntax-tokens', path, [zh,en], hint, chain.length === 1 ? inherited(deps[0]) : rst('inherit', '没单独设置时，沿用先找到的相关颜色。', deps),
    chosen ? partial : dead, [c(code)],
    [`${syn}:${synIndex + 1}`, `${gen}:269`, ...(adapters.textMateScopes?.length ? [`${shiki}:32`] : []),
      ...(adapters.zed?.length ? [`${zed}:17`] : []), ...(cmIndex >= 0 ? [`${cm}:${cmIndex + 1}`] : []), `${mdSyntax}:22`],
    `--syntax-${key.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`);
}

const chat = (key, ...items) => add('chat', `chat.${key}`, ...items);
chat('userMessageBackground', ['用户消息底色', 'Outgoing message surface'], ['用户消息区域的色块；不修改气泡形状。', 'Outgoing message fill; does not change shape.'], inherited('surface.elevated','css'), live, [c(['surface.foreground','surface.mutedForeground'])], [`${gen}:289`], '--chat-user-message-bg');
chat('background', ['备用行内代码底色', 'Fallback inline code background'], ['只在没设「行内代码底色」时生效，不改聊天页。', 'Used when the inline code background is not set. Does not change the chat page.'], inherited('surface.background','css'), partial, [c(['markdown.inlineCode'])], [`${gen}:298`, `${gen}:303`, `${UI}/index.css:2044`], '--markdown-inline-code-bg');
chat('divider', ['工作状态分隔线', 'Work Status divider'], ['只改工作状态扩展里的分隔线。', 'Read by the Work Status guest view, not all chat separators.'], inherited('interactive.border','css'), partial, [c(main,3)], [`${gen}:290`, `${UI}/components/chat/work-status/WorkStatusGuestView.tsx:131`], '--chat-divider');

for (const [key, cssName, zh, en, hint, eng, fallback, effect, contrast, line] of [
  ['link','link','链接','Link','Markdown 链接文字。','Markdown link text.',inherited('primary.base','css'),live,[c(main)],300],
  ['linkHover','link-hover','链接悬停','Link on hover','鼠标停在 Markdown 链接上时的字色。','The text colour when you hover over a Markdown link.',inherited('primary.hover','css'),partial,[c(main)],301],
  ['inlineCode','inline-code','行内代码','Inline code','正文行内代码文字。','Text of inline code in prose.',inherited('syntax.base.string','css'),live,[c(['markdown.inlineCodeBackground'])],302],
  ['inlineCodeBackground','inline-code-bg','行内代码底色','Inline code surface','正文及笔记编辑的行内代码底色。','Inline code fill in prose and Notes.',rst('inherit','按 chat.background → surface.background 回退。',['chat.background','surface.background'],'css'),live,[c(['markdown.inlineCode'])],303],
  ['blockquote','blockquote','引用文字','Quote text','Markdown 引用文字。','Markdown blockquote text.',inherited('surface.mutedForeground','css'),live,[c(main)],304],
  ['blockquoteBorder','blockquote-border','引用侧线','Quote rule','Markdown 引用边线，不改粗细。','Markdown quote rule, not its thickness.',inherited('interactive.border','css'),live,[c(main,3)],305],
  ['listMarker','list-marker','列表符号','List marker','这一版的列表符号不随此颜色变化。','This version does not change list marker colours.',derived('强调色，不透明度 60%。',['primary.base'],'css'),dead,[],306],
  ['bold','bold','粗体文字','Bold text','Markdown 粗体颜色，不改字重。','Markdown bold color, not weight.',inherited('surface.foreground','css'),live,[c(main)],307],
  ['italic','italic','斜体文字','Italic text','Markdown 斜体颜色，不改字体。','Markdown italic color, not style.',derived('正文色透明度 90%。',['surface.foreground'],'css'),live,[c(main)],308],
  ['strikethrough','strikethrough','删除线文字','Struck text','Markdown 删除线片段的文字颜色。','Struck Markdown text color.',inherited('surface.mutedForeground','css'),live,[c(main)],309],
  ['hr','hr','水平分隔线','Horizontal rule','Markdown 水平线。','Markdown horizontal rule.',inherited('interactive.border','css'),live,[c(main,3)],310],
]) add('markdown', `markdown.${key}`, [zh,en], [hint,eng], fallback, effect, contrast, [`${gen}:${line}`], `--markdown-${cssName}`);

for (const [path, name, zh, en, hint, eng, fallback, effect, contrast, line] of [
  ['border','border','工具边框','Tool border','工具组与卡片分隔。','Tool group and card dividers.',derived('边框色透明度 30%。',['interactive.border'],'css'),live,[c(main,3)],318],
  ['icon','icon','工具图标色','Tool icon tint','工具行和通知图标颜色；不替换图标。','Tool and notice icon tint; does not replace icons.',inherited('surface.mutedForeground','css'),live,[c(main,3)],319],
  ['title','title','工具标题','Tool title','工具行、执行活动标题。','Tool rows and activity titles.',inherited('surface.foreground','css'),live,[c(main)],320],
  ['description','description','工具说明','Tool caption','工具辅助说明、路径、活动文本。','Tool captions, paths and activity text.',derived('次级文字色透明度 60%。',['surface.mutedForeground'],'css'),live,[c(main)],321],
  ['edit.addedBackground','edit-added-bg','新增行底色','Added row background','部分工具卡片里新增代码行的底色。','The background of added lines in some tool cards.',inherited('status.successBackground','css'),partial,[c(['syntax.base.foreground'])],324],
  ['edit.removedBackground','edit-removed-bg','删除行底色','Removed row background','部分工具卡片里删除代码行的底色。','The background of removed lines in some tool cards.',inherited('status.errorBackground','css'),partial,[c(['syntax.base.foreground'])],325],
  ['edit.modifiedBackground','edit-modified-bg','修改行底色','Modified line background','这一版的改动预览不显示这个底色。','This colour is not shown in change previews in this version.',inherited('status.infoBackground','css'),dead,[],326],
  ['edit.lineNumber','edit-line-number','工具差异行号','Tool diff line number','工具差异预览的新增与删除行号。','Numbers for added and deleted lines in tool diff previews.',derived('次级文字色透明度 60%。',['surface.mutedForeground'],'css'),partial,[c(['tools.edit.addedBackground','tools.edit.removedBackground'])],327],
]) add('tools', `tools.${path}`, [zh,en], [hint,eng], fallback, effect, contrast, [`${gen}:${line}`], `--tools-${name}`);

for (const [path, zh, en, hint, eng, effect, line, variable] of [
  ['fonts.sans','主题界面字体','Theme interface font','以外观设置中的「界面字体」为准，改文件里的这一项不会生效。','Ordinary value is overruled by interface preference; use the L2 setting.',dead,345,'font-sans'],
  ['fonts.mono','主题等宽字体','Theme monospace font','以外观设置中的「等宽字体」为准。','Ordinary value is overruled by monospace preference; use the L2 setting.',dead,349,'font-mono'],
  ['fonts.heading','主题标题字体','Theme heading font','这一版不能单独改标题字体。','No heading uses --font-heading; independent heading font is not available.',dead,352,'font-heading'],
  ['transitions.fast','快速过渡','Fast transition','这一版的界面动画不受此设置影响。','This setting does not change animations in this version.',dead,356,'transition-fast'],
  ['transitions.normal','常规过渡','Normal transition','这一版的界面动画不受此设置影响。','This setting does not change animations in this version.',dead,357,'transition-normal'],
  ['transitions.slow','慢速过渡','Slow transition','这一版的界面动画不受此设置影响。','This setting does not change animations in this version.',dead,358,'transition-slow'],
]) add('config', `config.${path}`, [zh,en], [hint,eng],
  path === 'transitions.fast' ? derived('样式表声明 150ms ease-in-out；主题不写时走 CSS 回退。', [], 'css','150ms ease-in-out') : none,
  effect, [], [`${gen}:${line}`, ...(path.startsWith('fonts.') ? [`${font}:28`] : [`${UI}/styles/typography.css:81`])], `--${variable}`);

for (const [key, zh, en, hint, eng, fallback, effect] of [
  ['name','主题名称','Theme name','主题选择器显示的名称。','Displayed in the theme picker.',required,live],
  ['id','主题 ID','Theme ID','用于主题身份、选择和文件替换；不能随便复用既有 ID。','Identity for theme selection and replacement; do not reuse an existing ID.',required,partial],
  ['variant','浅色或深色','Variant','决定主题出现在浅色还是深色列表，也影响系统控件；不会随底色自动切换。','Light/dark slots, CSS branch and native appearance; not inferred from luminance.',required,live],
  ['description','简介','Description','只保存在主题文件里，选主题时不显示。','Saved in the theme file, not shown in the theme picker.',derived('空字符串。',[],'schema',''),dead],
  ['author','作者','Author','随主题文件保留，常规选择器不展示。','Retained in theme file; not shown in the ordinary picker.',none,dead],
  ['version','版本','Version','记录主题自己的版本，不限制 OpenChamber 版本。','The theme’s own version. Does not limit which OpenChamber version can use it.',derived('1.0.0。',[],'schema','1.0.0'),dead],
  ['tags','标签','Tags','随主题文件保留，不驱动颜色或选择器归类。','Retained in theme file; does not drive rendering or picker grouping.',derived('空数组。',[],'schema',[]),dead],
]) add('metadata', `metadata.${key}`, [zh,en], [hint,eng], fallback, effect, [], [`${UI}/contexts/ThemeSystemContext.tsx:348`, `${UI}/components/sections/openchamber/ThemeAppearancePicker.tsx:27`]);

assert.equal(rows.size, STYLE_PATHS.length);
const fields = [...rows.values()].sort((a, b) => {
  const groupIndex = (row) => groups.findIndex(({ id }) => id === row.group);
  return groupIndex(a) - groupIndex(b) || a.order - b.order;
});
assert.equal(fields.filter(({ quick }) => quick).length, quickRoles.size);
assert.ok(fields.every(({ tier, quick, effect }) => (tier === 'hidden') === (effect.kind === 'dead') && (!quick || tier === 'basic')));
const settings = settingsSpec.map((spec, index) => {
  const field = registry[spec.key];
  assert.ok(field, `missing L2 setting: ${spec.key}`);
  const { scope, perSurface = false, surfaces, derived = false, local = false } = field;
  return {
    ...spec, order: index + 1, scope, perSurface, surfaces: surfaces ?? ['web','desktop','vscode','mobile'], derived, local,
    storage: local ? 'device-local UI state' : scope === 'profile' ? 'preferences.json (+ UI cache)' : scope === 'instance' ? 'settings.json' : 'device-local settings',
    evidence: [`packages/web/server/lib/settings/settings-registry.json#fields.${spec.key}`, ...spec.evidence],
  };
});

const itemList = (key, values) => `  "${key}": [\n${values.map((row) => `    ${JSON.stringify(row)}`).join(',\n')}\n  ]`;
const catalog = `{\n  "schemaVersion": 1,\n  "openChamberVersion": "2.8.0",\n${[
  itemList('groups',groups), itemList('fields',fields), itemList('settingsGroups',settingsGroups), itemList('settings',settings),
].join(',\n')}\n}\n`;
if (rest.includes('--write')) writeFileSync(file('data/fields.json'), catalog);
console.log(`PASS · ${fields.length} L1 · ${settings.length} L2 · ${groups.length} L1 分组 · ${fields.filter((field) => field.effect.kind === 'dead').length} L1 未接线/仅文件元数据`);
