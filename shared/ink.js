export function inkElements(scene) {
  return scene.elements.filter(
    (element) =>
      !element.isDeleted && element.type === 'freedraw' && !element.customData?.studyboard?.summaryId,
  );
}
export function inkSignature(scene) {
  return inkElements(scene)
    .map((element) => [element.id, element.version, element.versionNonce].join(':'))
    .sort()
    .join('|');
}
