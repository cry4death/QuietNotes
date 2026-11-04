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
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
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
  if (application) await application.close();
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
  await page.locator('#editor').fill('# Мой текст\n\nИзменение из приложения.');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#markdown h1')).toHaveText('Мой текст');
  expect(await fs.readFile(path.join(root, 'Git', 'Ветки.md'), 'utf8')).toContain('Изменение из приложения');
  await fs.writeFile(path.join(root, 'Git', 'Ветки.md'), '# Снаружи\n\nВнешняя версия.');
  await expect(page.locator('#markdown h1')).toHaveText('Снаружи');
  await page.locator('#edit').click();
  await page.locator('#editor').fill('# Моя несохранённая версия');
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
  await expect(page.locator('#editor')).toBeVisible();
  await page.locator('#editor').fill('# Проверка\n\nТекст');
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
  await page.locator('#editor').fill('Не потерять этот текст');
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
  await page.locator('#editor').fill('# Сохранить перед выходом');
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
  await expect(page.locator('#editor')).toBeVisible();
  await page.locator('#editor').fill('# Текст из корня');
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
  await expect(page.locator('#editor')).toBeVisible();
  await page.locator('#editor').fill('# Создано с первого запуска');
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
  await expect(page.locator('#editor')).toBeVisible();
  await page.locator('#editor').fill('# Черновик при смене вида');
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
