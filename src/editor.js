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
  const value = () => source.value === fileOriginal.replace(/\r\n?/g, '\n') ? fileOriginal : source.value;

  function imageView(node) {
    const image = document.createElement('img');
    image.alt = node.attrs.altText || '';
    const url = node.attrs.imageUrl;
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
      hooks: { addImageBlobHook: () => {
        toast('Сохраните изображение в папку заметки и укажите относительный путь в Markdown.');
        return false;
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
      fileOriginal = markdown; source.value = markdown; mode = 'visual'; renderMode(); mount();
    },
    value,
    focus, setReadOnly,
    setTheme(theme) { host.querySelector('.toastui-editor-defaultUI')?.classList.toggle('toastui-editor-dark', theme === 'dark'); }
  };
}
