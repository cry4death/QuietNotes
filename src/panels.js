// Размеры и видимость панелей не затрагивают текст в редакторе.
export function createPanels({ state, $, api, run }) {
  const shell = document.querySelector('.app-shell');
  const body = document.querySelector('.workspace-body');
  const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
  const persist = () => api.preferences({ sidebar: state.sidebar, browser: state.browser, preview: state.preview,
    sidebarWidth: state.sidebarWidth, browserWidth: state.browserWidth });

  function render() {
    const sidebarWidth = clamp(state.sidebarWidth, 190, Math.min(360, shell.clientWidth - 560));
    shell.style.setProperty('--sidebar-width', sidebarWidth + 'px');
    shell.dataset.sidebarHidden = String(!state.sidebar);
    $('sidebar').hidden = !state.sidebar;
    $('sidebar-resizer').hidden = !state.sidebar;
    const showBrowser = Boolean(state.root) && state.browser;
    const showPreview = !state.root || state.preview;
    $('browser-panel').hidden = !showBrowser;
    $('content-scroll').hidden = !showPreview;
    $('browser-resizer').hidden = !showBrowser || !showPreview;
    body.dataset.browserHidden = String(!showBrowser);
    body.dataset.previewHidden = String(!showPreview);
    const defaultWidth = state.viewMode === 'list' ? 290 : body.clientWidth / 2.1;
    const width = clamp(state.browserWidth ?? defaultWidth, 200, body.clientWidth - 305);
    body.style.setProperty('--browser-width', width + 'px');
    for (const [id, value, min, max] of [['sidebar-resizer', sidebarWidth, 190, Math.min(360, shell.clientWidth - 560)], ['browser-resizer', width, 200, body.clientWidth - 305]]) {
      $(id).setAttribute('aria-valuenow', String(Math.round(value)));
      $(id).setAttribute('aria-valuemin', String(min));
      $(id).setAttribute('aria-valuemax', String(Math.max(min, Math.round(max))));
    }
    for (const [id, shown, label] of [['sidebar-toggle', state.sidebar, 'левую панель'], ['browser-toggle', showBrowser, 'список файлов'], ['preview-toggle', showPreview, 'область просмотра']]) {
      $(id).setAttribute('aria-expanded', String(shown));
      $(id).setAttribute('aria-pressed', String(shown));
      $(id).title = (shown ? 'Скрыть ' : 'Показать ') + label;
      $(id).disabled = id !== 'sidebar-toggle' && !state.root;
    }
  }

  function separator(id, property) {
    const element = $(id);
    let drag = null;
    const current = () => Number(element.getAttribute('aria-valuenow'));
    const resize = width => {
      state[property] = Math.round(clamp(width, Number(element.getAttribute('aria-valuemin')), Number(element.getAttribute('aria-valuemax'))));
      render();
    };
    element.onpointerdown = event => {
      if (event.button !== 0) return;
      event.preventDefault(); element.focus();
      drag = { x: event.clientX, width: current(), previous: state[property] };
      element.setPointerCapture(event.pointerId);
      document.body.classList.add('resizing-panels');
    };
    element.onpointermove = event => { if (drag) resize(drag.width + event.clientX - drag.x); };
    element.onpointerup = run(async event => {
      if (!drag) return;
      drag = null; document.body.classList.remove('resizing-panels');
      element.releasePointerCapture(event.pointerId);
      await persist();
    });
    element.onpointercancel = () => {
      if (drag) { state[property] = drag.previous; drag = null; render(); }
      document.body.classList.remove('resizing-panels');
    };
    element.ondblclick = run(async () => {
      state[property] = property === 'sidebarWidth' ? 235 : null;
      render(); await persist();
    });
    element.onkeydown = run(async event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? 64 : 16;
      resize(event.key === 'Home' ? -Infinity : event.key === 'End' ? Infinity : current() + (event.key === 'ArrowRight' ? step : -step));
      await persist();
    });
  }

  $('sidebar-toggle').onclick = run(async () => { state.sidebar = !state.sidebar; render(); await persist(); });
  $('browser-toggle').onclick = run(async () => {
    if (!state.root) return;
    state.browser = !state.browser;
    if (!state.browser) state.preview = true;
    render(); await persist();
  });
  $('preview-toggle').onclick = run(async () => {
    if (!state.root) return;
    state.preview = !state.preview;
    if (!state.preview) state.browser = true;
    render(); await persist();
  });
  separator('sidebar-resizer', 'sidebarWidth');
  separator('browser-resizer', 'browserWidth');
  window.addEventListener('resize', render);
  return { render };
}
