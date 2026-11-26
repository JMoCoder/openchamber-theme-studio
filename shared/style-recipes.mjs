import { onColor, resolveSyntaxTokens, ThemeValidationError } from './theme-core.mjs';
import { EFFECTIVE_FILLS, edit, get, hasVitalFailure, LIVE_COLORS, repairTheme, view } from './theme-derive-audit.mjs';
import { blend, hex, over, rgb } from './theme-derive-color.mjs';
import { DESIGNS } from './style-recipes-designs.mjs';
import { styleGuardrails } from './style-recipes-guards.mjs';
import { isMaterial, materialPaint, materialStatus } from './style-recipes-materials.mjs';

const words = (zh, en) => Object.freeze({ zh, en });
const fixedShape = words('OpenChamber 的圆角、线宽和阴影不会变。', 'OpenChamber keeps its corners, stroke widths, and shadows.');
const option = (key, name, initial, options) => Object.freeze({
  key, label: words(...name), default: initial,
  choices: Object.freeze(options.map(([value, zh, en]) => Object.freeze({ value, label: words(zh, en) }))),
});
const pairing = option('palettePair', ['配色搭档', 'Colour pairing'], 'auto', [
  ['auto', '自动搭配', 'Auto'], ['signal', '亮标', 'Signal'], ['studio', '工坊', 'Studio'], ['triad', '三色版', 'Three inks'],
]);
const pair = (key, name, first, second) => option(key, name, first[0], [first, second]);
const specs = [
  ['brutalism', '粗野主义', 'Brutalism',
    ['白纸或黑底、硬墨线、醒目的纯色色块；次要文字在选中行也清楚。', 'Paper or black, hard ink rules, and bright solid marks. Selected rows keep small labels readable.'],
    [option('edge', ['边线', 'Rules'], 'ink', [['ink', '黑白墨线', 'Black or white'], ['pigment', '带色墨线', 'Pigmented ink']]), pairing],
    { uiFontWeight: 'strong', monoFont: 'system-mono', padding: 110, layoutAnimations: false },
    ['不能改成直角、粗边或硬投影；标题不能单独换字体，也没有 700 或 900 字重。', 'No square corners, thick rules, cast shadows, separate heading font, or 700/900 weights.']],
  ['fauvism', '野兽派撞色', 'Fauvism',
    ['把大胆的颜料色留给侧栏；干净的画布上只加几笔撞色。', 'One painted sidebar, with a few contrasting marks on a quiet canvas.'],
    [option('pair', ['用色方式', 'Paint arrangement'], 'opposite', [['opposite', '大色面', 'Colour plane'], ['split', '加一笔', 'Extra stroke']]), pairing],
    { uiFontWeight: 'strong', uiFont: 'fixel', padding: 105 },
    ['不能加笔触纹理或渐变，也不能给每个区域分别设背景。', 'No brush textures, gradients, or a separate background for every region.']],
  ['terminal-retro', '终端复古', 'Phosphor Terminal',
    ['深色像磷光屏；浅色像印着磷绿或琥珀色条的白纸。', 'Phosphor ramps at night; green or amber stripes on white paper by day.'],
    [option('phosphor', ['光色', 'Phosphor'], 'green', [['green', '磷绿', 'Green'], ['amber', '琥珀', 'Amber']])],
    { uiFont: 'custom', customUiFont: 'Liberation Mono, DejaVu Sans Mono, Menlo, Consolas', monoFont: 'system-mono', uiFontWeight: 'balanced', layoutAnimations: false, mermaidRenderingMode: 'ascii', padding: 90 },
    ['不能加扫描线或荧光光晕；终端的错误、警告等颜色仍各自保留。', 'No scanlines or glow. Terminal errors and warnings keep their own colours.']],
  ['editorial-paper', '纸感编辑部', 'Editorial Paper',
    ['浅色是象牙纸和批注笔；深色用蓝墨作底、象牙色阅读、朱色批注。', 'Ivory paper and annotation ink by day; blue-black, ivory text, and vermilion notes at night.'],
    [option('paper', ['纸色', 'Paper'], 'cream', [['cream', '象牙纸', 'Ivory'], ['newsprint', '新闻纸', 'Newsprint']])],
    { uiFont: 'source-sans-3', monoFont: 'source-code-pro', uiFontWeight: 'regular', padding: 120, chatWidth: 'default' },
    ['不能加纸纹、双栏排版或单独的标题字体。', 'No paper grain, two-column layout, or separate heading font.']],
  ['swiss-minimal', '瑞士极简', 'Swiss Minimal',
    ['白纸或近黑，用细线分区；链接、按钮和选中行只用一种点色。', 'White or near-black, fine rules, and one signal ink for links, buttons and selection.'],
    [option('accent', ['选中色深浅', 'Selection tint'], 'pin', [['pin', '一点淡色', 'Light tint'], ['stripe', '色条明显', 'Clearer stripe']])],
    { uiFont: 'inter', uiFontWeight: 'balanced', monoFont: 'geist-mono', padding: 105, layoutAnimations: false },
    ['不能重新排列界面，或单独调整字距和字号层次。', 'Cannot change the layout, tracking, or type scale.']],
  ['eink', '墨水屏', 'E-Ink',
    ['用清楚的灰阶分出侧栏、正文和选中行；暖墨只暖文字。', 'Distinct greys define the sidebar, text and selection. Warm ink warms text, not paper.'],
    [option('ink', ['墨色', 'Ink'], 'neutral', [['neutral', '中性墨', 'Neutral'], ['warm', '暖墨', 'Warm']])],
    { uiFont: 'atkinson-hyperlegible', uiFontWeight: 'strong', layoutAnimations: false, monoFont: 'system-mono', padding: 115 },
    ['不能控制电子墨水刷新；状态颜色和部分动画仍会保留。', 'Does not control e-ink refresh. State colours and some animations remain.']],
  ['cyber-vapor', '赛博／蒸汽波', 'Cyber / Vaporwave',
    ['冷白或午夜色做底，把电光放进消息、细线和行内代码。', 'Cold white or midnight, with electric message fills, rules and inline code.'],
    [option('flavor', ['光色', 'Light'], 'cyber', [['cyber', '赛博冷光', 'Cyber'], ['vapor', '蒸汽波粉光', 'Vapor']])],
    { uiFont: 'geist-sans', monoFont: 'geist-mono', uiFontWeight: 'balanced', padding: 100 },
    ['不能加真实发光、背景图、渐变或故障动画。', 'No actual glow, backdrop images, gradients, or glitch effects.']],
  ['pixel-palette', '像素少色盘', 'Pixel Palette',
    ['背景、边线、字和代码复用四或六个色阶，再加一个强调色。', 'Surfaces, rules, text and code reuse four or six steps, plus one signal ink.'],
    [option('palette', ['色阶', 'Tonal steps'], 'four', [['four', '四阶', 'Four'], ['six', '六阶', 'Six']])],
    { uiFontWeight: 'strong', monoFont: 'iosevka', layoutAnimations: false, padding: 95 },
    ['不能改图标或做成像素网格；状态色仍用来区分错误、警告和成功。', 'No pixel grid or icon changes. State colours still identify errors, warnings and success.']],
  ['soft-glass', '柔和玻璃', 'Soft Glass',
    ['冷雾底上叠一层更亮的侧栏和半透明卡片，气泡留一点原配色的柔光。', 'A brighter rail and translucent cards over cool mist, with a trace of the original colour in the message.'],
    [option('glass', ['雾面颜色', 'Frost tone'], 'mist', [['mist', '中性雾', 'Neutral mist'], ['tint', '微染雾', 'Lightly tinted']])],
    { uiFont: 'dm-sans', uiFontWeight: 'regular', monoFont: 'commit-mono', padding: 115, layoutAnimations: true },
    ['不能新增磨砂效果，也不能改变 OpenChamber 已有的模糊强度。', 'No new blur or control over how much OpenChamber blurs.']],
  ['constructivist', '构成主义', 'Constructivist',
    ['米纸、朱红侧栏和黑墨，代码只用红、黑与灰；入夜换成墨黑底和正红侧栏。', 'Rice paper, a vermilion rail and black ink, with code in red, black and grey; ink black and true red at night.'],
    [pair('edition', ['印版', 'Edition'], ['poster', '朱砂海报', 'Vermilion poster'], ['leaflet', '红墨折页', 'Red-ink leaflet'])],
    { uiFont: 'inter', monoFont: 'iosevka', uiFontWeight: 'strong', padding: 105, layoutAnimations: false },
    ['不改变版式或印出纸纹；按钮与状态图标仍会出现原色及语义色。', 'No new layout or paper texture; actions and status marks retain colour.']],
  ['art-deco', '装饰艺术', 'Art Deco',
    ['象牙与香槟金接住日光，入夜后由金线划开漆墨和祖母绿。', 'Ivory and champagne catch the light by day; gold rules separate lacquer and emerald at night.'],
    [pair('metal', ['金属色', 'Metal'], ['champagne', '香槟金', 'Champagne gold'], ['bronze', '古铜', 'Antique bronze'])],
    { uiFont: 'dm-sans', monoFont: 'commit-mono', uiFontWeight: 'balanced', padding: 120 },
    ['能改金线的颜色，不会出现镀金反光或几何雕花。', 'Gold-coloured rules do not add reflections or geometric ornament.']],
  ['mineral-landscape', '青绿山水', 'Mineral Landscape',
    ['绢面与矿物青绿分给正文和侧栏，泥金只勾轮廓。', 'Silk, azurite and malachite occupy separate planes, with soft gold around the edges.'],
    [pair('pigment', ['矿物色', 'Pigment'], ['azurite', '石青', 'Azurite'], ['malachite', '石绿', 'Malachite'])],
    { uiFont: 'source-sans-3', monoFont: 'source-code-pro', uiFontWeight: 'regular', padding: 120, chatWidth: 'default' },
    ['没有绢纹、晕染或山形；侧栏和主画布使用同一套字色。', 'No silk grain, pigment washes or mountains; the rail and canvas share their text inks.']],
  ['retro-desktop', '旧日桌面', 'Retro Desktop',
    ['银灰窗体、彩色桌面、便笺黄和蓝链接；入夜换成海军蓝窗体。', 'Silver window chrome, a coloured desktop, note yellow and blue links; navy takes over at night.'],
    [pair('desktop', ['桌面色', 'Desktop colour'], ['classic', '经典桌面', 'Classic desktop'], ['alternate', '换一张桌面', 'Alternate desktop'])],
    { uiFont: 'inter', monoFont: 'system-mono', uiFontWeight: 'balanced', padding: 95, layoutAnimations: false },
    ['仅替换颜色，不会增添像素图标或立体窗体边框。', 'Colours only: no pixel icons or bevelled window frames.']],
  ['thermal-ramp', '热力色阶', 'Thermal Ramp',
    ['柠檬、杏橙到橙红一路升温；入夜是蓝墨画布与钢蓝侧栏，余火留在消息、代码卡和边线。', 'Lemon, apricot and orange-red climb a heat scale. At night, blue-black ink and a steel-blue rail set off the embers in messages, code cards and rules.'],
    [pair('heat', ['热区', 'Heat zone'], ['ramp', '热力色阶', 'Heat ramp'], ['ember', '余烬偏暖', 'Ember bias'])],
    { uiFont: 'geist-sans', monoFont: 'geist-mono', uiFontWeight: 'balanced', padding: 105 },
    ['是分区实色而非渐变，状态颜色仍分别表示成功、错误和警告。', 'Solid planes, not a gradient; success, error and warning still have their own colours.']],
  ['chalkboard', '粉笔黑板', 'Chalkboard',
    ['板面、木框和粉笔白分成三层，夜版保留教室里耐看的板绿。', 'Board, wood frame and chalk each get their own plane, with classroom green at night.'],
    [pair('board', ['板面', 'Board stock'], ['green', '绿黑板', 'Green board'], ['slate', '蓝石板', 'Blue slate'])],
    { uiFont: 'atkinson-hyperlegible', monoFont: 'system-mono', uiFontWeight: 'strong', padding: 115 },
    ['不会出现粉尘、手写字或木纹。', 'No chalk dust, handwriting or wood grain.']],
  ['stained-glass', '彩窗', 'Stained Glass',
    ['蓝宝石边栏、红宝石选中与一块可随配色变换的宝石气泡，镶在铅色细线里。', 'Lead-coloured rules hold a sapphire rail, ruby selection, and a jewel-tinted message that follows the palette.'],
    [pair('glasswork', ['玻璃拼色', 'Glasswork'], ['amber', '翠绿代码卡', 'Emerald code card'], ['emerald', '琥珀代码卡', 'Amber code card'])],
    { uiFont: 'fixel', monoFont: 'commit-mono', uiFontWeight: 'balanced', padding: 110 },
    ['颜色不透光，窗格形状仍是 OpenChamber 原样。', 'The paint is opaque; OpenChamber keeps the original shapes.']],
  ['kraft-label', '牛皮纸标签', 'Kraft Label',
    ['用牛皮纸装底，留一张更亮的标签给消息；夜版以黑卡纸托住牛皮色块。', 'Kraft stock carries paler message labels; at night, black card backs the kraft blocks.'],
    [pair('stock', ['纸材颜色', 'Stock colour'], ['kraft', '暖牛皮', 'Warm kraft'], ['mill', '再生纸', 'Recycled stock'])],
    { uiFont: 'source-sans-3', monoFont: 'source-code-pro', uiFontWeight: 'balanced', padding: 120 },
    ['标签不加纸纤维或贴纸阴影，不能单独改变输入框形状。', 'No paper fibres, sticker shadows or separate shape for the composer.']],
].map(([id, zh, en, desc, options, settings, limits]) => ({
  id, name: words(zh, en), description: words(...desc), options, settings, limits: [fixedShape, words(...limits)],
}));

function choicesFor(spec, options) {
  return Object.fromEntries(spec.options.map(({ key, default: initial, choices }) => [
    key, choices.some(({ value }) => value === options[key]) ? options[key] : initial,
  ]));
}

const statusInk = {
  light: { error: '#a42b40', warning: '#80421f', success: '#165437', info: '#244e90' },
  dark: { error: '#ff9398', warning: '#e6bd71', success: '#6ddd9a', info: '#93c2ff' },
};
const opacity = (value, byte) => hex({ ...rgb(value), a: byte / 255 });

// Schema adapter, not a style template. Only completes shared semantic roles
// (PRs, labels, aliases), leaving each builder's hierarchy and palette intact.
function nativePaint(colors, model, solidStatus, defaults = statusInk[model.variant]) {
  const { surface: s, primary: p, interactive: i, syntax: code, markdown: m, tools: t } = colors;
  const dark = model.dark, status = { ...defaults };
  s.elevatedForeground ??= s.foreground;
  s.subtle ??= s.muted;
  p.foreground ??= onColor(p.base, s.background);
  i.selectionForeground ??= s.foreground;
  i.borderHover ??= i.border;
  i.cursor ??= code.base.foreground;
  i.hover ??= opacity(s.foreground, 18);
  i.active ??= opacity(s.foreground, 30);
  m.blockquote ??= s.mutedForeground;
  m.blockquoteBorder ??= i.border;
  m.bold ??= s.foreground;
  m.italic ??= s.foreground;
  m.strikethrough ??= s.mutedForeground;
  m.hr ??= i.border;
  Object.assign(colors, {
    status,
    pr: { open: status.success, draft: s.mutedForeground, blocked: status.warning,
      merged: dark ? '#b8a7f0' : '#664784', closed: status.error, ...colors.pr },
  });
  t.title ??= s.elevatedForeground;
  t.description ??= s.mutedForeground;
  t.edit ??= {};
  t.edit.lineNumber ??= s.mutedForeground;
  const h = code.highlights ??= {};
  h.diffAdded ??= status.success;
  h.diffRemoved ??= status.error;
  h.diffModified ??= status.info;
  h.diffAddedBackground ??= opacity(status.success, 25);
  h.diffRemovedBackground ??= opacity(status.error, 25);
  h.lineNumber ??= s.mutedForeground;
  h.lineNumberActive ??= code.base.foreground;
  t.edit.addedBackground ??= h.diffAddedBackground;
  t.edit.removedBackground ??= h.diffRemovedBackground;
  for (const [key, ink] of Object.entries(defaults)) {
    const paint = key === 'success' ? t.edit.addedBackground : key === 'error' ? t.edit.removedBackground : null;
    // Hard print in Brutalism: every supported panel/mark is opaque. Other
    // styles keep the native tint relationship for details.
    status[`${key}Background`] = paint ?? (solidStatus ? hex(over({ ...rgb(ink), a: 32 / 255 }, rgb(s.background))) : opacity(ink, 32));
    status[`${key}Border`] = solidStatus ? ink : opacity(ink, 80);
  }
  status.errorForeground = onColor(status.error, s.background);
  status.infoForeground = onColor(status.info, s.background);
  const inherited = resolveSyntaxTokens({ base: code.base });
  const byKey = Object.fromEntries(LIVE_COLORS.filter(({ path }) =>
    path.startsWith('colors.syntax.tokens.') && get(model.definition, path) !== undefined)
    .map(({ path }) => [path.split('.').at(-1), inherited[path.split('.').at(-1)]]));
  if (Object.keys(byKey).length) code.tokens = byKey;
  if (get(model.definition, 'colors.chat.background') !== undefined) colors.chat.background = m.inlineCodeBackground;
  if (get(model.definition, 'colors.primary.hover') !== undefined) p.hover = m.linkHover;
  return Object.fromEntries(LIVE_COLORS.flatMap(({ path }) => {
    const value = get({ colors }, path);
    return value === undefined ? [] : [[path.slice(7), value]];
  }));
}

const fills = new Set([...Object.values(EFFECTIVE_FILLS), 'primary.base', 'markdown.link', 'markdown.linkHover']);
const solidHex = new Set(['surface.muted', 'surface.subtle', 'interactive.border']);
function project(definition, model, paint, strength, pin = false) {
  const editor = edit(definition);
  for (const [path, value] of Object.entries(paint)) {
    const current = model.color(path), target = rgb(value);
    const from = solidHex.has(path) && current && model.canvas ? over(current, model.canvas) : current;
    const selected = strength === 1 || pin && fills.has(path) ? value : hex(blend(from, target, strength));
    editor.set(`colors.${path}`, selected, 'style');
  }
  // Intentional level surfaces and pixel steps should not be increased by
  // the generic depth recommendation. Essential readability still applies.
  const repaired = repairTheme(editor.draft, { normalizeUnsupported: true, layers: false, diff: false });
  for (const { path, to, reason } of repaired.changes) editor.set(path, to, reason);
  return editor.result();
}

function applyMaterial(spec, definition, options, strength) {
  if (strength === 0) return { definition, changes: [] };
  let model;
  try {
    model = view(definition);
  } catch (error) {
    if (!(error instanceof ThemeValidationError)) throw error;
    return { definition, changes: [] };
  }
  const choice = spec.options[0];
  const alternate = choicesFor(spec, options)[choice.key] !== choice.default;
  const paint = materialPaint(spec.id, model, strength, alternate);
  return project(definition, model, nativePaint(paint, model, false, materialStatus(model.variant)), 1);
}

function apply(spec, definition, options = {}) {
  const strength = Number.isFinite(options.strength) ? Math.max(0, Math.min(1, options.strength)) : 1;
  if (isMaterial(spec.id)) return applyMaterial(spec, definition, options, strength);
  const model = view(definition);
  if (strength === 0) return { definition, changes: [] };
  const paint = nativePaint(DESIGNS[spec.id](model, choicesFor(spec, options)), model, spec.id === 'brutalism');
  let result = project(definition, model, paint, strength);
  const conflicts = () => hasVitalFailure(result.definition) || styleGuardrails(result.definition, spec.id).length;
  if (strength < 1 && conflicts()) {
    result = project(definition, model, paint, strength, true);
    if (conflicts()) {
      // Move the remaining ink toward its safe match before taking the
      // complete treatment. Mixed-polarity imports can still need the endpoint.
      result = project(definition, model, paint, (1 + strength) / 2, true);
      if (conflicts()) result = project(definition, model, paint, 1);
    }
  }
  return result;
}

export const STYLE_RECIPES = Object.freeze(specs.map((spec) => Object.freeze({
  id: spec.id, name: spec.name, description: spec.description,
  strength: Object.freeze({ min: 0, max: 1, default: 1 }),
  options: Object.freeze(spec.options), settings: Object.freeze(spec.settings), limits: Object.freeze(spec.limits),
  apply: (definition, options) => apply(spec, definition, options),
})));
export const styleRecipes = STYLE_RECIPES;
export function applyStyleRecipe(id, definition, options) {
  const recipe = STYLE_RECIPES.find((item) => item.id === id);
  if (!recipe) throw new RangeError(`Unknown style recipe: ${id}`);
  return recipe.apply(definition, options);
}
