package com.cardprogramming.app;
import java.nio.charset.StandardCharsets;
public final class Tc01FrameTest {
 static void check(boolean ok){if(!ok)throw new AssertionError();}
 public static void main(String[] args){
  for(String ending:new String[]{"","\r","\n","\r\n"}){
   check(Tc01Frame.valid(Tc01Frame.stopped(ending),ending));
   check(Tc01Frame.valid(("KEY_DATA=1001"+ending).getBytes(StandardCharsets.US_ASCII),ending));
   for(String bad:new String[]{"KEY_DATA=1100","KEY_DATA=0011","KEY_DATA=2000","KEY_DATA=10000","KEY_DATA=100","key_data=1000","AT+RESET"})check(!Tc01Frame.valid((bad+ending).getBytes(StandardCharsets.US_ASCII),ending));
  }
  check(!Tc01Frame.valid(Tc01Frame.stopped(""),null));check(!Tc01Frame.valid(Tc01Frame.stopped("\n"),""));
  System.out.println("PASS TC-01 native gate: exact ASCII, configured ending, binary digits, no conflicting motor directions, no AT/other frames.");
 }
}
