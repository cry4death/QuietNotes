import Editor from '@toast-ui/editor';
import '@toast-ui/editor/dist/i18n/ru-ru';
import DOMPurify from 'dompurify';

Editor.setLanguage('ru-RU', {
  Task: 'Список задач', 'Unordered list': 'Маркированный список',
  'Ordered list': 'Нумерованный список', 'Insert CodeBlock': 'Блок кода',
  OK: 'Вставить', More: 'Ещё'
});

// Файл остаётся Markdown. Визуальный редактор работает только с черновиком.
export function createNoteEditor({ $, onChange, getPath, getTheme, toast }) {
  const source = $('editor'), host = $('visual-editor');
  let editor, mode = 'visual', loading = false, locked = false;
  let visualBase = '', original = '', visualText = '', fileOriginal = '';
  const pendingImages = new Map();
  const imagePath = name => '/.quiet-notes-images/' + name;
  const value = () => source.value === fileOriginal.replace(/\r\n?/g, '\n') ? fileOriginal : source.value;

  function addImage(blob) {
    if (locked) return null;
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg' }[blob.type];
    if (!extension || !blob.size || blob.size > 10 * 1024 * 1024) {
      toast('Вставьте изображение PNG или JPEG размером до 10 МБ.', true);
      return null;
    }
    const size = [...pendingImages.values()].reduce((total, image) => total + image.blob.size, blob.size);
    if (pendingImages.size >= 8 || size > 32 * 1024 * 1024) {
      toast('Сохраните заметку перед добавлением других изображений.', true);
      return null;
    }
    const name = crypto.randomUUID() + '.' + extension;
    pendingImages.set(imagePath(name), { name, blob, url: URL.createObjectURL(blob) });
    return imagePath(name);
  }

  function clearImages() {
    for (const image of pendingImages.values()) URL.revokeObjectURL(image.url);
    pendingImages.clear();
  }

  async function attachments(content) {
    const images = [...pendingImages].filter(([path]) => content.includes(path));
    return Promise.all(images.map(async ([, image]) => ({
      name: image.name, bytes: new Uint8Array(await image.blob.arrayBuffer())
    })));
  }

  function imageView(node) {
    const image = document.createElement('img');
    image.alt = node.attrs.altText || '';
    const url = node.attrs.imageUrl;
    const pending = pendingImages.get(url);
    if (pending) {
      image.src = pending.url;
      return { dom: image };
    }
    if (!/^[a-z][a-z\d+.-]*:|^\/\//i.test(url)) {
      try {
        const base = 'notes://media/' + getPath().split('/').map(encodeURIComponent).join('/');
        const resolved = new URL(url, base);
        if (resolved.host === 'media') image.src = resolved.href;
      } catch { /* Некорректный путь остаётся подписью. */ }
    } else image.alt ||= 'Внешнее изображение недоступно без интернета';
    return { dom: image };
  }

  function mount() {
    loading = true;
    editor?.destroy();
    original = visualText = source.value;
    editor = new Editor({
      el: host, height: '100%', minHeight: '200px', initialValue: original.replace(/^\uFEFF/, ''),
      initialEditType: 'wysiwyg', language: 'ru-RU', hideModeSwitch: true,
      autofocus: false, usageStatistics: false, theme: getTheme() === 'dark' ? 'dark' : undefined,
      placeholder: 'Начните писать…',
      toolbarItems: [
        ['heading', 'bold', 'italic', 'strike'], ['ul', 'ol', 'task'],
        ['quote', 'hr'], ['link', 'table'], ['code', 'codeblock']
      ],
      customHTMLSanitizer: html => DOMPurify.sanitize(html, {
        FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio'],
        FORBID_ATTR: ['style']
      }),
      plugins: [() => ({ wysiwygNodeViews: { image: imageView } })],
      hooks: { addImageBlobHook: (blob, insert) => {
        const path = addImage(blob);
        if (path) insert(path, 'Скриншот');
      } },
      events: { change: () => {
        if (loading || locked || mode !== 'visual') return;
        const markdown = editor.getMarkdown();
        // Открытие и отмена всех правок не меняют исходные пробелы и переносы.
        source.value = markdown === visualBase ? original : markdown;
        visualText = source.value;
        onChange(value());
      } }
    });
    visualBase = editor.getMarkdown();
    const input = host.querySelector('.toastui-editor-ww-container .ProseMirror');
    input.setAttribute('role', 'textbox');
    input.setAttribute('aria-label', 'Текст заметки');
    input.setAttribute('aria-multiline', 'true');
    input.setAttribute('spellcheck', 'true');
    loading = false;
    setReadOnly(locked);
  }

  function renderMode() {
    source.hidden = mode !== 'source'; host.hidden = mode !== 'visual';
    $('editor-history').hidden = mode !== 'visual';
    for (const value of ['visual', 'source']) {
      $('editor-' + value).setAttribute('aria-pressed', String(mode === value));
    }
    $('editor-hint').textContent = mode === 'visual' ? 'Выделите текст и выберите оформление' : 'Исходный Markdown';
  }

  function switchMode(next) {
    if (locked || mode === next) return;
    mode = next;
    renderMode();
    if (mode === 'visual' && source.value !== visualText) mount();
    focus();
  }

  function focus() { if (mode === 'visual') editor?.focus(); else source.focus(); }
  function setReadOnly(value) {
    locked = value; source.readOnly = value; host.inert = value;
    host.querySelector('[role="textbox"]')?.setAttribute('contenteditable', String(!value));
    for (const id of ['editor-visual', 'editor-source', 'editor-undo', 'editor-redo']) $(id).disabled = value;
  }

  $('editor-visual').onclick = () => switchMode('visual');
  $('editor-source').onclick = () => switchMode('source');
  source.oninput = () => onChange(value());
  source.onpaste = event => {
    if (locked || event.clipboardData.getData('text/plain')) return;
    const item = [...event.clipboardData.items].find(item => item.kind === 'file' && item.type.startsWith('image/'));
    const blob = item?.getAsFile();
    if (!blob) return;
    event.preventDefault();
    const path = addImage(blob);
    if (!path) return;
    source.setRangeText('\n\n![Скриншот](' + path + ')\n\n', source.selectionStart, source.selectionEnd, 'end');
    onChange(value());
  };
  for (const command of ['undo', 'redo']) {
    const button = $('editor-' + command);
    button.onmousedown = event => event.preventDefault();
    button.onclick = () => { if (!locked) { editor.exec(command); editor.focus(); } };
  }
  host.addEventListener('click', event => { if (event.target.closest('a')) event.preventDefault(); });
  host.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || locked) return;
    const blockTool = ['bullet-list', 'ordered-list', 'task-list', 'codeblock'].some(name => button.classList.contains(name));
    if (blockTool && editor.getRangeInfoOfNode().type === 'heading') editor.exec('heading', { level: 0 });
  }, true);
  host.addEventListener('keydown', event => {
    // Физические клавиши работают и при русской раскладке.
    if (locked || !(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return;
    const command = !event.shiftKey && { KeyB: 'bold', KeyI: 'italic' }[event.code];
    if (command) { event.preventDefault(); event.stopPropagation(); editor.exec(command); }
  }, true);

  return {
    load(markdown) {
      clearImages();
      fileOriginal = markdown; source.value = markdown; mode = 'visual'; renderMode(); mount();
    },
    value, attachments, clearImages,
    focus, setReadOnly,
    setTheme(theme) { host.querySelector('.toastui-editor-defaultUI')?.classList.toggle('toastui-editor-dark', theme === 'dark'); }
  };
}
