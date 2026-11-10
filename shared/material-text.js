const normalizedText = (text) =>
  String(text || '')
    .replace(/\r/g, '')
    .replace(/[\t ]+/g, ' ')
    .trim();
export function splitParagraphs(text) {
  return normalizedText(text)
    .split(/\n\s*\n|\n(?=[#•])/)
    .flatMap((paragraph) => {
      const result = [];
      for (let start = 0; start < paragraph.length; start += 1500)
        result.push(paragraph.slice(start, start + 1500));
      return result;
    })
    .filter(Boolean)
    .slice(0, 200)
    .map((text, index) => ({ id: 'p' + (index + 1), text, position: index, seconds: null }));
}
function timestamp(text) {
  const parts = text.replace(',', '.').split(':').map(Number);
  if (parts.some((value) => !Number.isFinite(value))) return null;
  return parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts.length === 2
      ? parts[0] * 60 + parts[1]
      : null;
}
export function parseSubtitles(text) {
  const lines = String(text).replace(/\r/g, '').split('\n'),
    blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const timing = lines[i].match(/((?:\d+:)?\d+:\d+[.,]\d+)\s*-->\s*((?:\d+:)?\d+:\d+[.,]\d+)/);
    if (!timing) continue;
    const content = [];
    while (++i < lines.length && lines[i].trim()) content.push(lines[i].replace(/<[^>]*>/g, ''));
    const value = normalizedText(content.join(' '));
    if (value)
      blocks.push({
        id: 'cue' + (blocks.length + 1),
        text: value,
        seconds: timestamp(timing[1]),
        endSeconds: timestamp(timing[2]),
        position: blocks.length,
      });
  }
  return blocks.slice(0, 1500);
}
export function readingMinutes(blocks) {
  return Math.max(1, Math.ceil(blocks.reduce((n, b) => n + b.text.length, 0) / 450));
}
export function timestampUrl(raw, seconds) {
  if (seconds == null) return raw;
  try {
    const url = new URL(raw);
    if (/(^|\.)youtube\.com$|^youtu\.be$|(^|\.)bilibili\.com$/.test(url.hostname))
      url.searchParams.set('t', String(Math.floor(seconds)));
    else url.hash = 't=' + Math.floor(seconds);
    return url.href;
  } catch {
    return raw;
  }
}
