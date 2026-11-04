const { app, BrowserWindow, ipcMain, dialog, protocol, session, shell, clipboard, screen, nativeTheme } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { NoteStore } = require('./store.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'notes', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.commandLine.appendSwitch('disable-background-networking');
if (process.env.QUIET_NOTES_TEST_DATA) app.setPath('userData', process.env.QUIET_NOTES_TEST_DATA);

let window, store, watcher, settings = {}, settingsFile, dirty = false, allowClose = false;
let operations = Promise.resolve();
let settingsQueue = Promise.resolve();
let closing = false;
let fullscreenQueue = Promise.resolve();
const serialized = task => {
  const result = operations.then(task);
  operations = result.catch(() => {});
  return result;
};
const persist = () => {
  const snapshot = JSON.stringify(settings, null, 2);
  settingsQueue = settingsQueue.catch(() => {}).then(async () => {
    await fs.writeFile(settingsFile + '.tmp', snapshot, 'utf8');
    await fs.rename(settingsFile + '.tmp', settingsFile);
  });
  return settingsQueue;
};

function recordWindow() {
  settings.window = { ...window.getNormalBounds(), maximized: window.isMaximized(), fullscreen: window.isFullScreen() };
}

async function closeWindow() {
  if (closing) return;
  closing = true;
  try { recordWindow(); await persist(); }
  finally { allowClose = true; window.close(); }
}

function failText(error) {
  const messages = {
    ENOENT: 'Файл или папка больше не существует. Обновите список или выберите другую папку.',
    EACCES: 'Нет доступа к файлу. Проверьте разрешения папки.',
    EPERM: 'Windows не разрешает изменить файл. Проверьте права доступа и другие открытые программы.',
    EEXIST: 'Файл или папка с таким названием уже существует.',
    ENOSPC: 'На диске не осталось места. Освободите место и сохраните ещё раз.',
    EBUSY: 'Файл занят другой программой. Закройте её и попробуйте снова.'
  };
  return messages[error.code] || error.message || 'Не удалось выполнить действие.';
}

function handle(name, callback) {
  ipcMain.handle(name, async (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame
      || event.senderFrame.url !== 'notes://app/index.html') throw new Error('Недопустимый запрос.');
    try { return { ok: true, value: await callback(...args) }; }
    catch (error) { return { ok: false, error: failText(error) }; }
  });
}

async function setRoot(root) {
  const next = await NoteStore.open(root);
  const tree = await next.tree();
  await watcher?.close();
  store = next;
  const { watch } = await import('chokidar');
  watcher = watch(store.root, {
    ignoreInitial: true, followSymlinks: false,
    ignored: file => path.relative(store.root, file).split(path.sep).some(part => part.startsWith('.')),
    awaitWriteFinish: { stabilityThreshold: 220, pollInterval: 70 }
  });
  let timer;
  watcher.on('all', () => {
    store.invalidateSearch();
    clearTimeout(timer);
    timer = setTimeout(() => window?.webContents.send('files-changed'), 100);
  });
  watcher.on('error', error => window?.webContents.send('watch-error', failText(error)));
  settings.root = store.root;
  delete settings.rootError;
  await persist();
  return { root: store.root, tree };
}

function installHandlers() {
  const getStore = () => { if (!store) throw new Error('Сначала выберите папку заметок.'); return store; };
  handle('initial', () => ({ settings, root: store?.root || null, version: app.getVersion() }));
  handle('choose-root', () => serialized(async () => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Выберите папку с Markdown-заметками', properties: ['openDirectory', 'createDirectory'],
      defaultPath: settings.root || app.getPath('documents'), buttonLabel: 'Выбрать папку'
    });
    if (result.canceled) return null;
    return setRoot(result.filePaths[0]);
  }));
  handle('tree', () => serialized(() => getStore().tree()));
  handle('read', relative => serialized(() => getStore().read(relative)));
  handle('search', query => serialized(() => getStore().search(query)));
  handle('save', (relative, content, version) => serialized(() => getStore().save(relative, content, version)));
  handle('create', (parent, name, type) => serialized(() => getStore().create(parent, name, type)));
  handle('rename', (relative, name) => serialized(() => getStore().rename(relative, name)));
  handle('move', (relative, destination) => serialized(() => getStore().move(relative, destination)));
  handle('import-files', destination => serialized(async () => {
    const current = getStore();
    await current.resolve(destination);
    const result = await dialog.showOpenDialog(window, {
      title: 'Добавить Markdown-файлы в текущую папку', buttonLabel: 'Добавить',
      properties: ['openFile', 'multiSelections'], filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (result.canceled) return null;
    return current.importFiles(destination, result.filePaths);
  }));
  handle('delete', relative => serialized(() => getStore().trash(relative, item => shell.trashItem(item))));
  handle('reveal', async relative => {
    const full = await getStore().resolve(relative);
    if (!relative) {
      const error = await shell.openPath(full);
      if (error) throw new Error(error);
    } else shell.showItemInFolder(full);
  });
  handle('copy', text => { if (typeof text !== 'string') throw new Error('Нечего копировать.'); clipboard.writeText(text); });
  handle('preferences', patch => {
    if (['dark', 'light'].includes(patch?.theme)) {
      settings.theme = patch.theme;
      nativeTheme.themeSource = patch.theme;
    }
    if (typeof patch?.lastNote === 'string') settings.lastNote = patch.lastNote;
    if (typeof patch?.folder === 'string') settings.folder = patch.folder;
    if (['list', 'tiles', 'icons'].includes(patch?.viewMode)) settings.viewMode = patch.viewMode;
    if (typeof patch?.preview === 'boolean') settings.preview = patch.preview;
    if (Array.isArray(patch?.expanded)) settings.expanded = patch.expanded.filter(item => typeof item === 'string');
    return persist();
  });
  handle('dirty', value => { dirty = Boolean(value); window.setDocumentEdited(dirty); });
  handle('close', closeWindow);
  handle('fullscreen', () => {
    fullscreenQueue = fullscreenQueue.then(() => new Promise(resolve => {
      const next = !window.isFullScreen();
      window.once(next ? 'enter-full-screen' : 'leave-full-screen', () => resolve());
      window.setFullScreen(next);
    }));
    return fullscreenQueue;
  });
}

async function createWindow() {
  const saved = settings.window || {};
  const visible = Number.isFinite(saved.x) && Number.isFinite(saved.y)
    && screen.getAllDisplays().some(({ workArea: a }) => saved.x + 100 > a.x && saved.x < a.x + a.width - 100
      && saved.y + 50 > a.y && saved.y < a.y + a.height - 50);
  window = new BrowserWindow({
    width: Math.max(800, Math.min(saved.width || 1180, 3840)),
    height: Math.max(560, Math.min(saved.height || 790, 2160)),
    ...(visible ? { x: saved.x, y: saved.y } : {}),
    minWidth: 800, minHeight: 560, show: false, title: 'Заметки',
    backgroundColor: settings.theme === 'light' ? '#fafbfc' : '#1b1e24',
    icon: path.join(__dirname, '../assets/icon.ico'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  let geometryTimer;
  const saveGeometry = () => {
    clearTimeout(geometryTimer);
    geometryTimer = setTimeout(() => {
      if (window.isDestroyed()) return;
      recordWindow();
      persist().catch(() => {});
    }, 250);
  };
  for (const event of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) window.on(event, saveGeometry);
  window.on('close', event => {
    if (allowClose) return;
    event.preventDefault();
    if (dirty) window.webContents.send('request-close');
    else closeWindow().catch(() => {});
  });
  window.once('ready-to-show', () => {
    if (saved.maximized) window.maximize();
    if (saved.fullscreen) window.setFullScreen(true);
    window.show();
  });
  await window.loadURL('notes://app/index.html');
}

async function ready() {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  await fs.mkdir(path.dirname(settingsFile), { recursive: true });
  try {
    const parsed = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
    settings = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { settings = {}; }
  settings.theme = settings.theme === 'light' ? 'light' : 'dark';
  nativeTheme.themeSource = settings.theme;
  if (process.env.QUIET_NOTES_TEST_ROOT) settings.root = process.env.QUIET_NOTES_TEST_ROOT;
  if (settings.root) {
    try { await setRoot(settings.root); }
    catch (error) { settings.rootError = failText(error); }
  }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
  protocol.handle('notes', async request => {
    try {
      const url = new URL(request.url);
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      let full;
      if (url.host === 'app' && ['index.html', 'renderer.js', 'styles.css'].includes(relative)) full = path.join(__dirname, '../dist', relative);
      else if (url.host === 'media' && store && /\.(png|jpe?g|gif|webp|svg)$/i.test(relative)) full = await store.resolve(relative);
      else return new Response('Not found', { status: 404 });
      return new Response(await fs.readFile(full), { headers: { 'Content-Type': types[path.extname(full).toLowerCase()] || 'application/octet-stream' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith('notes://') && !details.url.startsWith('devtools://') });
  });
  installHandlers();
  await createWindow();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(ready).catch(error => { dialog.showErrorBox('Не удалось запустить Заметки', failText(error)); app.quit(); });
  app.on('window-all-closed', () => { watcher?.close(); app.quit(); });
}
