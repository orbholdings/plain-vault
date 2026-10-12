package com.plainapps.vault;
public final class LocalSyncHarness {
 public static void main(String[] args)throws Exception {
  if(args[0].equals("addresses")){
   String[] accepted={"10.1.2.3","192.168.1.2","172.16.1.2","172.31.255.254"};
   String[] rejected={"127.0.0.1","8.8.8.8","172.32.1.2","192.168.1.256","192.168.1.255","192.168.1.0","localhost","10.0.0.1.attacker.invalid","::1","169.254.1.1"};
   for(String s:accepted)if(!LocalSync.privateAddress(s))throw new Exception("Rejected private address");
   for(String s:rejected)if(LocalSync.privateAddress(s))throw new Exception("Accepted unsafe address");
   System.out.println("Address tests passed");return;
  }
  System.out.println(LocalSync.requestPinned(args[0],Integer.parseInt(args[1]),args[2],args[3],args[4],args[5]));
 }
}
