package com.cardprogramming.app;

final class CardCompilerNative {
    static { System.loadLibrary("card_compiler"); }
    private CardCompilerNative() {}
    static native int compileFiles(String input, String output);
}
