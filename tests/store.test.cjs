const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { NoteStore } = require('../src/store.cjs');

let temporary, root, store;
beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'quiet-notes-test-'));
  root = path.join(temporary, 'Заметки');
  await fs.mkdir(root);
  store = await NoteStore.open(root);
});
afterEach(() => fs.rm(temporary, { recursive: true, force: true }));

test('дерево, поиск по тексту и названиям, Unicode, вложенные папки', async () => {
  await store.create('', 'SSH', 'folder');
  await store.create('SSH', 'Сервер 2', 'note');
  await store.create('SSH', 'Сервер 10', 'note');
  const note = await store.read('SSH/Сервер 2.md');
  await store.save(note.path, '# Подключение\n\nssh root@example.test\nКлюч находится в папке сервера.', note.version);
  const tree = await store.tree();
  assert.deepEqual(tree[0].children.map(item => item.name), ['Сервер 2', 'Сервер 10']);
  assert.equal((await store.search('ssh ключ'))[0].path, note.path);
  assert.equal((await store.search('СЕРВЕР 10'))[0].path, 'SSH/Сервер 10.md');
  assert.deepEqual(await store.search('ничего-такого'), []);
});

test('конфликт с внешним редактором не перезаписывает диск', async () => {
  const relative = await store.create('', 'Важное', 'note');
  const before = await store.read(relative);
  await fs.writeFile(path.join(root, relative), 'Правка извне', 'utf8');
  const result = await store.save(relative, 'Моя правка', before.version);
  assert.equal(result.conflict, true);
  assert.equal((await store.read(relative)).content, 'Правка извне');
  const saved = await store.save(relative, 'Согласованная версия', result.current.version);
  assert.equal(saved.content, 'Согласованная версия');
  assert.equal((await fs.readdir(root)).length, 1);
});

test('операции не выходят за корень, в том числе через junction', async () => {
  const outside = path.join(temporary, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.md'), 'secret');
  await assert.rejects(store.read('../outside/secret.md'));
  await assert.rejects(store.create('', '../oops', 'note'));
  await fs.symlink(outside, path.join(root, 'Link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(await store.tree(), []);
  await assert.rejects(store.read('Link/secret.md'));
  await assert.rejects(store.create('Link', 'oops', 'note'));
});

test('переименование и создание не затирают существующий файл', async () => {
  await store.create('', 'Первый', 'note');
  await store.create('', 'Второй', 'note');
  await assert.rejects(store.rename('Первый.md', 'Второй'));
  await assert.rejects(store.create('', 'Второй', 'note'));
  assert.equal(await store.rename('Первый.md', 'Новое имя.md'), 'Новое имя.md');
  await assert.rejects(store.create('', 'CON', 'note'));
  await assert.rejects(store.create('', 'тема.', 'folder'));
  await assert.rejects(store.create('', 'ошибка:имя', 'note'));
});

test('удаление только через переданную корзину, корень защищён', async () => {
  await store.create('', 'Тема', 'folder');
  await store.create('Тема', 'Заметка', 'note');
  let target;
  await store.trash('Тема', async full => { target = full; });
  assert.equal(target, path.join(root, 'Тема'));
  assert.equal((await store.read('Тема/Заметка.md')).content, '# Заметка\n\n');
  await assert.rejects(store.trash('', async () => assert.fail('Корень не должен удаляться')));
});

test('перенос заметки и папки, защита от затирания и вложения в себя', async () => {
  await store.create('', 'SSH', 'folder');
  await store.create('', 'Git', 'folder');
  await store.create('', 'Начните здесь', 'note');
  const before = await store.read('Начните здесь.md');
  assert.equal(await store.move('Начните здесь.md', 'SSH'), 'SSH/Начните здесь.md');
  assert.equal((await store.read('SSH/Начните здесь.md')).content, before.content);
  await assert.rejects(fs.access(path.join(root, 'Начните здесь.md')));
  await store.create('Git', 'Начните здесь', 'note');
  await assert.rejects(store.move('SSH/Начните здесь.md', 'Git'), /уже есть/);
  assert.equal((await store.read('SSH/Начните здесь.md')).content, before.content);
  await store.create('SSH', 'Вложенная', 'folder');
  await assert.rejects(store.move('SSH', 'SSH/Вложенная'), /внутрь самой себя/);
  await assert.rejects(store.move('SSH', '../outside'));
  await assert.rejects(store.move('', 'Git'));
  assert.equal(await store.move('SSH', 'Git'), 'Git/SSH');
  assert.equal((await store.read('Git/SSH/Начните здесь.md')).content, before.content);
  assert.equal(await store.move('Git/SSH/Начните здесь.md', ''), 'Начните здесь.md');
});

test('импорт копирует .md и сохраняет исходник, существующие файлы не заменяет', async () => {
  const external = path.join(temporary, 'Внешняя.md');
  await fs.writeFile(external, '# Внешняя\n\nТекст', 'utf8');
  const result = await store.importFiles('', [external]);
  assert.deepEqual(result.added, ['Внешняя.md']);
  assert.equal((await store.read('Внешняя.md')).content, '# Внешняя\n\nТекст');
  assert.equal(await fs.readFile(external, 'utf8'), '# Внешняя\n\nТекст');
  await fs.writeFile(external, 'Другая версия', 'utf8');
  const repeated = await store.importFiles('', [external, path.join(temporary, 'other.txt')]);
  assert.equal(repeated.added.length, 0);
  assert.equal(repeated.errors.length, 2);
  assert.equal((await store.read('Внешняя.md')).content, '# Внешняя\n\nТекст');
});
