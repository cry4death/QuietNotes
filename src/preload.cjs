const { contextBridge, ipcRenderer } = require('electron');
const invoke = (name, ...args) => ipcRenderer.invoke(name, ...args).then(result => {
  if (!result.ok) throw new Error(result.error);
  return result.value;
});
const on = (name, callback) => {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(name, listener);
  return () => ipcRenderer.removeListener(name, listener);
};
contextBridge.exposeInMainWorld('notes', {
  initial: () => invoke('initial'), chooseRoot: () => invoke('choose-root'),
  tree: () => invoke('tree'), read: relative => invoke('read', relative), search: query => invoke('search', query),
  save: (relative, content, version) => invoke('save', relative, content, version),
  create: (parent, name, type) => invoke('create', parent, name, type),
  rename: (relative, name) => invoke('rename', relative, name), delete: relative => invoke('delete', relative),
  move: (relative, destination) => invoke('move', relative, destination),
  importFiles: destination => invoke('import-files', destination),
  contextMenu: request => invoke('context-menu', request),
  reveal: relative => invoke('reveal', relative), copy: text => invoke('copy', text),
  preferences: patch => invoke('preferences', patch), dirty: value => invoke('dirty', value),
  close: () => invoke('close'), fullscreen: () => invoke('fullscreen'),
  onFilesChanged: callback => on('files-changed', callback), onWatchError: callback => on('watch-error', callback),
  onRequestClose: callback => on('request-close', callback)
});
