// Sätteri hast plugin: small markup tweaks the markdown-source look needs that CSS can't do alone.
// - wrap tables in <div class="md-table"> so wide tables scroll horizontally
// - replace GFM task-list checkboxes with literal "- [x]" / "- [ ]" text
const el = (tagName, properties, children) => ({ type: 'element', tagName, properties, children });
const text = (value) => ({ type: 'text', value });

export default {
  name: 'agentid-markdown-style',
  element: [
    {
      filter: ['table'],
      visit(node, ctx) {
        ctx.wrapNode(node, el('div', { className: ['md-table'] }, []));
      },
    },
    {
      filter: ['input'],
      visit(node, ctx) {
        if (node.properties?.type !== 'checkbox') return;
        // Tight lists put the checkbox directly in the <li>; loose lists wrap it in a <p>.
        let li = ctx.parent(node);
        if (li?.tagName === 'p') li = ctx.parent(li);
        if (li?.tagName !== 'li') return;
        const checked = Boolean(node.properties.checked);
        ctx.replaceNode(
          node,
          el('span', { className: ['box'] }, [
            text('- ['),
            checked ? el('span', { className: ['x'] }, [text('x')]) : text(' '),
            text(']'),
          ]),
        );
        if (checked) {
          const classes = [].concat(li.properties?.className ?? []);
          ctx.setProperty(li, 'className', [...classes, 'done']);
        }
      },
    },
  ],
};
