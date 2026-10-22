// Syntax theme matching the design: colors are CSS variables so code blocks
// follow the light/dark toggle (see src/styles/global.css).
export default {
  name: 'ident-link',
  type: 'light',
  colors: {
    'editor.foreground': 'var(--ink)',
    'editor.background': 'var(--code-bg)',
  },
  tokenColors: [
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: 'var(--syntax)' },
    },
    {
      scope: ['string', 'string.quoted'],
      settings: { foreground: 'var(--green)' },
    },
    {
      // JSON/YAML keys, plus the usual keyword-ish scopes for other languages
      scope: [
        'support.type.property-name',
        'entity.name.tag',
        'entity.other.attribute-name',
        'keyword',
        'storage',
        'entity.name.function',
        'support.function',
      ],
      settings: { foreground: 'var(--accent)' },
    },
  ],
};
