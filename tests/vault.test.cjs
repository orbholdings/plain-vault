'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
const {Vault,randomPassword,fromBase64,toBase64,kdbx}=require('../build/core.cjs');
const password='test-only correct horse battery staple';
const memory=()=>new Vault(async()=>({revision:crypto.randomUUID()}));
const entry=(title,secret)=>({title,username:'test-user',password:secret,url:'https://example.invalid',notes:'private test note',category:'Tests'});

test('KDBX encryption round-trip, wrong-password rejection and ciphertext tampering',async()=>{
 const a=memory();await a.create(password,'Test vault');await a.upsert(entry('Round trip','test-secret-8675309'));
 const blob=a.export();assert.equal(Buffer.from(blob).includes(Buffer.from('test-secret-8675309')),false);
 assert.equal(a.db.header.versionMajor,4);assert.equal(a.db.header.kdfParameters.get('$UUID').byteLength,16);
 assert.equal(kdbx.ByteUtils.bytesToBase64(a.db.header.kdfParameters.get('$UUID')),kdbx.Consts.KdfId.Argon2id);
 assert.equal(a.db.header.kdfParameters.get('M').value,64*1024*1024);
 const b=memory();await b.open(blob,password);assert.equal(b.details(b.list()[0].id).password,'test-secret-8675309');
 await assert.rejects(memory().open(blob,'incorrect master password'));
 const corrupt=blob.slice();corrupt[corrupt.length-12]^=1;await assert.rejects(memory().open(corrupt,password));
 const corruptBody=blob.slice();corruptBody[corruptBody.length-80]^=1;await assert.rejects(memory().open(corruptBody,password));
 const appended=new Uint8Array(blob.length+1);appended.set(blob);await assert.rejects(memory().open(appended,password));
 assert.deepEqual(fromBase64(toBase64(blob)),blob);
 await fs.mkdir(path.join(__dirname,'../build/fixtures'),{recursive:true});await fs.writeFile(path.join(__dirname,'../build/fixtures/interop.kdbx'),blob);
});
test('independent offline edits merge in both directions without losing entries',async()=>{
 const pc=memory();await pc.create(password);const phone=memory();await phone.open(pc.export(),password);
 await pc.upsert(entry('PC entry','pc-secret'));await phone.upsert(entry('Phone entry','phone-secret'));
 assert.equal(await pc.merge(phone.export()),0);await phone.merge(pc.export());
 assert.deepEqual(pc.list().map(x=>x.title).sort(),['PC entry','Phone entry']);assert.deepEqual(phone.list().map(x=>x.title).sort(),['PC entry','Phone entry']);
});
test('same-entry simultaneous edits preserve both passwords, even with equal timestamps',async()=>{
 const pc=memory();await pc.create(password);const id=await pc.upsert(entry('Shared login','original'));
 const phone=memory();await phone.open(pc.export(),password);await pc.upsert(entry('Shared login','PC-changed'),id);await phone.upsert(entry('Shared login','Phone-changed'),id);
 phone.find(id).times.lastModTime=new Date(pc.find(id).times.lastModTime.getTime());await phone.save();
 assert.equal(await pc.merge(phone.export()),1);await phone.merge(pc.export());
 assert.equal(pc.details(id).password,phone.details(id).password);
 for(const v of [pc,phone]){
  const values=[v.details(id).password,...v.history(id).map(h=>v.details(id,h.index).password)];
  assert.ok(values.includes('PC-changed'));assert.ok(values.includes('Phone-changed'));assert.ok(values.includes('original'));
 }
 const target=pc.history(id).find(h=>pc.details(id,h.index).password==='PC-changed');await pc.restore(id,target.index);assert.equal(pc.details(id).password,'PC-changed');
});
test('sync refuses a different vault and an interrupted response is safe to retry',async()=>{
 const pc=memory();await pc.create(password);const phone=memory();await phone.open(pc.export(),password);await phone.upsert(entry('Offline change','saved offline'));
 await pc.merge(phone.export()); // Response is lost here.
 await pc.merge(phone.export());await phone.merge(pc.export());assert.equal(phone.list().length,1);assert.equal(pc.list().length,1);
 const different=memory();await different.create(password);await assert.rejects(pc.merge(different.export()),/different vaults/);
});
test('failed persistence rolls back a password edit',async()=>{
 let fail=false;const v=new Vault(async()=>{if(fail)throw new Error('Disk full');return {revision:crypto.randomUUID()};});await v.create(password);const id=await v.upsert(entry('Disk test','before'));
 fail=true;await assert.rejects(v.upsert(entry('Disk test','after'),id),/Disk full/);assert.equal(v.details(id).password,'before');
});
test('delete persists in encrypted recycle bin and sync does not resurrect it',async()=>{
 const pc=memory();await pc.create(password);const id=await pc.upsert(entry('Deleted','secret'));const phone=memory();await phone.open(pc.export(),password);await pc.remove(id);await phone.merge(pc.export());assert.equal(phone.list().length,0);
 await pc.merge(phone.export());assert.equal(pc.list().length,0);const reopened=memory();await reopened.open(pc.export(),password);assert.equal(reopened.list().length,0);
});
test('locking clears protected password buffers and disables access',async()=>{
 const v=memory();await v.create(password);const id=await v.upsert(entry('Lock test','secret'));const protectedValue=v.find(id).fields.get('Password');v.lock();assert.equal(v.unlocked,false);assert.throws(()=>v.details(id));assert.ok(protectedValue.value.every(x=>x===0));assert.ok(protectedValue.salt.every(x=>x===0));
});
test('generator produces the requested length, all enabled character classes, and distinct results',()=>{
 const values=new Set();for(let i=0;i<100;i++){const p=randomPassword(24);assert.equal(p.length,24);assert.match(p,/[a-z]/);assert.match(p,/[A-Z]/);assert.match(p,/[0-9]/);assert.match(p,/[^a-zA-Z0-9]/);values.add(p);}assert.equal(values.size,100);assert.match(randomPassword(32,{symbols:false}),/^[a-zA-Z0-9]{32}$/);
});
