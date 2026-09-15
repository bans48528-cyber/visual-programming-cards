package com.cardprogramming.app;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** An explicitly prepared file transfer with an explicit final run mode. */
final class UploadGate {
    private byte[] filename;
    private int expected,received;
    private boolean named,run;
    void begin(int size,int slot) {
        begin(size,slot,false);
    }
    void begin(int size,int slot,boolean run) {
        if(size<16||size>256*1024||slot<0||slot>10) throw new IllegalArgumentException("程序大小或槽位无效。");
        filename=(slot+".o").getBytes(StandardCharsets.US_ASCII);expected=size;received=0;named=false;this.run=run;
    }
    void reset() {filename=null;expected=received=0;named=false;}
    boolean active() {return expected>0;}
    boolean accept(byte[] b) {
        if(!active()||b.length<8||(b[0]&255)!=0x5a||(b[1]&255)!=0x97||(b[2]&255)!=0x98||(b[b.length-1]&255)!=0xa5) return false;
        int n=b[3]&255,sum=0,cmd=b[4]&255;
        if(b.length!=n+7) return false;
        for(int i=0;i<b.length-2;i++) sum+=b[i]&255;
        if((sum&255)!=(b[b.length-2]&255)) return false;
        if(!named) {
            if(cmd!=0xda||!Arrays.equals(filename,Arrays.copyOfRange(b,5,5+n))) return false;
            named=true;return true;
        }
        if(n<1||n>128||received+n>expected) return false;
        if(received==0&&(n<4||b[5]!=15||b[6]!='p'||b[7]!='y'||b[8]!='o')) return false;
        boolean last=received+n==expected;
        if(last?cmd!=(run?0xbc:0xbb):cmd!=0xaa||n!=128) return false;
        received+=n;if(last) reset();return true;
    }
}
