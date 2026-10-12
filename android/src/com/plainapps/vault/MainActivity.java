package com.plainapps.vault;

import android.app.Activity;
import android.app.AlertDialog;
import android.Manifest;
import android.content.Intent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PersistableBundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.WindowManager;
import android.view.View;
import android.widget.FrameLayout;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Comparator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final int MAX=16*1024*1024;
    private static final String ORIGIN="https://appassets.androidplatform.net/";
    private WebView web;
    private final Handler ui=new Handler(Looper.getMainLooper());
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private File directory;
    private String fileRequest=null;
    private byte[] exportBytes=null;
    private PermissionRequest cameraRequest;
    private String clipboardText="";
    private Runnable clipboardClear;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        getWindow().setStatusBarColor(0xff101b24);getWindow().setNavigationBarColor(0xff101b24);
        directory=getNoBackupFilesDir();new File(directory,"backups").mkdirs();
        web=new WebView(this);web.setBackgroundColor(0xff101b24);web.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(false);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setBlockNetworkLoads(true);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setSafeBrowsingEnabled(false);s.setSaveFormData(false);s.setMediaPlaybackRequiresUserGesture(true);
        web.addJavascriptInterface(new Bridge(),"PlainVaultNative");
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return true;}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                String url=request.getUrl().toString();
                try {
                    if(!url.startsWith(ORIGIN))return new WebResourceResponse("text/plain","utf-8",new ByteArrayInputStream(new byte[0]));
                    String name=url.substring(ORIGIN.length());
                    if(!Arrays.asList("index.html","app.js","style.css","icon.svg").contains(name))return new WebResourceResponse("text/plain","utf-8",new ByteArrayInputStream(new byte[0]));
                    String mime=name.endsWith(".js")?"application/javascript":name.endsWith(".css")?"text/css":name.endsWith(".svg")?"image/svg+xml":"text/html";
                    return new WebResourceResponse(mime,"utf-8",getAssets().open("web/"+name));
                }catch(Exception e){return new WebResourceResponse("text/plain","utf-8",new ByteArrayInputStream(new byte[0]));}
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onJsConfirm(WebView view,String url,String message,JsResult result){new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("Continue",(d,w)->result.confirm()).setNegativeButton("Cancel",(d,w)->result.cancel()).setOnCancelListener(d->result.cancel()).show();return true;}
            @Override public void onPermissionRequest(final PermissionRequest request){ui.post(()->{
                if(!request.getOrigin().toString().equals(ORIGIN.substring(0,ORIGIN.length()-1))&&!request.getOrigin().toString().equals(ORIGIN)){request.deny();return;}
                for(String resource:request.getResources())if(!resource.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE)){request.deny();return;}
                if(checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                else {if(cameraRequest!=null)cameraRequest.deny();cameraRequest=request;requestPermissions(new String[]{Manifest.permission.CAMERA},200);}
            });}
            @Override public void onPermissionRequestCanceled(PermissionRequest r){if(cameraRequest==r)cameraRequest=null;}
        });
        FrameLayout root=new FrameLayout(this);root.setOnApplyWindowInsetsListener((v,insets)->{v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets.consumeSystemWindowInsets();});root.addView(web,new FrameLayout.LayoutParams(-1,-1));setContentView(root);web.loadUrl(ORIGIN+"index.html");
    }
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] grants){super.onRequestPermissionsResult(code,permissions,grants);if(code==200&&cameraRequest!=null){if(grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED)cameraRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});else cameraRequest.deny();cameraRequest=null;}}
    @Override protected void onPause(){super.onPause();clearClipboard();if(web!=null&&fileRequest==null)web.evaluateJavascript("window.dispatchEvent(new Event('plainvault-lock'))",null);}
    @Override protected void onDestroy(){clearClipboard();worker.shutdownNow();if(web!=null){web.removeJavascriptInterface("PlainVaultNative");web.destroy();}super.onDestroy();}
    private void reply(String id,Object data,String error){ui.post(()->{if(web==null||isFinishing())return;try{JSONObject p=new JSONObject();p.put("id",id);if(error!=null)p.put("error",error);else p.put("data",data);web.evaluateJavascript("window.dispatchEvent(new CustomEvent('plainvault-response',{detail:"+p.toString()+"}))",null);}catch(Exception ignored){}});}
    private void clearClipboard(){if(clipboardClear!=null)ui.removeCallbacks(clipboardClear);ClipboardManager c=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);if(!clipboardText.isEmpty()&&c.hasPrimaryClip()&&c.getPrimaryClip()!=null&&clipboardText.contentEquals(c.getPrimaryClip().getItemAt(0).coerceToText(this)))c.clearPrimaryClip();clipboardText="";}
    private void copy(String text){ui.post(()->{clearClipboard();ClipboardManager c=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);ClipData clip=ClipData.newPlainText("Plain Vault",text);PersistableBundle extra=new PersistableBundle();extra.putBoolean("android.content.extra.IS_SENSITIVE",true);clip.getDescription().setExtras(extra);c.setPrimaryClip(clip);clipboardText=text;clipboardClear=()->clearClipboard();ui.postDelayed(clipboardClear,20000);});}
    private static byte[] decodeVault(String data)throws Exception{if(data==null||data.length()>((long)MAX*4/3)+8)throw new IOException("Vault exceeds the 16 MB limit.");byte[] b=Base64.decode(data,Base64.NO_WRAP);validate(b);return b;}
    private static void validate(byte[] b)throws Exception{if(b.length<32||b.length>MAX||b[0]!=(byte)0x03||b[1]!=(byte)0xd9||b[2]!=(byte)0xa2||b[3]!=(byte)0x9a||b[4]!=(byte)0x67||b[5]!=(byte)0xfb||b[6]!=(byte)0x4b||b[7]!=(byte)0xb5)throw new IOException("Choose a KeePass 2 .kdbx vault smaller than 16 MB.");}
    private static byte[] read(InputStream in,int limit)throws Exception{try{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1){if(out.size()+n>limit)throw new IOException("File is too large.");out.write(buf,0,n);}return out.toByteArray();}finally{in.close();}}
    private static String revision(byte[] b)throws Exception{return LocalSync.hex(MessageDigest.getInstance("SHA-256").digest(b));}
    private JSONObject readVault()throws Exception{AtomicFile f=new AtomicFile(new File(directory,"vault.kdbx"));JSONObject r=new JSONObject();try{byte[] b=read(f.openRead(),MAX);r.put("data",Base64.encodeToString(b,Base64.NO_WRAP));r.put("revision",revision(b));}catch(FileNotFoundException e){r.put("data",JSONObject.NULL);r.put("revision",JSONObject.NULL);}return r;}
    private void atomicWrite(File file,byte[] data)throws Exception{AtomicFile a=new AtomicFile(file);FileOutputStream out=null;try{out=a.startWrite();out.write(data);a.finishWrite(out);}catch(Exception e){if(out!=null)a.failWrite(out);throw e;}}
    private JSONObject writeVault(JSONObject a)throws Exception{
        byte[] bytes=decodeVault(a.getString("data"));JSONObject old=readVault();String expected=a.isNull("expectedRevision")?null:a.optString("expectedRevision",null);String actual=old.isNull("revision")?null:old.getString("revision");
        if(expected==null?actual!=null:!expected.equals(actual))throw new IOException("Vault changed while saving. Lock and unlock it, then try again.");
        if(!old.isNull("data")){byte[] random=new byte[3];new SecureRandom().nextBytes(random);atomicWrite(new File(directory,"backups/vault-"+System.currentTimeMillis()+"-"+LocalSync.hex(random)+".kdbx"),Base64.decode(old.getString("data"),Base64.NO_WRAP));}
        atomicWrite(new File(directory,"vault.kdbx"),bytes);File[] backups=backupFiles();for(int i=10;i<backups.length;i++)backups[i].delete();
        JSONObject r=new JSONObject();r.put("revision",revision(bytes));return r;
    }
    private File[] backupFiles(){File[] f=new File(directory,"backups").listFiles((d,n)->n.matches("vault-[0-9]+-[a-f0-9]+\\.kdbx"));if(f==null)return new File[0];Arrays.sort(f,Comparator.comparing(File::getName).reversed());return f;}
    private JSONArray backups()throws Exception{JSONArray r=new JSONArray();for(File f:backupFiles()){JSONObject p=new JSONObject();p.put("name",f.getName());p.put("date",Long.parseLong(f.getName().split("-")[1]));r.put(p);}return r;}
    private SecretKey secret()throws Exception{KeyStore k=KeyStore.getInstance("AndroidKeyStore");k.load(null);if(k.containsAlias("plainvault-pairing"))return(SecretKey)k.getKey("plainvault-pairing",null);KeyGenerator g=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");g.init(new KeyGenParameterSpec.Builder("plainvault-pairing",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());return g.generateKey();}
    private void savePeer(JSONObject p)throws Exception{Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,secret());String data=Base64.encodeToString(c.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(c.doFinal(p.toString().getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);atomicWrite(new File(directory,"peer.dat"),data.getBytes(StandardCharsets.UTF_8));}
    private JSONObject peer()throws Exception{File f=new File(directory,"peer.dat");if(!f.exists())return null;String data=new String(read(new FileInputStream(f),10000),StandardCharsets.UTF_8);String[] parts=data.split(":");Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,secret(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));return new JSONObject(new String(c.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8));}
    private JSONObject info()throws Exception{JSONObject r=new JSONObject();r.put("platform","android");r.put("version","0.1.0");return r;}
    private JSONObject syncInfo()throws Exception{JSONObject r=new JSONObject();JSONObject p=peer();if(p!=null){JSONObject safe=new JSONObject();safe.put("host",p.getString("host"));safe.put("port",p.getInt("port"));r.put("peer",safe);}else r.put("peer",JSONObject.NULL);return r;}
    private JSONObject pair(JSONObject a)throws Exception{
        String code=a.getString("code").trim();if(!code.startsWith("pv1:")||code.length()>2500)throw new IOException("Invalid pairing code.");
        JSONObject p=new JSONObject(new String(Base64.decode(code.substring(4),Base64.URL_SAFE|Base64.NO_WRAP),StandardCharsets.UTF_8));
        if(p.getInt("v")!=1||p.getLong("expires")<System.currentTimeMillis())throw new IOException("Pairing code expired. Generate a new code on your PC.");
        JSONObject request=new JSONObject();request.put("name",android.os.Build.MANUFACTURER+" "+android.os.Build.MODEL);
        JSONObject result=new JSONObject(LocalSync.request(p.getString("host"),p.getInt("port"),p.getString("fingerprint"),p.getString("token"),"/pair",request.toString()));
        p.put("token",result.getString("token"));p.put("id",result.getString("id"));p.remove("expires");savePeer(p);return syncInfo();
    }
    private JSONObject remote(String endpoint,JSONObject a)throws Exception{JSONObject p=peer();if(p==null)throw new IOException("Pair with your PC first.");return new JSONObject(LocalSync.request(p.getString("host"),p.getInt("port"),p.getString("fingerprint"),p.getString("token"),endpoint,a.toString()));}
    private void chooseFile(String id,byte[] bytes){ui.post(()->{if(fileRequest!=null){reply(id,null,"A file picker is already open.");return;}fileRequest=id;exportBytes=bytes;Intent intent=new Intent(bytes==null?Intent.ACTION_OPEN_DOCUMENT:Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(bytes==null?"*/*":"application/octet-stream");if(bytes!=null)intent.putExtra(Intent.EXTRA_TITLE,"Plain-Vault-"+new java.text.SimpleDateFormat("yyyy-MM-dd",java.util.Locale.UK).format(new java.util.Date())+".kdbx");try{startActivityForResult(intent,100);}catch(Exception e){fileRequest=null;exportBytes=null;reply(id,null,"No file picker is available.");}});}
    @Override protected void onActivityResult(int request,int result,Intent intent){super.onActivityResult(request,result,intent);if(request!=100||fileRequest==null)return;final String id=fileRequest;final byte[] bytes=exportBytes;fileRequest=null;exportBytes=null;if(result!=RESULT_OK||intent==null||intent.getData()==null){try{reply(id,new JSONObject().put("cancelled",true),null);}catch(Exception ignored){}return;}final Uri uri=intent.getData();worker.execute(()->{try{JSONObject r=new JSONObject();if(bytes==null){byte[] b=read(getContentResolver().openInputStream(uri),MAX);validate(b);r.put("data",Base64.encodeToString(b,Base64.NO_WRAP));r.put("name","Imported vault");}else{try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new IOException("Could not open the output file.");out.write(bytes);}r.put("saved",true);}reply(id,r,null);}catch(Exception e){reply(id,null,e.getMessage());}});}
    private final class Bridge {
        @JavascriptInterface public void call(String op,String json,String id){if(id==null||!id.matches("[a-z0-9-]{1,80}")||json==null||json.length()>23*1024*1024)return;worker.execute(()->{
            try{JSONObject a=new JSONObject(json);Object r=new JSONObject();switch(op){
                case"info":r=info();break;
                case"readVault":r=readVault();break;
                case"writeVault":r=writeVault(a);break;
                case"importFile":chooseFile(id,null);return;
                case"exportFile":chooseFile(id,decodeVault(a.getString("data")));return;
                case"backups":r=backups();break;
                case"readBackup":String name=a.getString("name");if(!name.matches("vault-[0-9]+-[a-f0-9]+\\.kdbx"))throw new IOException("Invalid backup name.");r=new JSONObject().put("data",Base64.encodeToString(read(new FileInputStream(new File(directory,"backups/"+name)),MAX),Base64.NO_WRAP));break;
                case"copy":String text=a.getString("text");if(text.length()>65536)throw new IOException("Clipboard value is too large.");copy(text);break;
                case"clearClipboard":ui.post(()->clearClipboard());break;
                case"unlocked":break;
                case"syncInfo":r=syncInfo();break;
                case"pair":r=pair(a);break;
                case"remotePull":r=remote("/pull",new JSONObject());break;
                case"sync":decodeVault(a.getString("data"));r=remote("/sync",a);break;
                case"forgetPeer":new File(directory,"peer.dat").delete();r=syncInfo();break;
                case"support":ui.post(()->{try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://square.link/u/kAddgU4q")));}catch(Exception ignored){}});break;
                default:throw new IOException("Unknown operation.");
            }reply(id,r,null);}catch(Exception e){String m=e.getMessage();if(e instanceof javax.net.ssl.SSLException)m="Could not verify the PC connection. Check the pairing code and pair again.";else if(e instanceof java.net.ConnectException||e instanceof java.net.SocketTimeoutException)m="PC unavailable. Connect both devices to the same Wi-Fi, unlock the PC vault and start local sync.";reply(id,null,m==null?"Could not complete this action.":m);}
        });}
    }
}
