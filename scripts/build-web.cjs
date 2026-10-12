const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const alias = { kdbxweb: path.resolve('node_modules/kdbxweb/lib/index.ts') };
const hardenKdbx={name:'verify-kdbx-terminator',setup(b){b.onLoad({filter:/hmac-block-transform\.ts$/},async(args)=>{
  const source=await fs.promises.readFile(args.path,'utf8');
  const needle='return Promise.resolve(ret.buffer);';
  if(!source.includes(needle))throw new Error('KDBX source changed: review the terminator hardening patch.');
  const replacement=`return getBlockHmac(key, blockIndex, 0, new ArrayBuffer(0)).then(calculated => {
    if (!arrayBufferEquals(calculated, blockHash) || stm.pos !== data.byteLength) {
      throw new KdbxError(ErrorCodes.FileCorrupt, 'invalid authenticated terminator');
    }
    return ret.buffer;
  });`;
  return {contents:source.replace(needle,replacement),loader:'ts'};
});}};
(async () => {
  fs.mkdirSync('web', { recursive: true }); fs.mkdirSync('build', { recursive: true });
  await esbuild.build({entryPoints:['src/app.js'],bundle:true,outfile:'web/app.js',platform:'browser',target:'chrome100',alias,
    define:{ global:'globalThis' },plugins:[hardenKdbx,{name:'browser-crypto',setup(b){b.onResolve({filter:/^crypto$/},()=>({path:'crypto',namespace:'empty'}));b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'module.exports = {}'}));}}],minify:true,legalComments:'eof'});
  await esbuild.build({entryPoints:['src/core.cjs'],bundle:true,outfile:'build/core.cjs',platform:'node',target:'node20',alias,plugins:[hardenKdbx]});
  for (const file of ['index.html','style.css','icon.svg','icon.png']) fs.copyFileSync('src/'+file,'web/'+file);
  console.log('Built shared Android and Windows vault engine.');
})().catch(e=>{console.error(e);process.exit(1)});
