#!/usr/bin/env node
// Theme Studio's authored palette relationships. Output is native theme JSON,
// not an authoring format loaded by OpenChamber. No changes outside presets/.
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const directory = fileURLToPath(new URL('../presets/', import.meta.url));
const syntaxRoles = ['keyword', 'string', 'number', 'function', 'variable', 'type', 'operator'];
const statusNames = ['error', 'warning', 'success', 'info'];
const clamp = (x) => Math.min(1, Math.max(0, x));
const gamma = (v) => clamp(v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const linear = (v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const byte = (v) => Math.round(255 * v).toString(16).padStart(2, '0');
function fromLch([l, c = 0, h = 0]) {
  const a = c * Math.cos(h * Math.PI / 180), b = c * Math.sin(h * Math.PI / 180);
  const x = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const y = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const z = (l - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z,
    -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z,
    -0.0041960863 * x - 0.7034186147 * y + 1.7076147010 * z,
  ];
}
function hex(color) {
  if (typeof color === 'string') return color;
  const [l, c = 0, h = 0] = color;
  let rgb = fromLch([l, c, h]);
  const inGamut = (v) => v.every((x) => x >= -1e-8 && x <= 1 + 1e-8);
  if (!inGamut(rgb)) {
    // Preserve hue and lightness: reduce chroma instead of clipping channels.
    let low = 0, high = c;
    for (let step = 0; step < 21; step++) {
      const mid = (low + high) / 2;
      if (inGamut(fromLch([l, mid, h]))) low = mid; else high = mid;
    }
    rgb = fromLch([l, low, h]);
  }
  return `#${rgb.map((v) => byte(gamma(v))).join('')}`;
}
const rgb = (color) => color.slice(1).match(/../g).map((x) => parseInt(x, 16) / 255);
const luminance = (color) => rgb(color).slice(0, 3).map(linear)
  .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
const alpha = (color, opacity) => `${color}${byte(opacity)}`;
function over(color, background, opacity = 1) {
  const [r, g, b, a = 1] = rgb(color);
  const k = a * opacity;
  return '#' + rgb(background).slice(0, 3).map((x, i) => byte(k * [r, g, b][i] + (1 - k) * x)).join('');
}
function contrast(foreground, background) {
  const x = luminance(foreground), y = luminance(background);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const shift = ([l, c = 0, h = 0], delta, dC = 0) => [clamp(l + delta), Math.max(0, c + dC), h];
function fit(recipe, dark, backplates, minimum) {
  for (let step = 0; step < 350; step++) {
    const color = hex(shift(recipe, (dark ? 1 : -1) * step * 0.002));
    if (backplates.every((bg) => contrast(color, bg) >= minimum)) return color;
  }
  throw new Error(`无法为 ${recipe.join('/')} 在 ${backplates.join('/')} 上达到 ${minimum}`);
}

const text = (zh, en) => ({ zh, en });
const style = (direction, label, keywords, sans, mono, [bodyPx, codePx, bodyWeight, headingWeight, lineHeight],
  [rhythmPx, density], [tempo, fastMs, normalMs, slowMs]) => ({
  direction, label, keywords,
  fonts: {
    sans: [sans, 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', 'system-ui', 'sans-serif'],
    mono: [mono, 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'monospace'],
  },
  typography: { bodyPx, codePx, bodyWeight, headingWeight, lineHeight },
  spacing: { rhythmPx, density },
  motion: { tempo, fastMs, normalMs, slowMs },
});
// Each recipe independently assigns canvas, rail, and popup elevations.
// Syntax positions: keyword / string / number / function / variable / type / operator.
const presets = [
  {
    slug: 'tidemark', name: text('澄潮', 'Tidemark'), family: 'tidal',
    description: text('海玻璃侧栏和近白留白，杏色标注把冷色界面点暖。', 'A sea-glass rail and near-white space, warmed by apricot annotations.'),
    signature: text('海玻璃边上贴一张杏色便签。', 'An apricot note clipped to sea glass.'),
    syntaxStrategy: text('冷墨主线，杏橘只强调字面量。', 'Cool ink for structure; apricot only on literal values.'),
    tags: ['fresh', 'sea-glass', 'soft'],
    style: style('watercolor-utility', '海玻璃', ['留白', '清澈', '轻快'], 'Inter', 'IBM Plex Mono', [14,12,400,600,1.62], [8,'open'], ['light',115,175,230]),
    light: { layout: 'soft', secondaryPr: 'blocked', backdrop: [[.992,.007,218],[.972,.017,175],[.982,.010,190]],
      primary: [.468,.109,218], secondary: [.477,.123,49], bubble: [.964,.031,54], selection: [.941,.047,184], border: [.894,.015,195], code: [.982,.012,196],
      syntax: [[.42,.105,217],[.49,.138,50],[.46,.080,57],[.46,.099,230],[.34,.021,217],[.51,.07,179],[.50,.033,216]],
      status: ['#740007','#774900','#004e3e','#0054a2'] },
    dark: { layout: 'rail-lift', secondaryPr: 'blocked', secondaryMode: 'annotation',
      backdrop: [[.203,.020,201],[.244,.022,174],[.264,.014,203]],
      primary: [.754,.113,219], secondary: [.765,.109,46], bubble: [.294,.031,231], selection: [.294,.048,194], border: [.324,.024,193], code: [.221,.014,201],
      syntax: [[.80,.100,217],[.82,.097,52],[.73,.125,54],[.78,.079,235],[.88,.021,217],[.74,.068,176],[.69,.027,211]],
      status: ['#ff958f','#ffdda8','#5deb63','#84bdff'] },
  },
  {
    slug: 'wheat-vellum', name: text('麦笺', 'Wheat Vellum'), family: 'vellum',
    description: text('奶白纸、靛墨与朱批；深版是台灯照着暖炭。', 'Cream paper with indigo ink and red annotations; warm graphite at night.'),
    signature: text('靛青写正文，朱红只批注。', 'Indigo writes the copy; seal red marks the notes.'),
    syntaxStrategy: text('靛、暖墨和朱批，关键词与函数共用主墨。', 'Indigo keywords and functions, warm ink, and a proofreader’s red.'),
    tags: ['editorial', 'paper', 'warm'],
    style: style('editorial-paper', '暖纸编辑部', ['纸感', '靛墨', '从容'], 'Source Sans 3', 'Source Code Pro', [15,13,400,650,1.70], [9,'open'], ['calm',160,240,340]),
    light: { layout: 'paper', secondaryPr: 'closed', secondaryMode: 'annotation',
      backdrop: [[.987,.013,91],[.954,.015,89],[.973,.017,88]],
      primary: [.409,.148,268], secondary: [.438,.132,23], bubble: [.944,.024,272], selection: [.924,.037,270], border: [.866,.014,81], code: [.969,.009,85],
      syntax: [[.41,.150,266],[.47,.129,34],[.45,.118,38],[.43,.136,265],[.34,.022,69],[.43,.072,247],[.47,.026,63]],
      status: ['#6e0019','#793c00','#005544','#005e97'] },
    dark: { layout: 'paper', secondaryPr: 'closed', secondaryMode: 'annotation',
      backdrop: [[.233,.007,76],[.193,.007,78],[.274,.010,76]],
      primary: [.780,.120,268], secondary: [.731,.161,24], bubble: [.313,.035,269], selection: [.316,.063,271], border: [.340,.012,73], code: [.242,.006,77],
      syntax: [[.80,.107,270],[.765,.133,35],[.73,.127,30],[.80,.101,267],[.890,.018,76],[.81,.054,244],[.71,.026,77]],
      status: ['#f39c9d','#ffd6b5','#33ee77','#4cbede'] },
  },
  {
    slug: 'quiet-graphite', name: text('静砚', 'Quiet Graphite'), family: 'neutral',
    description: text('纯白纸与银灰侧栏；只用钢蓝点出调用和注记。', 'White paper and silver-gray; a single steel-blue cue for calls and annotations.'),
    signature: text('石墨校样上，一支钢蓝笔圈出调用。', 'One steel-blue pen marks calls on a graphite proof.'),
    syntaxStrategy: text('灰阶为主，只有函数／调用是钢蓝。', 'Grayscale except for a single steel-blue function/call cue.'),
    tags: ['neutral', 'grayscale', 'focus'],
    style: style('eink-minimal', '墨水屏极简', ['银灰', '低噪', '专注'], 'IBM Plex Sans', 'IBM Plex Mono', [14,12,400,600,1.60], [8,'balanced'], ['restrained',70,110,160]),
    light: { layout: 'bright-card', secondaryPr: 'draft', secondaryMode: 'point', backdrop: ['#fdfdfd','#eeeeee','#ffffff'],
      tone: [0,0], primary: [.210], secondary: [.448,.105,247], bubble: [.973], selection: [.900], border: [.842], code: [.976],
      syntax: [[.247],[.49],[.395],[.448,.105,247],[.438],[.378],[.505]],
      status: ['#740007','#754a00','#004e3e','#00558f'] },
    dark: { layout: 'charcoal', secondaryPr: 'draft', secondaryMode: 'point', backdrop: [[.245],[.192],[.297]],
      primary: [.906], secondary: [.783,.089,244], bubble: [.305], selection: [.347], border: [.383], code: [.257],
      syntax: [[.91],[.73],[.83],[.783,.089,244],[.78],[.855],[.72]],
      status: ['#ffa19d','#ffdda6','#8ee360','#69c3ff'] },
  },
  {
    slug: 'blue-etch', name: text('蓝刻', 'Blue Etch'), family: 'blueprint',
    description: text('淡蓝图纸用钴蓝刻线分区，冰青做注记；深版展开普鲁士蓝底。', 'Pale blueprint paper, cobalt seams, ice-cyan annotations, and Prussian blue after dark.'),
    signature: text('淡蓝底片上一道清楚的钴蓝制图线。', 'A precise cobalt seam on pale blueprint paper.'),
    syntaxStrategy: text('淡蓝／深蓝制图底配冷色线稿，赤铜只充当尺寸标。', 'Cool technical linework; copper is reserved for dimension marks.'),
    tags: ['blueprint', 'precision', 'night'],
    style: style('blueprint-night', '普鲁士蓝图', ['刻线', '粉笔', '夜航'], 'Inter', 'JetBrains Mono', [14,12,450,650,1.55], [7,'compact'], ['precise',100,155,220]),
    light: { layout: 'seam', secondaryPr: 'merged', surfaceException: 'blueprint-paper',
      backdrop: [[.957,.026,228],[.957,.026,228],[.971,.020,234]],
      primary: [.482,.215,266], secondary: [.435,.100,200], bubble: [.914,.055,193], selection: [.898,.062,259], border: [.748,.057,250], code: [.961,.026,239],
      syntax: [[.42,.157,261],[.46,.100,202],[.454,.127,41],[.48,.161,255],[.346,.036,247],[.49,.084,231],[.47,.065,253]],
      status: ['#740007','#774900','#004e3e','#005882'] },
    dark: { layout: 'seam', secondaryPr: 'merged', surfaceException: 'prussian-blueprint',
      backdrop: [[.247,.055,252],[.249,.054,252],[.296,.057,250]],
      primary: [.824,.094,214], secondary: [.759,.114,179], bubble: [.319,.052,199], selection: [.335,.061,222], border: [.520,.090,249], code: [.234,.046,249],
      syntax: [[.873,.083,215],[.807,.105,181],[.841,.125,76],[.810,.105,248],[.902,.032,235],[.84,.059,231],[.73,.058,243]],
      status: ['#ff8f8c','#fddf50','#7aec97','#00c4ed'] },
  },
  {
    slug: 'kilnmark', name: text('朱窑', 'Kilnmark'), family: 'porcelain',
    description: text('白瓷、暖窑灰和朱砂印，青釉只作点染；夜间是中性窑黑。', 'White porcelain, warm kiln ash, and a vermilion stamp with a drop of celadon; neutral kiln-black at night.'),
    signature: text('白瓷落在窑灰上，朱砂盖印，只用一点青釉。', 'A stamped porcelain tile on kiln ash with one drop of celadon.'),
    syntaxStrategy: text('朱砂是控制流，青釉是函数和类型；其余沉到石墨。', 'Vermilion for control flow, celadon for functions and types, graphite elsewhere.'),
    tags: ['porcelain', 'red', 'celadon'],
    style: style('kiln-editorial', '白瓷朱印', ['白瓷', '朱砂', '青釉'], 'Source Sans 3', 'Fira Code', [15,12,450,650,1.62], [8,'balanced'], ['measured',130,200,280]),
    light: { layout: 'bright-card', secondaryPr: 'open', backdrop: ['#faf9f6',[.937,.016,81],'#ffffff'],
      primary: [.506,.205,32], secondary: [.431,.092,158], bubble: [.945,.022,156], inlineBg: [.919,.021,156],
      selection: [.915,.043,59], border: [.823,.017,79], code: [.974,.006,80],
      syntax: [[.485,.167,31],[.39,.046,248],[.482,.136,44],[.456,.111,179],[.37,.030,240],[.50,.073,166],[.43,.079,252]],
      status: ['#740007','#6f4900','#004b3c','#005882'] },
    dark: { layout: 'rail-lift', secondaryPr: 'open', backdrop: ['#151515',[.248,.007,247],[.279,.006,251]],
      primary: [.744,.165,40], secondary: [.781,.111,158], bubble: [.264,.030,153], selection: [.296,.030,244], border: [.364,.015,243], code: '#1a1a1a',
      syntax: [[.775,.151,42],[.81,.051,244],[.827,.14,65],[.830,.108,173],[.869,.022,235],[.80,.103,158],[.743,.063,249]],
      status: ['#ff84a0','#fddf50','#64e79a','#53bdfc'] },
  },
  {
    slug: 'reed-shade', name: text('芦影', 'Reed Shade'), family: 'reed',
    description: text('燕麦纸与苔绿按钮，用芦苇金标注，不再铺一整屏薄荷。', 'Oat-toned ground and moss actions, annotated in reed gold rather than a field of mint.'),
    signature: text('芦苇金像压在燕麦纸上的干叶。', 'Reed gold lies like a pressed leaf on oat paper.'),
    syntaxStrategy: text('苔绿和芦苇金双色调，变量与标点退成石灰。', 'Moss and reed-gold duotone, with limestone variables and punctuation.'),
    tags: ['botanical', 'oat', 'gentle'],
    style: style('botanical-quiet', '干叶标本', ['燕麦', '苔色', '柔边'], 'Atkinson Hyperlegible', 'Cascadia Mono', [15,13,400,700,1.66], [9,'open'], ['calm',155,235,330]),
    light: { layout: 'soft', secondaryPr: 'draft', secondaryMode: 'wash', backdrop: [[.981,.007,88],[.943,.014,117],[.974,.008,121]],
      primary: [.458,.127,164], secondary: [.306,.022,224], bubble: [.910,.054,94], selection: [.901,.052,146], border: [.904,.013,146], code: [.974,.009,103],
      syntax: [[.404,.102,162],[.422,.092,52],[.445,.033,218],[.408,.084,168],[.344,.041,199],[.466,.042,167],[.47,.025,213]],
      status: ['#740007','#6f4900','#004b3c','#005386'] },
    dark: { layout: 'soft', secondaryPr: 'blocked', secondaryMode: 'annotation',
      backdrop: [[.209,.019,155],[.169,.018,153],[.260,.014,150]],
      primary: [.760,.114,157], secondary: [.820,.113,88], bubble: [.295,.026,163], selection: [.304,.040,148], border: [.304,.019,152], code: [.222,.014,150],
      syntax: [[.78,.105,153],[.822,.133,86],[.79,.126,76],[.82,.083,151],[.89,.028,108],[.777,.049,139],[.723,.028,110]],
      status: ['#ff9b98','#ffd584','#48f4bd','#58c1ff'] },
  },
  {
    slug: 'hard-edge', name: text('硬边', 'Hard Edge'), family: 'hard-edge',
    description: text('纸白／近黑和纯色硬线，电青、橘红、钴蓝与铬绿只在小块出现。', 'Paper white and near-black: electric cyan, tangerine, cobalt and chrome green in small, solid blocks.'),
    signature: text('像丝网海报：黑白面干净，饱和色只印在小块。', 'Like a screen print: clean black and white, full color only in small blocks.'),
    syntaxStrategy: text('中性文件底，冷青字面结构加少量暖橘墨，硬色留在选区和变更。', 'Neutral file canvas; cyan structure and tangerine ink, with color blocks in selection and edits.'),
    tags: ['neo-brutalism', 'fauvist', 'solid'],
    style: style('neo-brutalism', '新粗野主义', ['硬边', '撞色', '海报感'], 'Space Grotesk', 'Space Mono', [15,13,500,700,1.52], [8,'compact'], ['snappy',65,105,150]),
    light: { layout: 'hard', secondaryPr: 'blocked', backdrop: ['#f7f7f7','#ffffff',[.963,.009,91]],
      primary: [.471,.145,211], secondary: [.383,.132,50], bubble: [.812,.170,59], selection: [.906,.154,190],
      inlineBg: [.835,.160,59], border: '#000000', code: '#fdfdfd',
      syntax: [[.365,.182,257],[.44,.159,41],[.453,.109,204],[.418,.141,211],[.352,.027,246],[.464,.131,257],[.430,.042,65]],
      status: ['#740007','#774900','#004e3e','#0054a2'] },
    dark: { layout: 'hard', secondaryPr: 'open', backdrop: ['#0a0a0a','#101010',[.230,.008,246]],
      primary: [.653,.157,210], secondary: [.824,.143,166], bubble: [.399,.110,183], selection: [.363,.183,257],
      inlineBg: [.424,.120,181], border: '#ffffff', code: '#101010',
      syntax: [[.883,.133,192],[.805,.146,60],[.856,.125,205],[.828,.156,250],[.927,.017,245],[.821,.113,166],[.804,.040,68]],
      status: ['#fc8882','#ffd074','#72e7b2','#70aaff'] },
  },
  {
    slug: 'dusk-margin', name: text('暮汀', 'Dusk Margin'), family: 'dusk',
    description: text('雾灰紫与紫炭的大面，银蓝色只落在气泡与注记。', 'A muted violet-gray ground by day and violet charcoal after dark, with silver-blue annotations.'),
    signature: text('侧栏像晚天，银蓝气泡是倒映的第一片灯光。', 'A twilight rail, with the first light reflected in a silver-blue bubble.'),
    syntaxStrategy: text('低彩光谱：暮紫结构、灰蓝参数，暖棕字符串只作远灯。', 'A muted spectrum: dusk-violet structure, slate parameters, and umber strings like distant lamps.'),
    tags: ['periwinkle', 'twilight', 'quiet'],
    style: style('blue-hour', '雾面蓝暮', ['暮色', '银蓝', '沉静'], 'IBM Plex Sans', 'Source Code Pro', [15,12,400,650,1.68], [9,'open'], ['measured',140,210,290]),
    // Pin the gamut-mapped near-neutrals to keep the same hue after 8-bit rounding.
    light: { layout: 'rail-lift', secondaryPr: 'merged', backdrop: [[.953,.010,297],'#f9f8fc','#f8f7fb'],
      subtle: '#fbfafe', overlay: '#01000499', code: '#f0edf8', selection: '#e2daf7',
      border: '#d1ceda', borderHover: '#bbb8c4', blockquoteBorder: '#b1acbf',
      primary: [.467,.125,273], secondary: [.441,.083,237], bubble: [.926,.027,238],
      syntax: [[.447,.097,287],[.461,.076,45],[.46,.091,240],[.473,.094,278],[.39,.036,239],[.469,.110,299],[.487,.050,264]],
      status: ['#740007','#704800','#004b3c','#005a7e'] },
    dark: { layout: 'bright-card', secondaryPr: 'merged', backdrop: [[.221,.016,295],'#201f24','#2b2932'],
      subtle: '#27252e', overlay: '#01000499', code: '#1d1b24', selection: '#342e48',
      border: '#3e3b48', borderHover: '#55535d', blockquoteBorder: '#605c6e',
      primary: [.768,.115,273], secondary: [.827,.068,235], bubble: [.278,.043,235],
      syntax: [[.826,.091,295],[.788,.084,54],[.803,.076,229],[.83,.081,267],[.907,.034,238],[.792,.105,307],[.728,.042,259]],
      status: ['#ff8f89','#ffd074','#72e7b2','#54bcff'] },
  },
  {
    slug: 'zero-hour', name: text('零时', 'Zero Hour'), family: 'terminal',
    description: text('白昼用酸柠当荧光笔；深夜给酸柠信号和纯黑画布留足空间。', 'Acid citron as a marker by day and a signal against a truly black canvas at night.'),
    signature: text('一条荧光刻度划过白屏，入夜画布熄成全黑。', 'A highlighter mark on white; after midnight, the canvas goes black.'),
    syntaxStrategy: text('信号梯度：近单色底稿，类型与数字作荧光读数。', 'Signal levels: near-monochrome copy, with highlighted type and number readouts.'),
    tags: ['citron', 'terminal', 'oled'],
    style: style('retro-terminal', '白昼／午夜终端', ['电讯', '黑场', '荧光笔'], 'IBM Plex Sans', 'JetBrains Mono', [14,13,450,650,1.54], [7,'compact'], ['restrained',70,115,165]),
    light: { layout: 'signal', secondaryPr: 'draft', secondaryMode: 'wash', backdrop: ['#ffffff','#f7f7f7','#efefef'],
      primary: [.320,.057,244], secondary: [.417,.020,247], bubble: [.961,.091,108], selection: [.944,.106,111], border: [.886,.014,250], code: '#f8f8f8',
      syntax: [[.345,.052,244],[.45,.013,247],[.410,.070,224],[.429,.070,246],[.365,.031,246],[.455,.051,229],[.428,.04,251]],
      status: ['#740007','#804800','#004e3e','#005a8e'] },
    dark: { layout: 'signal', secondaryPr: 'draft', secondaryMode: 'neutral', backdrop: ['#000000',[.166,.012,240],[.228,.014,242]],
      tone: [.010,245], primary: [.893,.206,111], secondary: [.788,.019,240], bubble: [.214,.009,242], selection: [.289,.073,111], border: [.298,.024,247], code: [.152,.010,246],
      syntax: [[.847,.106,112],[.756,.042,240],[.901,.172,110],[.80,.095,238],[.856,.018,244],[.818,.140,117],[.747,.054,243]],
      status: ['#ff827d','#ffdcb4','#33ee77','#5bbbff'] },
  },
  {
    slug: 'afterglow', name: text('晚照', 'Afterglow'), family: 'sunset',
    description: text('杏白画布挨着长春花蓝，杏橙气泡、珊瑚按钮；入夜是靛蓝、铜橙与一点薄金。', 'An apricot-white page beside a periwinkle rail, with apricot messages and coral actions; after dusk, indigo holds copper and a trace of gold.'),
    signature: text('长春花蓝的影子挨着窗边，纸上还留着一块珊瑚晚照。', 'A periwinkle shadow at the window, a patch of coral light still on the page.'),
    syntaxStrategy: text('靛蓝辨结构，珊瑚标字面量；入夜让薄金接手数字。', 'Indigo defines structure, coral marks literals, and pale gold picks out numbers after dark.'),
    tags: ['indigo', 'coral', 'sunset'],
    style: style('sunset-print', '窗边晚照', ['长春花蓝', '杏白', '珊瑚'], 'Manrope', 'JetBrains Mono', [14,13,450,650,1.60], [8,'balanced'], ['steady',120,185,260]),
    light: { layout: 'bright-card', secondaryPr: 'merged', secondaryMode: 'point', surfaceException: 'periwinkle-rail',
      backdrop: ['#fdf7ed',[.870,.053,279],[.992,.009,83]], tone: [.028,270],
      primary: [.459,.155,36], secondary: [.423,.137,280], bubble: '#ffd3ac', selection: [.929,.065,67],
      border: [.788,.043,279], code: '#fbf4e9', inlineBg: [.935,.032,80],
      syntax: [[.419,.132,276],[.410,.122,34],[.460,.120,54],[.447,.130,252],[.364,.032,267],[.437,.102,302],[.501,.048,275]],
      status: ['#77000b','#734700','#00483b','#00509f'] },
    dark: { layout: 'rail-lift', secondaryPr: 'blocked', secondaryMode: 'point', surfaceException: 'indigo-night',
      backdrop: [[.246,.065,277],[.315,.077,275],[.302,.060,276]], tone: [.019,276],
      primary: [.803,.154,42], secondary: [.849,.097,85], bubble: [.326,.061,46], selection: [.380,.071,53],
      border: [.408,.066,275], code: [.241,.055,275], diffRemoved: '#ff8c84',
      syntax: [[.823,.114,280],[.801,.104,42],[.869,.107,86],[.809,.090,252],[.904,.025,275],[.789,.086,310],[.743,.057,264]],
      status: ['#f8b0c7','#ffdd60','#79fdbd','#56caff'] },
  },
  {
    slug: 'hojicha', name: text('焙茶', 'Hojicha'), family: 'roasted-tea',
    description: text('奶油画布、烘茶侧栏和奶泡气泡，青瓷标出选中与链接；入夜换成浓咖啡，气泡留一勺焦糖。', 'Cream, a roasted-tea rail and milk foam, with celadon selection and links; espresso after dark, with caramel in the message.'),
    signature: text('茶汤、奶泡与一点青瓷，热气散了，仍能看到焦糖色的杯沿。', 'Roasted tea, milk foam and a little celadon; when the steam clears, a caramel rim remains.'),
    syntaxStrategy: text('可可墨沿着结构走，焦糖写字符串，蓝绿只标函数。', 'Cacao ink follows the structure, caramel marks strings, and blue-green picks out functions.'),
    tags: ['roasted-tea', 'caramel', 'celadon'],
    style: style('tea-house', '手焙茶器', ['焦糖', '奶泡', '青瓷'], 'Aptos', 'Cascadia Mono', [15,12,400,650,1.66], [9,'open'], ['calm',150,225,315]),
    light: { layout: 'paper', secondaryPr: 'draft', secondaryMode: 'point', surfaceException: 'tea-cream',
      backdrop: ['#faf1e0',[.835,.066,76],[.988,.014,89]], tone: [.028,62],
      primary: [.445,.119,56], secondary: [.434,.094,194], bubble: [.992,.009,83], selection: [.879,.018,194],
      border: [.788,.050,77], code: [.955,.022,83], inlineBg: [.920,.029,190],
      syntax: [[.419,.098,24],[.436,.105,64],[.416,.102,281],[.433,.100,201],[.353,.032,60],[.471,.081,149],[.476,.047,67]],
      status: ['#4e0200','#59460a','#004034','#144793'] },
    dark: { layout: 'charcoal', secondaryPr: 'draft', secondaryMode: 'point', surfaceException: 'espresso-night',
      backdrop: [[.251,.032,57],[.205,.025,56],[.296,.028,66]], subtle: [.274,.015,62], tone: [.024,71],
      primary: [.800,.111,64], secondary: [.801,.089,194], bubble: [.331,.048,63], selection: '#1d3f3d',
      border: [.399,.066,69], borderHover: hex([.455,.065,72]), code: [.247,.014,59], diffRemoved: '#ff8b7f',
      syntax: [[.833,.089,28],[.812,.096,66],[.797,.095,284],[.843,.096,197],[.897,.029,67],[.778,.088,153],[.735,.050,75]],
      status: ['#f2aac2','#feeb5b','#74ee9b','#50c3ff'] },
  },
];

function build(preset, variant) {
  const a = preset[variant], dark = variant === 'dark', hard = a.layout === 'hard';
  const [background, muted, elevated] = a.backdrop.map(hex);
  const tone = a.tone ?? (Array.isArray(a.backdrop[0]) ? a.backdrop[0].slice(1) : [0, 0]);
  const softInk = (l) => [l, tone[0] ?? 0, tone[1] ?? 0];
  const foreground = fit(softInk(dark ? .87 : .347), dark, [background], dark ? hard ? 16.00 : 15.32 : 13.18);
  const primary = {
    base: hex(a.primary),
    foreground: hex(dark ? [.163, a.primary[1] ? .009 : 0, a.primary[2] ?? 0] : [.992]),
    hover: hex(shift(a.primary, dark ? .036 : -.029)),
    active: hex(shift(a.primary, dark ? .065 : -.056)),
  };
  primary.muted = hard ? over(primary.base, background, .44) : alpha(primary.base, .44);
  const selection = hex(a.selection), bubble = hex(a.bubble), border = hex(a.border), codeBg = hex(a.code);
  const subtle = hex(a.subtle ?? (Array.isArray(a.backdrop[2]) ? shift(a.backdrop[2], dark ? -.017 : .009) : a.backdrop[2]));
  const overlay = a.overlay ?? (hard ? '#000000' : null);
  const hover = hard ? dark ? '#242424' : '#f0eee6' : alpha(foreground, dark ? .101 : .071);
  const active = hard ? dark ? '#252525' : '#eae7dc' : alpha(foreground, dark ? .144 : .115);
  const mutedForeground = fit(softInk(hard ? dark ? .854 : .351 : dark ? .58 : a.layout === 'seam' ? .472 : .570), dark,
    [background, muted, elevated, subtle, bubble, selection, over(active, elevated)], hard ? 4.60 : 4.96);
  const status = Object.fromEntries(statusNames.flatMap((role, i) => {
    const source = a.status[i], coat = (opacity) => hard ? over(source, background, opacity) : alpha(source, opacity);
    const text = contrast('#ffffff', source) > contrast('#000000', source) ? '#ffffff' : '#000000';
    const fill = dark && a.layout === 'seam' && role === 'info' ? .095 : dark ? .125 : .100;
    return [[role, source], [`${role}Foreground`, text], [`${role}Background`, coat(fill)], [`${role}Border`, coat(.30)]];
  }));
  const tintStrength = a.layout === 'signal' ? .025 : a.layout === 'seam' ? .013 : 0;
  const diffAdded = dark ? '#81fab6' : '#003b18';
  const diffRemoved = a.diffRemoved ?? (dark ? '#ff7b77' : '#a43837');
  const diff = hard
    ? dark ? ['#00543d','#4e1b1d','#102c4b'] : ['#a2d5ac','#ffded8','#dae8fe']
    : [alpha(dark ? diffAdded : '#006b39', dark ? .223 + tintStrength : .255 + tintStrength),
      alpha(diffRemoved,dark ? .105 : .078), alpha(status.info,dark ? .122 : .080)];
  const diffSurfaces = (base) => diff.map((color) => over(color, base));
  const codeBacks = [codeBg, elevated, muted, selection, ...diffSurfaces(codeBg)];
  const syntax = a.syntax.map((entry) => fit(entry, dark, codeBacks, 4.64));
  const comment = fit(softInk(dark ? .55 : .627), dark, codeBacks, 4.16);
  const lineNumber = fit(softInk(dark ? .57 : .565), dark, [...codeBacks, ...[background, elevated].flatMap(diffSurfaces)], 4.70);

  const secondary = fit(a.secondary, dark, [background, muted, elevated, subtle, bubble, selection], 5.00);
  const inlineBg = hex(a.inlineBg ?? shift(a.bubble, dark ? .059 : -.039, a.layout === 'signal' ? .011 : -.009));
  const chip = fit(shift(a.secondary, dark ? .018 : -.020), dark,
    [inlineBg, ...[background, muted, elevated, bubble].map((bg) => over(foreground, over(inlineBg, bg, .5), .04))], 4.90);
  const pr = { open: status.success, draft: mutedForeground, blocked: status.warning,
    merged: fit([dark ? .738 : .493,.145,294], dark, [background, muted, elevated, selection], 4.72), closed: status.error,
    [a.secondaryPr]: secondary };
  const id = `theme-studio-${preset.slug}-${variant}`;
  return {
    metadata: {
      id, name: `${preset.name.zh} · ${preset.name.en}`, variant,
      description: `${preset.description.zh} ${preset.description.en}`,
      version: '1.0.0', author: 'Theme Studio', tags: [...preset.tags, variant],
    },
    colors: {
      primary, surface: { background, foreground, muted, mutedForeground, elevated, subtle, ...(overlay ? { overlay } : {}) },
      interactive: {
        border, borderHover: a.borderHover ?? (hard ? border : over(foreground, border, dark && preset.family === 'neutral' ? .10 : .13)),
        borderFocus: primary.base, focus: primary.base,
        focusRing: hard ? primary.base : alpha(primary.base, dark ? .86 : .89), selection, selectionForeground: foreground, hover, active,
      },
      status, pr,
      syntax: {
        base: { background: codeBg, foreground, comment, ...Object.fromEntries(syntaxRoles.map((role, i) => [role, syntax[i]])) },
        tokens: { punctuation: lineNumber, variableProperty: syntax[5], className: syntax[3], stringEscape: foreground },
        highlights: {
          diffAdded, diffRemoved, diffModified: status.info, diffAddedBackground: diff[0], diffRemovedBackground: diff[1],
          diffModifiedBackground: diff[2], lineNumber,
          lineNumberActive: hard ? fit(a.secondary, dark, codeBacks, 4.74) : foreground,
        },
      },
      chat: { userMessageBackground: bubble, divider: border },
      markdown: {
        link: secondary, linkHover: fit(shift(a.secondary, dark ? .074 : -.070), dark, [background, muted, elevated, bubble, subtle], 4.84),
        inlineCode: chip, inlineCodeBackground: inlineBg, blockquote: mutedForeground,
        blockquoteBorder: a.blockquoteBorder ?? (hard ? border : over(secondary, border, .25)), listMarker: secondary, italic: foreground,
      },
      tools: {
        border, icon: secondary, title: foreground, description: mutedForeground,
        edit: { addedBackground: diff[0], removedBackground: diff[1], modifiedBackground: diff[2], lineNumber },
      },
    },
  };
}

export function cardSwatches(c) {
  return {
    canvas: c.surface.background, sidebar: c.surface.muted, elevated: c.surface.elevated,
    primary: c.primary.base, secondary: c.markdown.link, bubble: c.chat.userMessageBackground,
    selection: over(c.interactive.selection, c.surface.background), edge: c.interactive.border, code: c.syntax.base.background,
    syntax: syntaxRoles.slice(0, 4).map((key) => c.syntax.base[key]),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const stringify = (data) => JSON.stringify(data, null, 2) + '\n';
  const payload = new Map();
  const index = presets.map((preset, rank) => {
    const { slug, name, description, signature, syntaxStrategy, tags, family, style } = preset;
    const variants = Object.fromEntries(['light', 'dark'].map((variant) => {
      const theme = build(preset, variant), a = preset[variant], file = `${slug}-${variant}.json`;
      payload.set(file, stringify(theme));
      return [variant, {
        id: theme.metadata.id, file, layout: a.layout, secondaryPr: a.secondaryPr, secondaryMode: a.secondaryMode ?? 'ink',
        ...(a.surfaceException ? { surfaceException: a.surfaceException } : {}),
        swatches: cardSwatches(theme.colors),
      }];
    }));
    return { slug, name, description, signature, syntaxStrategy, tags, family, rank: rank + 1, style, variants };
  });
  // The previous Violet Arc pair was retired; remove its owned JSON before regenerating.
  const other = readdirSync(directory).filter((f) => f.endsWith('.json') && f !== 'index.json' && !payload.has(f));
  if (other.length) throw new Error(`预设目录另有 JSON；请人工核验并移走旧版：${other.join(', ')}`);
  for (const [file, contents] of payload) {
    const path = join(directory, file);
    if (!existsSync(path) || readFileSync(path, 'utf8') !== contents) writeFileSync(path, contents);
  }
  writeFileSync(join(directory, 'index.json'), stringify({ schemaVersion: 1, presets: index }));
  console.log(`wrote ${payload.size} themes and the bilingual preset index`);
}
