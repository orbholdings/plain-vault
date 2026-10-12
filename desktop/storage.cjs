'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX = 16 * 1024 * 1024;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const validate = bytes => {
  if (!Buffer.isBuffer(bytes) || bytes.length < 32 || bytes.length > MAX || bytes.readUInt32LE(0) !== 0x9aa2d903 || bytes.readUInt32LE(4) !== 0xb54bfb67)
    throw new Error('Invalid or oversized encrypted vault.');
};
class Storage {
  constructor(directory) { this.dir = directory; this.file = path.join(directory,'vault.kdbx'); this.queue = Promise.resolve(); }
  async init() { await fs.mkdir(path.join(this.dir,'backups'),{recursive:true,mode:0o700}); }
  async read() {
    try { const bytes = await fs.readFile(this.file); return { data: bytes.toString('base64'), revision: digest(bytes) }; }
    catch (e) { if (e.code==='ENOENT') return {data:null,revision:null}; throw e; }
  }
  write(data, expectedRevision) {
    const action = this.queue.then(async()=>{
      const bytes=Buffer.from(data,'base64'); validate(bytes);
      const old=await this.read();
      if (old.revision!==expectedRevision) throw new Error('The vault changed while saving. Lock and unlock it, then try again.');
      if (old.data) {
        const backup=path.join(this.dir,'backups',`vault-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.kdbx`);
        await fs.writeFile(backup,Buffer.from(old.data,'base64'),{mode:0o600,flag:'wx'});
      }
      const temp=this.file+'.tmp';
      const fd=await fs.open(temp,'w',0o600);
      try {await fd.writeFile(bytes);await fd.sync();} finally {await fd.close();}
      await fs.rename(temp,this.file);
      const backups=(await fs.readdir(path.join(this.dir,'backups'))).filter(f=>/^vault-[0-9]+-[a-f0-9]+\.kdbx$/.test(f)).sort().reverse();
      for(const f of backups.slice(10))await fs.unlink(path.join(this.dir,'backups',f)).catch(()=>{});
      return {revision:digest(bytes)};
    });
    this.queue=action.catch(()=>{});return action;
  }
  async backups() {
    const files=(await fs.readdir(path.join(this.dir,'backups'))).filter(f=>/^vault-[0-9]+-[a-f0-9]+\.kdbx$/.test(f)).sort().reverse();
    return files.map(name=>({name,date:new Date(Number(name.split('-')[1])).toISOString()}));
  }
  async readBackup(name) {
    if(!/^vault-[0-9]+-[a-f0-9]+\.kdbx$/.test(name))throw new Error('Invalid backup name.');
    return {data:(await fs.readFile(path.join(this.dir,'backups',name))).toString('base64')};
  }
}
module.exports={Storage,validate,digest,MAX};
