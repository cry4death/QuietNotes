import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { createExplorer } from './explorer.js';
import { createPanels } from './panels.js';
import { createNoteEditor } from './editor.js';

const $ = id => document.getElementById(id);
const api = window.notes;
const icons = {
  clipboard: '<path d="M9 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3M8 12h8m-8 4h8"/><rect x="9" y="2" width="6" height="5" rx="1.5"/>',
  notebook: '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M9 3v18M3 7h4M3 12h4M3 17h4M13 8h3M13 12h3"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  'folder-open': '<path d="M3 11V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2M3 10h18l-2 10H5Z"/>',
  'folder-plus': '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 13h6m-3-3v6"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9ZM14 3v6h6M8 13h8M8 17h5"/>',
  'file-plus': '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9ZM14 3v6h6M9 15h6m-3-3v6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>', chevrons: '<path d="m8 9 4-4 4 4m-8 6 4 4 4-4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20.5 13a9 9 0 0 1-9.5-9.5A9 9 0 1 0 20.5 13Z"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6ZM13 6l5 5"/>',
  pencil: '<path d="m16 3 5 5-12 12-6 1 1-6ZM13 6l5 5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  check: '<path d="m5 12 4 4L19 6"/>', copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  terminal: '<path d="m5 7 5 5-5 5m8 0h6"/>',
  up: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  move: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M7 13h10m-3-3 3 3-3 3"/>',
  import: '<path d="M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16m8-16v16"/>'
};
const icon = name => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.file}</svg>`;
document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
const state = { root: null, folder: '', viewMode: 'list', preview: true, sidebar: true, browser: true, sidebarWidth: 235, browserWidth: null, tree: [], expanded: new Set(), selected: null, note: null, editing: false, dirty: false, external: false, saving: false, navigating: false, theme: 'dark' };
let toastTimer, searchTimer, searchGeneration = 0, searchResults = [], activeResult = 0, refreshing = false, refreshAgain = false, closePending = false;
const basename = value => value.split('/').at(-1);
const parent = value => value.includes('/') ? value.slice(0, value.lastIndexOf('/')) : '';
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const flatten = nodes => nodes.flatMap(node => node.type === 'folder' ? [node, ...flatten(node.children)] : [node]);
const nodes = () => flatten(state.tree);
const selectedNode = () => nodes().find(node => node.path === state.selected);
const activeParent = () => state.folder;
const run = action => async (...args) => { try { return await action(...args); } catch (error) { toast(error.message, true); } };
marked.use({ renderer: {
  checkbox({ checked }) {
    return `<span class="task-check" role="img" aria-label="${checked ? 'Выполнено' : 'Не выполнено'}">${checked ? '☑' : '☐'}</span> `;
  }
} });

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 7000 : 2800);
}

function setDirty(value) {
  state.dirty = value;
  document.title = `${value ? '• ' : ''}${state.note ? basename(state.note.path).replace(/\.md$/i, '') + ' — ' : ''}Заметки`;
  api.dirty(value).catch(error => toast(error.message, true));
  updateStatus();
}

function updateStatus(message) {
  $('status-text').textContent = message || (state.dirty ? 'Есть несохранённые изменения' : state.editing ? 'Редактирование заметки' : state.note ? '.md · Сохранено на диске' : state.root ? `${nodes().filter(node => node.type === 'note').length} заметок · На диске` : 'Выберите папку, чтобы начать');
  $('status-text').classList.toggle('unsaved', state.dirty);
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  noteEditor.setTheme(theme);
  const title = theme === 'dark' ? 'Светлая тема' : 'Тёмная тема';
  $('theme-toggle').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
  $('theme-toggle').title = title;
  $('theme-toggle').setAttribute('aria-label', title);
}

// Один диалог используется для названий, удаления и несохранённых правок.
function ask({ title, description = '', value, preview, submit, buttons }) {
  const dialog = $('action-dialog');
  if (dialog.open) return Promise.resolve(null);
  const previousFocus = document.activeElement;
  $('action-title').textContent = title;
  $('action-description').textContent = description;
  $('action-input').hidden = value === undefined;
  $('action-label').hidden = value === undefined;
  $('action-input').value = value || '';
  $('action-error').textContent = '';
  $('action-buttons').replaceChildren();
  $('action-preview').hidden = preview === undefined;
  $('action-preview').textContent = preview ?? '';
  $('action-preview').scrollTop = 0;
  return new Promise(resolve => {
    let finished = false, submitting = false;
    const finish = result => {
      if (finished) return;
      finished = true;
      dialog.close();
      dialog.removeEventListener('cancel', cancel);
      $('action-form').onsubmit = null;
      $('action-preview').textContent = '';
      previousFocus?.focus();
      resolve(result);
    };
    const cancel = event => { event.preventDefault(); if (!submitting) finish(null); };
    dialog.addEventListener('cancel', cancel);
    for (const choice of buttons) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button ' + (choice.kind || '');
      button.textContent = choice.label;
      button.onclick = async () => {
        if (submitting) return;
        if (choice.value === 'submit') {
          const input = $('action-input');
          const name = input.value.trim();
          if (!name) { $('action-error').textContent = 'Введите название.'; input.focus(); return; }
          if (!submit) { finish(name); return; }
          submitting = true;
          $('action-error').textContent = '';
          const controls = [input, ...$('action-buttons').children];
          controls.forEach(control => { control.disabled = true; });
          try {
            finish(await submit(name));
          } catch (error) {
            $('action-error').textContent = error.message;
          } finally {
            submitting = false;
            controls.forEach(control => { control.disabled = false; });
            if (!finished) { input.focus(); input.select(); }
          }
        } else finish(choice.value);
      };
      $('action-buttons').append(button);
    }
    $('action-form').onsubmit = event => {
      event.preventDefault();
      if (value !== undefined) $('action-buttons').lastElementChild.click();
    };
    dialog.showModal();
    if (value !== undefined) { $('action-input').focus(); $('action-input').select(); }
    else $('action-buttons').firstElementChild.focus();
  });
}

async function confirmUnsaved() {
  if (!state.dirty) return true;
  const choice = await ask({ title: 'Сохранить изменения?', description: 'В заметке есть несохранённый текст.', buttons: [
    { label: 'Отмена', value: null }, { label: 'Не сохранять', value: 'discard' }, { label: 'Сохранить', value: 'save', kind: 'primary' }
  ] });
  if (choice === 'save') return await saveNote();
  return choice === 'discard';
}

function drawTree() {
  explorer.render();
  panels.render();
  if (!$('folder-preview').hidden) renderFolderPreview();
}

function updateToolbar() {
  $('select-root').setAttribute('aria-current', String(Boolean(state.root) && !state.selected));
  for (const id of ['rename', 'delete', 'move']) $(id).hidden = !state.selected;
  $('reveal').hidden = !state.root;
  $('edit').hidden = !state.note || state.editing;
  $('save').hidden = !state.editing;
  $('cancel-edit').hidden = !state.editing;
  $('edit-divider').hidden = !state.note;
  $('save').disabled = state.saving;
  noteEditor.setReadOnly(state.saving);
  for (const id of ['create-folder', 'create-note', 'import-files', 'create-from-clipboard']) $(id).disabled = state.saving;
}

function updateRoot() {
  $('root-name').textContent = state.root ? basename(state.root.replace(/\\/g, '/')) : 'Выбрать папку';
  $('choose-root').title = state.root ? `${state.root}\nНажмите, чтобы выбрать другую папку` : 'Выбрать папку';
  updateToolbar();
}

function clearNote(selection = null) {
  state.selected = selection; state.note = null; state.editing = false; state.external = false;
  setDirty(false);
  $('note').hidden = true; $('editor-panel').hidden = true; $('conflict-banner').hidden = true;
  $('content-scroll').scrollTop = 0;
}

function showWelcome() {
  clearNote();
  $('welcome').hidden = false; $('folder-preview').hidden = true;
  $('welcome-title').textContent = state.root ? 'Выберите заметку' : 'Всё нужное — под рукой.';
  $('welcome-description').innerHTML = state.root ? 'Нажмите на папку или заметку, чтобы увидеть её содержимое.<br>Двойной клик открывает папку в списке.' : 'Заметки, команды и инструкции.<br>В обычной папке на вашем компьютере.';
  $('welcome-choose').innerHTML = icon(state.root ? 'file-plus' : 'folder') + (state.root ? 'Создать заметку' : 'Выбрать папку с заметками');
  $('welcome-hint').textContent = state.root ? `Новые файлы создаются в папке «${state.folder ? basename(state.folder) : 'Мои заметки'}»` : 'Подойдёт любая папка с файлами .md';
  updateToolbar(); drawTree();
}

function showFolder(node) {
  state.folder = node?.path || '';
  state.browser = true;
  showFolderPreview();
}

async function navigateFolder(relative) {
  if (!state.root || state.navigating || state.saving || $('action-dialog').open || $('move-dialog').open) return;
  state.navigating = true;
  try {
    if (!(await confirmUnsaved())) return;
    const node = relative ? nodes().find(item => item.type === 'folder' && item.path === relative) : null;
    if (relative && !node) throw new Error('Папка больше не существует.');
    showFolder(node);
    await api.preferences({ folder: state.folder, lastNote: '', browser: state.browser });
  } finally { state.navigating = false; }
}

async function selectFolder(node) {
  if (state.navigating || state.saving || state.selected === node.path) return;
  state.navigating = true;
  try {
    if (!(await confirmUnsaved())) return;
    showFolderPreview(node.path);
  } finally { state.navigating = false; }
}

function showFolderPreview(selection = null) {
  clearNote(selection);
  $('welcome').hidden = true; $('folder-preview').hidden = false;
  updateToolbar(); drawTree();
}

function renderFolderPreview() {
  const relative = state.selected ?? state.folder;
  const entries = relative ? nodes().find(node => node.path === relative)?.children || [] : state.tree;
  $('folder-preview-title').textContent = relative ? basename(relative) : 'Мои заметки';
  $('folder-preview-open').hidden = !state.selected;
  $('folder-preview-empty').hidden = entries.length > 0;
  const list = $('folder-preview-list');
  const signature = JSON.stringify([relative, entries.map(entry => [entry.path, entry.type])]);
  if (list.dataset.signature === signature) return;
  list.dataset.signature = signature;
  list.replaceChildren();
  for (const entry of entries) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.innerHTML = icon(entry.type === 'folder' ? 'folder' : 'file');
    const name = document.createElement('span');
    name.textContent = basename(entry.path);
    button.append(name);
    button.onclick = run(() => entry.type === 'folder' ? navigateFolder(entry.path) : navigateToNote(entry.path));
    item.append(button);
    list.append(item);
  }
}

function renderMarkdown() {
  const content = state.note.content.replace(/^\uFEFF/, '');
  $('markdown').innerHTML = DOMPurify.sanitize(marked.parse(content, { gfm: true }), {
    FORBID_TAGS: ['style', 'form', 'button', 'input', 'textarea', 'select', 'video', 'audio'], FORBID_ATTR: ['style', 'id', 'name']
  });
  if (!$('markdown').querySelector('h1')) {
    const heading = document.createElement('h1');
    heading.textContent = basename(state.note.path).replace(/\.md$/i, '');
    $('markdown').prepend(heading);
  }
  $('markdown').querySelectorAll('pre').forEach(pre => {
    const code = pre.querySelector('code');
    if (!code) return;
    const command = code.textContent;
    const language = code.className.match(/language-([\w+-]+)/)?.[1] || '';
    if (language && hljs.getLanguage(language)) code.innerHTML = hljs.highlight(command, { language, ignoreIllegals: true }).value;
    code.classList.add('hljs');
    const block = document.createElement('div'); block.className = 'code-block';
    const bar = document.createElement('div'); bar.className = 'code-bar';
    const label = document.createElement('span'); label.className = 'code-language';
    label.innerHTML = icon('terminal') + `<span>${escape(language || 'Код')}</span>`;
    const copy = document.createElement('button'); copy.className = 'copy-button'; copy.innerHTML = icon('copy') + 'Копировать';
    copy.setAttribute('aria-label', 'Копировать код');
    copy.onclick = run(async () => {
      // Копируется исходный текст блока, без подсветки и элементов интерфейса.
      await api.copy(command.replace(/\r?\n$/, ''));
      copy.innerHTML = icon('check') + 'Скопировано';
      copy.classList.add('copied');
      setTimeout(() => { copy.innerHTML = icon('copy') + 'Копировать'; copy.classList.remove('copied'); }, 1800);
    });
    bar.append(label, copy); pre.replaceWith(block); block.append(bar, pre);
  });
  $('markdown').querySelectorAll('img').forEach(image => {
    const source = image.getAttribute('src') || '';
    if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(source)) {
      image.removeAttribute('src'); image.alt = image.alt || 'Внешнее изображение недоступно без интернета';
      return;
    }
    try {
      const url = new URL(source, 'notes://media/' + state.note.path.split('/').map(encodeURIComponent).join('/'));
      if (url.host === 'media') image.src = url.href;
      else image.removeAttribute('src');
    } catch { image.removeAttribute('src'); }
  });
  $('markdown').querySelectorAll('a').forEach(link => {
    link.onclick = run(async event => {
      event.preventDefault();
      const href = link.getAttribute('href') || '';
      if (href.startsWith('#')) {
        const target = decodeURIComponent(href.slice(1)).toLowerCase();
        [...$('markdown').querySelectorAll('h1,h2,h3,h4,h5,h6')].find(heading => heading.textContent.toLowerCase().replace(/\s+/g, '-') === target)?.scrollIntoView();
      } else if (!/^[a-z][a-z\d+.-]*:|^\/\//i.test(href) && /\.md(?:#.*)?$/i.test(href)) {
        const url = new URL(href, 'notes://media/' + state.note.path.split('/').map(encodeURIComponent).join('/'));
        await navigateToNote(decodeURIComponent(url.pathname.slice(1)));
      } else toast('Внешние ссылки отключены: приложение работает без интернета.');
    });
  });
  $('note-topic').textContent = parent(state.note.path).replaceAll('/', ' / ') || 'Мои заметки';
  $('note-date').textContent = 'Изменено ' + new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' }).format(state.note.modified);
}

async function openNote(relative, skipConfirm = false, revealPreview = true) {
  if (relative === state.note?.path && !skipConfirm) {
    if (revealPreview) { state.preview = true; drawTree(); await api.preferences({ preview: true }); }
    if (!state.editing) $('content-scroll').scrollTop = 0;
    return;
  }
  if (!skipConfirm && !(await confirmUnsaved())) return;
  const note = await api.read(relative);
  if (revealPreview) state.preview = true;
  state.selected = relative; state.folder = parent(relative); state.note = note; state.editing = false; state.external = false;
  setDirty(false);
  let folder = parent(relative);
  while (folder) { state.expanded.add(folder); folder = parent(folder); }
  $('welcome').hidden = true; $('folder-preview').hidden = true; $('editor-panel').hidden = true; $('note').hidden = false; $('conflict-banner').hidden = true;
  renderMarkdown(); updateToolbar(); drawTree();
  $('content-scroll').scrollTop = 0;
  await api.preferences({ lastNote: relative, folder: state.folder, preview: state.preview, expanded: [...state.expanded] });
}

async function navigateToNote(relative) {
  if (state.navigating || state.saving) return;
  state.navigating = true;
  try { await openNote(relative); } finally { state.navigating = false; }
}

async function chooseRoot() {
  if (state.navigating || state.saving) return;
  state.navigating = true;
  try {
    if (!(await confirmUnsaved())) return;
    const result = await api.chooseRoot();
    if (!result) return;
    state.root = result.root; state.folder = ''; state.tree = result.tree;
    state.expanded = new Set(state.tree.filter(node => node.type === 'folder').map(node => node.path));
    await api.preferences({ lastNote: '', folder: '', expanded: [...state.expanded] });
    updateRoot(); showWelcome();
    const first = state.tree.find(node => node.type === 'note');
    if (first) await openNote(first.path, true);
  } finally { state.navigating = false; }
}

async function createItem(type, destination) {
  if (state.navigating || state.saving) return;
  if (!state.root) await chooseRoot();
  if (!state.root) return;
  state.navigating = true;
  try {
    const folder = destination ?? activeParent();
    if (!(await confirmUnsaved())) return;
    const name = await ask({ title: type === 'folder' ? 'Новая папка' : 'Новая заметка', description: `В папке: ${folder || basename(state.root.replace(/\\/g, '/'))}`, value: '', buttons: [{ label: 'Отмена', value: null }, { label: 'Создать', value: 'submit', kind: 'primary' }] });
    if (!name) return;
    const relative = await api.create(folder, name, type);
    state.tree = await api.tree();
    if (folder) state.expanded.add(folder);
    if (type === 'note') { await openNote(relative, true); startEditing(); }
    else { state.expanded.add(relative); showFolder(nodes().find(node => node.path === relative)); }
    drawTree();
    await api.preferences({ folder: state.folder, browser: state.browser });
  } finally { state.navigating = false; }
}

async function createFromClipboard(destination) {
  if (state.navigating || state.saving || document.querySelector('dialog[open]')) return;
  const content = await api.clipboardText();
  if (!state.root) await chooseRoot();
  if (!state.root || state.navigating || state.saving) return;
  state.navigating = true;
  try {
    const folder = destination ?? activeParent();
    if (!(await confirmUnsaved())) return;
    const previewLimit = 12000;
    const relative = await ask({
      title: 'Новая заметка из буфера',
      description: `В папке: ${folder || basename(state.root.replace(/\\/g, '/'))}`,
      value: '',
      preview: content.length > previewLimit ? content.slice(0, previewLimit) + '\n\n… Остальной текст тоже сохранится' : content,
      submit: name => api.create(folder, name, 'note', content),
      buttons: [{ label: 'Отмена', value: null }, { label: 'Сохранить заметку', value: 'submit', kind: 'primary' }]
    });
    if (!relative) return;
    state.tree = await api.tree();
    await openNote(relative, true);
    toast('Заметка сохранена');
  } finally { state.navigating = false; }
}

function startEditing() {
  if (!state.note || state.saving) return;
  state.editing = true;
  state.preview = true;
  drawTree();
  api.preferences({ preview: true }).catch(error => toast(error.message, true));
  $('note').hidden = true; $('editor-panel').hidden = false;
  noteEditor.load(state.note.content);
  updateToolbar(); updateStatus(); noteEditor.focus();
}

async function saveNote() {
  if (!state.editing || !state.note || state.saving) return !state.dirty;
  if (state.external) { toast('Файл изменён снаружи. Загрузите его с диска или сохраните свою версию отдельной копией.', true); return false; }
  state.saving = true; updateToolbar();
  try {
    const result = await api.save(state.note.path, noteEditor.value(), state.note.version);
    if (result.conflict) { showConflict(); return false; }
    state.note = result; state.editing = false; state.external = false;
    setDirty(false); renderMarkdown();
    $('note').hidden = false; $('editor-panel').hidden = true; $('conflict-banner').hidden = true;
    toast('Заметка сохранена');
    return true;
  } catch (error) { toast(error.message, true); return false; }
  finally { state.saving = false; updateToolbar(); if (closePending) run(requestClose)(); }
}

function showConflict(missing = false) {
  state.external = true;
  $('conflict-banner').hidden = false;
  $('conflict-banner').querySelector('span').textContent = missing ? 'Файл удалён или перемещён снаружи. Ваш текст остаётся в редакторе.' : 'Файл изменён снаружи. Ваш текст остаётся в редакторе.';
  $('load-external').hidden = missing;
}

async function saveCopy() {
  if (!state.note || state.saving) return;
  const name = await ask({ title: 'Сохранить отдельную копию', description: 'Файл на диске останется без изменений.', value: basename(state.note.path).replace(/\.md$/i, '') + ' — копия', buttons: [{ label: 'Отмена', value: null }, { label: 'Сохранить копию', value: 'submit', kind: 'primary' }] });
  if (!name) return;
  state.saving = true; updateToolbar();
  try {
    const relative = await api.create(parent(state.note.path), name, 'note');
    const original = await api.read(relative);
    const saved = await api.save(relative, noteEditor.value(), original.version);
    if (saved.conflict) throw new Error('Файл копии тоже изменился. Выберите другое название.');
    state.tree = await api.tree();
    await openNote(relative, true);
    toast('Ваша версия сохранена отдельной копией');
  } finally { state.saving = false; updateToolbar(); if (closePending) run(requestClose)(); }
}

async function renameItem(relative = state.selected) {
  const node = nodes().find(item => item.path === relative);
  if (!node || state.navigating || state.saving) return;
  state.navigating = true;
  try {
    if (!(await confirmUnsaved())) return;
    const name = await ask({ title: 'Переименовать', value: node.name, buttons: [{ label: 'Отмена', value: null }, { label: 'Переименовать', value: 'submit', kind: 'primary' }] });
    if (!name) return;
    const next = await api.rename(node.path, name);
    state.expanded = new Set([...state.expanded].map(item => item === node.path || item.startsWith(node.path + '/') ? next + item.slice(node.path.length) : item));
    state.tree = await api.tree();
    if (node.type === 'note') await openNote(next, true);
    else { state.folder = parent(next); showFolderPreview(next); }
    await api.preferences({ expanded: [...state.expanded] });
    toast('Название изменено');
  } finally { state.navigating = false; }
}

async function moveItem(relative = state.selected, destination) {
  const node = nodes().find(item => item.path === relative);
  if (!node || state.navigating || state.saving) return;
  state.navigating = true;
  try {
    if (!(await confirmUnsaved())) return;
    const folder = destination === undefined ? await explorer.chooseDestination(relative) : destination;
    if (folder === null) return;
    if (folder === parent(relative)) { toast('Файл уже находится в этой папке'); return; }
    const next = await api.move(relative, folder);
    state.tree = await api.tree(); state.folder = folder;
    if (node.type === 'note') await openNote(next, true);
    else showFolderPreview(next);
    await api.preferences({ folder: state.folder });
    toast('Перемещено в «' + (folder ? basename(folder) : 'Мои заметки') + '»');
  } finally { state.navigating = false; }
}

async function importFiles(destination = state.folder) {
  if (state.navigating || state.saving) return;
  if (!state.root) await chooseRoot();
  if (!state.root) return;
  state.navigating = true;
  try {
    if (!(await confirmUnsaved())) return;
    const result = await api.importFiles(destination);
    if (!result) return;
    state.tree = await api.tree(); drawTree();
    if (result.added.length) await openNote(result.added[0], true);
    if (result.errors.length) toast(result.errors.map(item => item.name + ': ' + item.message).join(' '), true);
    else toast('Добавлено файлов: ' + result.added.length);
  } finally { state.navigating = false; }
}

async function deleteItem(relative = state.selected) {
  const node = nodes().find(item => item.path === relative);
  if (!node || state.navigating || state.saving) return;
  state.navigating = true;
  try {
    if (!(await confirmUnsaved())) return;
    const choice = await ask({ title: `Удалить «${node.name}»?`, description: node.type === 'folder' ? 'Папка и всё её содержимое будут перемещены в корзину Windows.' : 'Заметка будет перемещена в корзину Windows.', buttons: [{ label: 'Отмена', value: null }, { label: 'В корзину', value: 'delete', kind: 'danger' }] });
    if (choice !== 'delete') return;
    await api.delete(node.path);
    state.tree = await api.tree();
    while (state.folder && !nodes().some(item => item.type === 'folder' && item.path === state.folder)) state.folder = parent(state.folder);
    showWelcome();
    await api.preferences({ lastNote: '' });
    toast('Перемещено в корзину');
  } finally { state.navigating = false; }
}

async function refreshFiles() {
  if (!state.root) return;
  if (refreshing) { refreshAgain = true; return; }
  if (state.navigating || state.saving) { setTimeout(() => run(refreshFiles)(), 300); return; }
  refreshing = true;
  try {
    state.tree = await api.tree();
    while (state.folder && !nodes().some(item => item.type === 'folder' && item.path === state.folder)) state.folder = parent(state.folder);
    drawTree(); updateStatus();
    if (state.note) {
      const relative = state.note.path;
      let current;
      try { current = await api.read(relative); }
      catch (error) {
        if (state.dirty) showConflict(true);
        else { showWelcome(); toast('Выбранная заметка удалена или перемещена.'); }
        return;
      }
      if (state.note?.path !== relative || state.saving) return;
      if (current.version !== state.note.version) {
        if (state.dirty) showConflict();
        else {
          state.note = current; renderMarkdown();
          if (state.editing) noteEditor.load(current.content);
          updateStatus('Подхвачены изменения с диска');
        }
      }
    } else if (state.selected && !selectedNode()) showWelcome();
    if ($('search-dialog').open) scheduleSearch();
  } finally {
    refreshing = false;
    if (refreshAgain) { refreshAgain = false; run(refreshFiles)(); }
  }
}

function openSearch() {
  if ($('action-dialog').open || $('move-dialog').open) return;
  if (!$('search-dialog').open) $('search-dialog').showModal();
  $('search-input').focus(); $('search-input').select();
  scheduleSearch();
}

function highlightMatch(text, query) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return escape(text);
  const pattern = new RegExp(terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  let result = '', start = 0;
  for (const match of text.matchAll(pattern)) { result += escape(text.slice(start, match.index)) + '<mark>' + escape(match[0]) + '</mark>'; start = match.index + match[0].length; }
  return result + escape(text.slice(start));
}

function drawSearch(query) {
  const container = $('search-results'); container.replaceChildren();
  searchResults.forEach((result, index) => {
    const button = document.createElement('button');
    button.className = 'search-result'; button.setAttribute('role', 'option'); button.id = 'search-result-' + index;
    button.innerHTML = `<span class="result-icon">${icon('file')}</span><span class="result-body"><strong>${highlightMatch(result.name, query)}</strong><span class="result-path">${escape(parent(result.path) || 'Мои заметки')}</span><span class="result-snippet">${highlightMatch(result.snippet, query)}</span></span><span class="result-enter">↵</span>`;
    button.onclick = run(async () => { $('search-dialog').close(); await navigateToNote(result.path); });
    button.onmousemove = () => { if (activeResult !== index) { activeResult = index; selectResult(false); } };
    container.append(button);
  });
  if (!searchResults.length) {
    const empty = document.createElement('div'); empty.className = 'search-empty';
    empty.textContent = !state.root ? 'Сначала выберите папку с заметками.' : query ? 'Ничего не найдено. Попробуйте другое слово.' : 'Введите название, команду или часть текста.';
    container.append(empty);
  }
  $('search-caption').textContent = query ? `Найдено: ${searchResults.length}` : 'Поиск по названиям и содержимому всех заметок';
  activeResult = 0; selectResult(false);
}

function selectResult(scroll = true) {
  const rows = [...$('search-results').querySelectorAll('.search-result')];
  rows.forEach((row, index) => { row.classList.toggle('active', index === activeResult); row.setAttribute('aria-selected', String(index === activeResult)); });
  if (rows[activeResult]) { $('search-input').setAttribute('aria-activedescendant', rows[activeResult].id); if (scroll) rows[activeResult].scrollIntoView({ block: 'nearest' }); }
  else $('search-input').removeAttribute('aria-activedescendant');
}

function scheduleSearch() {
  clearTimeout(searchTimer);
  const generation = ++searchGeneration;
  const query = $('search-input').value.trim();
  if (!query || !state.root) { searchResults = []; drawSearch(query); return; }
  $('search-caption').textContent = 'Поиск…';
  searchTimer = setTimeout(run(async () => {
    const results = await api.search(query);
    if (generation !== searchGeneration || !$('search-dialog').open) return;
    searchResults = results; drawSearch(query);
  }), 100);
}

async function contextMenu(event, relative, background = false) {
  event.preventDefault(); event.stopPropagation();
  if (state.navigating || state.saving || document.querySelector('dialog[open]')) return;
  const command = await api.contextMenu({ path: relative, background });
  if (!command) return;
  const actions = {
    'create-note': () => createItem('note', command.directory),
    'create-from-clipboard': () => createFromClipboard(command.directory),
    'create-folder': () => createItem('folder', command.directory),
    import: () => importFiles(command.directory),
    'open-folder': () => navigateFolder(command.path),
    'open-note': () => navigateToNote(command.path),
    rename: () => renameItem(command.path),
    move: () => moveItem(command.path),
    delete: () => deleteItem(command.path),
    reveal: () => api.reveal(command.path)
  };
  await actions[command.action]?.();
}

const explorer = createExplorer({ state, $, icon, escape, flatten, parent, basename, run, navigateFolder, navigateToNote, selectFolder, moveItem, contextMenu });
const panels = createPanels({ state, $, api, run });
const noteEditor = createNoteEditor({ $, getPath: () => state.note?.path || '', getTheme: () => state.theme, toast,
  onChange: content => { if (state.editing && !state.saving) setDirty(content !== state.note.content); }
});
$('view-mode').onchange = run(async () => {
  state.viewMode = $('view-mode').value;
  drawTree();
  await api.preferences({ viewMode: state.viewMode });
});
$('choose-root').onclick = run(chooseRoot);
$('select-root').onclick = run(() => navigateFolder(''));
$('folder-up').onclick = run(() => navigateFolder(parent(state.folder)));
$('welcome-choose').onclick = run(() => state.root ? createItem('note') : chooseRoot());
$('folder-preview-open').onclick = run(() => navigateFolder(state.selected));
$('create-folder').onclick = run(() => createItem('folder'));
$('create-note').onclick = run(() => createItem('note'));
$('create-from-clipboard').onclick = run(() => createFromClipboard());
$('import-files').onclick = run(() => importFiles());
$('move').onclick = run(() => moveItem());
$('rename').onclick = run(() => renameItem()); $('delete').onclick = run(() => deleteItem());
$('reveal').onclick = run(() => api.reveal(state.selected || ''));
$('edit').onclick = startEditing; $('save').onclick = run(saveNote);
$('cancel-edit').onclick = run(async () => { if (state.note && await confirmUnsaved()) await openNote(state.note.path, true); });
$('load-external').onclick = run(async () => {
  const choice = await ask({ title: 'Загрузить версию с диска?', description: 'Несохранённый текст в редакторе будет заменён. Чтобы оставить его, сначала сохраните копию.', buttons: [{ label: 'Отмена', value: null }, { label: 'Загрузить с диска', value: 'load', kind: 'primary' }] });
  if (choice === 'load') await openNote(state.note.path, true);
});
$('save-copy').onclick = run(saveCopy);
$('theme-toggle').onclick = run(async () => { setTheme(state.theme === 'dark' ? 'light' : 'dark'); await api.preferences({ theme: state.theme }); });
$('search-open').onclick = openSearch;
$('search-close').onclick = () => $('search-dialog').close();
$('search-dialog').addEventListener('close', () => { ++searchGeneration; clearTimeout(searchTimer); (state.sidebar ? $('search-open') : $('sidebar-toggle')).focus(); });
$('search-dialog').addEventListener('click', event => { if (event.target === $('search-dialog')) { const r = $('search-dialog').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('search-dialog').close(); } });
$('search-input').oninput = scheduleSearch;
$('search-input').onkeydown = event => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); activeResult = Math.max(0, Math.min(searchResults.length - 1, activeResult + (event.key === 'ArrowDown' ? 1 : -1))); selectResult(); }
  if (event.key === 'Enter') { event.preventDefault(); $('search-results').querySelectorAll('.search-result')[activeResult]?.click(); }
};
document.addEventListener('keydown', run(async event => {
  if (event.ctrlKey && event.shiftKey && !event.altKey && event.code === 'KeyN' && !event.isComposing) {
    event.preventDefault();
    if (!event.repeat) await createFromClipboard();
    return;
  }
  if (event.altKey && event.key === 'ArrowUp') { event.preventDefault(); await navigateFolder(parent(state.folder)); }
  if (event.key === 'F11') { event.preventDefault(); await api.fullscreen(); }
  if ((event.ctrlKey || event.metaKey) && (event.code === 'KeyK' || event.key.toLowerCase() === 'k')) { event.preventDefault(); openSearch(); }
  if ((event.ctrlKey || event.metaKey) && (event.code === 'KeyS' || event.key.toLowerCase() === 's')) { event.preventDefault(); if (!$('action-dialog').open && !$('move-dialog').open) await saveNote(); }
  if (event.key === 'F2' && !$('action-dialog').open && !$('search-dialog').open && !$('move-dialog').open && !state.editing) { event.preventDefault(); await renameItem(); }
}));
api.onFilesChanged(run(refreshFiles));
api.onWatchError(message => toast('Не удалось отследить изменения: ' + message, true));
async function requestClose() {
  if (state.saving) { closePending = true; return; }
  closePending = false;
  if ($('search-dialog').open) $('search-dialog').close();
  if (await confirmUnsaved()) await api.close();
}
api.onRequestClose(run(requestClose));
window.addEventListener('focus', run(refreshFiles));

async function init() {
  const initial = await api.initial();
  setTheme(initial.settings.theme || 'dark');
  state.viewMode = ['list', 'tiles', 'icons'].includes(initial.settings.viewMode) ? initial.settings.viewMode : 'list';
  state.preview = initial.settings.preview !== false;
  state.sidebar = initial.settings.sidebar !== false;
  state.browser = initial.settings.browser !== false;
  if (!state.browser && !state.preview) state.preview = true;
  state.sidebarWidth = Number.isFinite(initial.settings.sidebarWidth) ? initial.settings.sidebarWidth : 235;
  state.browserWidth = Number.isFinite(initial.settings.browserWidth) ? initial.settings.browserWidth : null;
  state.root = initial.root;
  state.expanded = new Set(initial.settings.expanded || []);
  updateRoot();
  if (state.root) {
    state.tree = await api.tree();
    const all = nodes();
    state.folder = all.some(item => item.type === 'folder' && item.path === initial.settings.folder) ? initial.settings.folder : '';
    const first = all.find(node => node.path === initial.settings.lastNote && node.type === 'note')
      || (initial.settings.folder === undefined ? state.tree.find(node => node.type === 'note') || all.find(node => node.type === 'note') : null);
    if (first) await openNote(first.path, true, false); else showWelcome();
  } else showWelcome();
  if (initial.settings.rootError) toast(initial.settings.rootError, true);
}
run(async () => { try { await init(); } finally { document.body.setAttribute('aria-busy', 'false'); } })();
