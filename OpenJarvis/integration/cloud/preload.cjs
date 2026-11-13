const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('jarvisDesktop',{openExternal:url=>ipcRenderer.invoke('jarvis:open-external',url)});
