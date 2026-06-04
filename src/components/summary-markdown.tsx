import type { ReactNode } from "react";

// Minimal markdown → React for short LLM summaries (no deps). Handles headings,
// bullet/numbered lists, **bold**, `code`, --- dividers, and paragraphs.

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] !== undefined) nodes.push(<strong key={k++}>{m[2]}</strong>);
    else if (m[3] !== undefined) nodes.push(<code key={k++}>{m[3]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function SummaryMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: ReactNode[] = [];
  let bullets: ReactNode[] | null = null;

  // Keys are type-prefixed + positional so reconciliation stays stable even when
  // the element type at a given index changes between re-parses.
  const flush = () => {
    if (bullets) {
      out.push(
        <ul key={`ul${out.length}`} className="md-list">
          {bullets}
        </ul>,
      );
      bullets = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^([-*_])\1{2,}$/.test(line)) {
      flush();
      out.push(<hr key={`hr${out.length}`} className="md-hr" />);
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flush();
      out.push(
        <div key={`h${out.length}`} className="md-h">
          {inline(h[2])}
        </div>,
      );
      continue;
    }
    const b = line.match(/^[-*]\s+(.*)$/);
    if (b) {
      if (!bullets) bullets = [];
      bullets.push(<li key={bullets.length}>{inline(b[1])}</li>);
      continue;
    }
    flush();
    out.push(
      <p key={`p${out.length}`} className="md-p">
        {inline(line)}
      </p>,
    );
  }
  flush();

  return <div className="summary-md">{out}</div>;
}
