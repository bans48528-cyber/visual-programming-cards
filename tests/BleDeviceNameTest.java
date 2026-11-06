package com.cardprogramming.app;

public final class BleDeviceNameTest {
    private static int checks;
    private static void same(Object wanted,Object got) {
        checks++;if(!wanted.equals(got))throw new AssertionError("Expected "+wanted+", got "+got);
    }
    public static void main(String[] args) {
        BleDeviceName a=BleDeviceName.resolve("Spark_AI","BT_ECB0DC10B443");
        same("Spark_AI",a.name);same("advertisement",a.source);
        same("Spark_AI",a.advertisedName);same("BT_ECB0DC10B443",a.cachedName);
        a=BleDeviceName.resolve("  ","BT_ECB0DC10B443");same("BT_ECB0DC10B443",a.name);same("system-cache",a.source);
        a=BleDeviceName.resolve(null,"Spark_AI");same("Spark_AI",a.name);same("system-cache",a.source);same("",a.advertisedName);
        a=BleDeviceName.resolve("Spark_AI\0bad","Old name");same("Spark_AI",a.name);same("Spark_AI\0bad",a.advertisedName);same("advertisement",a.source);
        a=BleDeviceName.resolve("\0\0",null);same("未命名设备",a.name);same("unnamed",a.source);
        a=BleDeviceName.resolve("Other_Model","Spark_AI");same("Other_Model",a.name);same("advertisement",a.source);
        a=BleDeviceName.resolve("小白课堂","Old name");same("小白课堂",a.name);
        a=BleDeviceName.resolve("\r\n   \t", "Cached");same("Cached",a.name);same("system-cache",a.source);
        a=BleDeviceName.resolve(null,null);same("未命名设备",a.name);same("",a.cachedName);
        for(int code=0;code<32;code++) {
            if(code==0)continue;
            a=BleDeviceName.resolve("A"+(char)code+"B","Cached");same("AB",a.name);same("advertisement",a.source);
        }
        for(int code=127;code<=159;code++) {a=BleDeviceName.resolve("A"+(char)code+"B","Cached");same("AB",a.name);}
        System.out.println("Production BLE name selection: "+checks+" checks passed; no radio/device access.");
    }
}
