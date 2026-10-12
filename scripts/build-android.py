#!/usr/bin/env python3
"""Build an APK from the bundled web UI and a dependency-free native bridge.
Requires Android SDK build tools 35+, android.jar and a JDK or Eclipse ECJ jar.
The signing key is deliberately outside the source tree.
"""
import argparse, os, pathlib, shutil, subprocess, zipfile

ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser()
p.add_argument('--build-tools',required=True,type=pathlib.Path)
p.add_argument('--android-jar',required=True,type=pathlib.Path)
p.add_argument('--ecj',type=pathlib.Path)
p.add_argument('--keystore',required=True,type=pathlib.Path)
p.add_argument('--alias',default='plainvault')
p.add_argument('--output',type=pathlib.Path,default=ROOT/'dist'/'Plain-Vault-0.1.0-Android.apk')
a=p.parse_args()

def run(args):
    print('Running',pathlib.Path(str(args[0])).name,flush=True)
    subprocess.run([str(x) for x in args],check=True,cwd=ROOT)

b=ROOT/'build'/'android'
if b.exists():shutil.rmtree(b)
b.mkdir(parents=True);(b/'classes').mkdir();(b/'dex').mkdir();(b/'assets'/'web').mkdir(parents=True)
for f in ['index.html','app.js','style.css','icon.svg']:shutil.copyfile(ROOT/'web'/f,b/'assets'/'web'/f)
run([a.build_tools/'aapt2','compile','--dir',ROOT/'android'/'res','-o',b/'res.zip'])
run([a.build_tools/'aapt2','link','-o',b/'resources.apk','-I',a.android_jar,'--manifest',ROOT/'android'/'AndroidManifest.xml','-A',b/'assets','--auto-add-overlay',b/'res.zip'])
sources=list((ROOT/'android'/'src').rglob('*.java'))
if a.ecj:
    run(['java','-jar',a.ecj,'-1.8','-encoding','UTF-8','-classpath',a.android_jar,'-d',b/'classes',*sources])
else:
    run(['javac','-source','8','-target','8','-encoding','UTF-8','-bootclasspath',a.android_jar,'-d',b/'classes',*sources])
classes=list((b/'classes').rglob('*.class'))
run(['java','-cp',a.build_tools/'lib'/'d8.jar','com.android.tools.r8.D8','--release','--min-api','28','--lib',a.android_jar,'--output',b/'dex',*classes])
shutil.copyfile(b/'resources.apk',b/'unsigned.apk')
with zipfile.ZipFile(b/'unsigned.apk','a',compression=zipfile.ZIP_DEFLATED) as z:
    for f in (b/'dex').glob('*.dex'):z.write(f,f.name)
run([a.build_tools/'zipalign','-P','16','-f','4',b/'unsigned.apk',b/'aligned.apk'])
if not os.environ.get('PLAIN_VAULT_SIGNING_PASSWORD'):raise SystemExit('Set PLAIN_VAULT_SIGNING_PASSWORD securely before signing.')
a.output.parent.mkdir(parents=True,exist_ok=True)
run(['java','-jar',a.build_tools/'lib'/'apksigner.jar','sign','--ks',a.keystore,'--ks-key-alias',a.alias,'--ks-pass','env:PLAIN_VAULT_SIGNING_PASSWORD','--key-pass','env:PLAIN_VAULT_SIGNING_PASSWORD','--out',a.output,b/'aligned.apk'])
run(['java','-jar',a.build_tools/'lib'/'apksigner.jar','verify','--verbose',a.output])
print('APK ready:',a.output,'bytes:',a.output.stat().st_size,flush=True)
