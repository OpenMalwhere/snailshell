// Snailshell - bridge: gives interface code access to the system through window.snailshell
const { contextBridge, ipcRenderer } = require('electron');
const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('snailshell', {
  system: { info: call('sys:info'), exec: call('sys:exec') },
  fs: {
    read: call('fs:read'), write: call('fs:write'), list: call('fs:list'),
    exists: call('fs:exists'), remove: call('fs:delete')
  },
  dialog: { open: call('dialog:open'), save: call('dialog:save'), message: call('dialog:message') },
  shell: { openExternal: call('shell:open'), openPath: call('shell:openPath'), showInFolder: call('shell:show') },
  clipboard: { read: call('clip:read'), write: call('clip:write') },
  window: {
    minimize: call('win:minimize'), maximize: call('win:maximize'), close: call('win:close'),
    setTitle: call('win:setTitle'), fullscreen: call('win:fullscreen'), alwaysOnTop: call('win:alwaysOnTop')
  },
  app: { reload: call('app:reload'), devtools: call('app:devtools'), quit: call('app:quit') }
});
