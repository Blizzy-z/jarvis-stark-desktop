const {app,BrowserWindow,Menu,Tray,shell,ipcMain,nativeImage,dialog}=require('electron');
const path=require('node:path');
const BASE='http://127.0.0.1:3014';
let win,server,tray,quitting=false;
function trusted(url){try{const u=new URL(url);return u.origin===BASE;}catch{return false;}}
function external(url){try{const u=new URL(url);return (u.origin===BASE&&u.pathname==='/api/cloud/browser-login')||(u.protocol==='https:'&&['chatgpt.com','auth.openai.com','developers.openai.com'].includes(u.hostname));}catch{return false;}}
function show(){win.show();win.focus();}
if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',()=>win&&show());
 app.whenReady().then(async()=>{
  process.env.JARVIS_PORT='3014';
  try{server=require('./server.cjs');await new Promise((resolve,reject)=>{if(server.listening)return resolve();server.once('listening',resolve);server.once('error',reject);});}catch{dialog.showErrorBox('JARVIS could not start','Port 3014 may be in use by the browser version of JARVIS. Close that version and try again.');app.quit();return;}
  win=new BrowserWindow({width:1440,height:900,minWidth:360,minHeight:480,fullscreen:true,show:false,backgroundColor:'#070b11',title:'JARVIS | Stark Industries',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  const ses=win.webContents.session;
  ses.setPermissionRequestHandler((contents,permission,callback,details)=>{
   if(!trusted(contents.getURL())||permission!=='media'||(details.mediaTypes||[]).some(x=>x!=='audio'))return callback(false);
   dialog.showMessageBox(win,{type:'question',buttons:['Allow microphone','Not now'],defaultId:1,cancelId:1,message:'Allow JARVIS to use your microphone?'}).then(r=>callback(r.response===0));
  });
  ses.setPermissionCheckHandler((contents,permission,origin)=>permission==='media'&&!!contents&&trusted(contents.getURL())&&trusted(origin));
  win.webContents.setWindowOpenHandler(({url})=>{if(external(url))void shell.openExternal(url);return {action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{if(!trusted(url)){event.preventDefault();if(external(url))void shell.openExternal(url);}});
  win.webContents.on('before-input-event',(event,input)=>{if(input.type==='keyDown'&&input.key==='F11'){event.preventDefault();win.setFullScreen(!win.isFullScreen());}if(input.type==='keyDown'&&input.key==='Escape'&&win.isFullScreen()){event.preventDefault();win.setFullScreen(false);}});
  ipcMain.handle('jarvis:open-external',(event,url)=>{if(!trusted(event.senderFrame.url)||!external(url))throw Error('Unapproved address');return shell.openExternal(url);});
  const menu=Menu.buildFromTemplate([{label:'JARVIS',submenu:[{label:'Show JARVIS',click:show},{label:'Toggle fullscreen',accelerator:'F11',click:()=>win.setFullScreen(!win.isFullScreen())},{label:'Minimize to tray',click:()=>win.hide()},{type:'separator'},{label:'Quit JARVIS',click:()=>{quitting=true;app.quit();}}]}]);Menu.setApplicationMenu(menu);
  const icon=nativeImage.createFromPath(path.join(__dirname,'public/pwa-192x192.png'));tray=new Tray(icon);tray.setToolTip('JARVIS · Stark Industries');tray.setContextMenu(menu);tray.on('double-click',show);
  win.on('close',event=>{if(!quitting){event.preventDefault();win.hide();}});
  win.once('ready-to-show',show);await win.loadURL(BASE);
 }).catch(e=>{dialog.showErrorBox('JARVIS startup failed',String(e.message));app.quit();});
 app.on('before-quit',()=>{quitting=true;server?.close();});
}
