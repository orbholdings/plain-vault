const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {Storage}=require('../desktop/storage.cjs');
function blob(n){const b=Buffer.alloc(40,n);b.writeUInt32LE(0x9aa2d903,0);b.writeUInt32LE(0xb54bfb67,4);return b.toString('base64');}
test('atomic storage rejects stale writes and rotates ten encrypted backups',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pv-storage-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const s=new Storage(dir);await s.init();let rev=null;
 for(let i=0;i<13;i++){const r=await s.write(blob(i),rev);rev=r.revision;}
 assert.equal((await s.backups()).length,10);assert.equal((await s.read()).data,blob(12));await assert.rejects(s.write(blob(13),'stale'),/changed/);
 const backups=await s.backups();assert.ok((await s.readBackup(backups[0].name)).data);await assert.rejects(s.readBackup('../vault.kdbx'),/Invalid/);
});
test('parallel local writes use revision checks, preserving the accepted edit',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pv-storage-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const s=new Storage(dir);await s.init();const first=await s.write(blob(0),null);
 const writes=await Promise.allSettled([s.write(blob(1),first.revision),s.write(blob(2),first.revision)]);assert.deepEqual(writes.map(x=>x.status),['fulfilled','rejected']);assert.equal((await s.read()).data,blob(1));
});
