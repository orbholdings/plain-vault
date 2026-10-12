'use strict';
// Rebuild on Windows, Linux or macOS. Electron ships an official Windows runtime.
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const version=require('../package.json').devDependencies.electron;
(async()=>{
  const cache=process.env.PLAIN_VAULT_BUILD_CACHE||path.join(root,'build','downloads');await fs.mkdir(cache,{recursive:true});
  const name=`electron-v${version}-win32-x64.zip`,file=path.join(cache,name),url=`https://github.com/electron/electron/releases/download/v${version}/`;
  const sumResponse=await fetch(url+'SHASUMS256.txt');if(!sumResponse.ok)throw new Error('Cannot fetch official Electron checksums.');
  const sums=await sumResponse.text(),expected=sums.split('\n').find(l=>l.trim().split(/\s+/).at(-1)?.replace(/^\*/,'')===name)?.split(/\s+/)[0];if(!expected)throw new Error('Electron checksum is missing.');
  try{await fs.access(file)}catch{const response=await fetch(url+name);if(!response.ok)throw new Error('Cannot download the Windows runtime.');await fs.writeFile(file,Buffer.from(await response.arrayBuffer()));}
  if(crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')!==expected)throw new Error('Windows runtime checksum mismatch.');
  const result=spawnSync(process.env.PLAIN_VAULT_PYTHON||'python3',[path.join(root,'scripts','package-windows.py'),file],{cwd:root,stdio:'inherit'});
  if(result.error)throw result.error;if(result.status)process.exit(result.status);
})().catch(e=>{console.error(e.message);process.exit(1)});
