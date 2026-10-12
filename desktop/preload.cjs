const {contextBridge,ipcRenderer}=require('electron');
const ops=new Set(['info','readVault','writeVault','importFile','exportFile','backups','readBackup','copy','clearClipboard','unlocked','syncInfo','syncStart','syncStop','pairingCode','forgetPeer','support','syncResponse']);
contextBridge.exposeInMainWorld('PlainVaultPlatform',{
  invoke:(op,args={})=>{if(!ops.has(op))return Promise.reject(new Error('Unknown operation.'));return ipcRenderer.invoke('plainvault',op,args);},
  onSync:callback=>ipcRenderer.on('plainvault-sync',(_,payload)=>callback(payload)),
  onLock:callback=>ipcRenderer.on('plainvault-lock',()=>callback())
});
