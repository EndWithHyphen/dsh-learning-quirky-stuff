import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { publicUrl } from '../lib/values.js';
import { splitParagraphs, readingMinutes } from '../../shared/material-text.js';

export function isPublicAddress(address) {
  const ip = address.toLowerCase();
  if (ip.startsWith('::ffff:')) return isPublicAddress(ip.slice(7));
  if (isIP(ip) === 6)
    return !(ip === '::' || ip === '::1' || /^(fc|fd|fe[89ab]|ff)/.test(ip) || ip.startsWith('2001:db8:'));
  if (isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split('.').map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && [0, 2].includes(c)))) ||
    (a === 198 && ([18, 19].includes(b) || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** Fetch public documents without cookies, credentials, executable page scripts or private-network redirects. */
export async function fetchPublicDocument(
  raw,
  { signal, maxBytes = 4000000, timeoutMs = 20000, resolve = lookup } = {},
) {
  let current = publicUrl(raw);
  for (let redirects = 0; redirects <= 4; redirects++) {
    signal?.throwIfAborted();
    const url = new URL(current),
      addresses = await resolve(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
    if (!addresses.length || addresses.some((record) => !isPublicAddress(record.address)))
      throw new Error('材料读取仅支持公共网站；当前浏览器中的正文可通过扩展导入');
    const chosen = addresses.find((record) => record.family === 4) || addresses[0];
    const result = await new Promise((resolveResult, reject) => {
      const req = (url.protocol === 'https:' ? https : http).request(
        url,
        {
          method: 'GET',
          signal,
          headers: {
            'User-Agent': 'Studyboard/3.0 (+document-reader)',
            Accept: 'text/html,text/plain,application/pdf;q=0.9,*/*;q=0.1',
            'Accept-Encoding': 'identity',
          },
          lookup: (_hostname, options, callback) =>
            options?.all ? callback(null, [chosen]) : callback(null, chosen.address, chosen.family),
        },
        (response) => {
          const chunks = [];
          let size = 0;
          response.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) req.destroy(new Error('材料超过读取大小限制'));
            else chunks.push(chunk);
          });
          response.on('error', reject);
          response.on('end', () =>
            resolveResult({
              status: response.statusCode,
              headers: response.headers,
              bytes: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.setTimeout(timeoutMs, () => req.destroy(new Error('网页读取超时')));
      req.on('error', reject);
      req.end();
    });
    if ([301, 302, 303, 307, 308].includes(result.status) && result.headers.location) {
      current = publicUrl(new URL(result.headers.location, current).href);
      continue;
    }
    if (result.status < 200 || result.status >= 300)
      throw new Error('网站未允许读取正文（HTTP ' + result.status + '），可通过浏览器扩展导入或粘贴正文');
    let bytes = result.bytes;
    const encoding = result.headers['content-encoding'];
    if (encoding === 'gzip') bytes = gunzipSync(bytes, { maxOutputLength: maxBytes });
    if (encoding === 'deflate') bytes = inflateSync(bytes, { maxOutputLength: maxBytes });
    if (encoding === 'br') bytes = brotliDecompressSync(bytes, { maxOutputLength: maxBytes });
    if (bytes.length > maxBytes) throw new Error('材料解压后超过读取大小限制');
    return { url: current, bytes, mediaType: String(result.headers['content-type'] || '').split(';')[0] };
  }
  throw new Error('网页跳转次数过多');
}

export function parseArticle(html, url) {
  const dom = new JSDOM(html, { url });
  try {
    const document = dom.window.document;
    const rawDate = document
      .querySelector(
        'meta[property="article:published_time"],meta[name="citation_publication_date"],meta[name="DC.Date.issued"]',
      )
      ?.getAttribute('content');
    const dateMatch = rawDate?.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?/);
    const dateValue =
      dateMatch &&
      `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${(dateMatch[3] || '01').padStart(2, '0')}`;
    const publishedAt =
      dateValue &&
      Number.isFinite(Date.parse(dateValue)) &&
      new Date(dateValue).toISOString().startsWith(dateValue)
        ? dateValue
        : null;
    const article = new Readability(dom.window.document, { maxElemsToParse: 40000 }).parse();
    if (
      !article?.textContent?.trim() ||
      /^(just a moment|access denied|checking your browser|verify you are human)/i.test(article?.title || '')
    )
      throw new Error('没有读取到正文，请通过浏览器扩展导入已打开页面');
    const content = new JSDOM(article.content);
    try {
      const raw = [...content.window.document.querySelectorAll('h1,h2,h3,h4,p,li,pre,blockquote')]
        .filter((node) => !node.parentElement?.closest('p,li,pre,blockquote'))
        .map((node) => node.textContent.trim())
        .filter(Boolean);
      const blocks = splitParagraphs((raw.length ? raw.join('\n\n') : article.textContent).slice(0, 200000));
      return {
        title: article.title || new URL(url).hostname,
        url,
        kind: 'article',
        byline: article.byline || '',
        publishedAt,
        blocks,
        completeness: article.textContent.length > 200000 ? 'partial' : 'full',
        estimatedMinutes: readingMinutes(blocks),
        fetchedAt: new Date().toISOString(),
      };
    } finally {
      content.window.close();
    }
  } finally {
    dom.window.close();
  }
}

export class WebReader {
  constructor(nativeReader, { fetchDocument = fetchPublicDocument } = {}) {
    this.native = nativeReader;
    this.fetchDocument = fetchDocument;
  }
  async read(url, signal) {
    const result = await this.fetchDocument(url, { signal });
    if (result.mediaType === 'application/pdf') {
      const pdf = await this.native.read(result.bytes, { kind: 'pdf', signal });
      const blocks = pdf.pages
        .filter((page) => page.text.trim())
        .map((page, index) => ({
          id: 'page' + page.page,
          text: page.text.slice(0, 6000),
          page: page.page,
          position: index,
          seconds: null,
        }));
      if (!blocks.length) throw new Error('该 PDF 没有可提取文字，可导入截图后进行文字识别');
      return {
        title: decodeURIComponent(new URL(result.url).pathname.split('/').at(-1)),
        url: result.url,
        kind: 'pdf',
        blocks,
        completeness: pdf.pageCount > 80 ? 'partial' : 'full',
        estimatedMinutes: readingMinutes(blocks),
        fetchedAt: new Date().toISOString(),
      };
    }
    if (result.mediaType.startsWith('text/plain')) {
      const blocks = splitParagraphs(result.bytes.toString('utf8').slice(0, 200000));
      return {
        title: new URL(result.url).hostname,
        url: result.url,
        kind: 'text',
        blocks,
        completeness: 'full',
        estimatedMinutes: readingMinutes(blocks),
        fetchedAt: new Date().toISOString(),
      };
    }
    if (!['text/html', 'application/xhtml+xml', ''].includes(result.mediaType))
      throw new Error('这个链接不是可读取的文章或 PDF');
    return parseArticle(result.bytes.toString('utf8'), result.url);
  }
}
