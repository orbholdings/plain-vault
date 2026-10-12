'use strict';
const https=require('node:https');
const crypto=require('node:crypto');
const os=require('node:os');
const fs=require('node:fs/promises');
const path=require('node:path');
const selfsigned=require('selfsigned');
const {validate,MAX}=require('./storage.cjs');
const safeEqual=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
function privateAddress(address) {
  address=String(address||'').replace(/^::ffff:/,'');
  const m=/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if(!m)return false;const [a,b,c,d]=m.slice(1).map(Number);
  if([a,b,c,d].some(n=>n>255)||d===0||d===255)return false;
  return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||a===127;
}
function addresses() {
  try{return Object.entries(os.networkInterfaces()).flatMap(([name,list])=>(list||[]).filter(x=>x.family==='IPv4'&&!x.internal&&privateAddress(x.address)).map(x=>({name,address:x.address})));}catch{return [];}
}
function parsePairing(code) {
  if(typeof code!=='string'||!code.startsWith('pv1:')||code.length>2500)throw new Error('Invalid pairing code.');
  let p;try{p=JSON.parse(Buffer.from(code.slice(4),'base64url').toString('utf8'))}catch{throw new Error('Invalid pairing code.');}
  if(p.v!==1||!privateAddress(p.host)||p.host.startsWith('127.')||!Number.isInteger(p.port)||p.port<1024||p.port>65535||!/^[a-f0-9]{64}$/.test(p.fingerprint)||!/^[a-f0-9]{64}$/.test(p.token)||!Number.isFinite(p.expires)||p.expires<Date.now())throw new Error('Pairing code is invalid or expired.');
  return p;
}
class SyncServer {
  constructor(dir,exchange,options={}) {this.dir=dir;this.exchange=exchange;this.server=null;this.pairing=null;this.peers=[];this.seal=options.seal||((s)=>s);this.unseal=options.unseal||((s)=>s);this.clock=options.clock||Date.now;this.port=options.port??48521;this.addresses=options.addresses||addresses;}
  async load() {
    await fs.mkdir(this.dir,{recursive:true,mode:0o700});
    try {this.identity=JSON.parse(this.unseal(await fs.readFile(path.join(this.dir,'identity.dat'))));}
    catch(e) {
      if(e.code!=='ENOENT')throw new Error('Cannot unlock the local sync identity.');
      const cert=await selfsigned.generate([{name:'commonName',value:'Plain Vault local sync'}],{days:3650,keySize:2048,algorithm:'sha256'});
      this.identity={key:cert.private,cert:cert.cert};
      await fs.writeFile(path.join(this.dir,'identity.dat'),this.seal(JSON.stringify(this.identity)),{mode:0o600});
    }
    this.fingerprint=new crypto.X509Certificate(this.identity.cert).fingerprint256.replaceAll(':','').toLowerCase();
    try {this.peers=JSON.parse(this.unseal(await fs.readFile(path.join(this.dir,'peers.dat'))));}
    catch(e){if(e.code!=='ENOENT')throw new Error('Cannot unlock paired devices.');}
  }
  async savePeers(){await fs.writeFile(path.join(this.dir,'peers.dat'),this.seal(JSON.stringify(this.peers)),{mode:0o600});}
  async start() {
    if(this.server)return this.info();
    if(!this.identity)await this.load();
    this.server=https.createServer({...this.identity,minVersion:'TLSv1.2'},(req,res)=>this.handle(req,res));
    this.server.requestTimeout=25000;this.server.headersTimeout=10000;this.server.maxConnections=8;
    await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(this.port,'0.0.0.0',resolve);});
    return this.info();
  }
  info(){return{running:!!this.server,port:this.server?.address()?.port,fingerprint:this.fingerprint,addresses:this.addresses(),peers:this.peers.map(p=>({id:p.id,name:p.name}))};}
  async pairingCode(host) {
    await this.start();if(!this.addresses().some(a=>a.address===host))throw new Error('Choose a local network address.');
    this.pairing={token:crypto.randomBytes(32).toString('hex'),expires:this.clock()+5*60*1000};
    return {code:'pv1:'+Buffer.from(JSON.stringify({v:1,host,port:this.server.address().port,fingerprint:this.fingerprint,...this.pairing})).toString('base64url'),expires:this.pairing.expires};
  }
  async forget(id){this.peers=this.peers.filter(p=>p.id!==id);await this.savePeers();return this.info();}
  async stop(){this.pairing=null;const s=this.server;this.server=null;if(s){s.closeAllConnections();await new Promise(r=>s.close(r));}return {running:false};}
  async handle(req,res) {
    const send=(status,data)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try {
      if(!privateAddress(req.socket.remoteAddress))return send(403,{error:'Local network only.'});
      if(req.method!=='POST'||!['/pair','/sync','/pull'].includes(req.url))return send(404,{error:'Unknown request.'});
      const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
      if(req.url==='/pair') {
        if(!this.pairing||this.pairing.expires<this.clock()||!safeEqual(token,this.pairing.token))return send(401,{error:'Pairing code expired or already used.'});
        // Consume before reading the body so simultaneous requests cannot reuse this token.
        this.pairing=null;
      } else if(!this.peers.some(p=>safeEqual(p.token,token)))return send(401,{error:'Device is not paired.'});
      const limit=req.url==='/pair'?4096:Math.ceil(MAX*4/3)+4096;
      let bytes=0;const chunks=[];
      for await(const chunk of req){bytes+=chunk.length;if(bytes>limit)return send(413,{error:'Vault is too large.'});chunks.push(chunk);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,{error:'Invalid request.'});}
      if(req.url==='/pair') {
        if(this.peers.length>=12)return send(409,{error:'Remove a paired device before adding another.'});
        const peer={id:crypto.randomUUID(),name:String(body.name||'Android phone').replace(/[\x00-\x1f]/g,'').slice(0,60),token:crypto.randomBytes(32).toString('hex')};
        this.peers.push(peer);await this.savePeers();return send(200,{id:peer.id,token:peer.token});
      }
      if(req.url==='/pull')return send(200,await this.exchange(null));
      if(typeof body.data!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.data))return send(400,{error:'Invalid vault data.'});
      const data=Buffer.from(body.data,'base64');validate(data);
      const result=await this.exchange(body.data);return send(200,result);
    } catch(e) {send(e.status||400,{error:e.message||'Sync failed.'});}
  }
}
module.exports={SyncServer,privateAddress,parsePairing,addresses,safeEqual};
