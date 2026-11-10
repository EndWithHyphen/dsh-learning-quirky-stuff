import { Readability } from '@mozilla/readability';

const clean = (text) =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
export async function extractMaterial() {
  const video = document.querySelector('video'),
    isVideo =
      !!video ||
      /(^|\.)(youtube\.com|bilibili\.com)$/.test(location.hostname) ||
      location.hostname === 'youtu.be';
  if (isVideo) {
    if (video) {
      const tracks = [...video.textTracks],
        track =
          tracks.find((track) => track.mode === 'showing') ||
          tracks.find((track) => /^zh/.test(track.language)) ||
          tracks[0];
      if (track) {
        const prior = track.mode;
        try {
          if (prior === 'disabled') track.mode = 'hidden';
          if (!track.cues?.length) await new Promise((resolve) => setTimeout(resolve, 1200));
          const blocks = [...(track.cues || [])]
            .map((cue) => ({
              text: clean(cue.text.replace(/<[^>]*>/g, '')),
              seconds: cue.startTime,
              endSeconds: cue.endTime,
            }))
            .filter((block) => block.text)
            .slice(0, 1500);
          if (blocks.length)
            return {
              title: document.title,
              url: location.href,
              kind: 'video',
              blocks,
              completeness:
                Number.isFinite(video.duration) && blocks.at(-1).endSeconds > video.duration * 0.85
                  ? 'full'
                  : 'partial',
            };
        } finally {
          track.mode = prior;
        }
      }
    }
    return {
      title: document.title,
      url: location.href,
      kind: 'video',
      blocks: [],
      needsTranscript: true,
      completeness: 'partial',
    };
  }
  const clone = document.cloneNode(true);
  clone.querySelector('#__studyboard_bottom')?.remove();
  const article = new Readability(clone, { maxElemsToParse: 40000 }).parse();
  if (!article?.textContent?.trim())
    return { title: document.title, url: location.href, blocks: [], needsText: true, kind: 'article' };
  const doc = new DOMParser().parseFromString(article.content, 'text/html'),
    parts = [...doc.querySelectorAll('h1,h2,h3,h4,p,li,pre,blockquote')]
      .filter((node) => !node.parentElement?.closest('p,li,pre,blockquote'))
      .map((node) => clean(node.textContent))
      .filter(Boolean),
    candidates = [...document.querySelectorAll('h1,h2,h3,h4,p,li,pre,blockquote')],
    prefix = 'study-' + crypto.randomUUID().slice(0, 8);
  const blocks = (parts.length ? parts : [clean(article.textContent)]).slice(0, 300).map((text, index) => {
    const domId = prefix + '-' + index,
      found = candidates.find((node) => clean(node.textContent) === text);
    if (found) found.dataset.studyboardSource = domId;
    return { text: text.slice(0, 10000), seconds: null, domId: found ? domId : null };
  });
  let length = 0;
  const bounded = [];
  for (const block of blocks) {
    if (length + block.text.length > 200000) break;
    bounded.push(block);
    length += block.text.length;
  }
  return {
    title: article.title || document.title,
    url: location.href,
    kind: 'article',
    blocks: bounded,
    completeness:
      bounded.length < blocks.length || /larkoffice\.com$|feishu\.cn$/.test(location.hostname)
        ? 'partial'
        : 'full',
  };
}
export function focusMaterial(locator) {
  if (Number.isFinite(locator.seconds)) {
    const video = document.querySelector('video');
    if (!video) throw new Error('当前页面没有可定位的视频');
    video.currentTime = locator.seconds;
    video.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return { focused: true };
  }
  let element = locator.domId
    ? [...document.querySelectorAll('[data-studyboard-source]')].find(
        (node) => node.dataset.studyboardSource === locator.domId,
      )
    : null;
  const quote = clean(locator.quote || '');
  if (!element && quote)
    element = [...document.querySelectorAll('p,li,blockquote,h1,h2,h3,h4,pre')].find((node) =>
      clean(node.textContent).includes(quote),
    );
  if (!element) throw new Error('原网页内容已变化，可在 DSH 中查看保存的段落');
  const prior = element.style.outline;
  element.style.outline = '3px solid #7b9c79';
  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setTimeout(() => {
    element.style.outline = prior;
  }, 4500);
  return { focused: true };
}
