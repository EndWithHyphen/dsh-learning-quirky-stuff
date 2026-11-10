export const FEATURES = [
  {
    id: 'infographics',
    title: '自适应信息图',
    description: 'AI 总结按内容需要配图，支持编辑、查看来源与单独重做。',
    model: false,
    surface: 'note',
  },
  {
    id: 'weekly',
    title: '学习周报',
    description: '按周回顾主题进展、具体理解变化和复习记录，选择下周重点。',
    model: true,
  },
  {
    id: 'systemStudy',
    title: '系统学习',
    description: '在 AI 总结中扩展主题，生成可编辑论证白板与时间旅行研究。',
    model: true,
    surface: 'note',
  },
  {
    id: 'topics',
    title: '专题工作台',
    description: '把多篇笔记整理成同一专题，比较共识、分歧、缺口和新增内容。',
    model: true,
  },
  {
    id: 'explore',
    title: '拓展探索',
    description: '发现相邻主题、不同视角和跨领域联系，并管理待学资料。',
    model: true,
  },
  {
    id: 'search',
    title: '全内容搜索',
    description: '搜索笔记、图注、总结、截图和手写识别结果，直接定位来源。',
    model: false,
  },
  {
    id: 'preview',
    title: '材料预览',
    description: '读取文章或字幕，对照已有知识，找出新增内容和重点阅读位置。',
    model: true,
  },
  {
    id: 'feedback',
    title: '理解反馈',
    description: '检查复述、问题回答或关系补全，提供有来源的理解反馈。',
    model: true,
  },
];
export const FEATURE_IDS = FEATURES.map((feature) => feature.id);
export const featureById = (id) => FEATURES.find((feature) => feature.id === id);
