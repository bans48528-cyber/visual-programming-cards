package com.cardprogramming.app;

import java.util.*;
import java.util.zip.CRC32;

/** Runs the exact production native transport with deterministic time and fake GATT callbacks. */
public final class OtaTransportTest {
    static int checks;
    static void check(boolean value,String label) {checks++;if(!value)throw new AssertionError(label);}
    static void rejected(Runnable fn,String label) {checks++;try{fn.run();throw new AssertionError(label);}catch(IllegalArgumentException|IllegalStateException expected){}}
    static byte[] bytes(String hex) {byte[] b=new byte[hex.length()/2];for(int i=0;i<b.length;i++)b[i]=(byte)Integer.parseInt(hex.substring(i*2,i*2+2),16);return b;}
    static String hex(byte[] b) {StringBuilder out=new StringBuilder();for(byte v:b)out.append(String.format("%02x",v&255));return out.toString();}
    static byte[] frame(int cmd,long id,byte[] payload) {
        byte[] b=new byte[16+payload.length];b[0]='X';b[1]='B';b[2]='O';b[3]='T';b[4]=1;b[5]=(byte)cmd;b[6]=(byte)payload.length;b[7]=(byte)(payload.length>>8);
        put(b,8,id);System.arraycopy(payload,0,b,16,payload.length);CRC32 crc=new CRC32();crc.update(b,0,12);crc.update(b,16,payload.length);put(b,12,crc.getValue());return b;
    }
    static void put(byte[] b,int off,long value) {for(int i=0;i<4;i++)b[off+i]=(byte)(value>>(8*i));}
    public static void main(String[] args) throws Exception {
        byte[] info=frame(0x60,0x12345678L,new byte[0]);
        check(hex(info).equals("58424f5401600000785634125112bc46"),"independent IEEE CRC32 golden INFO");
        check(OtaTransport.validRequest(info),"INFO accepted");
        check(!OtaTransport.validRequest(null),"null rejected");
        for(int i=0;i<info.length;i++) {byte[] bad=info.clone();bad[i]^=1;check(!OtaTransport.validRequest(bad),"CRC envelope mutation "+i);}
        check(!OtaTransport.validRequest(frame(0x60,0,new byte[0])),"zero request ID");
        for(int cmd=0;cmd<256;cmd++)check(OtaTransport.validRequest(frame(cmd,1,new byte[0]))==(cmd==0x60||cmd==0x64),"empty payload opcode "+cmd);
        for(int size=0;size<=160;size++)check(OtaTransport.validRequest(frame(0x62,1,new byte[size]))==(size==128),"BEGIN manifest exact "+size);
        for(int size=0;size<=160;size++)check(OtaTransport.validRequest(frame(0x63,1,new byte[size]))==(size>=5&&size<=132),"DATA bound "+size);
        byte[] full=new byte[132];put(full,0,128);for(int i=4;i<full.length;i++)full[i]=(byte)i;
        byte[] data=frame(0x63,0xffffffffL,full), ack=frame(0xe3,0xffffffffL,new byte[]{0,0,1,0,0});
        check(OtaTransport.validRequest(data),"max uint32 id signed bytes");
        for(long offset:new long[]{1,127,129,0xb000,0xffffffffL}) {byte[] p=full.clone();put(p,0,offset);check(!OtaTransport.validRequest(frame(0x63,1,p)),"unaligned/outside offset "+offset);}
        byte[] last=new byte[]{0,(byte)0xaf,0,0,1};check(OtaTransport.validRequest(frame(0x63,1,last)),"last aligned capacity page allowed");
        OtaTransport t=new OtaTransport();
        rejected(()->t.prepare(info),"closed gate rejects");
        t.begin();check(t.active(),"begin exclusive");
        t.observedRx(100);check(t.delay(100)==40&&t.delay(130)==10&&t.delay(140)==0,"new raw session includes actual ENTER ACK quiet gap");
        byte[][] chunks=t.prepare(data);check(chunks.length==8,"148B request is 8 chunks");
        int offset=0;for(int i=0;i<chunks.length;i++) {check(chunks[i].length<=20&&chunks[i].length>0,"chunk cap");for(byte v:chunks[i])check(v==data[offset++],"chunk byte order");}
        check(offset==data.length,"all frame bytes fragmented");
        check(t.receive(ack,150).isEmpty(),"ACK before last request chunk submitted ignored");
        rejected(()->t.prepare(info),"different request cannot overtake pending");
        t.markSent();
        for(int i=0;i<chunks.length;i++) {long now=200+i*40;t.written(now);check(t.delay(now)==40&&t.delay(now+39)==1&&t.delay(now+40)==0,"callback pacing "+i);}
        check(t.receive(frame(0xe0,0xffffffffL,new byte[]{0}),600).isEmpty(),"wrong command ignored");
        check(t.receive(frame(0xe3,4,new byte[]{0}),640).isEmpty(),"wrong ID ignored");
        byte[] bad=ack.clone();bad[12]^=1;check(t.receive(bad,680).isEmpty(),"bad CRC never forwarded");
        check(t.prepare(data).length==8,"same byte and ID retry allowed");
        byte[] changed=full.clone();changed[4]^=1;rejected(()->t.prepare(frame(0x63,0xffffffffL,changed)),"same ID different bytes cannot retry");
        for(int split=1;split<ack.length;split++) {
            OtaTransport rx=new OtaTransport();rx.begin();rx.prepare(data);rx.markSent();
            check(rx.receive(Arrays.copyOf(ack,split),0).isEmpty(),"partial response "+split);
            List<byte[]> got=rx.receive(Arrays.copyOfRange(ack,split,ack.length),30);
            check(got.size()==1&&Arrays.equals(got.get(0),ack),"arbitrary BLE split "+split);
            check(rx.receive(ack,60).isEmpty(),"duplicate suppressed "+split);
        }
        t.close();check(!t.active(),"close ends exclusivity");check(t.receive(ack,800).isEmpty(),"closed gate drops");
        t.begin();t.prepare(data);t.markSent();check(t.receive(Arrays.copyOf(ack,10),900).isEmpty(),"partial buffered");
        check(t.receive(Arrays.copyOfRange(ack,10,ack.length),2000).isEmpty(),"one-second stale partial discarded");
        check(t.receive(ack,2030).size()==1,"whole retry after stale partial");
        t.prepare(info);t.markSent();
        byte[] response=frame(0xe0,0x12345678L,new byte[61]);
        byte[] noisy=new byte[50000+response.length];Arrays.fill(noisy,0,50000,(byte)0x58);System.arraycopy(response,0,noisy,50000,response.length);
        check(t.receive(noisy,2100).size()==1,"huge noisy notification bounded recovery");
        t.prepare(info);t.markSent();
        byte[] malformed=new byte[16+response.length];malformed[0]='X';malformed[1]='B';malformed[2]='O';malformed[3]='T';malformed[4]=1;malformed[6]=(byte)0xff;malformed[7]=(byte)0xff;System.arraycopy(response,0,malformed,16,response.length);
        check(t.receive(malformed,2200).size()==1,"oversize prefix resynchronization");
        // Source-of-truth cross-end vector frames supplied by Node from the firmware repo.
        for(String line:new Scanner(System.in).useDelimiter("\\A").next().split("\\R"))if(!line.isBlank()) {
            String[] fields=line.split("\\t");byte[] b=bytes(fields[1]);
            check(OtaTransport.validFrame(b)==fields[0].equals("valid"),"firmware vector "+fields[2]);
        }
        System.out.println("Native production OTA codec/transport: "+checks+" checks passed (offline simulated GATT, no hardware).");
    }
}
