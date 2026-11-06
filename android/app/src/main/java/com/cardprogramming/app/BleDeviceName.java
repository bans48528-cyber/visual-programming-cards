package com.cardprogramming.app;

/** Keeps a BLE advertising name separate from Android's cached device name.
 * No model-specific substitution and no writes to user aliases or the radio.
 */
final class BleDeviceName {
    final String name, advertisedName, cachedName, source;

    private BleDeviceName(String name,String advertisedName,String cachedName,String source) {
        this.name=name;this.advertisedName=advertisedName;this.cachedName=cachedName;this.source=source;
    }
    static BleDeviceName resolve(String advertised,String cached) {
        String a=clean(advertised),c=clean(cached);
        return new BleDeviceName(!a.isEmpty()?a:!c.isEmpty()?c:"未命名设备",
            advertised==null?"":advertised,cached==null?"":cached,
            !a.isEmpty()?"advertisement":!c.isEmpty()?"system-cache":"unnamed");
    }
    static String clean(String value) {
        if(value==null)return "";
        // An incorrectly sized module AT name may leave a NUL and trailing bytes.
        // Keep the original in metadata; presentation stops at the terminator.
        int end=value.indexOf('\0');
        if(end>=0)value=value.substring(0,end);
        StringBuilder result=new StringBuilder();
        for(int i=0;i<value.length();i++)if(!Character.isISOControl(value.charAt(i)))result.append(value.charAt(i));
        return result.toString().trim();
    }
}
