export function createNoteFinder($) {
  const bar = $('note-find'), input = $('note-find-input');
  const article = $('markdown'), scroll = $('content-scroll');
  let matches = [], current = -1;
  const limit = 1000;

  function showMatch(index) {
    current = matches.length ? (index + matches.length) % matches.length : -1;
    const match = matches[current];
    CSS.highlights.set('note-current', new Highlight(...(match ? [match] : [])));
    $('note-find-count').textContent = match ? `${current + 1} из ${matches.length}${matches.length === limit ? '+' : ''}`
      : input.value ? 'Нет совпадений' : '';
    $('note-find-prev').disabled = $('note-find-next').disabled = !match;
    if (match) {
      const bounds = match.getBoundingClientRect();
      const viewport = scroll.getBoundingClientRect();
      if (bounds.top < bar.getBoundingClientRect().bottom || bounds.bottom > viewport.bottom) {
        scroll.scrollTop += bounds.top - viewport.top - viewport.height / 3;
      }
      const code = match.startContainer.parentElement.closest('pre');
      if (code) {
        const area = code.getBoundingClientRect();
        if (bounds.left < area.left || bounds.right > area.right) code.scrollLeft += bounds.left - area.left - 20;
      }
    }
  }

  function refresh() {
    if (bar.hidden) return;
    matches = [];
    const query = input.value.trim();
    if (query) {
      const parts = [];
      let previousBlock, length = 0;
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (parent.closest('.code-bar') || !node.data) continue;
        const block = parent.closest('p,h1,h2,h3,h4,h5,h6,li,th,td,pre,blockquote');
        const separator = parts.length && previousBlock !== block ? '\n' : '';
        const start = length + separator.length;
        length = start + node.length;
        parts.push({ node, start, end: length, text: separator + node.data });
        previousBlock = block;
      }
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const text = parts.map(part => part.text).join('');
      let first = 0, last = 0;
      for (const found of text.matchAll(new RegExp(escaped, 'giu'))) {
        const start = found.index, end = start + found[0].length;
        while (parts[first].end <= start) first++;
        last = Math.max(first, last);
        while (parts[last].end < end) last++;
        const range = document.createRange();
        range.setStart(parts[first].node, start - parts[first].start);
        range.setEnd(parts[last].node, end - parts[last].start);
        matches.push(range);
        if (matches.length === limit) break;
      }
    }
    CSS.highlights.set('note-matches', new Highlight(...matches));
    showMatch(0);
  }

  function close() {
    if (bar.hidden) return;
    bar.hidden = true;
    CSS.highlights.delete('note-matches');
    CSS.highlights.delete('note-current');
    matches = []; input.value = '';
  }

  input.oninput = refresh;
  $('note-find-prev').onclick = () => showMatch(current - 1);
  $('note-find-next').onclick = () => showMatch(current + 1);
  $('note-find-close').onclick = () => { close(); $('edit').focus(); };
  bar.onkeydown = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      $('edit').focus();
    } else if (event.key === 'Enter' && event.target === input) {
      event.preventDefault();
      showMatch(current + (event.shiftKey ? -1 : 1));
    }
  };
  return {
    open() { bar.hidden = false; input.focus(); input.select(); refresh(); },
    close, refresh
  };
}
