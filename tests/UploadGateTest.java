package com.cardprogramming.app;
public final class UploadGateTest {
    static void check(boolean ok) {if(!ok) throw new AssertionError();}
    static byte[] frame(int cmd,byte[] data) {
        byte[] b=new byte[data.length+7];b[0]=0x5a;b[1]=(byte)0x97;b[2]=(byte)0x98;b[3]=(byte)data.length;b[4]=(byte)cmd;
        System.arraycopy(data,0,b,5,data.length);int sum=0;for(int i=0;i<b.length-2;i++) sum+=b[i]&255;
        b[b.length-2]=(byte)sum;b[b.length-1]=(byte)0xa5;return b;
    }
    public static void main(String[] args) {
        UploadGate gate=new UploadGate();byte[] name=frame(0xda,new byte[]{'0','.','o'});
        byte[] code=new byte[128];code[0]=15;code[1]='p';code[2]='y';code[3]='o';
        check(!gate.accept(name));gate.begin(129,0);
        check(!gate.accept(frame(0xaa,code)));check(!gate.accept(frame(0xda,new byte[]{'1','.','o'})));
        check(gate.accept(name));check(!gate.accept(name));check(!gate.accept(frame(0xbc,code)));
        check(!gate.accept(frame(0xbb,code)));check(gate.accept(frame(0xaa,code)));
        check(!gate.accept(frame(0xaa,new byte[]{1})));check(gate.accept(frame(0xbb,new byte[]{1})));check(!gate.active());
        for(int i=0;i<name.length;i++) {gate.begin(128,0);byte[] bad=name.clone();bad[i]^=1;check(!gate.accept(bad));}
        gate.begin(128,0);check(gate.accept(name));check(gate.accept(frame(0xbb,code)));check(!gate.active());
        gate.begin(128,0);gate.reset();check(!gate.accept(name));
        gate.begin(128,0,true);check(gate.accept(name));check(!gate.accept(frame(0xbb,code)));
        check(gate.accept(frame(0xbc,code)));check(!gate.active());
        System.out.println("PASS native upload gate: preparation, filename, checksum, order, exact byte count, explicit BB/BC completion, reset");
    }
}
