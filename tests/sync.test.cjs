const test=require('node:test');const assert=require('node:assert/strict');const https=require('node:https');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const crypto=require('node:crypto');const util=require('node:util');const execFile=util.promisify(require('node:child_process').execFile);
const {SyncServer,privateAddress,parsePairing,addresses}=require('../desktop/sync-server.cjs');
const testAddresses=()=>[{name:'Test network',address:'192.168.0.2'}];
function blob(){const b=Buffer.alloc(40);b.writeUInt32LE(0x9aa2d903,0);b.writeUInt32LE(0xb54bfb67,4);return b.toString('base64');}
async function req(server,endpoint,token,data){return new Promise((resolve,reject)=>{const body=JSON.stringify(data);const r=https.request({host:'127.0.0.1',port:server.info().port,path:endpoint,method:'POST',ca:server.identity.cert,checkServerIdentity:(_host,cert)=>crypto.createHash('sha256').update(cert.raw).digest('hex')===server.fingerprint?undefined:new Error('Wrong certificate'),headers:{authorization:'Bearer '+token,'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{let out='';res.on('data',x=>out+=x);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(out)}));});r.on('error',reject);r.end(body);});}
test('local sync pairing is single-use, authenticated, revocable and certificate-verified',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pv-sync-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let received=null;
 const server=new SyncServer(dir,async data=>{received=data;return {data:data||blob(),conflicts:0};},{port:0,addresses:testAddresses});t.after(()=>server.stop());await server.start();
 const pair=await server.pairingCode(testAddresses()[0].address),code=parsePairing(pair.code);const p=await req(server,'/pair',code.token,{name:'Test phone'});assert.equal(p.status,200);
 assert.equal((await req(server,'/pair',code.token,{name:'Reuse'})).status,401);
 assert.equal((await req(server,'/sync','0'.repeat(64),{data:blob()})).status,401);
 const r=await req(server,'/sync',p.body.token,{data:blob()});assert.equal(r.status,200);assert.equal(received,blob());assert.equal((await req(server,'/pull',p.body.token,{})).status,200);
 await server.forget(p.body.id);assert.equal((await req(server,'/sync',p.body.token,{data:blob()})).status,401);
 const second=await server.pairingCode(testAddresses()[0].address);server.pairing.expires=Date.now()-1;assert.equal((await req(server,'/pair',parsePairing(second.code).token,{name:'Expired'})).status,401);
});
test('public destinations, malformed pairing codes and expired codes are rejected',()=>{
 for(const p of ['8.8.8.8','172.32.0.5','192.168.1.256','localhost','::1','10.0.0.1.attacker.invalid'])assert.equal(privateAddress(p),false);
 for(const p of ['10.0.0.5','172.16.0.8','192.168.1.7'])assert.equal(privateAddress(p),true);
 assert.throws(()=>parsePairing('https://example.invalid'));assert.throws(()=>parsePairing('pv1:broken'));
 const make=p=>'pv1:'+Buffer.from(JSON.stringify({v:1,host:'192.168.1.8',port:48521,fingerprint:'f'.repeat(64),token:'a'.repeat(64),expires:Date.now()+10000,...p})).toString('base64url');
 assert.throws(()=>parsePairing(make({host:'8.8.8.8'})));assert.throws(()=>parsePairing(make({expires:1})));assert.throws(()=>parsePairing(make({port:22})));
});
test('Android Java transport connects to Windows TLS server and rejects a changed certificate',async t=>{
 const classes=path.join(__dirname,'../build/java-tests');await fs.access(path.join(classes,'com/plainapps/vault/LocalSyncHarness.class'));
 const host='127.0.0.1';const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pv-java-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const server=new SyncServer(dir,async data=>({data:data||blob(),conflicts:0}),{port:0,addresses:testAddresses});t.after(()=>server.stop());await server.start();
 const pair=await server.pairingCode(testAddresses()[0].address),code=parsePairing(pair.code);
 const invoke=(fp,token,endpoint,body)=>execFile('java',['-cp',classes,'com.plainapps.vault.LocalSyncHarness',host,String(server.info().port),fp,token,endpoint,JSON.stringify(body)],{timeout:30000});
 const result=await invoke(code.fingerprint,code.token,'/pair',{name:'Native Java phone'});const peer=JSON.parse(result.stdout.trim());assert.match(peer.token,/^[a-f0-9]{64}$/);
 const synced=JSON.parse((await invoke(code.fingerprint,peer.token,'/sync',{data:blob()})).stdout.trim());assert.equal(synced.data,blob());
 await assert.rejects(invoke('0'.repeat(64),peer.token,'/sync',{data:blob()}));
 assert.match((await execFile('java',['-cp',classes,'com.plainapps.vault.LocalSyncHarness','addresses'])).stdout,/passed/);
});
