package com.cardprogramming.app;
import java.nio.charset.StandardCharsets;
final class Tc01Frame {
    static boolean validEnding(String ending){return "".equals(ending)||"\r".equals(ending)||"\n".equals(ending)||"\r\n".equals(ending);}
    static byte[] stopped(String ending){return ("KEY_DATA=0000"+ending).getBytes(StandardCharsets.US_ASCII);}
    static boolean valid(byte[] bytes,String ending){
        if(bytes==null||!validEnding(ending)||bytes.length!=13+ending.length())return false;
        byte[] template=stopped(ending);
        for(int i=0;i<bytes.length;i++){
            if(i>=9&&i<13){if(bytes[i]!='0'&&bytes[i]!='1')return false;}
            else if(bytes[i]!=template[i])return false;
        }
        return !(bytes[9]=='1'&&bytes[10]=='1')&&!(bytes[11]=='1'&&bytes[12]=='1');
    }
}
