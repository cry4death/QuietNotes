const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const MAX_NOTE_BYTES = 10 * 1024 * 1024;
const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
const hash = text => createHash('sha256').update(text).digest('hex');
const toRelative = value => value.split(path.sep).join('/');

function validName(value, note = false) {
  if (typeof value !== 'string') throw new Error('Укажите название.');
  let name = value.trim();
  if (note && !/\.md$/i.test(name)) name += '.md';
  if (!name || name.startsWith('.') || name.length > 180 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)
    || /^\.{1,2}$/.test(name) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) {
    throw new Error('Название не должно содержать / \\ : * ? " < > |, заканчиваться точкой или быть системным именем Windows.');
  }
  if (note && name.toLowerCase() === '.md') throw new Error('Укажите название заметки.');
  return name;
}

class NoteStore {
  constructor(root) { this.root = root; this.searchIndex = null; }

  invalidateSearch() { this.searchIndex = null; }

  static async open(root) {
    const canonical = await fs.realpath(root);
    if (!(await fs.stat(canonical)).isDirectory()) throw new Error('Выберите папку.');
    return new NoteStore(canonical);
  }

  // Не выходим за корневую папку и не следуем ссылкам на другие папки.
  async resolve(relative = '', allowMissing = false) {
    if (typeof relative !== 'string' || relative.includes('\0') || path.isAbsolute(relative)) {
      throw new Error('Недопустимый путь.');
    }
    const full = path.resolve(this.root, relative);
    const rel = path.relative(this.root, full);
    if (rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) throw new Error('Путь вне папки заметок.');
    let current = this.root;
    const pieces = rel ? rel.split(path.sep) : [];
    for (let index = 0; index < pieces.length; index++) {
      current = path.join(current, pieces[index]);
      try {
        if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Ссылки на файлы и папки не поддерживаются.');
      } catch (error) {
        if (allowMissing && error.code === 'ENOENT' && index === pieces.length - 1) break;
        throw error;
      }
    }
    return full;
  }

  async tree() {
    const walk = async relative => {
      const entries = await fs.readdir(await this.resolve(relative), { withFileTypes: true });
      const nodes = [];
      for (const entry of entries) {
        if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
        const rel = toRelative(path.join(relative, entry.name));
        if (entry.isDirectory()) {
          nodes.push({ type: 'folder', name: entry.name, path: rel, children: await walk(rel) });
        } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
          nodes.push({ type: 'note', name: entry.name.replace(/\.md$/i, ''), path: rel });
        }
      }
      return nodes.sort((a, b) => (a.type === b.type ? collator.compare(a.name, b.name) : a.type === 'folder' ? -1 : 1));
    };
    return walk('');
  }

  async read(relative) {
    if (!/\.md$/i.test(relative)) throw new Error('Можно открывать только Markdown-файлы (.md).');
    const full = await this.resolve(relative);
    const stat = await fs.stat(full);
    if (!stat.isFile()) throw new Error('Это не файл заметки.');
    if (stat.size > MAX_NOTE_BYTES) throw new Error('Заметка больше 10 МБ. Откройте её во внешнем редакторе.');
    const content = await fs.readFile(full, 'utf8');
    return { path: relative, content, version: hash(content), modified: stat.mtimeMs };
  }

  async save(relative, content, version) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_NOTE_BYTES) throw new Error('Максимальный размер заметки — 10 МБ.');
    const full = await this.resolve(relative);
    const original = await this.read(relative);
    if (original.version !== version) return { conflict: true, current: original };
    const temporary = path.join(path.dirname(full), '.quiet-notes-' + randomUUID() + '.tmp');
    try {
      const stat = await fs.stat(full);
      await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: stat.mode });
      // Повторная проверка перед заменой защищает от обычных внешних правок.
      if ((await this.read(relative)).version !== version) return { conflict: true, current: await this.read(relative) };
      await fs.rename(temporary, full);
      this.invalidateSearch();
      return await this.read(relative);
    } finally { await fs.unlink(temporary).catch(() => {}); }
  }

  async create(parent, name, type) {
    const folder = await this.resolve(parent);
    if (!(await fs.stat(folder)).isDirectory()) throw new Error('Выберите папку для новой заметки.');
    if (!['folder', 'note'].includes(type)) throw new Error('Неизвестный тип файла.');
    const safeName = validName(name, type === 'note');
    const relative = toRelative(path.join(parent, safeName));
    const full = await this.resolve(relative, true);
    if (type === 'folder') await fs.mkdir(full);
    else await fs.writeFile(full, '# ' + safeName.replace(/\.md$/i, '') + '\n\n', { encoding: 'utf8', flag: 'wx' });
    this.invalidateSearch();
    return relative;
  }

  async rename(relative, name) {
    if (!relative) throw new Error('Нельзя переименовать корневую папку.');
    const full = await this.resolve(relative);
    const isNote = (await fs.stat(full)).isFile();
    const safeName = validName(name, isNote);
    const next = toRelative(path.join(path.dirname(relative), safeName));
    if (next === relative) return next;
    const target = await this.resolve(next, true);
    try {
      await fs.access(target);
      // Windows допускает изменение только регистра у того же файла.
      if (process.platform !== 'win32' || target.toLowerCase() !== full.toLowerCase()) {
        throw new Error('Файл или папка с таким названием уже существует.');
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rename(full, target);
    this.invalidateSearch();
    return next;
  }

  async trash(relative, trashItem) {
    if (!relative) throw new Error('Нельзя удалить корневую папку.');
    await trashItem(await this.resolve(relative));
    this.invalidateSearch();
  }

  async move(relative, destination) {
    if (!relative) throw new Error('Нельзя переместить корневую папку.');
    const source = await this.resolve(relative);
    const folder = await this.resolve(destination);
    if (!(await fs.stat(folder)).isDirectory()) throw new Error('Выберите папку назначения.');
    const next = toRelative(path.join(destination, path.basename(source)));
    if (next === relative) return next;
    if ((await fs.stat(source)).isDirectory()) {
      const inside = path.relative(source, folder);
      if (!inside || (!inside.startsWith('..' + path.sep) && inside !== '..' && !path.isAbsolute(inside))) {
        throw new Error('Нельзя переместить папку внутрь самой себя.');
      }
    }
    const target = await this.resolve(next, true);
    try { await fs.lstat(target); throw new Error('В выбранной папке уже есть файл или папка с таким названием.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rename(source, target);
    this.invalidateSearch();
    return next;
  }

  async importFiles(destination, files) {
    const folder = await this.resolve(destination);
    if (!(await fs.stat(folder)).isDirectory()) throw new Error('Выберите папку назначения.');
    const result = { added: [], errors: [] };
    for (const source of files) {
      const name = path.basename(source);
      try {
        if (!/\.md$/i.test(name)) throw new Error('Нужен Markdown-файл .md.');
        validName(name, true);
        const stat = await fs.stat(source);
        if (!stat.isFile() || stat.size > MAX_NOTE_BYTES) throw new Error('Нужен файл размером до 10 МБ.');
        const relative = toRelative(path.join(destination, name));
        const target = await this.resolve(relative, true);
        await fs.copyFile(source, target, constants.COPYFILE_EXCL);
        result.added.push(relative);
      } catch (error) {
        result.errors.push({ name, message: error.code === 'EEXIST' ? 'Уже есть файл с таким названием.' : error.message });
      }
    }
    this.invalidateSearch();
    return result;
  }

  async search(query) {
    const text = String(query).trim().toLocaleLowerCase('ru');
    if (!text) return [];
    const terms = text.split(/\s+/);
    const results = [];
    const index = [];
    const walk = async nodes => {
      for (const node of nodes) {
        if (node.type === 'folder') { await walk(node.children); continue; }
        try {
          const note = await this.read(node.path);
          index.push({ ...node, content: note.content, title: node.name.toLocaleLowerCase('ru'), lower: note.content.toLocaleLowerCase('ru') });
        } catch (error) {
          if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code) || /10 МБ/.test(error.message)) continue;
          throw error;
        }
      }
    };
    if (!this.searchIndex) {
      await walk(await this.tree());
      this.searchIndex = index;
    }
    // Индекс живёт только в памяти; на диске по-прежнему лишь Markdown.
    for (const note of this.searchIndex) {
      if (!terms.every(term => note.title.includes(term) || note.lower.includes(term))) continue;
      const position = Math.max(0, note.lower.indexOf(terms.find(term => note.lower.includes(term)) || ''));
      results.push({ type: 'note', name: note.name, path: note.path,
        snippet: note.content.slice(Math.max(0, position - 45), position + 150).replace(/\s+/g, ' '), rank: note.title.includes(text) ? 0 : 1 });
    }
    return results.sort((a, b) => a.rank - b.rank || collator.compare(a.name, b.name));
  }
}

module.exports = { NoteStore, validName, hash };
