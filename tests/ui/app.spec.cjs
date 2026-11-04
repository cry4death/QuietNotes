const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

let application, page, temp, root, data;
const errors = [];
async function launch(withRoot = true) {
  const env = { ...process.env, QUIET_NOTES_TEST_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  if (withRoot) env.QUIET_NOTES_TEST_ROOT = root;
  application = await electron.launch({ args: ['.'], cwd: path.resolve(__dirname, '../..'), env });
  page = await application.firstWindow();
  page.on('pageerror', error => errors.push(error.stack || error.message));
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
}
async function fillMarkdown(text) {
  await page.locator('#editor-source').click();
  await page.locator('#editor').fill(text);
}

test.beforeEach(async () => {
  errors.length = 0;
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'quiet-notes-ui-'));
  root = path.join(temp, 'Заметки'); data = path.join(temp, 'settings');
  await fs.mkdir(path.join(root, 'SSH'), { recursive: true });
  await fs.mkdir(path.join(root, 'Git'), { recursive: true });
  await fs.writeFile(path.join(root, 'SSH', 'Подключение.md'), '# Подключение к серверу\n\nБыстрый доступ к рабочему серверу по SSH.\n\n## Подключиться\n\n```bash\nssh root@192.168.1.10\n```\n\n## Передать файл\n\n```bash\nscp ./backup.tar.gz root@192.168.1.10:/var/backups/\n```\n\n> Перед первым подключением проверьте адрес и отпечаток ключа.\n\n## Полезно знать\n\n- Стандартный порт: `22`\n- Выйти из сессии: `exit`\n');
  await fs.writeFile(path.join(root, 'Git', 'Ветки.md'), '# Ветки Git\n\nУникальный текст для поиска: черника\n\n```sh\ngit switch -c feature/notes\n```\n');
});
test.afterEach(async () => {
  if (application) {
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.removeAllListeners('close')));
    await application.close();
  }
  application = null;
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  expect(errors).toEqual([]);
});

test('папки, просмотр, точное копирование и поиск текста', async () => {
  await launch();
  await page.locator('.folder-shortcut', { hasText: 'SSH' }).click();
  await page.locator('.file-row.note', { hasText: 'Подключение' }).click();
  await expect(page.locator('#markdown h1')).toHaveText('Подключение к серверу');
  await expect(page.locator('.code-block')).toHaveCount(2);
  await page.getByRole('button', { name: 'Копировать код', exact: true }).first().click();
  const copied = await application.evaluate(({ clipboard }) => clipboard.readText());
  expect(copied).toBe('ssh root@192.168.1.10');
  await expect(page.locator('.copy-button').first()).toHaveText('Скопировано');
  await page.keyboard.press('Control+k');
  await page.locator('#search-input').fill('черника');
  await expect(page.locator('.search-result')).toHaveCount(1);
  await expect(page.locator('.search-result strong')).toHaveText('Ветки');
  await page.keyboard.press('Enter');
  await expect(page.locator('#markdown h1')).toHaveText('Ветки Git');
  await expect(page.locator('#search-dialog')).not.toBeVisible();
});

test('редактирование, Ctrl+S, внешние изменения и конфликт', async () => {
  await launch();
  await page.locator('#edit').click();
  await fillMarkdown('# Мой текст\n\nИзменение из приложения.');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#markdown h1')).toHaveText('Мой текст');
  expect(await fs.readFile(path.join(root, 'Git', 'Ветки.md'), 'utf8')).toContain('Изменение из приложения');
  await fs.writeFile(path.join(root, 'Git', 'Ветки.md'), '# Снаружи\n\nВнешняя версия.');
  await expect(page.locator('#markdown h1')).toHaveText('Снаружи');
  await page.locator('#edit').click();
  await fillMarkdown('# Моя несохранённая версия');
  await fs.writeFile(path.join(root, 'Git', 'Ветки.md'), '# Внешняя вторая версия');
  await expect(page.locator('#conflict-banner')).toBeVisible();
  await page.keyboard.press('Control+s');
  expect(await fs.readFile(path.join(root, 'Git', 'Ветки.md'), 'utf8')).toBe('# Внешняя вторая версия');
  await expect(page.locator('#editor')).toHaveValue('# Моя несохранённая версия');
  await page.locator('#save-copy').click();
  await page.locator('#action-input').fill('Моя копия');
  await page.getByRole('button', { name: 'Сохранить копию', exact: true }).last().click();
  await expect(page.locator('#markdown h1')).toHaveText('Моя несохранённая версия');
  expect(await fs.readFile(path.join(root, 'Git', 'Моя копия.md'), 'utf8')).toBe('# Моя несохранённая версия');
});

test('создать, переименовать, отменить и подтвердить удаление', async () => {
  await launch();
  await page.locator('#create-folder').click();
  await page.locator('#action-input').fill('Хостинг');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  // Новая папка создаётся рядом с выбранной заметкой.
  await expect(page.locator('#browser-title')).toHaveText('Хостинг');
  await page.locator('#create-note').click();
  await page.locator('#action-input').fill('Проверка');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('#editor-panel')).toBeVisible();
  await fillMarkdown('# Проверка\n\nТекст');
  await page.keyboard.press('Control+s');
  await page.locator('#rename').click();
  await page.locator('#action-input').fill('Новое имя');
  await page.getByRole('button', { name: 'Переименовать', exact: true }).last().click();
  await expect(page.locator('.file-row.note', { hasText: 'Новое имя' })).toBeVisible();
  await page.locator('#delete').click();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  expect(await fs.readFile(path.join(root, 'Git', 'Хостинг', 'Новое имя.md'), 'utf8')).toContain('Текст');
  await page.locator('#delete').click();
  await page.getByRole('button', { name: 'В корзину', exact: true }).click();
  await expect(page.locator('.file-row.note', { hasText: 'Новое имя' })).toHaveCount(0);
  await expect(fs.access(path.join(root, 'Git', 'Хостинг', 'Новое имя.md'))).rejects.toThrow();
});

test('защита несохранённого текста и тема после перезапуска', async () => {
  await launch();
  expect(await application.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)).toBe(true);
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => application.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)).toBe(false);
  await page.locator('#edit').click();
  await fillMarkdown('Не потерять этот текст');
  await page.locator('.folder-shortcut', { hasText: 'SSH' }).click();
  await expect(page.locator('#action-title')).toHaveText('Сохранить изменения?');
  await page.getByRole('button', { name: 'Отмена', exact: true }).last().click();
  await expect(page.locator('#editor')).toHaveValue('Не потерять этот текст');
  await page.locator('#save').click();
  await expect(page.locator('#editor')).not.toBeVisible();
  await application.close(); application = null;
  await launch(false);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#markdown')).toContainText('Не потерять этот текст');
  expect(await page.evaluate(() => window.notes.initial().then(value => value.root))).toBe(root);
});

test('первый запуск, блокировка активного HTML и сетевых запросов', async () => {
  await launch(false);
  await expect(page.getByRole('button', { name: 'Выбрать папку с заметками' })).toBeVisible();
  await expect(page.locator('#create-note')).toBeEnabled();
  await application.close(); application = null;
  await fs.writeFile(path.join(root, 'Git', 'Ветки.md'), '# Безопасность\n\n<script>window.compromised = true</script><img src="https://example.com/track.png" onerror="window.compromised = true"><iframe src="https://example.com"></iframe>\n\n```html\n<script>alert(1)</script>\n```');
  await launch();
  await expect(page.locator('#markdown h1')).toHaveText('Безопасность');
  expect(await page.evaluate(() => window.compromised)).toBeUndefined();
  await expect(page.locator('#markdown script, #markdown iframe')).toHaveCount(0);
  await expect(page.locator('#markdown img')).not.toHaveAttribute('src', /https/);
  expect(await page.evaluate(() => fetch('https://example.com').then(() => false).catch(() => true))).toBe(true);
});

test('скриншоты, маленькое окно, полный экран и восстановление размера', async () => {
  await launch();
  await page.locator('.folder-shortcut', { hasText: 'SSH' }).click();
  await page.locator('.file-row.note', { hasText: 'Подключение' }).click();
  await page.screenshot({ path: 'test-results/notes-dark.png', animations: 'disabled' });
  await page.locator('#theme-toggle').click();
  await page.screenshot({ path: 'test-results/notes-light.png', animations: 'disabled' });
  await page.keyboard.press('Control+k');
  await page.locator('#search-input').fill('ssh');
  await expect(page.locator('.search-result')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/notes-search.png' });
  await page.keyboard.press('Escape');
  await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setFullScreen(false); win.unmaximize(); win.setBounds({ x: 90, y: 90, width: 820, height: 600 });
  });
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds().width)).toBe(820);
  expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/notes-small.png' });
  const entered = application.evaluate(({ BrowserWindow }) => new Promise(resolve => BrowserWindow.getAllWindows()[0].once('enter-full-screen', () => resolve(true))));
  await page.keyboard.press('F11');
  await entered;
  const left = application.evaluate(({ BrowserWindow }) => new Promise(resolve => BrowserWindow.getAllWindows()[0].once('leave-full-screen', () => resolve(true))));
  await page.keyboard.press('F11');
  await left;
  await expect.poll(async () => JSON.parse(await fs.readFile(path.join(data, 'settings.json'), 'utf8')).window?.width).toBe(820);
  await application.close(); application = null;
  await launch(false);
  const bounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds());
  expect(bounds).toMatchObject({ width: 820, height: 600, x: 90, y: 90 });
});

test('закрытие с несохранённым текстом: отмена, сохранение, выход', async () => {
  await launch();
  await page.locator('#edit').click();
  await fillMarkdown('# Сохранить перед выходом');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect(page.locator('#action-title')).toHaveText('Сохранить изменения?');
  await page.getByRole('button', { name: 'Отмена', exact: true }).last().click();
  await expect(page.locator('#editor')).toHaveValue('# Сохранить перед выходом');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  const closed = application.waitForEvent('close');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).last().click();
  await closed; application = null;
  expect(await fs.readFile(path.join(root, 'Git', 'Ветки.md'), 'utf8')).toBe('# Сохранить перед выходом');
});

test('создание в корне и горячие клавиши при русской раскладке', async () => {
  await launch();
  await page.locator('#select-root').click();
  await page.locator('#create-folder').click();
  await page.locator('#action-input').fill('Хостинг');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  expect((await fs.stat(path.join(root, 'Хостинг'))).isDirectory()).toBe(true);
  await page.locator('#select-root').click();
  await page.locator('#create-note').click();
  await page.locator('#action-input').fill('Корневая заметка');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('#editor-panel')).toBeVisible();
  await fillMarkdown('# Текст из корня');
  await page.locator('#editor').dispatchEvent('keydown', { key: 'ы', code: 'KeyS', ctrlKey: true });
  await expect(page.locator('#markdown h1')).toHaveText('Текст из корня');
  expect(await fs.readFile(path.join(root, 'Корневая заметка.md'), 'utf8')).toBe('# Текст из корня');
  await page.locator('body').dispatchEvent('keydown', { key: 'л', code: 'KeyK', ctrlKey: true });
  await expect(page.locator('#search-dialog')).toBeVisible();
  await page.locator('#search-input').fill('Текст из корня');
  await expect(page.locator('.search-result')).toHaveCount(1);
});

test('индекс поиска обновляется после внешней правки и добавления файла', async () => {
  await launch();
  await page.keyboard.press('Control+k');
  await page.locator('#search-input').fill('черника');
  await expect(page.locator('.search-result')).toHaveCount(1);
  await fs.writeFile(path.join(root, 'Git', 'Ветки.md'), '# Ветки\n\nБрусника');
  await expect(page.locator('.search-result')).toHaveCount(0);
  await page.locator('#search-input').fill('брусника');
  await expect(page.locator('.search-result')).toHaveCount(1);
  await fs.writeFile(path.join(root, 'SSH', 'Извне.md'), '# Ещё брусника');
  await expect(page.locator('.search-result')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.locator('.folder-shortcut', { hasText: 'SSH' }).click();
  await expect(page.locator('.file-row.note', { hasText: 'Извне' })).toBeVisible();
});

test('проводник: обзор папки, двойной клик, один клик для просмотра и переход вверх', async () => {
  await fs.writeFile(path.join(root, 'Начните здесь.md'), '# Начните здесь\n\nМоя заметка');
  await launch();
  await expect(page.locator('#browser-title')).toHaveText('Мои заметки');
  await expect(page.locator('.file-row')).toHaveCount(3);
  await expect(page.locator('#markdown h1')).toHaveText('Начните здесь');
  await page.locator('.file-row.folder[data-path="SSH"]').click();
  await expect(page.locator('#welcome-title')).toHaveText('SSH');
  await expect(page.locator('#browser-title')).toHaveText('Мои заметки');
  await page.locator('.file-row.folder[data-path="SSH"]').dblclick();
  await expect(page.locator('#browser-title')).toHaveText('SSH');
  await page.locator('.file-row.note').click();
  await expect(page.locator('#markdown h1')).toHaveText('Подключение к серверу');
  await expect(page.locator('#note')).toBeVisible();
  await page.locator('#folder-up').click();
  await expect(page.locator('#browser-title')).toHaveText('Мои заметки');
  await page.locator('.file-row.note[data-path="Начните здесь.md"]').click();
  await expect(page.locator('#markdown h1')).toHaveText('Начните здесь');
});

test('перемещение заметки через выбор папки и обратно в корень', async () => {
  await fs.writeFile(path.join(root, 'Начните здесь.md'), '# Начните здесь\n\nНе менять текст');
  await launch();
  await page.locator('#move').click();
  await expect(page.locator('#move-confirm')).toBeDisabled();
  await page.locator('.move-folder[data-path="SSH"]').click();
  await page.locator('#move-confirm').click();
  await expect(page.locator('#browser-title')).toHaveText('SSH');
  await expect(page.locator('#markdown h1')).toHaveText('Начните здесь');
  await expect(page.locator('.file-row.selected')).toHaveAttribute('data-path', 'SSH/Начните здесь.md');
  expect(await fs.readFile(path.join(root, 'SSH', 'Начните здесь.md'), 'utf8')).toBe('# Начните здесь\n\nНе менять текст');
  await expect(fs.access(path.join(root, 'Начните здесь.md'))).rejects.toThrow();
  await page.locator('#move').click();
  await page.locator('#move-up').click();
  await page.locator('#move-confirm').click();
  await expect(page.locator('#browser-title')).toHaveText('Мои заметки');
  expect(await fs.readFile(path.join(root, 'Начните здесь.md'), 'utf8')).toContain('Не менять текст');
});

test('перетаскивание заметки в папку списка и в папку боковой панели', async () => {
  await fs.writeFile(path.join(root, 'Начните здесь.md'), '# Перенос мышью');
  await launch();
  await page.locator('.file-row.note[data-path="Начните здесь.md"]').dragTo(page.locator('.file-row.folder[data-path="SSH"]'));
  await expect(page.locator('#browser-title')).toHaveText('SSH');
  expect(await fs.readFile(path.join(root, 'SSH', 'Начните здесь.md'), 'utf8')).toBe('# Перенос мышью');
  await page.locator('.file-row.note[data-path="SSH/Начните здесь.md"]').dragTo(page.locator('.folder-shortcut[data-path="Git"]'));
  await expect(page.locator('#browser-title')).toHaveText('Git');
  expect(await fs.readFile(path.join(root, 'Git', 'Начните здесь.md'), 'utf8')).toBe('# Перенос мышью');
  await expect(page.locator('#markdown h1')).toHaveText('Перенос мышью');
});

test('импорт .md через кнопку: файл копируется, дубликат не затирает заметку', async () => {
  await launch();
  await page.locator('#select-root').click();
  const source = path.join(temp, 'Импорт.md');
  await fs.writeFile(source, '# Из внешнего файла\n\nТекст');
  await application.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source);
  await page.locator('#import-files').click();
  await expect(page.locator('#markdown h1')).toHaveText('Из внешнего файла');
  expect(await fs.readFile(path.join(root, 'Импорт.md'), 'utf8')).toBe('# Из внешнего файла\n\nТекст');
  expect(await fs.readFile(source, 'utf8')).toContain('Текст');
  await fs.writeFile(source, '# Новое содержимое');
  await page.locator('#import-files').click();
  await expect(page.locator('#toast')).toContainText('Уже есть файл');
  expect(await fs.readFile(path.join(root, 'Импорт.md'), 'utf8')).toBe('# Из внешнего файла\n\nТекст');
});

test('создание на первом запуске: отмена выбора папки не блокирует следующие кнопки', async () => {
  await launch(false);
  await application.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
  await page.locator('#create-folder').click();
  await expect(page.locator('#action-dialog')).not.toBeVisible();
  await application.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, root);
  await page.locator('#create-note').click();
  await expect(page.locator('#action-title')).toHaveText('Новая заметка');
  await page.locator('#action-input').fill('Новая с первого запуска');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('#editor-panel')).toBeVisible();
  await fillMarkdown('# Создано с первого запуска');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#markdown h1')).toHaveText('Создано с первого запуска');
  expect(await fs.readFile(path.join(root, 'Новая с первого запуска.md'), 'utf8')).toBe('# Создано с первого запуска');
});

test('виды: крупные значки, плитки, список и полный обзор папок', async () => {
  for (const name of ['WordPress', 'Хостинг', 'Архив', 'Работа и документы']) await fs.mkdir(path.join(root, name));
  await fs.writeFile(path.join(root, 'Начните здесь.md'), '# Начните здесь');
  await launch();
  await expect(page.locator('#file-list')).toHaveClass(/view-list/);
  await page.locator('#view-mode').selectOption('icons');
  await expect(page.locator('#file-list')).toHaveClass(/view-icons/);
  await expect(page.locator('.file-row.folder .folder-art').first()).toBeVisible();
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#content-scroll')).not.toBeVisible();
  const folderRows = page.locator('.file-row.folder');
  const first = await folderRows.nth(0).boundingBox(), second = await folderRows.nth(1).boundingBox();
  expect(second.x).toBeGreaterThan(first.x + first.width - 1);
  expect(second.y).toBe(first.y);
  const art = await folderRows.first().locator('.folder-art').boundingBox();
  const name = await folderRows.first().locator('.file-row-name').boundingBox();
  expect(art.y + art.height).toBeLessThan(name.y);
  await page.screenshot({ path: 'test-results/notes-icons-dark.png', animations: 'disabled' });
  await page.locator('#theme-toggle').click();
  await page.screenshot({ path: 'test-results/notes-icons-light.png', animations: 'disabled' });
  await page.locator('#view-mode').selectOption('tiles');
  await expect(page.locator('#file-list')).toHaveClass(/view-tiles/);
  await expect(page.locator('.file-row')).toHaveCount(7);
  await page.screenshot({ path: 'test-results/notes-tiles.png', animations: 'disabled' });
  await page.locator('#view-mode').selectOption('list');
  await expect(page.locator('.file-row.folder .folder-art').first()).not.toBeVisible();
  await page.locator('.file-row.folder[data-path="SSH"]').dblclick();
  await expect(page.locator('#browser-title')).toHaveText('SSH');
  await page.locator('.file-row.note').click();
  await expect(page.locator('#content-scroll')).toBeVisible();
  await expect(page.locator('#markdown h1')).toHaveText('Подключение к серверу');
});

test('вид и область просмотра запоминаются, смена вида сохраняет черновик', async () => {
  await launch();
  await page.locator('#view-mode').selectOption('tiles');
  await page.locator('#preview-toggle').click();
  await application.close(); application = null;
  await launch(false);
  await expect(page.locator('#view-mode')).toHaveValue('tiles');
  await expect(page.locator('#content-scroll')).not.toBeVisible();
  await expect(page.locator('#preview-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#edit').click();
  await expect(page.locator('#editor-panel')).toBeVisible();
  await fillMarkdown('# Черновик при смене вида');
  for (const mode of ['icons', 'list', 'tiles']) {
    await page.locator('#view-mode').selectOption(mode);
    await expect(page.locator('#editor')).toHaveValue('# Черновик при смене вида');
  }
  await page.keyboard.press('Control+s');
  await expect(page.locator('#markdown h1')).toHaveText('Черновик при смене вида');
});

test('перетаскивание и клавиатурная навигация в крупных значках', async () => {
  for (const name of ['Архив', 'Работа', 'Хостинг', 'WordPress', 'Личные']) await fs.mkdir(path.join(root, name));
  await fs.writeFile(path.join(root, 'Начните здесь.md'), '# Перенос крупного значка');
  await launch();
  await page.locator('#view-mode').selectOption('icons');
  await page.locator('#preview-toggle').click();
  const rows = page.locator('.file-row');
  await rows.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const focused = await page.evaluate(() => document.activeElement.dataset.path);
  expect(focused).not.toBe(await rows.nth(1).getAttribute('data-path'));
  await page.locator('.file-row.note[data-path="Начните здесь.md"]').dragTo(page.locator('.file-row.folder[data-path="SSH"]'));
  await expect(page.locator('#browser-title')).toHaveText('SSH');
  await expect(page.locator('#file-list')).toHaveClass(/view-icons/);
  await expect(page.locator('#markdown h1')).toHaveText('Перенос крупного значка');
  expect(await fs.readFile(path.join(root, 'SSH', 'Начните здесь.md'), 'utf8')).toBe('# Перенос крупного значка');
});

test('все панели можно скрыть и вернуть без потери черновика', async () => {
  await launch();
  await page.locator('.folder-shortcut[data-path="SSH"]').click();
  await page.locator('.file-row.note').click();
  const initialWidth = (await page.locator('.workspace').boundingBox()).width;
  await page.locator('#sidebar-toggle').click();
  await expect(page.locator('#sidebar')).not.toBeVisible();
  await expect(page.locator('#sidebar-toggle')).toBeVisible();
  expect((await page.locator('.workspace').boundingBox()).width).toBeGreaterThan(initialWidth + 180);
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sidebar-toggle')).toBeFocused();
  await page.locator('#browser-toggle').click();
  await expect(page.locator('#browser-panel')).not.toBeVisible();
  await expect(page.locator('#note')).toBeVisible();
  await page.screenshot({ path: 'test-results/notes-focus.png', animations: 'disabled' });
  await page.locator('#edit').click();
  await fillMarkdown('# Текст при скрытых панелях');
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#content-scroll')).not.toBeVisible();
  await expect(page.locator('#browser-panel')).toBeVisible();
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#editor')).toHaveValue('# Текст при скрытых панелях');
  await page.locator('#sidebar-toggle').click();
  await expect(page.locator('#sidebar')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page.locator('#markdown h1')).toHaveText('Текст при скрытых панелях');
});

test('изменение ширины мышью и восстановление панелей после перезапуска', async () => {
  await launch();
  const drag = async (id, delta) => {
    const bounds = await page.locator(id).boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 180);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + delta, bounds.y + 180, { steps: 8 });
    await page.mouse.up();
  };
  const sidebarBefore = (await page.locator('#sidebar').boundingBox()).width;
  await drag('#sidebar-resizer', 55);
  expect((await page.locator('#sidebar').boundingBox()).width).toBeGreaterThan(sidebarBefore + 45);
  const browserBefore = (await page.locator('#browser-panel').boundingBox()).width;
  await drag('#browser-resizer', 45);
  expect((await page.locator('#browser-panel').boundingBox()).width).toBeGreaterThan(browserBefore + 35);
  const sidebarWidth = (await page.locator('#sidebar').boundingBox()).width;
  const browserWidth = (await page.locator('#browser-panel').boundingBox()).width;
  await page.locator('#sidebar-toggle').click();
  await page.locator('#browser-toggle').click();
  await application.close(); application = null;
  await launch(false);
  await expect(page.locator('#sidebar')).not.toBeVisible();
  await expect(page.locator('#browser-panel')).not.toBeVisible();
  await page.locator('#sidebar-toggle').click();
  await page.locator('#browser-toggle').click();
  expect((await page.locator('#sidebar').boundingBox()).width).toBe(sidebarWidth);
  expect((await page.locator('#browser-panel').boundingBox()).width).toBe(browserWidth);
  await page.locator('#browser-resizer').focus();
  await page.keyboard.press('ArrowRight');
  expect((await page.locator('#browser-panel').boundingBox()).width).toBe(browserWidth + 16);
  await page.locator('#sidebar-resizer').dblclick();
  expect((await page.locator('#sidebar').boundingBox()).width).toBe(235);
});

async function chooseContextAction(label) {
  await application.evaluate(({ Menu }, choice) => {
    globalThis.contextChoice = choice;
    Menu.buildFromTemplate = items => ({ popup(options) {
      globalThis.contextLabels = items.filter(item => item.label).map(item => item.label);
      if (globalThis.contextChoice) {
        const selected = items.find(item => item.label === globalThis.contextChoice);
        if (!selected) throw new Error('Пункт меню не найден: ' + globalThis.contextChoice);
        selected.click();
      }
      options.callback();
    } });
  }, label);
}

async function setClipboardText(text) {
  await application.evaluate(({ clipboard }, content) => {
    clipboard.readText = () => content;
  }, text);
}

test('заметка из буфера по горячей клавише сохраняет исходный текст и сразу открывает просмотр', async () => {
  const markdown = '# Команда из чата\r\n\r\n```bash\r\nprintf "a  b"\r\n```\r\n';
  await launch();
  await setClipboardText(markdown);
  await page.locator('#sidebar-toggle').click();
  await page.keyboard.press('Control+Shift+N');
  await expect(page.locator('#action-title')).toHaveText('Новая заметка из буфера');
  await expect(page.locator('#action-description')).toContainText('Git');
  await expect(page.locator('#action-preview')).toContainText('printf "a  b"');
  await setClipboardText('Буфер изменился после открытия диалога');
  await page.locator('#action-input').fill('Из чата');
  await page.locator('#action-input').press('Enter');
  await expect(page.locator('#markdown h1')).toHaveText('Команда из чата');
  await expect(page.locator('#markdown pre code')).toHaveText('printf "a  b"');
  expect(await fs.readFile(path.join(root, 'Git', 'Из чата.md'), 'utf8')).toBe(markdown);
});

test('правый клик по папке сохраняет заметку внутри и позволяет исправить совпадающее название', async () => {
  await launch();
  const existing = path.join(root, 'SSH', 'Подключение.md');
  const original = await fs.readFile(existing, 'utf8');
  await setClipboardText('Новый текст из буфера');
  await chooseContextAction('Новая заметка из буфера…');
  await page.locator('.folder-shortcut[data-path="SSH"]').click({ button: 'right' });
  await expect(page.locator('#action-description')).toContainText('SSH');
  const input = page.locator('#action-input');
  await input.fill('Подключение');
  const save = page.getByRole('button', { name: 'Сохранить заметку', exact: true });
  await save.click();
  await expect(page.locator('#action-error')).toContainText('уже существует');
  await expect(page.locator('#action-preview')).toHaveText('Новый текст из буфера');
  expect(await fs.readFile(existing, 'utf8')).toBe(original);
  await input.fill('Ещё команда');
  await save.click();
  await expect(page.locator('#browser-title')).toHaveText('SSH');
  await expect(page.locator('#markdown')).toContainText('Новый текст из буфера');
  expect(await fs.readFile(path.join(root, 'SSH', 'Ещё команда.md'), 'utf8')).toBe('Новый текст из буфера');
});

test('пустой буфер и отмена создания сохраняют открытый черновик', async () => {
  await launch();
  await page.locator('#edit').click();
  await fillMarkdown('# Текущий черновик');
  await setClipboardText('  \n');
  const create = page.locator('#create-from-clipboard');
  await create.click();
  await expect(page.locator('#toast')).toContainText('Скопируйте текст');
  await expect(page.locator('#action-dialog')).not.toBeVisible();
  await setClipboardText('Текст из буфера');
  await create.click();
  await page.getByRole('button', { name: 'Не сохранять', exact: true }).click();
  await expect(page.locator('#action-preview')).toHaveText('Текст из буфера');
  await page.keyboard.press('Escape');
  await expect(page.locator('#editor')).toHaveValue('# Текущий черновик');
  expect(await fs.readdir(path.join(root, 'Git'))).toEqual(['Ветки.md']);
});

test('контекстное меню пустого места создаёт папку и заметку в текущем месте', async () => {
  await launch();
  await page.locator('#library-root').click();
  await chooseContextAction('Новая папка');
  await page.locator('#file-list').click({ button: 'right', position: { x: 160, y: 220 } });
  await expect(page.locator('#action-title')).toHaveText('Новая папка');
  expect(await application.evaluate(() => globalThis.contextLabels)).not.toContain('Удалить…');
  await page.locator('#action-input').fill('Из контекстного меню');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('#browser-title')).toHaveText('Из контекстного меню');
  await chooseContextAction('Новая заметка');
  await page.locator('#folder-empty').click({ button: 'right' });
  await page.locator('#action-input').fill('Созданная заметка');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('#editor-panel')).toBeVisible();
  expect(await fs.readFile(path.join(root, 'Из контекстного меню', 'Созданная заметка.md'), 'utf8')).toContain('# Созданная заметка');
});

test('контекстное меню папки использует именно нажатую папку', async () => {
  await launch();
  await page.locator('#library-root').click();
  await chooseContextAction('Новая заметка');
  await page.locator('.file-row.folder[data-path="SSH"]').click({ button: 'right' });
  await expect(page.locator('#action-description')).toContainText('SSH');
  await page.locator('#action-input').fill('Внутри SSH');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('#editor-panel')).toBeVisible();
  await page.keyboard.press('Control+s');
  expect(await fs.readFile(path.join(root, 'SSH', 'Внутри SSH.md'), 'utf8')).toContain('# Внутри SSH');
  await chooseContextAction('Переименовать…');
  await page.locator('.folder-shortcut[data-path="Git"]').click({ button: 'right' });
  await expect(page.locator('#action-input')).toHaveValue('Git');
  await page.locator('#action-input').fill('Git новое имя');
  await page.getByRole('button', { name: 'Переименовать', exact: true }).last().click();
  expect(await fs.readFile(path.join(root, 'Git новое имя', 'Ветки.md'), 'utf8')).toContain('# Ветки Git');
  await expect(page.locator('#welcome-title')).toHaveText('Git новое имя');
});

test('отмена контекстного меню не меняет несохранённый текст', async () => {
  await launch();
  await page.locator('#edit').click();
  await fillMarkdown('# Черновик до правого клика');
  await chooseContextAction(null);
  await page.locator('.folder-shortcut[data-path="SSH"]').click({ button: 'right' });
  await expect(page.locator('#editor')).toHaveValue('# Черновик до правого клика');
  await expect(page.locator('#action-dialog')).not.toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page.locator('#markdown h1')).toHaveText('Черновик до правого клика');
});

test('настоящее меню Electron открывается и передаёт правильный файл в подтверждение', async () => {
  await launch();
  await page.locator('#library-root').click();
  await application.evaluate(({ Menu }) => {
    const build = Menu.buildFromTemplate.bind(Menu);
    Menu.buildFromTemplate = items => {
      globalThis.nativeContextMenu = build(items);
      globalThis.nativeContextMenu.once('menu-will-show', () => { globalThis.nativeMenuShown = true; });
      return globalThis.nativeContextMenu;
    };
  });
  await page.locator('.file-row.folder[data-path="SSH"]').click({ button: 'right' });
  await expect.poll(() => application.evaluate(() => globalThis.nativeMenuShown)).toBe(true);
  expect(await application.evaluate(() => globalThis.nativeContextMenu.items.map(item => item.label))).toContain('Новая заметка');
  await application.evaluate(() => {
    globalThis.nativeContextMenu.items.find(item => item.label === 'Удалить…').click();
    globalThis.nativeContextMenu.closePopup();
  });
  await expect(page.locator('#action-title')).toHaveText('Удалить «SSH»?');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  expect((await fs.stat(path.join(root, 'SSH'))).isDirectory()).toBe(true);
});

const richText = () => page.getByRole('textbox', { name: 'Текст заметки', exact: true });
async function tool(name) {
  const button = page.locator('#visual-editor button.' + name);
  if (!await button.isVisible()) await page.locator('#visual-editor button.more').click();
  await button.click();
}

test('визуальный редактор: оформление кнопками, отмена, повтор и сохранение Markdown', async () => {
  await launch();
  await page.locator('#edit').click();
  await expect(richText()).toBeVisible();
  await expect(page.locator('#editor')).not.toBeVisible();
  await richText().fill('Новая инструкция');
  await tool('heading');
  await page.locator('#visual-editor li[data-level="2"]').click();
  await expect(richText().locator('h2')).toHaveText('Новая инструкция');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Важный текст');
  await page.keyboard.press('Shift+Home');
  await tool('bold');
  await expect(richText().locator('strong')).toHaveText('Важный текст');
  await page.locator('#editor-undo').click();
  await expect(richText().locator('strong')).toHaveCount(0);
  await page.locator('#editor-redo').click();
  await expect(richText().locator('strong')).toHaveText('Важный текст');
  await tool('italic');
  await expect(richText().locator('em')).toHaveText('Важный текст');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#markdown h2')).toHaveText('Новая инструкция');
  await expect(page.locator('#markdown strong em, #markdown em strong')).toHaveText('Важный текст');
  const saved = await fs.readFile(path.join(root, 'Git', 'Ветки.md'), 'utf8');
  expect(saved).toContain('## Новая инструкция');
  expect(saved).toContain('Важный текст');
  expect(saved).not.toContain('<h2>');
});

test('визуальный редактор: списки, задачи, ссылки и блок команд', async () => {
  await launch();
  await page.locator('#browser-toggle').click();
  await page.locator('#edit').click();
  await richText().fill('Проверить сервер');
  await tool('task-list');
  await expect(richText().locator('li.task-list-item')).toBeVisible();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await tool('link');
  await page.locator('#toastuiLinkUrlInput').fill('https://example.com/docs');
  await page.locator('#toastuiLinkTextInput').fill('Документация');
  await page.locator('.toastui-editor-popup:visible .toastui-editor-ok-button').click();
  await expect(richText().locator('a')).toHaveText('Документация');
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await tool('codeblock');
  await page.keyboard.insertText('ssh user@server\nprintf "a  b"');
  await expect(richText().locator('pre code')).toHaveText('ssh user@server\nprintf "a  b"');
  await page.screenshot({ path: 'test-results/notes-editor-dark.png', animations: 'disabled' });
  await page.locator('#theme-toggle').click();
  await expect(page.locator('#visual-editor .toastui-editor-defaultUI')).not.toHaveClass(/toastui-editor-dark/);
  await page.screenshot({ path: 'test-results/notes-editor-light.png', animations: 'disabled' });
  await page.keyboard.press('Control+s');
  await expect(page.locator('#markdown a')).toHaveText('Документация');
  await expect(page.locator('#markdown .task-check')).toHaveAttribute('aria-label', 'Не выполнено');
  expect(await fs.readFile(path.join(root, 'Git', 'Ветки.md'), 'utf8')).toMatch(/[-*] \[ \] Проверить сервер/);
  await page.getByRole('button', { name: 'Копировать код', exact: true }).click();
  expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe('ssh user@server\nprintf "a  b"');
});

test('режимы редактора: исходник без потерь, возврат к исходному тексту и новый черновик', async () => {
  const original = '\uFEFF# Заголовок\r\n\r\n-   текст\r\n\r\n```sh\r\necho "a  b"\r\n```\r\n';
  await fs.writeFile(path.join(root, 'Git', 'Ветки.md'), original);
  await launch();
  await page.locator('#edit').click();
  for (let i = 0; i < 2; i++) {
    await page.locator('#editor-source').click();
    // HTML textarea нормализует CRLF; файл при сохранении без правок остаётся прежним.
    await expect(page.locator('#editor')).toHaveValue(original.replaceAll('\r\n', '\n'));
    await page.locator('#editor-visual').click();
  }
  await expect(page.locator('#status-text')).not.toHaveClass(/unsaved/);
  await page.keyboard.press('Control+s');
  expect(await fs.readFile(path.join(root, 'Git', 'Ветки.md'), 'utf8')).toBe(original);
  await page.locator('#edit').click();
  await richText().fill('Визуальная правка');
  await fillMarkdown('Исходник после правки');
  await page.locator('#editor-visual').click();
  await expect(richText()).toHaveText('Исходник после правки');
  await fillMarkdown(original);
  await page.locator('#editor-visual').click();
  await expect(richText().locator('h1')).toHaveText('Заголовок');
  await page.locator('#cancel-edit').click();
  if (await page.locator('#action-dialog').isVisible()) await page.getByRole('button', { name: 'Не сохранять', exact: true }).click();
  await expect(page.locator('#note')).toBeVisible();
});

test('визуальная правка сохраняет таблицу, вложенный список, язык кода и локальную картинку', async () => {
  const markdown = '# Инструкция\n\n| Что | Где |\n| --- | --- |\n| Ключ | SSH |\n\n- Первая\n  - Вложенная\n\n```powershell\nWrite-Host "a  b"\n  echo ok\n```\n\n![Схема](./image.svg)\n\nКонец\n';
  await fs.writeFile(path.join(root, 'Git', 'Ветки.md'), markdown);
  await fs.writeFile(path.join(root, 'Git', 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="steelblue"/></svg>');
  await launch(); await page.locator('#edit').click();
  await expect(richText().locator('table')).toBeVisible();
  const image = richText().locator('img[alt="Схема"]');
  await expect.poll(() => image.evaluate(el => el.naturalWidth)).toBe(80);
  await richText().locator('p').last().click();
  await page.keyboard.press('End'); await page.keyboard.insertText(' инструкции');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#markdown table td').first()).toHaveText('Ключ');
  await expect(page.locator('#markdown ul ul li')).toHaveText('Вложенная');
  await expect(page.locator('#markdown code.language-powershell')).toHaveText('Write-Host "a  b"\n  echo ok\n');
  const saved = await fs.readFile(path.join(root, 'Git', 'Ветки.md'), 'utf8');
  expect(saved).toContain('![Схема](./image.svg)');
  expect(saved).toContain('Конец инструкции');
  expect(saved).not.toContain('notes://');
});

test('визуальный черновик защищён при внешних правках и сохранении копии', async () => {
  await launch(); await page.locator('#edit').click();
  await richText().fill('Мой визуальный черновик');
  await fs.writeFile(path.join(root, 'Git', 'Ветки.md'), '# С диска');
  await expect(page.locator('#conflict-banner')).toBeVisible();
  await expect(richText()).toHaveText('Мой визуальный черновик');
  await page.locator('#load-external').click();
  await page.locator('#action-dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(richText()).toHaveText('Мой визуальный черновик');
  await page.locator('#save-copy').click();
  await page.locator('#action-input').fill('Визуальная копия');
  await page.getByRole('button', { name: 'Сохранить копию', exact: true }).last().click();
  await expect(page.locator('#markdown')).toContainText('Мой визуальный черновик');
  expect(await fs.readFile(path.join(root, 'Git', 'Ветки.md'), 'utf8')).toBe('# С диска');
  expect(await fs.readFile(path.join(root, 'Git', 'Визуальная копия.md'), 'utf8')).toContain('Мой визуальный черновик');
});

test('инструменты редактора доступны в узком окне', async () => {
  await launch();
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(820, 600));
  await page.locator('#edit').click();
  await richText().fill('Оформление в узком окне');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(page.locator('#visual-editor button.more')).toBeVisible();
  await tool('table');
  await expect(page.locator('#visual-editor .toastui-editor-popup:visible')).toBeVisible();
  await page.locator('#visual-editor .toastui-editor-table-selection').click({ position: { x: 25, y: 25 }, timeout: 5000 });
  await expect(richText().locator('table')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page.locator('#editor-panel')).not.toBeVisible();
});
