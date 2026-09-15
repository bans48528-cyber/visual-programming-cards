package com.cardprogramming.app;
public final class RemoteFrameTest {
    private static void check(boolean ok) {if(!ok) throw new AssertionError();}
    public static void main(String[] args) {
        check(RemoteFrame.valid(RemoteFrame.released()));
        for(int mask=0;mask<1024;mask++) {
            byte[] b=RemoteFrame.released();int sum=0,directions=0;
            for(int i=0;i<10;i++) {b[5+i]=(byte)((mask>>i)&1);if(i<4) directions+=b[5+i];}
            for(int i=0;i<15;i++) sum+=b[i]&255;b[15]=(byte)sum;
            check(RemoteFrame.valid(b)==(directions<=1));
        }
        for(int i=0;i<17;i++) {byte[] b=RemoteFrame.released();b[i]^=2;check(!RemoteFrame.valid(b));}
        check(!RemoteFrame.valid(new byte[18]));check(!RemoteFrame.valid(new byte[0]));
        System.out.println("PASS native C1 validator: 1024 button combinations, corrupt headers/checksum/data, invalid lengths");
    }
}
