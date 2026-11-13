package com.cardprogramming.app;

import java.util.Arrays;

/** Strict, bounded C4 requests. Legacy C1/C2 and OTA gates are independent. */
final class MultiProgramFrame {
    static final int MAX_PAYLOAD=40, MIN_PAYLOAD=16;
    static final long CHUNK_GUARD_MS=40, CHUNK_TIMEOUT_MS=500;

    static boolean valid(byte[] b) {
        if(b==null || b.length<MIN_PAYLOAD+7 || b.length>MAX_PAYLOAD+7 ||
           u(b[0])!=0x5a || u(b[1])!=0x97 || u(b[2])!=0x98 ||
           u(b[3])!=b.length-7 || u(b[4])!=0xc4 || u(b[b.length-1])!=0xa5 ||
           (u(b[5])!=1 && u(b[5])!=2)) return false;
        int sum=0;
        for(int i=0;i<b.length-2;i++)sum+=u(b[i]);
        if((sum&255)!=u(b[b.length-2]) || !nonzero(b,9,8)) return false;
        int kind=u(b[6]), group=u(b[7]), op=u(b[8]), n=b.length-23;
        boolean task=nonzero(b,17,4), session=group==0 && op==0;
        if(u(b[5])==2) return validStream(b,kind,group,op,n,task,session);
        switch(kind) {
            case 1: return session && task && n==0; // CAPS
            case 2: return session && task && (n==9 || n==10 && u(b[30])==1) && u(b[29])>=1 && u(b[29])<=15; // OPEN, optional reusable flag
            case 3: case 6: return group>=1 && group<=4 && op==0 && !task && n==0;
            case 4: return group>=1 && group<=4 && task && action(b,op,n);
            case 5: return group>=1 && group<=4 && op==0 && task && n==0;
            case 7: case 8: case 9: return session && !task && n==0;
            case 10:
                if(n!=1 || u(b[21])<1 || u(b[21])>8)return false;
                if(session && !task)return u(b[21])==8; // session ABORT repeat ACK
                return group>=1 && group<=4 && task && actionOpcode(op);
            case 11: return session && !task && n==1 && u(b[21])>=1 && u(b[21])<=15;
            case 12: case 13: case 14: case 15:
                // Observer IDs are independent from PC task IDs. Group 0 is
                // bound to an active legacy runId, with the high SID word zero.
                if(group>4 || !task || op<1 || op>4 ||
                   (group==0 && (!nonzero(b,9,4) || nonzero(b,13,4))))return false;
                // Reusable groups prefix the condition args with their captured
                // invocation ID. Legacy group 0 has no reusable representation.
                int prefix=kind==12 ? (n==(op==4 ? 8 : 5) ? 4 : 0) :
                    (kind==15 ? (n==5 ? 4 : 0) : (n==4 ? 4 : 0));
                if(prefix!=0 && (group==0 || !nonzero(b,21,4)))return false;
                int at=21+prefix, count=n-prefix;
                if(kind==13 || kind==14)return count==0;
                if(kind==15)return count==1 && (u(b[at])==2 || u(b[at])==3 || u(b[at])==5 || u(b[at])==6);
                if(op==1 || op==2)return count==1 && range(b,at,0,100);
                if(op==3)return count==1 && range(b,at,2,5);
                return count==4 && (b[at+3]&0x80)==0; // zero-duration TIME is valid
            case 16: case 17: return group>=1 && group<=4 && op==0 && task && n==0;
            case 18: return session && !task && n==1 && range(b,21,1,15) &&
                nonzero(b,9,4) && nonzero(b,13,4); // START: both SID words are required
            default: return false;
        }
    }
    /** Version 2 shares the envelope while keeping a smaller request vocabulary. */
    private static boolean validStream(byte[] b,int kind,int group,int op,int n,
                                       boolean task,boolean session) {
        // Every stream request belongs to a nonzero run and connection token.
        if(!nonzero(b,9,4) || !nonzero(b,13,4)) return false;
        boolean script=group>=1 && group<=4;
        switch(kind) {
            case 4:
                if(!script || !task || op==0x30 || op==0x32) return false;
                if(op==0x34) return n==1 && range(b,21,3,4);
                return action(b,op,n);
            case 5: // Query a real device wait or playback result.
            case 6: // Retire this script's pending wait with a fresh task fence.
            case 16: // Begin or replace a script activation.
            case 17: // The script completed while its outputs may remain active.
                return script && op==0 && task && n==0;
            case 7: case 8: case 9:
                return session && !task && n==0;
            case 10:
                if(n!=1 || !range(b,21,1,8)) return false;
                if(session && !task) return u(b[21])==8;
                return script && task && actionOpcode(op) && op!=0x30 && op!=0x32;
            case 18:
                return session && !task && n==1 && range(b,21,0,15);
            default:
                return false;
        }
    }

    private static int u(byte value){return value&255;}
    private static boolean nonzero(byte[] b,int at,int count){int value=0;for(int i=at;i<at+count;i++)value|=b[i];return value!=0;}
    private static boolean duration(byte[] b,int at){return nonzero(b,at,4) && (b[at+3]&0x80)==0;}
    private static boolean range(byte[] b,int at,int lo,int hi){int value=u(b[at]);return value>=lo && value<=hi;}
    private static boolean actionOpcode(int op){
        switch(op){
            case 0x10: case 0x11: case 0x12: case 0x13: case 0x20: case 0x21:
            case 0x22: case 0x23: case 0x30: case 0x32: case 0x34: case 0x40: case 0x41:
            case 0x42: case 0x43: case 0x50: case 0x51: case 0x55: return true;
            default: return false;
        }
    }
    private static boolean action(byte[] b,int op,int n){
        switch(op){
            case 0x10: return n==6 && range(b,21,0,1) && range(b,22,1,2) && duration(b,23);
            case 0x11: return n==2 && range(b,21,0,1) && range(b,22,1,2);
            case 0x12: return n==1 && range(b,21,0,1);
            case 0x13: case 0x23: return n==1 && range(b,21,1,3);
            case 0x20: return n==5 && range(b,21,1,4) && duration(b,22);
            case 0x21: return n==1 && range(b,21,1,4);
            case 0x22: case 0x42: return n==0;
            case 0x30: return n==3 && range(b,21,0,2) && range(b,22,0,1) && range(b,23,0,100);
            case 0x32: return n==1 && range(b,21,1,5); // any-orientation stillness or existing sides
            case 0x34: return n==1 && range(b,21,1,4); // still/shaking/new up/new down
            case 0x40: case 0x50: case 0x51: case 0x55: return n==1 && range(b,21,1,10);
            case 0x41: return n==1 && range(b,21,0,100);
            case 0x43: return n==16;
            default: return false;
        }
    }

    /** One immutable complete frame; callback tokens never cross Transfer instances. */
    static final class Transfer {
        private final byte[] bytes;
        private final int chunkBytes;
        private int offset, pendingBytes;
        private volatile long token;
        private long sentAt, writtenAt, firstWaitAt=-1;
        private boolean inFlight, cancelled;
        Transfer(byte[] frame,int mtu){
            if(!valid(frame) || mtu<23)throw new IllegalArgumentException("无效的小白多组程序帧或 MTU。");
            bytes=frame.clone();chunkBytes=Math.min(mtu-3,frame.length);writtenAt=-CHUNK_GUARD_MS;
        }
        boolean done(){return offset==bytes.length;}
        boolean inFlight(){return inFlight;}
        long token(){return token;}
        void cancel(){cancelled=true;inFlight=false;}
        long delay(long now,long lastReceive){
            check(now);
            if(done())return 0;
            if(inFlight)return Math.max(1,CHUNK_TIMEOUT_MS-(now-sentAt));
            long gap=CHUNK_GUARD_MS-(now-writtenAt);
            // RX may yield one bounded courtesy window before the first byte.
            // Once a logical frame starts, preserve its 40ms chunk spacing
            // without allowing incoming notifications to stall its remainder.
            if(offset>0)return Math.max(0,gap);
            if(firstWaitAt<0)firstWaitAt=now;
            long courtesy=Math.min(CHUNK_GUARD_MS-(now-lastReceive),
                                   CHUNK_GUARD_MS-(now-firstWaitAt));
            return Math.max(0,Math.max(gap,courtesy));
        }
        byte[] next(long now,long lastReceive){
            if(delay(now,lastReceive)!=0 || inFlight || done())return null;
            pendingBytes=Math.min(chunkBytes,bytes.length-offset);inFlight=true;sentAt=now;token++;
            return Arrays.copyOfRange(bytes,offset,offset+pendingBytes);
        }
        boolean written(long expectedToken,long now){
            if(cancelled || !inFlight || expectedToken!=token)return false;
            check(now);offset+=pendingBytes;pendingBytes=0;inFlight=false;writtenAt=now;return true;
        }
        private void check(long now){
            if(cancelled)throw new IllegalStateException("多组程序发送已取消。");
            if((inFlight && now-sentAt>=CHUNK_TIMEOUT_MS) ||
               (!inFlight && offset>0 && !done() && now-writtenAt>=CHUNK_TIMEOUT_MS))
                throw new IllegalStateException("多组程序分片发送超时，连接需重新建立。");
        }
    }
}
