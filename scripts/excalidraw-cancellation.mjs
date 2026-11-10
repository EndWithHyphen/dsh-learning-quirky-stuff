import { readFile } from 'node:fs/promises';

/** Patch only Excalidraw's confirmed file-dialog cancellation branches. */
export function quietFileCancellation(source) {
  let cancelledMessage = 0,
    guardedAbort = 0;
  const code = source
    .replace(/console\.warn\(["']Opening the file was canceled \(legacy-fs\)\.["']\)/g, () => {
      cancelledMessage++;
      return 'void 0';
    })
    .replace(
      /(\b([\w$]+)(?:\?\.|\.)name!=="AbortError"\?console\.error\(\2\):)console\.warn\(\2\)/g,
      (_, guard) => {
        guardedAbort++;
        return guard + 'void 0';
      },
    )
    .replace(/(\b([\w$]+)(?:\?\.|\.)name==="AbortError"\?\()console\.warn\(\2\)/g, (_, guard) => {
      guardedAbort++;
      return guard + 'void 0';
    })
    .replace(
      /(if\s*\(\s*([\w$]+)(?:\?\.|\.)name\s*===\s*"AbortError"\s*\)\s*\{\s*)console\.warn\(\2\);?/g,
      (_, guard) => {
        guardedAbort++;
        return guard;
      },
    );
  return { code, cancelledMessage, guardedAbort };
}

export function excalidrawCancellation() {
  return {
    name: 'studyboard-excalidraw-file-cancellation',
    setup(build) {
      let messages = 0,
        branches = 0;
      build.onStart(() => {
        messages = branches = 0;
      });
      build.onLoad(
        { filter: /[/\\]@excalidraw[/\\]excalidraw[/\\]dist[/\\]prod[/\\][^/\\]+\.js$/ },
        async (args) => {
          const result = quietFileCancellation(await readFile(args.path, 'utf8'));
          messages += result.cancelledMessage;
          branches += result.guardedAbort;
          if (!result.cancelledMessage && !result.guardedAbort) return;
          return { contents: result.code, loader: 'js', watchFiles: [args.path] };
        },
      );
      build.onEnd((result) => {
        if (!result.errors.length && (messages !== 1 || branches < 4))
          return { errors: [{ text: 'Excalidraw 文件取消处理结构已变化，请复核兼容补丁。' }] };
      });
    },
  };
}
