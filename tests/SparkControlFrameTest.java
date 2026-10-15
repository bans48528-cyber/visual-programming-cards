package com.cardprogramming.app;
public final class SparkControlFrameTest {
 public static void main(String[] args){
  for(int cmd:new int[]{0xd0,0xb9}){
   byte[] b=UploadGateTest.frame(cmd,new byte[]{1});
   UploadGateTest.check(SparkControlFrame.valid(b));
   for(int i=0;i<b.length;i++){byte[] bad=b.clone();bad[i]^=1;UploadGateTest.check(!SparkControlFrame.valid(bad));}
  }
  for(int cmd:new int[]{0xc2,0xda,0xaa,0xbb,0xbc,0xb6})UploadGateTest.check(!SparkControlFrame.valid(UploadGateTest.frame(cmd,new byte[]{1})));
  System.out.println("PASS Spark control gate: D0/B9 only; invalid checksums and unprepared upload/run rejected.");
 }
}
