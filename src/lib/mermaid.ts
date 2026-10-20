// Renders ```mermaid code blocks as diagrams, colored from the site's theme variables.
// The code block stays in place until rendering succeeds, so it doubles as the no-JS fallback.

const SELECTOR = '.prose pre > code.language-mermaid';

export async function renderMermaid() {
  const blocks = [...document.querySelectorAll<HTMLElement>(SELECTOR)];
  if (!blocks.length) return;

  const { default: mermaid } = await import('mermaid');
  const diagrams = blocks.map((code) => {
    const pre = code.parentElement!;
    const figure = document.createElement('div');
    figure.className = 'mermaid';
    pre.replaceWith(figure);
    return { source: code.textContent ?? '', pre, figure };
  });

  let count = 0;
  const draw = async () => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: themeVariables(),
      // mermaid 12 defaults flowcharts to ELK, which places short edge labels over the nodes
      layout: 'dagre',
    });
    for (const { source, pre, figure } of diagrams) {
      try {
        const { svg } = await mermaid.render(`mermaid-${count++}`, source);
        figure.innerHTML = svg;
      } catch (err) {
        console.error('mermaid:', err);
        figure.replaceChildren(pre); // show the source rather than nothing
      }
    }
  };
  await draw();

  // re-render when the light/dark toggle flips the class on <html>
  new MutationObserver(() => draw()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
}

function themeVariables() {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    darkMode: document.documentElement.classList.contains('dark'),
    fontFamily: getComputedStyle(document.body).fontFamily,
    fontSize: '13px',
    background: v('--paper'),
    primaryColor: v('--code-bg'),
    primaryTextColor: v('--ink'),
    primaryBorderColor: v('--syntax'),
    secondaryColor: v('--code-bg'),
    tertiaryColor: v('--paper'),
    lineColor: v('--muted'),
    textColor: v('--ink'),
    edgeLabelBackground: v('--paper'),
  };
}
