package com.plainapps.vault;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.security.cert.CertificateException;

/** Local-only HTTPS transport. Certificate pinning is scoped to each connection. */
public final class LocalSync {
    public static final int MAX_RESPONSE = 23 * 1024 * 1024;
    public static boolean privateAddress(String address) {
        if (address == null || !address.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}")) return false;
        String[] p=address.split("\\."); int[] n=new int[4];
        for(int i=0;i<4;i++){n[i]=Integer.parseInt(p[i]);if(n[i]>255)return false;}
        if(n[3]==0||n[3]==255)return false;
        return n[0]==10||(n[0]==172&&n[1]>=16&&n[1]<=31)||(n[0]==192&&n[1]==168);
    }
    public static String hex(byte[] value) {
        StringBuilder b=new StringBuilder();for(byte x:value)b.append(String.format("%02x",x & 255));return b.toString();
    }
    public static void verifyCertificate(X509Certificate[] chain,String fingerprint) throws CertificateException {
        if(chain==null||chain.length==0)throw new CertificateException("Missing PC certificate.");
        try {
            chain[0].checkValidity();
            byte[] actual=MessageDigest.getInstance("SHA-256").digest(chain[0].getEncoded());
            if(!fingerprint.matches("[a-f0-9]{64}"))throw new CertificateException("Invalid PC fingerprint.");
            byte[] expected=new byte[32];for(int i=0;i<32;i++)expected[i]=(byte)Integer.parseInt(fingerprint.substring(i*2,i*2+2),16);
            if(!MessageDigest.isEqual(actual,expected))throw new CertificateException("PC certificate changed. Pair this device again.");
        }catch(CertificateException e){throw e;}catch(Exception e){throw new CertificateException("Cannot verify PC identity.",e);}
    }
    public static String request(final String host,int port,final String fingerprint,String token,String endpoint,String json) throws Exception {
        if(!privateAddress(host)||port<1024||port>65535||!fingerprint.matches("[a-f0-9]{64}")||!token.matches("[a-f0-9]{64}")||!endpoint.matches("/(pair|pull|sync)"))throw new IOException("Invalid local sync destination.");
        return requestPinned(host,port,fingerprint,token,endpoint,json);
    }
    // Package-local transport seam lets the JVM test real TLS on loopback. The app only calls request().
    static String requestPinned(final String host,int port,final String fingerprint,String token,String endpoint,String json) throws Exception {
        SSLContext context=SSLContext.getInstance("TLS");
        context.init(null,new TrustManager[]{new X509TrustManager(){
            public X509Certificate[] getAcceptedIssuers(){return new X509Certificate[0];}
            public void checkClientTrusted(X509Certificate[] c,String a)throws CertificateException{throw new CertificateException("Client certificates are not used.");}
            public void checkServerTrusted(X509Certificate[] c,String a)throws CertificateException{verifyCertificate(c,fingerprint);}
        }},new SecureRandom());
        HttpsURLConnection c=(HttpsURLConnection)new URL("https://"+host+":"+port+endpoint).openConnection();
        c.setSSLSocketFactory(context.getSocketFactory());c.setHostnameVerifier((h,s)->h.equals(host));
        c.setInstanceFollowRedirects(false);c.setConnectTimeout(8000);c.setReadTimeout(23000);c.setRequestMethod("POST");c.setDoOutput(true);
        c.setRequestProperty("Authorization","Bearer "+token);c.setRequestProperty("Content-Type","application/json");c.setRequestProperty("Cache-Control","no-store");
        byte[] body=json.getBytes(StandardCharsets.UTF_8);
        if(body.length>MAX_RESPONSE)throw new IOException("Vault exceeds the local sync size limit.");
        c.setFixedLengthStreamingMode(body.length);
        try {
            c.getOutputStream().write(body);c.getOutputStream().close();
            int status=c.getResponseCode();
            if(status>=300&&status<400)throw new IOException("Sync redirects are blocked.");
            InputStream in=status==200?c.getInputStream():c.getErrorStream();
            if(in==null)throw new IOException("PC could not complete sync ("+status+").");
            ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buf=new byte[8192];int count;
            try {while((count=in.read(buf))!=-1){if(out.size()+count>MAX_RESPONSE)throw new IOException("PC response is too large.");out.write(buf,0,count);}}finally{in.close();}
            String result=new String(out.toByteArray(),StandardCharsets.UTF_8);
            if(status!=200){
                if(status==423)throw new IOException("Unlock the PC vault and start local sync.");
                if(status==401)throw new IOException("Pairing expired or this device was removed. Pair again.");
                throw new IOException("PC declined sync ("+status+"). Check both vaults are the same and try again.");
            }
            return result;
        }finally{c.disconnect();}
    }
}
