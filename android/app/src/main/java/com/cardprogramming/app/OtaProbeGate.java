package com.cardprogramming.app;

/** Immutable-candidate read whitelist. GATT discovery is not device identity. */
final class OtaProbeGate {
    static boolean validProgramRead(byte[] bytes) {
        if(!ProgramFrame.valid(bytes)||(bytes[4]&255)!=0xc2)return false;
        int opcode=bytes[6]&255;
        // ProgramFrame supplies the exact envelope/checksum/reserved-byte bounds.
        return opcode==0x04 || opcode==0x56 || opcode==0x60;
    }
}
