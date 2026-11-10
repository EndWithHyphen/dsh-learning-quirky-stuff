const string = { type: 'string' },
  number = { type: 'number' };
const array = (items) => ({ type: 'array', items });
const object = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const choice = (...values) => ({ type: 'string', enum: values });
export const INFOGRAPHIC_SCHEMA = object({
  id: string,
  title: string,
  caption: string,
  rationale: string,
  placement: choice('overview', 'inline'),
  conceptIds: array(string),
  theme: choice('navy', 'paper'),
  height: number,
  sourceIds: array(string),
  origin: choice('material', 'inference'),
  nodes: array(
    object({
      id: string,
      kind: choice('text', 'panel', 'image'),
      x: number,
      y: number,
      width: number,
      height: number,
      text: string,
      fontSize: number,
      align: choice('left', 'center'),
      tone: choice('text', 'muted', 'accent', 'secondary'),
      fill: choice('none', 'panel', 'accent'),
      imageSourceId: string,
      crop: object({ x: number, y: number, width: number, height: number }),
      sourceIds: array(string),
      origin: choice('material', 'inference', 'label'),
    }),
  ),
  edges: array(
    object({
      from: string,
      to: string,
      label: string,
      arrow: choice('none', 'forward', 'both'),
      sourceIds: array(string),
      origin: choice('material', 'inference'),
    }),
  ),
});
export const INFOGRAPHIC_RESULT_SCHEMA = object({
  decision: choice('compose', 'reuse', 'none'),
  reason: string,
  figures: array(INFOGRAPHIC_SCHEMA),
});

export const INFOGRAPHIC_INSTRUCTIONS = `【按内容选择信息图】
先判断空间组织能否显著增加理解：例如同时比较不同解释、追踪多个条件、梳理人物之间性质不同的联系，或把跨段证据串成机制。文字已经足够清楚、信息很少、只有孤立事实时，infographics 留空。原图本身已经清楚、重画没有增益时优先用 sourceFigures。简单几步流程可用 diagrams。三者分工由具体内容决定，不重复表达同一内容，不强制每篇、每节或每次都生成图，不以凑图为目标。
只有确有增益时生成少量 infographics（最多 3 张）。每张围绕一个明确问题，rationale 简述采用这种形式的解释价值；不要复述整篇总结。placement 选 overview 或 inline，inline 的 conceptIds 首位指向对应正文节。图应当替文字承担关系、结构或对比的解释，正文简洁解读图中关键联系，不逐项重抄。
版面由内容关系决定，可用非对称主次、分组、对照、路径、时间轴、局部关系网络，或组合这些结构。人物居中还是靠侧、背景是否需要侧栏、需要几列几行都要重新判断，不套固定人物图、三栏卡片或中心放射模板。优先留白、明确重点、短标签与少量高价值数字，不把每句话装进一个方框。
输出的是可编辑的排版数据：画布宽固定 1600，height 在 800～1600 按内容选择；标题与来源由程序预留，nodes 只安排在 x=64～1536、y=220～height-110 之间。节点的 x/y 是左上角，width/height 是实际排版区域。text 为独立文字，panel 为背景分区，image 为原图局部；panel 不能含正文，正文用单独 text 节点。重要人物、观点或关键数字可突出，正文字号通常 24～30，局部标题 32～42，注释至少 20。用换行与足够高度容纳中文，禁止文字相互重叠或压在人物脸上。控制文字总量，内容过多则删掉次要项或换一种表达，不缩成小字。
theme 按内容选 navy（深蓝、米白、金色）或 paper（浅色、墨绿）；tone 是文字颜色层级，fill 只用于 panel。edges 引用节点 id，箭头必须有真实语义；双方只是相关时 arrow=none，不能伪造因果、支持或推荐方向。连接到有意义的对象，label 保持简短，避免长线穿过文字。
imageSourceId 只能引用提供的原图 S 编号。可复用真实头像、结构图局部、设备、图表等；头像用于说明已被材料明确命名的人物，不能靠长相推断身份。crop 的 x/y/width/height 使用当前原图可见区域的 0～1 比例；整图为 0,0,1,1。无法可靠定位局部时使用整图，或采用纯文字关系表达。不要生成图片网址、base64、SVG、HTML 或代码。不要把人物附近的原有文字一起裁进去。
sourceIds 只能来自“图文来源”索引。图及关键节点、关系注明材料来源；材料中的观点用 origin=material，进一步推论用 inference，纯栏目名称用 label。数字、人物关系和观点忠实于材料，政策目标不表示已经实现的效果；原图写推荐某人的著作不能改成某人支持另一人。资料不足就省略该细节，不能虚构肖像、比例、关系、机制或证据。
visualDecision 用一句话说明本次为什么画图、复用原图或只保留文字。它只是编辑决策，不在正文重复讲制作过程。`;

const text = (v, n = 500) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const list = (v) => (Array.isArray(v) ? v : []);
const bounded = (v, min, max, fallback) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
const unique = (v) => [...new Set(v)];
export function normalizeInfographics(values, { conceptIds, sources, limit = 3 } = {}) {
  const sourceMap = sources && new Map(sources.map((s) => [s.id, s]));
  const refs = (v) =>
    unique(
      list(v)
        .map((x) => text(x, 90))
        .filter((x) => x && (!sourceMap || sourceMap.has(x))),
    ).slice(0, 12);
  const output = [];
  for (const [index, raw] of list(values).slice(0, limit).entries()) {
    if (!raw || !text(raw.title)) continue;
    const height = bounded(raw.height, 800, 1600, 1000),
      ids = new Set();
    const nodes = list(raw.nodes)
      .slice(0, 55)
      .flatMap((node, i) => {
        if (!node || !['text', 'panel', 'image'].includes(node.kind)) return [];
        const id = text(node.id, 50) || `n${i + 1}`;
        if (ids.has(id)) return [];
        const content = text(node.text, 600),
          imageSourceId = text(node.imageSourceId, 90);
        if (node.kind === 'text' && !content) return [];
        if (
          node.kind === 'image' &&
          (!imageSourceId || (sourceMap && sourceMap.get(imageSourceId)?.kind !== 'image'))
        )
          return [];
        const x = bounded(node.x, 64, 1480, 80),
          y = bounded(node.y, 220, height - 160, 240);
        const crop = node.crop || {},
          cx = bounded(crop.x, 0, 0.98, 0),
          cy = bounded(crop.y, 0, 0.98, 0);
        ids.add(id);
        return [
          {
            id,
            kind: node.kind,
            x,
            y,
            width: bounded(node.width, 40, 1536 - x, 350),
            height: bounded(node.height, 24, height - 110 - y, 100),
            text: node.kind === 'text' ? content : '',
            fontSize: bounded(node.fontSize, 20, 72, 26),
            align: node.align === 'center' ? 'center' : 'left',
            tone: ['text', 'muted', 'accent', 'secondary'].includes(node.tone) ? node.tone : 'text',
            fill: ['none', 'panel', 'accent'].includes(node.fill) ? node.fill : 'none',
            imageSourceId: node.kind === 'image' ? imageSourceId : '',
            crop: {
              x: cx,
              y: cy,
              width: bounded(crop.width, 0.02, 1 - cx, 1 - cx),
              height: bounded(crop.height, 0.02, 1 - cy, 1 - cy),
            },
            sourceIds: refs(node.sourceIds),
            origin: ['inference', 'label'].includes(node.origin) ? node.origin : 'material',
          },
        ];
      });
    if (nodes.filter((n) => n.kind === 'text' || n.kind === 'image').length < 2) continue;
    let targets = unique(
      list(raw.conceptIds)
        .map((id) => (conceptIds ? conceptIds.get(id) : text(id, 80)))
        .filter(Boolean),
    );
    output.push({
      id: `ig${index + 1}`,
      title: text(raw.title, 100),
      caption: text(raw.caption, 600),
      rationale: text(raw.rationale, 500),
      placement: raw.placement === 'overview' ? 'overview' : 'inline',
      conceptIds: targets,
      theme: raw.theme === 'paper' ? 'paper' : 'navy',
      height,
      sourceIds: refs(raw.sourceIds),
      origin: raw.origin === 'inference' ? 'inference' : 'material',
      nodes,
      edges: list(raw.edges)
        .slice(0, 30)
        .flatMap((edge) =>
          edge && ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to
            ? [
                {
                  from: edge.from,
                  to: edge.to,
                  label: text(edge.label, 50),
                  arrow: ['none', 'both'].includes(edge.arrow) ? edge.arrow : 'forward',
                  sourceIds: refs(edge.sourceIds),
                  origin: edge.origin === 'inference' ? 'inference' : 'material',
                },
              ]
            : [],
        ),
    });
  }
  return output;
}
