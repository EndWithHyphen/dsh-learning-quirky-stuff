export function missingImageFiles(scene) {
  return (scene?.elements || [])
    .filter((e) => e.type === 'image' && !e.isDeleted && (!e.fileId || !scene.files?.[e.fileId]?.dataURL))
    .map((e) => e.fileId || e.id);
}
export function withKnownFiles(scene, ...sources) {
  return { ...scene, files: Object.assign({}, ...sources.map((s) => s?.files || {}), scene.files || {}) };
}
export function sameSceneContent(a, b) {
  if (!a || !b) return false;
  const active = (scene) =>
    scene.elements
      .filter((e) => !e.isDeleted)
      .map((e) => {
        const { version, versionNonce, updated, index, status, ...value } = e;
        return value;
      });
  if (JSON.stringify(active(a)) !== JSON.stringify(active(b))) return false;
  for (const key of ['viewBackgroundColor', 'gridSize', 'gridStep'])
    if ((a.appState?.[key] ?? null) !== (b.appState?.[key] ?? null)) return false;
  const files = new Set(
    [...a.elements, ...b.elements].filter((e) => e.type === 'image' && !e.isDeleted).map((e) => e.fileId),
  );
  return [...files].every((id) => a.files?.[id]?.dataURL === b.files?.[id]?.dataURL);
}
