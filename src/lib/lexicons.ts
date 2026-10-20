// Lexicon schemas live in ./lexicons, laid out by NSID:
// lexicons/at/agentid/example.json holds the schema with id "at.agentid.example".

export interface LexiconDoc {
  lexicon: number;
  id: string;
  description?: string;
  defs: Record<string, { type: string; description?: string; [key: string]: unknown }>;
}

const files = import.meta.glob<{ default: LexiconDoc }>('/lexicons/**/*.json', { eager: true });

export const lexicons: LexiconDoc[] = Object.entries(files)
  .map(([path, mod]) => {
    const doc = mod.default;
    const expected = path.replace(/^\/lexicons\//, '').replace(/\.json$/, '').split('/').join('.');
    if (doc.id !== expected) {
      throw new Error(`${path}: lexicon id "${doc.id}" does not match its path (expected "${expected}")`);
    }
    return doc;
  })
  .sort((a, b) => a.id.localeCompare(b.id));

export const lexiconHref = (id: string) => `/lexicons/${id}.json`;
