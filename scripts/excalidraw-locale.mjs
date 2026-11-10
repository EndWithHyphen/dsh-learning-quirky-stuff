import { pathToFileURL } from 'node:url';
import { chineseToolHints, chineseCanvasLabels, chineseCanvasExtras } from '../src/excalidraw-zh.js';
export function mergeChineseLocale(base, patch) {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch))
    result[key] = value && typeof value === 'object' ? mergeChineseLocale(base?.[key] || {}, value) : value;
  return result;
}
export function excalidrawChinese() {
  return {
    name: 'studyboard-excalidraw-chinese',
    setup(build) {
      build.onLoad({ filter: /[/\\]locales[/\\]zh-CN-[^/\\]+\.js$/ }, async (args) => {
        if (!args.path.includes('@excalidraw')) return;
        const original = await import(pathToFileURL(args.path).href),
          data = mergeChineseLocale(original.default, {
            labels: chineseCanvasLabels,
            hints: chineseToolHints,
            ...chineseCanvasExtras,
          });
        const exports = Object.keys(original)
          .filter((k) => k !== 'default')
          .map((k) => `export const ${k}=data[${JSON.stringify(k)}];`)
          .join('\n');
        return {
          contents: `const data=${JSON.stringify(data)};export default data;\n${exports}`,
          loader: 'js',
          watchFiles: [args.path],
        };
      });
    },
  };
}
