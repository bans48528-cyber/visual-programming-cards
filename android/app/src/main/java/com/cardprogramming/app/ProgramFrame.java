package com.cardprogramming.app;

/** Fixed C2 frames permitted by the Xiaobai BLE programming protocol. */
final class ProgramFrame {
    static boolean valid(byte[] b) {
        if(b==null || b.length!=17 || (b[0]&255)!=0x5a || (b[1]&255)!=0x97 ||
            (b[2]&255)!=0x98 || (b[3]&255)!=0x0a || (b[4]&255)!=0xc2 ||
            (b[16]&255)!=0xa5) return false;
        int sum=0;
        for(int i=0;i<15;i++) sum+=b[i]&255;
        if((sum&255)!=(b[15]&255)) return false;
        int seq=b[5]&255, op=b[6]&255;
        if(op>=1&&op<=5) return seq==0 && zero(b,7);
        if(seq==0) return false;
        int args;
        switch(op) {
            case 0x10: case 0x20: args=6;break;
            case 0x11: args=2;break;
            case 0x30: args=3;break;
            case 0x12: case 0x13: case 0x21: case 0x23:
            case 0x40: case 0x41: case 0x50: case 0x51: args=1;break;
            case 0x22: case 0x31: case 0x42: args=0;break;
            case 0x43:
                // transfer, part, six column bytes; the final part has four columns.
                // Upload ordering and transfer matching are checked by the firmware ACK.
                int part=b[8]&255;
                return part<=2 && (part!=2 || zero(b,13));
            case 0x52: case 0x54:
                // Nonzero little-endian query/task ID; all remaining bytes reserved.
                return nonzeroId(b) && zero(b,11);
            case 0x53:
                return nonzeroId(b) && slot(b[11]) && (b[12]&255)<=1 && zero(b,13);
            case 0x55:
                return nonzeroId(b) && slot(b[11]) && zero(b,12);
            case 0x56:
                // UID96 is read as two six-byte response parts.
                return (b[7]&255)<=1 && zero(b,8);
            case 0x57:
                return nonzeroId(b) && (b[11]&255)<=1 && zero(b,12);
            default: return false;
        }
        if(op==0x20) args=5;
        return zero(b,7+args);
    }
    private static boolean nonzeroId(byte[] b) {
        return (b[7]|b[8]|b[9]|b[10])!=0;
    }
    private static boolean slot(byte value) {
        int slot=value&255;
        return slot>=1 && slot<=10;
    }
    private static boolean zero(byte[] b,int from) {
        for(int i=from;i<15;i++) if(b[i]!=0) return false;
        return true;
    }
}
