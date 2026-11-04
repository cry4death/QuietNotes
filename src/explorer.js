// Список папок, просмотр содержимого и выбор места для переноса.
export function createExplorer({ state, $, icon, escape, flatten, parent, basename, run, navigateFolder, navigateToNote, selectFolder, moveItem, contextMenu, orderEntries }) {
  const allNodes = () => flatten(state.tree);
  const children = relative => relative ? allNodes().find(node => node.path === relative)?.children || [] : state.tree;
  const mime = 'application/x-quiet-notes-path';

  function dropTarget(element, destination) {
    element.ondragover = event => {
      if (!event.dataTransfer.types.includes(mime)) return;
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = 'move'; element.classList.add('drop-target');
    };
    element.ondragleave = event => { if (!element.contains(event.relatedTarget)) element.classList.remove('drop-target'); };
    element.ondrop = run(async event => {
      if (!event.dataTransfer.types.includes(mime)) return;
      event.preventDefault(); event.stopPropagation(); element.classList.remove('drop-target');
      const relative = event.dataTransfer.getData(mime);
      if (relative) await moveItem(relative, typeof destination === 'function' ? destination() : destination);
    });
  }

  function breadcrumbs(container, relative, onOpen, allowDrop = false) {
    container.replaceChildren();
    const parts = [{ name: 'Мои заметки', path: '' }];
    let accumulated = '';
    for (const piece of relative.split('/').filter(Boolean)) {
      accumulated = accumulated ? accumulated + '/' + piece : piece;
      parts.push({ name: piece, path: accumulated });
    }
    parts.forEach((part, index) => {
      if (index) { const separator = document.createElement('span'); separator.className = 'breadcrumb-separator'; separator.textContent = '/'; container.append(separator); }
      const button = document.createElement('button'); button.className = 'breadcrumb-button';
      button.textContent = part.name; button.title = part.path || state.root || 'Мои заметки';
      button.onclick = run(() => onOpen(part.path));
      if (allowDrop) dropTarget(button, part.path);
      container.append(button);
    });
  }

  function render() {
    $('file-list').className = 'file-list view-' + state.viewMode;
    document.querySelector('.workspace-body').dataset.view = state.viewMode;
    $('view-mode').value = state.viewMode;
    $('content-scroll').hidden = Boolean(state.root) && !state.preview;
    $('preview-toggle').setAttribute('aria-pressed', String(state.preview));
    $('preview-toggle').title = state.preview ? 'Скрыть область просмотра' : 'Показать область просмотра';
    const library = $('tree'); library.replaceChildren();
    for (const node of orderEntries(state.tree.filter(item => item.type === 'folder'))) {
      const button = document.createElement('button'); button.className = 'folder-shortcut'; button.dataset.path = node.path;
      button.classList.toggle('active', state.folder === node.path || state.folder.startsWith(node.path + '/'));
      button.innerHTML = icon('folder') + `<span class="tree-name">${escape(node.name)}</span><span class="folder-count">${flatten(node.children).filter(item => item.type === 'note').length}</span>`;
      button.title = node.path; button.onclick = run(() => navigateFolder(node.path));
      button.oncontextmenu = run(event => contextMenu(event, node.path));
      dropTarget(button, node.path); library.append(button);
    }
    $('library-root').classList.toggle('active', Boolean(state.root) && !state.folder);
    $('library-root').onclick = run(() => navigateFolder(''));
    $('library-root').oncontextmenu = run(event => contextMenu(event, '', true));
    $('browser-panel').oncontextmenu = run(event => {
      if (event.target.closest('.view-controls')) return;
      return contextMenu(event, state.folder, true);
    });
    dropTarget($('library-root'), '');
    $('note-count').textContent = allNodes().filter(node => node.type === 'note').length;
    $('tree-empty').hidden = state.tree.some(node => node.type === 'folder');
    $('browser-panel').hidden = !state.root;
    $('folder-up').disabled = !state.folder;
    breadcrumbs($('breadcrumbs'), state.folder, navigateFolder, true);
    if (!state.root) { $('breadcrumbs').textContent = 'Выберите папку с заметками'; return; }
    const entries = orderEntries(children(state.folder));
    $('browser-title').textContent = state.folder ? basename(state.folder) : 'Мои заметки';
    $('folder-count').textContent = entries.length;
    $('folder-empty').hidden = entries.length > 0;
    const list = $('file-list');
    const signature = JSON.stringify([state.root, state.folder, entries.map(node => [node.path, node.name, node.type, node.children?.map(item => item.path)])]);
    if (list.dataset.signature === signature) {
      for (const row of list.children) {
        row.classList.toggle('selected', row.dataset.path === state.selected);
        if (row.dataset.path === state.selected) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current');
      }
      return;
    }
    list.dataset.signature = signature;
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.path : null;
    list.replaceChildren();
    for (const node of entries) {
      const row = document.createElement('button'); row.className = 'file-row ' + node.type; row.dataset.path = node.path;
      row.setAttribute('aria-label', node.type === 'folder' ? 'Папка ' + node.name : node.name);
      row.classList.toggle('selected', state.selected === node.path);
      if (state.selected === node.path) row.setAttribute('aria-current', 'true');
      row.title = node.type === 'folder' ? node.name + '\nДвойной клик — открыть' : node.path;
      const detail = node.type === 'folder' ? `${node.children.filter(item => item.type === 'folder').length} папок · ${node.children.filter(item => item.type === 'note').length} заметок` : 'Markdown-заметка';
      const artwork = node.type === 'folder'
        ? `<span class="item-art folder-art ${flatten(node.children).some(item => item.type === 'note') ? 'has-paper' : ''}" aria-hidden="true"><span class="folder-back"></span><span class="folder-paper"></span><span class="folder-front"></span></span>`
        : '<span class="item-art document-art" aria-hidden="true"><span class="document-fold"></span><span class="document-lines"></span><span class="document-label">md</span></span>';
      const badge = `<span class="favorite-badge" aria-hidden="true" title="В избранном">${icon('star')}</span>`;
      row.innerHTML = icon(node.type === 'folder' ? 'folder' : 'file') + artwork
        + `<span class="file-row-info"><span class="file-row-label"><span class="file-row-name">${escape(node.name)}</span>${badge}</span><span class="file-row-detail">${detail}</span></span><span class="file-extension">${node.type === 'folder' ? 'Папка' : '.md'}</span>`;
      row.onclick = run(() => node.type === 'folder' ? selectFolder(node) : navigateToNote(node.path));
      row.oncontextmenu = run(event => contextMenu(event, node.path));
      if (node.type === 'folder') {
        row.ondblclick = run(() => navigateFolder(node.path));
        dropTarget(row, node.path);
      }
      row.draggable = true;
      row.ondragstart = event => { event.dataTransfer.setData(mime, node.path); event.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); };
      row.ondragend = () => { row.classList.remove('dragging'); document.querySelectorAll('.drop-target').forEach(item => item.classList.remove('drop-target')); };
      row.onkeydown = event => {
        if (event.key === 'Enter' && node.type === 'folder') { event.preventDefault(); run(() => navigateFolder(node.path))(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const rows = [...list.querySelectorAll('.file-row')];
          let stride = 1;
          if (state.viewMode !== 'list' && rows.length > 1) {
            const top = rows[0].offsetTop;
            stride = rows.findIndex(item => item.offsetTop > top);
            if (stride < 1) stride = rows.length;
          }
          rows[Math.max(0, Math.min(rows.length - 1, rows.indexOf(row) + (event.key === 'ArrowDown' ? stride : -stride)))].focus();
        }
        if (state.viewMode !== 'list' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault();
          const rows = [...list.querySelectorAll('.file-row')];
          rows[Math.max(0, Math.min(rows.length - 1, rows.indexOf(row) + (event.key === 'ArrowRight' ? 1 : -1)))].focus();
        }
      };
      list.append(row);
    }
    dropTarget(list, () => state.folder);
    if (focused) [...list.children].find(row => row.dataset.path === focused)?.focus();
  }

  function chooseDestination(source) {
    const dialog = $('move-dialog');
    if (dialog.open) return Promise.resolve(null);
    const previousFocus = document.activeElement;
    let destination = parent(source);
    $('move-description').textContent = 'Выберите папку для «' + basename(source) + '».';
    $('move-error').textContent = '';
    return new Promise(resolve => {
      const finish = result => { dialog.close(); dialog.removeEventListener('cancel', cancel); previousFocus?.focus(); resolve(result); };
      const cancel = event => { event.preventDefault(); finish(null); };
      const draw = () => {
        breadcrumbs($('move-breadcrumbs'), destination, relative => { destination = relative; draw(); });
        $('move-up').disabled = !destination;
        $('move-confirm').disabled = destination === parent(source) || destination === source || destination.startsWith(source + '/');
        const folders = children(destination).filter(node => node.type === 'folder' && node.path !== source && !node.path.startsWith(source + '/'));
        const list = $('move-folders'); list.replaceChildren();
        for (const folder of folders) {
          const button = document.createElement('button'); button.className = 'move-folder'; button.dataset.path = folder.path;
          button.innerHTML = icon('folder') + `<span>${escape(folder.name)}</span>` + icon('chevron');
          button.onclick = () => { destination = folder.path; draw(); }; list.append(button);
        }
        if (!folders.length) { const message = document.createElement('div'); message.className = 'move-folder-empty'; message.textContent = 'Вложенных папок нет. Это место можно выбрать кнопкой внизу.'; list.append(message); }
      };
      $('move-up').onclick = () => { destination = parent(destination); draw(); };
      $('move-cancel').onclick = () => finish(null);
      $('move-confirm').onclick = () => finish(destination);
      dialog.addEventListener('cancel', cancel);
      draw(); dialog.showModal(); $('move-cancel').focus();
    });
  }

  return { render, chooseDestination };
}
