import React, { useMemo } from 'react';
import { Lexer } from 'marked';

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
function text(value = '') {
  return value.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos|nbsp);/gi, (match, key) => {
    if (key[0] !== '#') return entities[key.toLowerCase()] || match;
    const n = /^#x/i.test(key) ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
  });
}
function href(value) {
  try {
    const url = new URL(text(value));
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
function inline(tokens = []) {
  return tokens.map((token, key) => {
    const children = () => inline(token.tokens || []);
    switch (token.type) {
      case 'strong':
        return <strong key={key}>{children()}</strong>;
      case 'em':
        return <em key={key}>{children()}</em>;
      case 'del':
        return <del key={key}>{children()}</del>;
      case 'codespan':
        return <code key={key}>{token.text}</code>;
      case 'br':
        return <br key={key} />;
      case 'link': {
        const url = href(token.href);
        return url ? (
          <a key={key} href={url} target="_blank" rel="noopener noreferrer">
            {children()}
          </a>
        ) : (
          <React.Fragment key={key}>{children()}</React.Fragment>
        );
      }
      case 'image':
        return <span key={key}>{token.text ? '图片：' + text(token.text) : '图片'}</span>;
      case 'text': {
        if (token.tokens) return <React.Fragment key={key}>{children()}</React.Fragment>;
        // Some model replies leave a space immediately before a closing **. Repair only
        // unparsed text tokens, so code spans, fenced code and escaped markers stay literal.
        const raw = token.raw || token.text,
          repaired = raw.replace(/\*\*(\S(?:[^*\n]|\*(?!\*))*?)[ \t]+\*\*/g, '**$1**');
        if (repaired !== raw)
          return <React.Fragment key={key}>{inline(Lexer.lexInline(repaired))}</React.Fragment>;
        return <React.Fragment key={key}>{text(token.text)}</React.Fragment>;
      }
      default:
        return <React.Fragment key={key}>{text(token.text || token.raw)}</React.Fragment>;
    }
  });
}
function blocks(tokens = []) {
  return tokens.map((token, key) => {
    switch (token.type) {
      case 'space':
      case 'def':
        return null;
      case 'paragraph':
        return <p key={key}>{inline(token.tokens)}</p>;
      case 'text':
        return (
          <React.Fragment key={key}>{token.tokens ? inline(token.tokens) : text(token.text)}</React.Fragment>
        );
      case 'heading':
        return React.createElement('h' + Math.min(6, token.depth + 2), { key }, inline(token.tokens));
      case 'blockquote':
        return <blockquote key={key}>{blocks(token.tokens)}</blockquote>;
      case 'code':
        return (
          <pre key={key}>
            <code>{token.text}</code>
          </pre>
        );
      case 'hr':
        return <hr key={key} />;
      case 'list': {
        const List = token.ordered ? 'ol' : 'ul';
        return (
          <List key={key} start={token.ordered ? token.start : undefined}>
            {token.items.map((item, i) => (
              <li key={i}>
                {item.task && <input aria-label="清单状态" type="checkbox" disabled checked={item.checked} />}
                {blocks(item.tokens)}
              </li>
            ))}
          </List>
        );
      }
      case 'table':
        return (
          <div className="study-comment-table" key={key}>
            <table>
              <thead>
                <tr>
                  {token.header.map((cell, i) => (
                    <th key={i}>{inline(cell.tokens)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {token.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{inline(cell.tokens)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      // Raw HTML is rendered as React text, never injected or fetched.
      default:
        return <p key={key}>{text(token.text || token.raw)}</p>;
    }
  });
}
export default function CommentMarkdown({ value }) {
  const tokens = useMemo(() => Lexer.lex(String(value || ''), { gfm: true }), [value]);
  return <div className="study-comment-markdown">{blocks(tokens)}</div>;
}
