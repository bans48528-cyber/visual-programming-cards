package com.cardprogramming.app;
/** Only monitor and pause; upload commands must pass the separate session gate. */
final class SparkControlFrame {
    static boolean valid(byte[] b) {
        if(b==null||b.length!=8) return false;
        int cmd=b[4]&255;
        if(cmd!=0xd0&&cmd!=0xb9) return false;
        if((b[0]&255)!=0x5a||(b[1]&255)!=0x97||(b[2]&255)!=0x98||b[3]!=1||b[5]!=1||(b[7]&255)!=0xa5)return false;
        int sum=0;for(int i=0;i<6;i++)sum+=b[i]&255;
        return (sum&255)==(b[6]&255);
    }
}
