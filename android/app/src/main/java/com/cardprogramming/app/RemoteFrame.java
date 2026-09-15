package com.cardprogramming.app;

/** C1 button state format verified against the reference APK. */
final class RemoteFrame {
    static boolean valid(byte[] b) {
        if(b.length!=17 || (b[0]&255)!=0x5a || (b[1]&255)!=0x97 || (b[2]&255)!=0x98 ||
            b[3]!=10 || (b[4]&255)!=0xc1 || (b[16]&255)!=0xa5) return false;
        int sum=0,directions=0;
        for(int i=5;i<15;i++) {if(b[i]!=0 && b[i]!=1) return false;if(i<9) directions+=b[i];}
        if(directions>1) return false;
        for(int i=0;i<15;i++) sum+=b[i]&255;
        return (sum&255)==(b[15]&255);
    }
    static byte[] released() {return new byte[]{0x5a,(byte)0x97,(byte)0x98,10,(byte)0xc1,0,0,0,0,0,0,0,0,0,0,0x54,(byte)0xa5};}
}
