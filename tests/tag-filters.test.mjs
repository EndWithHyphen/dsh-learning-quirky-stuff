import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tagIndex, findTags, matchesTags, matchesNoteQuery } from '../shared/tag-filters.js';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const notes = [
  { title: '美国选举', tags: ['美国', '王骁', '美国'] },
  { title: '美国经济', tags: ['美国', '经济'] },
  { title: '访谈', tags: ['王骁'] },
  { title: '模型推理', tags: ['KV Cache'], textIndex: '减少重复计算' },
];
test('标签计数按笔记去重，支持部分名称、井号和全角英文搜索', () => {
  const entries = tagIndex(notes);
  assert.equal(entries.find((tag) => tag.name === '美国').count, 2);
  assert.deepEqual(findTags(entries, '#美'), [{ name: '美国', count: 2 }]);
  assert.deepEqual(findTags(entries, '# 美国'), [{ name: '美国', count: 2 }]);
  assert.deepEqual(findTags(entries, ' ｋｖ '), [{ name: 'KV Cache', count: 1 }]);
  assert.equal(findTags(entries)[0].count, 2);
  assert.equal(findTags(entries, '没有此标签').length, 0);
});
test('多个标签的交集与并集不同，内容搜索继续同时生效', () => {
  const selected = ['美国', '王骁'];
  assert.deepEqual(
    notes.filter((note) => matchesTags(note, selected)).map((note) => note.title),
    ['美国选举'],
  );
  assert.equal(notes.filter((note) => matchesTags(note, selected, 'any')).length, 3);
  assert.equal(
    notes.filter((note) => matchesTags(note, selected, 'any') && matchesNoteQuery(note, ' 选举 ')).length,
    1,
  );
  assert.equal(matchesTags({ tags: ['美国史'] }, ['美国']), false);
  assert.equal(matchesTags({ tags: [] }, []), true);
  assert.equal(matchesNoteQuery(notes[3], 'ｋｖ cache'), true);
  assert.equal(matchesNoteQuery(notes[3], '重复计算'), true);
});

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
for (const name of ['window', 'document', 'HTMLElement', 'Node', 'MutationObserver'])
  globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, fireEvent, cleanup } = await import('@testing-library/react');
await build({
  entryPoints: ['src/tag-filter.jsx'],
  outfile: 'node_modules/.cache/tag-filter-test.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['react'],
  logLevel: 'silent',
});
const { TagPicker, NoteFilters } = await import('../node_modules/.cache/tag-filter-test.mjs');
afterEach(cleanup);

test('很多标签时先显示八个，搜索能找到未展开的标签并保留已选项', () => {
  const entries = Array.from({ length: 240 }, (_, i) => ({
    name: '主题' + String(i).padStart(3, '0'),
    count: i === 2 ? 6 : 1,
  }));
  function App() {
    const [selected, setSelected] = React.useState([]);
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(TagPicker, {
        entries,
        scope: '全部笔记',
        selected,
        onToggle: (name) =>
          setSelected((v) => (v.includes(name) ? v.filter((n) => n !== name) : [...v, name])),
      }),
      React.createElement('output', { 'aria-label': '已选标签' }, selected.join(',')),
    );
  }
  const r = render(React.createElement(App));
  assert.equal(r.getAllByRole('checkbox').length, 8);
  fireEvent.click(r.getByRole('checkbox', { name: '主题002', exact: true }));
  fireEvent.change(r.getByRole('searchbox', { name: '搜索标签' }), { target: { value: '主题239' } });
  assert.equal(r.getAllByRole('checkbox').length, 1);
  fireEvent.click(r.getByRole('checkbox', { name: '主题239', exact: true }));
  assert.equal(r.getByLabelText('已选标签').textContent, '主题002,主题239');
  fireEvent.click(r.getByRole('button', { name: '清除标签搜索' }));
  assert.equal(r.getAllByRole('checkbox').length, 8);
  assert.equal(r.getByRole('checkbox', { name: '主题002', exact: true }).checked, true);
  fireEvent.click(r.getByRole('button', { name: '查看全部 240 个标签' }));
  assert.equal(r.getAllByRole('checkbox').length, 80);
  fireEvent.click(r.getByRole('button', { name: '再显示 80 个' }));
  assert.equal(r.getAllByRole('checkbox').length, 160);
  fireEvent.click(r.getByRole('button', { name: '收起', exact: true }));
  assert.equal(r.getAllByRole('checkbox').length, 8);
});
test('筛选条件独立可移除，可切换匹配方式并清空关键词和标签', () => {
  let changed,
    removed,
    cleared = false,
    queryCleared = false;
  const r = render(
    React.createElement(NoteFilters, {
      selected: ['美国', '王骁'],
      mode: 'all',
      query: '选举',
      scope: '政治（含子分类）',
      onRemove: (name) => (removed = name),
      onMode: (mode) => (changed = mode),
      onClear: () => (cleared = true),
      onClearQuery: () => (queryCleared = true),
    }),
  );
  assert.equal(r.getByRole('button', { name: '同时包含' }).getAttribute('aria-pressed'), 'true');
  fireEvent.click(r.getByRole('button', { name: '任一匹配' }));
  assert.equal(changed, 'any');
  fireEvent.click(r.getByRole('button', { name: '移除标签筛选：美国' }));
  assert.equal(removed, '美国');
  fireEvent.click(r.getByRole('button', { name: '移除内容搜索' }));
  assert.equal(queryCleared, true);
  fireEvent.click(r.getByRole('button', { name: '清空筛选' }));
  assert.equal(cleared, true);
});
