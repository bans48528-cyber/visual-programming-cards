package com.cardprogramming.app;

import java.nio.charset.StandardCharsets;

/** LBS2206 whole frames only. No AT commands or unverified wait/loop opcodes. */
public final class LbsFrame {
    public static boolean valid(byte[] wire, int maxBytes, int safeActions) {
        if (wire == null || wire.length < 4 || wire.length > maxBytes || maxBytes > 20) return false;
        String text = new String(wire, StandardCharsets.US_ASCII);
        for (String read : new String[]{"sys.GetVer()", "sys.GetVoltage()", "sys.GetBTMAC()", "sys.GetSTPL()", "sys.GetSTPR()"})
            if (read.equals(text)) return true;
        if ((wire.length & 1) != 0) return false;
        int[] data = new int[wire.length / 2];
        for (int i=0;i<data.length;i++) {
            int a=wire[i*2]&255,b=wire[i*2+1]&255;
            if (a+b!=255) return false;
            data[i]=b;
        }
        if (data.length==2 && data[1]==10) {
            if(data[0]==10 || data[0]==0x7b) return true;
            int action=data[0]&0xf0,speed=data[0]&15;
            return speed>=1 && speed<=5 && (action==0x10 || action==0x20 || action==0x30 || action==0x40 || action==0x50);
        }
        if (data.length<3 || data[0]!=0x7b || data[data.length-1]!=0x7d || data.length-2>safeActions) return false;
        for(int i=1;i<data.length-1;i++) if(data[i]!=0x10 && data[i]!=0x20 && data[i]!=0x40 && data[i]!=0x50) return false;
        return true;
    }
    private LbsFrame() {}
}
