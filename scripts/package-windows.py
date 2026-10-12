#!/usr/bin/env python3
import pathlib,sys,zipfile,shutil,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1]
runtime=pathlib.Path(sys.argv[1]);dest=ROOT/'build'/'windows'/'Plain-Vault'
if dest.exists():shutil.rmtree(dest)
dest.mkdir(parents=True)
with zipfile.ZipFile(runtime) as z:z.extractall(dest)
(dest/'electron.exe').rename(dest/'Plain-Vault.exe')
for name in ['default_app.asar']:
 f=dest/'resources'/name
 if f.exists():f.unlink()
app=dest/'resources'/'app';app.mkdir(parents=True)
for folder in ['desktop','web']:shutil.copytree(ROOT/folder,app/folder)
shutil.copyfile(ROOT/'package.json',app/'package.json');shutil.copyfile(ROOT/'package-lock.json',app/'package-lock.json')
# Include only production runtime dependencies in a clean staging directory.
subprocess.run(['npm','ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],cwd=app,check=True)
for filename in ['QUICK-START.txt','PRIVACY-AND-SECURITY.md','THIRD-PARTY-NOTICES.txt']:
 shutil.copyfile(ROOT/filename,dest/filename)
out=ROOT/'dist'/'Plain-Vault-0.1.0-Windows-x64.zip';out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for f in sorted(dest.rglob('*')):
  if f.is_file():z.write(f,f.relative_to(dest.parent))
print('Windows portable package ready:',out,'bytes:',out.stat().st_size)
