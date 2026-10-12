'use strict';
const {app,BrowserWindow,ipcMain,dialog,clipboard,shell,safeStorage,powerMonitor,session}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {Storage,validate}=require('./storage.cjs');
const {SyncServer}=require('./sync-server.cjs');
app.setName('Plain Vault');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-client-side-phishing-detection');
if(!app.requestSingleInstanceLock())app.exit(0);
let win,storage,sync,unlocked=false,ownedClip='',clipTimer;
app.on('second-instance',()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.focus();}});
let pending=new Map();
const ui=path.resolve(__dirname,'../web/index.html');
const lock=()=>{unlocked=false;clearClipboard();sync?.stop().catch(()=>{});if(win&&!win.isDestroyed())win.webContents.send('plainvault-lock');};
function clearClipboard(){clearTimeout(clipTimer);if(ownedClip&&clipboard.readText()===ownedClip)clipboard.clear();ownedClip='';}
function exchange(data){
  if(!unlocked||!win||win.isDestroyed()){const e=new Error('Unlock the PC vault to sync.');e.status=423;return Promise.reject(e);}
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID();const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Sync timed out. Unlock both devices and try again.'));},20000);
    pending.set(id,{resolve,reject,timer});win.webContents.send('plainvault-sync',{id,data});
  });
}
app.whenReady().then(async()=>{
  const dir=app.getPath('userData');storage=new Storage(dir);await storage.init();
  sync=new SyncServer(path.join(dir,'sync'),exchange,{seal:s=>{if(!safeStorage.isEncryptionAvailable())throw new Error('Windows secure storage is unavailable.');return safeStorage.encryptString(s);},unseal:b=>safeStorage.decryptString(b)});
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
    // Bundled assets only. All local-sync networking lives in the main process.
    let permitted=false;try{const u=new URL(details.url);permitted=u.protocol==='file:'&&decodeURIComponent(u.pathname).replace(/^\/(\w:)/,'$1').startsWith(path.resolve(__dirname,'../web').replaceAll('\\','/')+'/');}catch{}
    callback({cancel:!permitted});
  });
  win=new BrowserWindow({width:1120,height:790,minWidth:740,minHeight:600,title:'Plain Vault',icon:path.join(__dirname,'../web/icon.png'),backgroundColor:'#101b24',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webviewTag:false,devTools:false,spellcheck:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(url!==pathToFileURL(ui).href)event.preventDefault();});
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  win.on('minimize',lock);powerMonitor.on('lock-screen',lock);powerMonitor.on('suspend',lock);
  ipcMain.handle('plainvault',async(event,op,args)=>{
    if(event.sender!==win.webContents||event.senderFrame?.routingId!==win.webContents.mainFrame.routingId||event.senderFrame?.processId!==win.webContents.mainFrame.processId)throw new Error('Untrusted frame.');
    if(!args||typeof args!=='object')throw new Error('Invalid request.');
    switch(op){
      case 'info':return{platform:'windows',version:app.getVersion()};
      case 'readVault':return storage.read();
      case 'writeVault':return storage.write(args.data,args.expectedRevision??null);
      case 'importFile':{
        const r=await dialog.showOpenDialog(win,{title:'Import encrypted vault',properties:['openFile'],filters:[{name:'KeePass vault',extensions:['kdbx']}]});
        if(r.canceled)return{cancelled:true};const stat=await fs.stat(r.filePaths[0]);if(stat.size>16*1024*1024)throw new Error('Choose a vault smaller than 16 MB.');
        const bytes=await fs.readFile(r.filePaths[0]);validate(bytes);return{data:bytes.toString('base64'),name:path.basename(r.filePaths[0])};
      }
      case 'exportFile':{
        const bytes=Buffer.from(args.data||'','base64');validate(bytes);
        const r=await dialog.showSaveDialog(win,{title:'Save encrypted vault',defaultPath:`Plain-Vault-${new Date().toISOString().slice(0,10)}.kdbx`,filters:[{name:'KeePass vault',extensions:['kdbx']}]});
        if(r.canceled)return{cancelled:true};await fs.writeFile(r.filePath,bytes,{mode:0o600});return{saved:true};
      }
      case 'backups':return storage.backups();
      case 'readBackup':return storage.readBackup(args.name);
      case 'copy':if(typeof args.text!=='string'||args.text.length>65536)throw new Error('Invalid clipboard text.');clearClipboard();ownedClip=args.text;clipboard.writeText(ownedClip);clipTimer=setTimeout(clearClipboard,20000);return{};
      case 'clearClipboard':clearClipboard();return{};
      case 'unlocked':unlocked=args.value===true;if(!unlocked)await sync.stop();return{};
      case 'syncInfo':return sync.info();
      case 'syncStart':if(!unlocked)throw new Error('Unlock the vault first.');return sync.start();
      case 'syncStop':return sync.stop();
      case 'pairingCode':if(!unlocked)throw new Error('Unlock the vault first.');return sync.pairingCode(args.host);
      case 'forgetPeer':return sync.forget(args.id);
      case 'syncResponse':{
        const p=pending.get(args.id);if(p){pending.delete(args.id);clearTimeout(p.timer);if(args.error)p.reject(new Error(args.error));else p.resolve({data:args.data,conflicts:args.conflicts||0});}return{};
      }
      case 'support':await shell.openExternal('https://square.link/u/kAddgU4q');return{};
      default:throw new Error('Unknown operation.');
    }
  });
  await win.loadFile(ui);
}).catch(error=>{dialog.showErrorBox('Plain Vault could not start',error.message);app.quit();});
app.on('window-all-closed',()=>{lock();app.quit();});
app.on('before-quit',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Plain Vault closed.'));}pending.clear();clearClipboard();});
