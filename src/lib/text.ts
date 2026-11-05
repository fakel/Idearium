export interface ChunkOptions {
  /** Soft maximum size of a chunk in characters. */
  maxChars?: number;
  /** Characters repeated at the start of the next chunk when a section is split. */
  overlapChars?: number;
}

export interface Chunk {
  text: string;
  index: number;
  /** Nearest Markdown heading above the chunk, if any. */
  heading?: string;
}

export function slugify(value: string, maxLength = 60): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'nota';
}

export function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

interface Section {
  heading?: string;
  text: string;
}

/** Split Markdown into heading-delimited sections, keeping the heading in the text. */
export function splitSections(markdown: string): Section[] {
  const lines = markdown.split('\n');
  const sections: Section[] = [];
  let current: Section = { text: '' };

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      if (current.text.trim()) sections.push(current);
      current = { heading: headingMatch[2]?.trim(), text: `${line}\n` };
    } else {
      current.text += `${line}\n`;
    }
  }
  if (current.text.trim()) sections.push(current);
  return sections;
}

function splitLongText(text: string, maxChars: number, overlapChars: number): string[] {
  const paragraphs = text.split(/\n{2,}/).filter((part) => part.trim());
  const pieces: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      if (current.trim()) {
        pieces.push(current.trim());
        current = '';
      }
      let start = 0;
      while (start < paragraph.length) {
        const end = Math.min(start + maxChars, paragraph.length);
        pieces.push(paragraph.slice(start, end).trim());
        if (end === paragraph.length) break;
        start = Math.max(end - overlapChars, start + 1);
      }
      continue;
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChars && current.trim()) {
      pieces.push(current.trim());
      const overlap = current.slice(-overlapChars).trim();
      current = overlap ? `${overlap}\n\n${paragraph}` : paragraph;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces;
}

/** Split a Markdown document into overlapping chunks suitable for embeddings. */
export function chunkMarkdown(markdown: string, options: ChunkOptions = {}): Chunk[] {
  const maxChars = options.maxChars ?? 3_600;
  const overlapChars = options.overlapChars ?? 500;
  const sections = splitSections(markdown);
  const chunks: string[] = [];
  let current = '';
  let currentHeading: string | undefined;

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
    currentHeading = undefined;
  };

  for (const section of sections) {
    if (section.text.length > maxChars) {
      flush();
      for (const piece of splitLongText(section.text, maxChars, overlapChars)) {
        chunks.push(piece);
      }
      continue;
    }

    const candidate = current ? `${current}\n\n${section.text.trim()}` : section.text.trim();
    if (candidate.length > maxChars && current.trim()) {
      flush();
      const overlap = chunks.at(-1)?.slice(-overlapChars).trim();
      current = overlap ? `${overlap}\n\n${section.text.trim()}` : section.text.trim();
    } else {
      current = candidate;
    }
    currentHeading = section.heading ?? currentHeading;
  }
  flush();

  return chunks.map((text, index) => {
    const headingMatch = /^#{1,6}\s+(.+)$/m.exec(text);
    return {
      text,
      index,
      heading: headingMatch?.[1]?.trim() ?? currentHeading,
    };
  });
}
