'use strict';
const {Vault,randomPassword,toBase64,fromBase64}=require('./core.cjs');
const QRCode=require('qrcode');
const jsQR=require('jsqr');
const $=id=>document.getElementById(id);
let native;
if(window.PlainVaultPlatform)native=window.PlainVaultPlatform;
else if(window.PlainVaultNative){
  const waiting=new Map();
  window.addEventListener('plainvault-response',e=>{const p=waiting.get(e.detail.id);if(!p)return;waiting.delete(e.detail.id);clearTimeout(p.timer);e.detail.error?p.reject(new Error(e.detail.error)):p.resolve(e.detail.data);});
  native={invoke:(op,args={})=>new Promise((resolve,reject)=>{
    const id=crypto.randomUUID();const timer=setTimeout(()=>{waiting.delete(id);reject(new Error('This action timed out. Try again.'));},op==='importFile'||op==='exportFile'?600000:35000);
    waiting.set(id,{resolve,reject,timer});window.PlainVaultNative.call(op,JSON.stringify(args),id);
  }),onLock:callback=>window.addEventListener('plainvault-lock',callback)};
}else{
  $('auth-description').textContent='Open Plain Vault using the installed Android or Windows app.';
  $('auth-form').hidden=true;$('auth-import').hidden=true;
  throw new Error('Native app bridge is unavailable.');
}
let platform,stored={data:null,revision:null},pendingImport=null,busy=false,chain=Promise.resolve(),idle,toastTimer,scanStop=null,lastInteraction=Date.now();
const vault=new Vault(async(bytes,expectedRevision)=>{
  const data=toBase64(bytes);const result=await native.invoke('writeVault',{data,expectedRevision});stored={data,revision:result.revision};return result;
});
function toast(message,error=false){$('toast').textContent=message;$('toast').className='visible'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').className='';$('toast').textContent='';},error?12000:7500);}
function message(error){if(error?.code==='InvalidKey'||/InvalidKey/.test(error?.message))return'That master password did not unlock this vault.';return error?.message||'Could not complete this action.';}
function serial(fn,label='Working…'){
  const result=chain.then(async()=>{
    busy=true;$('working-text').textContent=label;$('working').hidden=false;
    const buttons=[...document.querySelectorAll('button')];const disabled=buttons.map(b=>b.disabled);buttons.forEach(b=>b.disabled=true);
    try{return await fn();}finally{busy=false;buttons.forEach((b,i)=>{if(b.isConnected)b.disabled=disabled[i];});$('working').hidden=true;resetIdle(false);}
  });chain=result.catch(()=>{});return result;
}
const act=(fn,label)=>serial(fn,label).catch(e=>toast(message(e),true));
function on(id,fn,label){$(id).addEventListener('click',()=>{if(!busy)act(fn,label);});}
function resetIdle(user=true){if(user)lastInteraction=Date.now();clearTimeout(idle);if(vault.unlocked)idle=setTimeout(()=>act(lock,'Locking…'),Math.max(0,120000-(Date.now()-lastInteraction)));}
document.addEventListener('pointerdown',resetIdle,{passive:true});document.addEventListener('keydown',resetIdle,{passive:true});
async function lock(){
  stopScan();closeModal();vault.lock();clearTimeout(idle);$('search').value='';$('entries').replaceChildren();$('count').textContent='0';$('vault-title').textContent='My vault';
  await native.invoke('clearClipboard');await native.invoke('unlocked',{value:false});stored=await native.invoke('readVault');pendingImport=null;showAuth();
}
native.onLock?.(()=>act(lock,'Locking…'));
native.onSync?.(payload=>{
  serial(async()=>{
    let conflicts=0;
    if(!vault.unlocked)throw new Error('Unlock the PC vault to sync.');
    if(payload.data)conflicts=await vault.merge(fromBase64(payload.data));
    await native.invoke('syncResponse',{id:payload.id,data:toBase64(vault.export()),conflicts});render();
    if(payload.data)toast(conflicts?`Sync complete. ${conflicts} entry/entries have different versions. Review History.`:'Phone synced. All changes are saved locally.');
  },'Syncing with phone…').catch(async e=>{await native.invoke('syncResponse',{id:payload.id,error:message(e)});toast(message(e),true);});
});
function showAuth(){
  $('auth').hidden=false;$('workspace').hidden=true;
  const creating=!stored.data&&!pendingImport;
  $('auth-title').textContent=pendingImport?'Unlock the imported vault.':creating?'A private home for your passwords.':'Welcome back.';
  $('auth-description').textContent=pendingImport?'Enter the master password for this vault. Your current vault will be backed up before replacement.':creating?'Create an encrypted vault on this device. You can also import a vault from your other device.':'Unlock your saved vault. Your passwords stay on this device.';
  $('name-label').hidden=!creating;$('confirm-label').hidden=!creating;$('master-confirm').required=creating;
  $('master-hint').textContent=creating?'Use a long passphrase of at least 12 characters. There is no master password reset.':'Your master password stays on this device. There is no password reset.';
  $('auth-submit').textContent=creating?'Create my vault':pendingImport?'Unlock & import vault':'Unlock vault';
  $('auth-cancel-import').hidden=!pendingImport;
  $('master').value='';$('master-confirm').value='';
  $('master').type='password';document.querySelector('[data-reveal="master"]').textContent='Show';
  $('auth-pair').hidden=platform!=='android';$('auth-pull').hidden=platform!=='android';$('auth-backups').hidden=!stored.data;
}
function render(){
  if(!vault.unlocked)return;
  $('auth').hidden=true;$('workspace').hidden=false;$('vault-title').textContent=vault.name;
  const entries=vault.list().sort((a,b)=>(a.title||'Untitled').localeCompare(b.title||'Untitled','en',{sensitivity:'base'}));$('count').textContent=entries.length;
  const chosen=$('category').value;const categories=[...new Set(entries.map(e=>e.category))].sort();
  $('category').replaceChildren(new Option('All categories',''),...categories.map(c=>new Option(c,c)));if(categories.includes(chosen))$('category').value=chosen;
  const q=$('search').value.trim().toLowerCase();
  const filtered=entries.filter(e=>(!chosen||e.category===chosen)&&(!q||`${e.title} ${e.username} ${e.url}`.toLowerCase().includes(q)));
  $('filtered-count').textContent=`${filtered.length} ${filtered.length===1?'entry':'entries'}`;$('entries').replaceChildren();
  for(const entry of filtered){
    const row=document.createElement('button');row.className='entry';row.setAttribute('aria-label',`Open ${entry.title}`);
    const mark=document.createElement('span');mark.className='entry-mark';mark.textContent=(entry.title||'?').slice(0,2).toUpperCase();
    const main=document.createElement('span');main.className='entry-main';const title=document.createElement('span');title.className='entry-title';title.textContent=entry.title||'Untitled';
    const subtitle=document.createElement('span');subtitle.className='entry-subtitle';subtitle.textContent=entry.username||entry.url||'Secure entry';main.append(title,subtitle);
    const tag=document.createElement('span');tag.className='entry-tag';tag.textContent=entry.category;const arrow=document.createElement('span');arrow.className='entry-arrow';arrow.textContent='›';
    row.append(mark,main,tag,arrow);row.addEventListener('click',()=>{if(!busy)details(entry.id);});$('entries').append(row);
  }
  $('empty').hidden=filtered.length!==0;$('empty-add').hidden=entries.length!==0;
  $('empty-title').textContent=entries.length?'No matching passwords.':'Make room for a little peace of mind.';
  $('empty-description').textContent=entries.length?'Try a different search or category.':'Add your first login. We’ll keep it encrypted, right here.';resetIdle(false);
}
$('search').addEventListener('input',render);$('category').addEventListener('change',render);
$('auth-form').addEventListener('submit',event=>{event.preventDefault();if(busy)return;const password=$('master').value,confirm=$('master-confirm').value,name=$('vault-name').value;
  $('master').value='';$('master-confirm').value='';
  act(async()=>{
    try {
    if(!stored.data&&!pendingImport){if(password!==confirm)throw new Error('The two master passwords do not match.');await vault.create(password,name);}
    else{await vault.open(fromBase64(pendingImport?.data||stored.data),password,stored.revision);if(pendingImport){await vault.save();pendingImport=null;}}
    await native.invoke('unlocked',{value:true});lastInteraction=Date.now();render();toast('Vault unlocked.');
    } catch(e) { vault.lock(); throw e; }
  },'Unlocking encrypted vault…');
});
function stopScan(){if(scanStop){scanStop();scanStop=null;}}
function closeModal(){stopScan();for(const el of $('modal-content').querySelectorAll('input,textarea'))el.value='';$('modal-content').replaceChildren();$('modal-title').textContent='';if($('modal').open)$('modal').close();}
function modal(title){closeModal();$('modal-title').textContent=title;$('modal').showModal();return $('modal-content');}
$('modal-close').addEventListener('click',()=>{if(!busy)closeModal();});$('modal').addEventListener('cancel',e=>{e.preventDefault();if(!busy)closeModal();});
document.addEventListener('click',e=>{const button=e.target.closest('[data-reveal]');if(!button||busy)return;const input=$(button.dataset.reveal);const show=input.type==='password';input.type=show?'text':'password';button.textContent=show?'Hide':'Show';button.setAttribute('aria-label',show?'Hide password':'Show password');});
function editor(id){
  const data=id?vault.details(id):{title:'',username:'',password:'',url:'',notes:'',category:'General'};
  const body=modal(id?'Edit password':'Add a password');
  body.innerHTML='<form id="entry-form" autocomplete="off"><label>Name<input id="entry-title" maxlength="200" required autocomplete="off"></label><div class="two-fields"><label>Username or email<input id="entry-username" autocomplete="off" autocapitalize="off" spellcheck="false"></label><label>Category<input id="entry-category" maxlength="80" autocomplete="off"></label></div><label>Password<span class="input-action"><input id="entry-password" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false"><button type="button" class="reveal" data-reveal="entry-password">Show</button></span></label><button type="button" class="secondary" id="entry-generate">Generate a strong password</button><label>Website<input id="entry-url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"></label><label>Secure notes<textarea id="entry-notes" autocomplete="off" spellcheck="false"></textarea></label><div class="actions"><button type="button" class="secondary" id="entry-cancel">Cancel</button><button class="primary">Save password</button></div></form>';
  for(const key of ['title','username','category','password','url','notes'])$('entry-'+key).value=data[key]||'';
  $('entry-generate').addEventListener('click',()=>{$('entry-password').value=randomPassword();toast('Generated a 24-character password.');});
  $('entry-cancel').addEventListener('click',closeModal);
  $('entry-form').addEventListener('submit',e=>{e.preventDefault();if(busy)return;const next={};for(const key of ['title','username','category','password','url','notes'])next[key]=$('entry-'+key).value;
    act(async()=>{await vault.upsert(next,id);closeModal();render();toast('Password saved on this device.');},'Encrypting and saving…');
  });$('entry-title').focus();
}
function detailRow(label,value,copy=false){
  const row=document.createElement('div');row.className='detail-row';const text=document.createElement('div');const name=document.createElement('div');name.className='detail-label';name.textContent=label;
  const content=document.createElement('div');content.className='detail-value';content.textContent=value||'—';text.append(name,content);row.append(text);
  if(copy&&value){const b=document.createElement('button');b.className='secondary';b.textContent='Copy';b.addEventListener('click',()=>act(async()=>{await native.invoke('copy',{text:value});toast('Copied. Clipboard clears in 20 seconds.');}));row.append(b);}
  return row;
}
function details(id,historyIndex){
  const data=vault.details(id,historyIndex),body=modal(historyIndex===undefined?data.title:'Saved password version');
  if(historyIndex!==undefined){const note=document.createElement('p');note.className='callout amber';note.textContent='This is a previous version. Restore it to make it current.';body.append(note);}
  body.append(detailRow('Username',data.username,true));
  const row=detailRow('Password','••••••••••••'),toggle=document.createElement('button');toggle.className='secondary';toggle.textContent='Show';let visible=false;
  toggle.addEventListener('click',()=>{visible=!visible;row.querySelector('.detail-value').textContent=visible?data.password:'••••••••••••';toggle.textContent=visible?'Hide':'Show';});row.append(toggle);
  const copy=document.createElement('button');copy.className='secondary';copy.textContent='Copy';copy.addEventListener('click',()=>act(async()=>{await native.invoke('copy',{text:data.password});toast('Password copied. Clipboard clears in 20 seconds.');}));row.append(copy);body.append(row);
  if(data.url)body.append(detailRow('Website',data.url,true));if(data.notes)body.append(detailRow('Secure notes',data.notes));body.append(detailRow('Category',data.category));body.append(detailRow('Last changed',formatDate(data.modified)));
  const actions=document.createElement('div');actions.className='actions';
  if(historyIndex!==undefined){const restore=document.createElement('button');restore.className='primary';restore.textContent='Restore this version';restore.addEventListener('click',()=>act(async()=>{await vault.restore(id,historyIndex);closeModal();render();toast('Version restored. The replaced version remains in History.');},'Restoring…'));actions.append(restore);}
  else{
    const history=document.createElement('button');history.className='secondary';history.textContent=`History (${vault.history(id).length})`;history.addEventListener('click',()=>historyDialog(id));
    const remove=document.createElement('button');remove.className='danger';remove.textContent='Delete';remove.addEventListener('click',()=>{if(window.confirm('Move this entry to the encrypted recycle bin?'))act(async()=>{await vault.remove(id);closeModal();render();toast('Entry removed. It remains in the encrypted KeePass recycle bin.');},'Saving…');});
    const edit=document.createElement('button');edit.className='primary';edit.textContent='Edit';edit.addEventListener('click',()=>editor(id));actions.append(history,remove,edit);
  }body.append(actions);
}
function formatDate(value){if(!value)return'Unknown';const d=new Date(value);return Number.isNaN(d.getTime())?'Unknown':new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(d);}
function historyDialog(id){
  const history=vault.history(id),body=modal('Password history');const intro=document.createElement('p');intro.className='modal-copy';intro.textContent='Older passwords and versions preserved during sync. Select one to inspect or restore it.';body.append(intro);
  const list=document.createElement('div');list.className='version-list';for(const h of history){const button=document.createElement('button');button.textContent=`${formatDate(h.modified)} · ${h.title||'Saved version'}`;button.addEventListener('click',()=>details(id,h.index));list.append(button);}if(!history.length){const p=document.createElement('p');p.textContent='No previous versions yet.';list.append(p);}body.append(list);
}
function generator(){
  const body=modal('Password generator');body.innerHTML='<p class="modal-copy">Create a random password entirely on this device.</p><label><span class="range-label"><span>Password length</span><strong id="length-value">24 characters</strong></span><input type="range" id="generate-length" min="12" max="64" value="24"></label><label class="checkbox-label"><input id="generate-symbols" type="checkbox" checked> Include symbols</label><label class="generator-output">Generated password<span class="input-action"><input id="generated" class="generated" type="password" readonly autocomplete="off"><button class="reveal" data-reveal="generated">Show</button></span></label><div class="actions"><button id="regenerate" class="secondary">Generate another</button><button id="copy-generated" class="primary">Copy password</button></div>';
  const generate=()=>{$('length-value').textContent=$('generate-length').value+' characters';$('generated').value=randomPassword($('generate-length').value,{symbols:$('generate-symbols').checked});};
  $('generate-length').addEventListener('input',generate);$('generate-symbols').addEventListener('change',generate);$('regenerate').addEventListener('click',generate);
  $('copy-generated').addEventListener('click',()=>act(async()=>{await native.invoke('copy',{text:$('generated').value});toast('Password copied. Clipboard clears in 20 seconds.');}));generate();
}
async function stageImport(data){
  if(stored.data&&!window.confirm('Importing replaces the vault on this device. An encrypted backup of the current vault will be kept. Continue?'))return;
  if(vault.unlocked){vault.lock();await native.invoke('unlocked',{value:false});await native.invoke('clearClipboard');}
  closeModal();pendingImport=data;$('entries').replaceChildren();showAuth();toast('Enter this vault’s master password to finish importing.');
}
async function importFile(){if(vault.unlocked)await lock();const r=await native.invoke('importFile');if(!r.cancelled)await stageImport(r);}
async function pullFromPC(){const r=await native.invoke('remotePull');await stageImport({data:r.data,name:'PC vault'});}
async function backupsDialog(){
  const backups=await native.invoke('backups'),body=modal('Backups & export');
  const note=document.createElement('p');note.className='callout';note.textContent='The previous vault is backed up before each save. The 10 newest encrypted backups are kept on this device.';body.append(note);
  if(vault.unlocked){const exportButton=document.createElement('button');exportButton.className='primary wide';exportButton.textContent='Export encrypted .kdbx vault';exportButton.addEventListener('click',()=>act(async()=>{const data=toBase64(vault.export());await lock();const result=await native.invoke('exportFile',{data});if(!result.cancelled)toast('Encrypted vault exported. Keep a copy on a separate device.');}));body.append(exportButton);}
  const p=document.createElement('p');p.className='modal-copy';p.style.marginTop='22px';p.textContent='Select a backup to restore it using its master password.';body.append(p);
  const list=document.createElement('div');list.className='backup-list';for(const backup of backups){const b=document.createElement('button');b.textContent=formatDate(backup.date);b.addEventListener('click',()=>act(async()=>{const r=await native.invoke('readBackup',{name:backup.name});await stageImport(r);}));list.append(b);}if(!backups.length){const none=document.createElement('p');none.className='hint';none.textContent='Backups appear after your next vault save.';list.append(none);}body.append(list);
}
async function syncDialog(){
  if(platform==='android'){
    const info=await native.invoke('syncInfo'),body=modal('Local sync');const p=document.createElement('p');p.className='modal-copy';p.textContent='Connect your phone and PC to the same Wi-Fi or hotspot. Unlock the PC vault and start local sync there.';body.append(p);
    if(info.peer){const status=document.createElement('div');status.className='callout';status.textContent=`Paired PC: ${info.peer.host}:${info.peer.port}. If its address or port changes, pair again.`;body.append(status);const syncButton=document.createElement('button');syncButton.className='primary wide';syncButton.textContent='Sync now';syncButton.addEventListener('click',()=>act(async()=>{
        const result=await native.invoke('sync',{data:toBase64(vault.export())});const conflicts=await vault.merge(fromBase64(result.data));closeModal();render();toast(result.conflicts||conflicts?'Sync complete. Different password versions were preserved. Review History.':'Both vaults synced. All changes are saved locally.');
      },'Syncing encrypted vault…'));body.append(syncButton);
      const forget=document.createElement('button');forget.className='text-button';forget.textContent='Forget this PC';forget.addEventListener('click',()=>act(async()=>{await native.invoke('forgetPeer');await syncDialog();toast('PC removed from this phone. Also remove the phone from the PC if needed.');}));body.append(forget);
    }const pairButton=document.createElement('button');pairButton.className='secondary wide';pairButton.style.marginTop='13px';pairButton.textContent=info.peer?'Pair again':'Pair with my PC';pairButton.addEventListener('click',pairDialog);body.append(pairButton);
  }else{
    const info=await native.invoke('syncInfo'),body=modal('Local sync');const intro=document.createElement('p');intro.className='modal-copy';intro.textContent='Keep this vault unlocked while your Android phone syncs. Sync works over your local Wi-Fi or hotspot, with no internet connection.';body.append(intro);
    const status=document.createElement('div');status.className='callout';status.textContent=info.running?`Local sync is listening on port ${info.port}. Allow Plain Vault through Windows Firewall on your private network.`:'Local sync is currently stopped.';body.append(status);
    const start=document.createElement('button');start.className='primary wide';start.textContent=info.running?'Stop local sync':'Start local sync';start.addEventListener('click',()=>act(async()=>{await native.invoke(info.running?'syncStop':'syncStart');await syncDialog();}));body.append(start);
    if(info.running){
      if(!info.addresses.length){const p=document.createElement('p');p.className='hint';p.textContent='Connect your PC to a private Wi-Fi or hotspot first.';body.append(p);}
      else{const label=document.createElement('label');label.textContent='PC network address';label.style.marginTop='22px';const select=document.createElement('select');select.id='sync-host';for(const a of info.addresses)select.append(new Option(`${a.address} · ${a.name}`,a.address));label.append(select);body.append(label);const pair=document.createElement('button');pair.className='secondary wide';pair.textContent='Show pairing QR code';pair.addEventListener('click',()=>act(()=>desktopPair(select.value),'Creating pairing code…'));body.append(pair);}
    }
    const h=document.createElement('h3');h.textContent='Paired phones';h.style.marginTop='24px';body.append(h);const list=document.createElement('div');list.className='peer-list';
    for(const peer of info.peers||[]){const row=document.createElement('div');row.className='peer';const name=document.createElement('span');name.textContent=peer.name;const forget=document.createElement('button');forget.className='secondary';forget.textContent='Remove';forget.addEventListener('click',()=>act(async()=>{await native.invoke('forgetPeer',{id:peer.id});await syncDialog();}));row.append(name,forget);list.append(row);}if(!(info.peers||[]).length){const p=document.createElement('p');p.className='hint';p.textContent='No paired phones yet.';list.append(p);}body.append(list);
  }
}
async function desktopPair(host){
  const pair=await native.invoke('pairingCode',{host}),dataURL=await QRCode.toDataURL(pair.code,{width:340,margin:2,errorCorrectionLevel:'M',color:{dark:'#15242d',light:'#ffffff'}}),body=modal('Pair your Android phone');
  const text=document.createElement('p');text.className='modal-copy';text.textContent='On your phone, open Local sync → Pair with my PC and scan this code. Keep this code private. It can be used once and expires within 5 minutes.';body.append(text);
  const image=document.createElement('img');image.className='qr';image.src=dataURL;image.alt='One-time local sync pairing QR code';body.append(image);
  const code=document.createElement('textarea');code.className='pair-code';code.readOnly=true;code.value=pair.code;code.setAttribute('aria-label','Pairing code');body.append(code);
  const copy=document.createElement('button');copy.className='secondary wide';copy.textContent='Copy pairing code';copy.addEventListener('click',()=>act(async()=>{await native.invoke('copy',{text:pair.code});toast('Pairing code copied. Keep it private.');}));body.append(copy);
}
function pairDialog(){
  const body=modal('Pair with your PC');body.innerHTML='<p class="modal-copy">On your PC, unlock Plain Vault, start Local sync and show its pairing QR code. Both devices must be on the same Wi-Fi.</p><button id="scan-qr" class="secondary wide">Scan PC pairing QR code</button><video id="scan-video" playsinline autoplay muted hidden></video><form id="pair-form"><label>Or paste the pairing code<textarea id="pair-input" class="pair-code" placeholder="pv1:…" autocomplete="off" spellcheck="false" required></textarea></label><p class="hint">Pairing verifies the PC’s certificate. Your master password is never sent.</p><div class="actions"><button class="primary">Pair devices</button></div></form>';
  $('scan-qr').addEventListener('click',async()=>{
    try{
      stopScan();if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera scanning is unavailable. Paste the pairing code instead.');
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:800},height:{ideal:800}}});
      const video=$('scan-video');if(!video){stream.getTracks().forEach(t=>t.stop());return;}video.hidden=false;video.srcObject=stream;await video.play();
      const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});let stopped=false,frame;
      scanStop=()=>{stopped=true;cancelAnimationFrame(frame);stream.getTracks().forEach(t=>t.stop());video.srcObject=null;video.hidden=true;};
      const scan=()=>{if(stopped)return;if(video.readyState>=2){canvas.width=Math.min(600,video.videoWidth);canvas.height=Math.round(video.videoHeight*canvas.width/video.videoWidth);context.drawImage(video,0,0,canvas.width,canvas.height);const pixels=context.getImageData(0,0,canvas.width,canvas.height),qr=jsQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:'dontInvert'});if(qr?.data?.startsWith('pv1:')){$('pair-input').value=qr.data;stopScan();toast('PC code scanned. Press Pair devices.');return;}}frame=requestAnimationFrame(scan);};frame=requestAnimationFrame(scan);
    }catch(e){toast(e.message||'Could not open the camera. Paste the code instead.',true);}
  });
  $('pair-form').addEventListener('submit',e=>{e.preventDefault();if(busy)return;const code=$('pair-input').value.trim();stopScan();act(async()=>{await native.invoke('pair',{code});closeModal();toast('Devices paired.');if(!stored.data){const result=await native.invoke('remotePull');await stageImport(result);}else if(vault.unlocked)await syncDialog();},'Verifying and pairing with PC…');});
}
on('add',()=>editor());on('empty-add',()=>editor());on('nav-generator',generator);on('nav-sync',syncDialog);on('nav-backups',backupsDialog);on('lock',lock);on('support',()=>native.invoke('support'));
on('nav-passwords',()=>{closeModal();render();});on('auth-import',importFile,'Opening file picker…');on('auth-pair',pairDialog);on('auth-pull',pullFromPC,'Getting encrypted PC vault…');on('auth-backups',backupsDialog);on('auth-cancel-import',()=>{pendingImport=null;showAuth();});
act(async()=>{const info=await native.invoke('info');platform=info.platform;stored=await native.invoke('readVault');showAuth();},'Opening Plain Vault…');
