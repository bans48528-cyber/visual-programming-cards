package com.cardprogramming.app;
import java.nio.charset.StandardCharsets;
public final class LbsFrameTest {
    private static void check(boolean ok){if(!ok)throw new AssertionError();}
    private static byte[] frame(int... d){byte[] r=new byte[d.length*2];for(int i=0;i<d.length;i++){r[2*i]=(byte)(255-d[i]);r[2*i+1]=(byte)d[i];}return r;}
    public static void main(String[] args){
        for(int action:new int[]{0x10,0x20,0x30,0x40,0x50})for(int speed=1;speed<=5;speed++)check(LbsFrame.valid(frame(action|speed,10),20,0));
        check(LbsFrame.valid(frame(123,10),20,0));check(LbsFrame.valid(frame(10,10),20,0));
        check(LbsFrame.valid(frame(123,16,32,125),20,2));check(!LbsFrame.valid(frame(123,16,32,125),20,1));
        check(!LbsFrame.valid(frame(123,16,32,125),6,2));check(!LbsFrame.valid(frame(123,96,125),20,2));check(!LbsFrame.valid(frame(123,129,125),20,2));
        check(!LbsFrame.valid(frame(0x16,10),20,0));check(!LbsFrame.valid(frame(123,16,0),20,2));
        check(LbsFrame.valid("sys.GetVer()".getBytes(StandardCharsets.US_ASCII),20,0));
        check(!LbsFrame.valid("AT+SET=1\r\n".getBytes(StandardCharsets.US_ASCII),20,0));
        check(!LbsFrame.valid("sys.Reset()".getBytes(StandardCharsets.US_ASCII),20,0));
        byte[] bad=frame(17,10);bad[0]^=1;check(!LbsFrame.valid(bad,20,0));
        System.out.println("PASS native LBS validator: five speeds, whole program bounds, stop, complement checks, read-only maintenance, no AT/wait/loop opcodes.");
    }
}
