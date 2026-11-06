package com.cardprogramming.app;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.zip.CRC32;

/** Pure, bounded OTA transport gate used by the real GATT bridge and JVM tests.
 * This does framing/pacing only; Boot independently validates the signed image.
 */
final class OtaTransport {
    static final int CHUNK_BYTES=20;
    static final long CHUNK_INTERVAL_MS=40, RX_QUIET_MS=40, PARTIAL_TIMEOUT_MS=1000;
    static final int MAX_PAYLOAD=OtaLayout.OTA_MAX_PAYLOAD, HEADER_BYTES=OtaLayout.OTA_FRAME_HEADER_SIZE, MAX_FRAME=OtaLayout.OTA_FRAME_MAX;
    private final byte[] buffer=new byte[MAX_FRAME];
    private int length;
    private boolean active, sent;
    private byte[] pending;
    private long lastRx=-1000, lastTx=-1000;

    void begin() {close();active=true;}
    void close() {active=false;sent=false;pending=null;length=0;lastRx=lastTx=-1000;}
    boolean active() {return active;}
    long delay(long now) {return Math.max(0,Math.max(lastRx+RX_QUIET_MS-now,lastTx+CHUNK_INTERVAL_MS-now));}
    void observedRx(long now) {lastRx=now;}
    void written(long now) {lastTx=now;}
    void markSent() {sent=true;}

    byte[][] prepare(byte[] bytes) {
        if(!active)throw new IllegalStateException("升级通道尚未开启。");
        if(!validRequest(bytes))throw new IllegalArgumentException("无效的 XBOT 升级请求。");
        if(pending!=null&&!Arrays.equals(pending,bytes))
            throw new IllegalStateException("上一条升级请求尚未收到匹配的回报。");
        if(pending==null) {pending=bytes.clone();sent=false;}
        int count=(bytes.length+CHUNK_BYTES-1)/CHUNK_BYTES;
        byte[][] chunks=new byte[count][];
        for(int i=0;i<count;i++)chunks[i]=Arrays.copyOfRange(bytes,i*CHUNK_BYTES,Math.min(bytes.length,(i+1)*CHUNK_BYTES));
        return chunks;
    }

    static boolean validFrame(byte[] b) {
        if(b==null||b.length<HEADER_BYTES||b.length>MAX_FRAME||b[0]!='X'||b[1]!='B'||b[2]!='O'||b[3]!='T'||(b[4]&255)!=OtaLayout.OTA_PROTOCOL_VERSION)return false;
        int payload=(b[6]&255)|((b[7]&255)<<8);
        if(payload>MAX_PAYLOAD||b.length!=HEADER_BYTES+payload)return false;
        CRC32 crc=new CRC32();crc.update(b,0,HEADER_BYTES-4);crc.update(b,HEADER_BYTES,payload);
        return crc.getValue()==u32(b,HEADER_BYTES-4);
    }
    static boolean validRequest(byte[] b) {
        if(!validFrame(b)||u32(b,8)==0)return false;
        int payload=b.length-HEADER_BYTES;
        switch(b[5]&255) {
            case OtaLayout.OTA_OP_INFO: case OtaLayout.OTA_OP_FINISH:return payload==0;
            case OtaLayout.OTA_OP_BEGIN:return payload==OtaLayout.OTA_MANIFEST_SIZE;
            case OtaLayout.OTA_OP_DATA:return payload>=5&&payload<=OtaLayout.OTA_DATA_MAX+4&&u32(b,HEADER_BYTES)%OtaLayout.OTA_PAGE_SIZE==0&&u32(b,HEADER_BYTES)<OtaLayout.OTA_APP_CAPACITY&&u32(b,HEADER_BYTES)+payload-4<=OtaLayout.OTA_APP_CAPACITY;
            default:return false;
        }
    }
    static long u32(byte[] b,int off) {
        return (b[off]&255L)|((b[off+1]&255L)<<8)|((b[off+2]&255L)<<16)|((b[off+3]&255L)<<24);
    }

    List<byte[]> receive(byte[] bytes,long now) {
        List<byte[]> frames=new ArrayList<>();
        if(!active||bytes==null||bytes.length==0)return frames;
        if(now-lastRx>=PARTIAL_TIMEOUT_MS)length=0;
        lastRx=now;
        // Consume byte by byte: even a noisy oversized notification cannot grow the buffer.
        for(byte value:bytes) {
            if(length==MAX_FRAME)shift();
            buffer[length++]=value;
            for(;;) {
                if(length<4)break;
                if(buffer[0]!='X'||buffer[1]!='B'||buffer[2]!='O'||buffer[3]!='T') {shift();continue;}
                if(length<HEADER_BYTES)break;
                int payload=(buffer[6]&255)|((buffer[7]&255)<<8);
                if((buffer[4]&255)!=OtaLayout.OTA_PROTOCOL_VERSION||payload>MAX_PAYLOAD) {shift();continue;}
                int total=HEADER_BYTES+payload;
                if(length<total)break;
                byte[] frame=Arrays.copyOf(buffer,total);
                if(!validFrame(frame)) {shift();continue;}
                System.arraycopy(buffer,total,buffer,0,length-total);length-=total;
                // Only the outstanding request, after its last chunk was submitted, can complete.
                if(pending!=null&&sent&&payload>=1&&(frame[5]&255)==((pending[5]&255)|OtaLayout.OTA_RESPONSE_FLAG)&&u32(frame,8)==u32(pending,8)) {
                    frames.add(frame);pending=null;sent=false;
                }
            }
        }
        return frames;
    }
    private void shift() {if(length>0){System.arraycopy(buffer,1,buffer,0,--length);}}
}
