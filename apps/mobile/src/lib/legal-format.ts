/** Turns a legal document body into readable blocks. Format: "# " heading, "## " sub-heading, "- " bullet, blank line between paragraphs. Plain text bodies still render as paragraphs. */
export type LegalBlock = { type: 'h1' | 'h2' | 'li' | 'p'; text: string };

export function parseLegalBody(body: string): LegalBlock[] {
  const out: LegalBlock[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push({ type: 'p', text: para.join(' ') }); para = []; } };
  for (const raw of String(body ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const h2 = /^##\s+(.*)$/.exec(line); const h1 = /^#\s+(.*)$/.exec(line); const li = /^[-•*]\s+(.*)$/.exec(line);
    if (h2) { flush(); out.push({ type: 'h2', text: h2[1] }); }
    else if (h1) { flush(); out.push({ type: 'h1', text: h1[1] }); }
    else if (li) { flush(); out.push({ type: 'li', text: li[1] }); }
    else para.push(line);
  }
  flush();
  return out;
}

/** True when the text still contains blanks that legal counsel must fill. */
export const hasLegalPlaceholders = (body: string) => /\[LEGAL TO [A-Z]+/.test(body);
