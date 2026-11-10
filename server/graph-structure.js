import { array, object, string, claimSchema } from './lib/values.js';
import { graphHash, quoteText } from '../graph-data.js';

const ids = (maxItems) => ({ ...array(string), minItems: 1, maxItems });
const groups = { ...array(object({ title: string, entityIds: ids(12) })), maxItems: 3 };
export const graphMapsSchema = {
  ...array(
    object({
      id: string,
      title: string,
      question: string,
      takeaway: claimSchema,
      topicIds: ids(180),
      coreEntityIds: ids(8),
      coreTripleIds: ids(10),
      groups,
      branches: {
        ...array(object({ id: string, title: string, summary: claimSchema, tripleIds: ids(12), groups })),
        maxItems: 3,
      },
    }),
  ),
  minItems: 1,
  maxItems: 6,
};

export function parseGraphMaps(raw, { input, entityIds, tripleIds, triples, sources }) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 6) throw new Error('图谱缺少主题主线结构');
  const topics = new Map(
    input.topics.flatMap((topic, index) => [
      [topic.id, topic.id],
      ['T' + (index + 1), topic.id],
    ]),
  );
  const text = (value, max) => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
      throw new Error('主线标题或说明不完整');
    return value.trim();
  };
  function refs(values, mapping, max, name) {
    if (
      !Array.isArray(values) ||
      !values.length ||
      values.length > max ||
      values.some((id) => !mapping.has(id))
    )
      throw new Error(name + '引用了不存在的编号或超过数量限制');
    return [...new Set(values.map((id) => mapping.get(id)))];
  }
  function claim(value, scope) {
    if (!value || !Array.isArray(value.evidence) || !value.evidence.length)
      throw new Error('主线结论缺少依据');
    const evidence = value.evidence.map((item) => {
      const source = sources.get(item.sourceId),
        quote = text(item.quote, 1000);
      if (!source || quoteText(quote).length < 4 || !quoteText(source.text).includes(quoteText(quote)))
        throw new Error('主线结论的引文与原文不符');
      if (!source.topicIds.some((id) => scope.includes(id))) throw new Error('主线引用超出了选定主题');
      return { ...source, quote };
    });
    return { text: text(value.text, 650), evidence };
  }
  function columns(value, allowed) {
    if (!Array.isArray(value) || value.length > 3) throw new Error('主线分组格式不正确');
    if (!value.length) return [];
    const seen = new Set();
    const result = value.map((group) => {
      const members = refs(group.entityIds, entityIds, 12, '分组');
      for (const id of members) {
        if (!allowed.has(id) || seen.has(id)) throw new Error('主线分组包含重复或范围外的实体');
        seen.add(id);
      }
      return { title: text(group.title, 30), entityIds: members };
    });
    if (seen.size !== allowed.size) throw new Error('主线分组遗漏了实体');
    return result;
  }
  const seen = new Set();
  return raw.map((map) => {
    const title = text(map.title, 80),
      topicIds = refs(map.topicIds, topics, 180, '主题'),
      coreEntityIds = refs(map.coreEntityIds, entityIds, 8, '主干实体'),
      coreTripleIds = refs(map.coreTripleIds, tripleIds, 10, '主干关系'),
      coreSet = new Set(coreEntityIds),
      connected = new Set();
    for (const id of coreTripleIds) {
      const edge = triples.get(id);
      if (!coreSet.has(edge.from) || !coreSet.has(edge.to)) throw new Error('主干关系超出了主干实体范围');
      connected.add(edge.from);
      connected.add(edge.to);
      if (!edge.evidence.some((source) => source.topicIds.some((id) => topicIds.includes(id))))
        throw new Error('主干关系超出了主题范围');
    }
    if (connected.size !== coreSet.size) throw new Error('主干中存在没有关系的孤立实体');
    const id = 'm-' + graphHash(title + '/' + [...topicIds].sort().join('/'));
    if (seen.has(id)) throw new Error('存在重复主题主线');
    seen.add(id);
    if (!Array.isArray(map.branches) || map.branches.length > 3) throw new Error('主线分支数量不正确');
    const branchNames = new Set();
    const branches = map.branches
      .map((branch) => {
        const branchTitle = text(branch.title, 80),
          relationIds = refs(branch.tripleIds, tripleIds, 12, '分支关系');
        if (branchNames.has(branchTitle)) throw new Error('存在重复主线分支');
        branchNames.add(branchTitle);
        const members = new Set(relationIds.flatMap((id) => [triples.get(id).from, triples.get(id).to]));
        if (members.size > 12) throw new Error('分支实体过多，请继续提炼');
        if (
          relationIds.some(
            (id) =>
              !triples.get(id).evidence.some((source) => source.topicIds.some((id) => topicIds.includes(id))),
          )
        )
          throw new Error('分支关系超出了主题范围');
        return {
          id: 'b-' + graphHash(id + '/' + branchTitle),
          title: branchTitle,
          summary: claim(branch.summary, topicIds),
          tripleIds: relationIds,
          groups: columns(branch.groups, members),
        };
      })
      .filter((branch) => branch.tripleIds.some((id) => !coreTripleIds.includes(id)));
    return {
      id,
      title,
      question: text(map.question, 180),
      takeaway: claim(map.takeaway, topicIds),
      topicIds,
      coreEntityIds,
      coreTripleIds,
      groups: columns(map.groups, coreSet),
      branches,
    };
  });
}
