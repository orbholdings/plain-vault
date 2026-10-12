'use strict';
// Real bundled UI and crypto, with native operations bridged to real test storage/TLS.
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {pathToFileURL}=require('node:url');const https=require('node:https');const crypto=require('node:crypto');
const {Storage}=require('../desktop/storage.cjs');const {SyncServer,parsePairing}=require('../desktop/sync-server.cjs');const {Vault}=require('../build/core.cjs');
const password='UI test-only correct horse battery staple';
const errors=[];let server,browser,dir;
async function request(endpoint,token,body){return new Promise((resolve,reject)=>{const json=JSON.stringify(body);const r=https.request({host:'127.0.0.1',port:server.info().port,path:endpoint,method:'POST',ca:server.identity.cert,checkServerIdentity:(_host,cert)=>crypto.createHash('sha256').update(cert.raw).digest('hex')===server.fingerprint?undefined:new Error('Certificate pin mismatch'),headers:{authorization:'Bearer '+token,'content-type':'application/json','content-length':Buffer.byteLength(json)}},res=>{let data='';res.on('data',b=>data+=b);res.on('end',()=>{const p=JSON.parse(data);res.statusCode===200?resolve(p):reject(new Error(p.error));});});r.on('error',reject);r.end(json);});}
async function ready(page){await page.locator('#working').waitFor({state:'hidden',timeout:35000});}
async function click(page,selector){await ready(page);await page.locator(selector).click();await ready(page);}
async function attach(page,platform,store){
 let peer=null,unlocked=false;const pending=new Map();let clipboard='';let exported=null;
 const backend=async(op,args={})=>{
  switch(op){
   case'info':return{platform,version:'0.1.0'};
   case'readVault':return store.read();
   case'writeVault':return store.write(args.data,args.expectedRevision??null);
   case'backups':return store.backups();case'readBackup':return store.readBackup(args.name);
   case'copy':clipboard=args.text;return{};case'clearClipboard':clipboard='';return{};
   case'exportFile':exported=args.data;return{saved:true};case'importFile':return{cancelled:true};
   case'unlocked':unlocked=args.value;if(platform==='windows'&&!unlocked)await server.stop();return{};
   case'syncInfo':return platform==='windows'?server.info():{peer:peer?{host:peer.host,port:peer.port}:null};
   case'syncStart':return server.start();case'syncStop':return server.stop();case'pairingCode':return server.pairingCode(args.host);case'forgetPeer':return platform==='windows'?server.forget(args.id):(peer=null,{});
   case'pair':{const code=parsePairing(args.code);const result=await request('/pair',code.token,{name:'UI test phone'});peer={...code,...result};return{peer:{host:peer.host,port:peer.port}};}
   case'remotePull':return request('/pull',peer.token,{});case'sync':return request('/sync',peer.token,args);
   case'syncResponse':{const p=pending.get(args.id);if(p){pending.delete(args.id);clearTimeout(p.timer);args.error?p.reject(new Error(args.error)):p.resolve({data:args.data,conflicts:args.conflicts});}return{};}
   case'support':return{};default:throw new Error('Unknown test operation '+op);
  }
 };
 await page.exposeFunction('testNativeInvoke',backend);
 await page.addInitScript(()=>{window.PlainVaultPlatform={invoke:(op,args)=>window.testNativeInvoke(op,args),onSync:fn=>window.addEventListener('test-sync',e=>fn(e.detail)),onLock:fn=>window.addEventListener('plainvault-lock',fn)};});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 if(platform==='windows')server=new SyncServer(path.join(dir,'server'),data=>{
   if(!unlocked)throw new Error('PC vault locked');return new Promise((resolve,reject)=>{const id=crypto.randomUUID();const timer=setTimeout(()=>{pending.delete(id);reject(new Error('UI sync timed out'));},25000);pending.set(id,{resolve,reject,timer});page.evaluate(p=>window.dispatchEvent(new CustomEvent('test-sync',{detail:p})),{id,data}).catch(reject);});
 },{port:0,addresses:()=>[{name:'Test Wi-Fi',address:'192.168.1.10'}]});
 await page.goto(pathToFileURL(path.join(__dirname,'../web/index.html')).href);await ready(page);
 return{get clipboard(){return clipboard},get exported(){return exported}};
}
async function add(page,title,secret){await click(page,'#add');await page.fill('#entry-title',title);await page.fill('#entry-username','user@example.invalid');await page.fill('#entry-password',secret);await page.fill('#entry-category','Personal');await page.fill('#entry-notes','Private test note');await page.locator('#entry-form button.primary').click();await ready(page);}
(async()=>{
 dir=await fs.mkdtemp(path.join(os.tmpdir(),'pv-ui-'));await fs.mkdir(path.join(__dirname,'../build/ui'),{recursive:true});
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.PLAIN_VAULT_TEST_CHROME?{executablePath:process.env.PLAIN_VAULT_TEST_CHROME}:{})});
 const desktop=await browser.newPage({viewport:{width:1120,height:800}}),phone=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});
 const desktopStore=new Storage(path.join(dir,'desktop')),phoneStore=new Storage(path.join(dir,'phone'));await desktopStore.init();await phoneStore.init();
 const desktopBackend=await attach(desktop,'windows',desktopStore);await desktop.screenshot({path:path.join(__dirname,'../build/ui/windows-create.png'),fullPage:true});
 await desktop.fill('#vault-name','Everyday vault');await desktop.fill('#master',password);await desktop.fill('#master-confirm',password);await click(desktop,'#auth-submit');assert.equal(await desktop.locator('#workspace').isVisible(),true);
 await add(desktop,'Email','UI-test-secret-123');await add(desktop,'Farm account','UI-test-farm-456');assert.equal(await desktop.locator('.entry').count(),2);
 await desktop.screenshot({path:path.join(__dirname,'../build/ui/windows-vault.png'),fullPage:true});
 await desktop.fill('#search','farm');assert.equal(await desktop.locator('.entry').count(),1);await desktop.fill('#search','');
 await desktop.locator('.entry').filter({hasText:'Email'}).click();await desktop.locator('#modal-content button').filter({hasText:/^Copy$/}).last().click();await ready(desktop);assert.equal(desktopBackend.clipboard,'UI-test-secret-123');await click(desktop,'#modal-close');
 await click(desktop,'#nav-generator');await desktop.locator('[data-reveal="generated"]').click();assert.equal((await desktop.inputValue('#generated')).length,24);await click(desktop,'#modal-close');
 await click(desktop,'#nav-backups');await desktop.locator('#modal-content button.primary').click();await ready(desktop);assert.ok(desktopBackend.exported);assert.equal(await desktop.locator('#workspace').isVisible(),false);await desktop.fill('#master',password);await click(desktop,'#auth-submit');
 await click(desktop,'#nav-sync');await desktop.locator('#modal-content button.primary').click();await ready(desktop);await desktop.locator('#modal-content button.secondary').filter({hasText:'Show pairing QR code'}).click();await ready(desktop);
 const code=await desktop.locator('.pair-code').inputValue();assert.ok(code.startsWith('pv1:'));assert.equal(await desktop.locator('.qr').isVisible(),true);await desktop.screenshot({path:path.join(__dirname,'../build/ui/windows-pairing.png'),fullPage:true});
 await attach(phone,'android',phoneStore);await phone.screenshot({path:path.join(__dirname,'../build/ui/android-create.png'),fullPage:true});
 await click(phone,'#auth-pair');await phone.fill('#pair-input',code);await phone.locator('#pair-form button.primary').click();await ready(phone);assert.equal(await phone.locator('#auth-submit').textContent(),'Unlock & import vault');
 await phone.fill('#master',password);await click(phone,'#auth-submit');assert.equal(await phone.locator('.entry').count(),2);
 await add(phone,'Phone-only login','UI-test-phone-789');await click(desktop,'#modal-close');await add(desktop,'PC-only login','UI-test-pc-012');
 await click(phone,'#nav-sync');await phone.locator('#modal-content button.primary').click();await ready(phone);await ready(desktop);assert.equal(await phone.locator('.entry').count(),4);assert.equal(await desktop.locator('.entry').count(),4);
 await phone.screenshot({path:path.join(__dirname,'../build/ui/android-vault.png'),fullPage:true});
 assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await phone.locator('.entry').filter({hasText:'Email'}).click();await phone.locator('#modal-content button.primary').filter({hasText:/^Edit$/}).click();await phone.fill('#entry-password','UI-new-phone-password');await phone.locator('#entry-form button.primary').click();await ready(phone);
 await phone.locator('.entry').filter({hasText:'Email'}).click();await phone.locator('#modal-content button.secondary').filter({hasText:/^History/}).click();assert.ok(await phone.locator('.version-list button').count());await click(phone,'#modal-close');
 await click(phone,'#lock');assert.equal(await phone.locator('#workspace').isVisible(),false);assert.equal(await phone.locator('.entry').count(),0);
 await phone.fill('#master','wrong password');await click(phone,'#auth-submit');assert.equal(await phone.locator('#workspace').isVisible(),false);assert.match(await phone.locator('#toast').textContent(),/password/i);
 await phone.fill('#master',password);await click(phone,'#auth-submit');assert.equal(await phone.locator('.entry').count(),4);
 // Cross-engine proof that the UI wrote the edited secret, without persisting plaintext.
 const verifier=new Vault(async()=>({}));await verifier.open(Uint8Array.from(Buffer.from((await phoneStore.read()).data,'base64')),password);const id=verifier.list().find(e=>e.title==='Email').id;assert.equal(verifier.details(id).password,'UI-new-phone-password');
 assert.deepEqual(errors,[]);console.log('UI smoke passed: desktop/mobile create, edit, search, generator, export, QR pairing, initial vault transfer, real TLS sync, history, lock and wrong-password handling.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(server)await server.stop();if(browser)await browser.close();if(dir)await fs.rm(dir,{recursive:true,force:true});});
