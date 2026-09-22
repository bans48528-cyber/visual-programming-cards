package com.cardprogramming.app;

import android.Manifest;
import android.bluetooth.*;
import android.bluetooth.le.*;
import android.content.*;
import android.location.LocationManager;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.util.*;

/** Foreground-only Spark BLE byte transport. All mutable GATT state lives on main. */
@CapacitorPlugin(name="SparkBle", permissions={
    @Permission(alias="nearby", strings={Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT}),
    @Permission(alias="location", strings={Manifest.permission.ACCESS_FINE_LOCATION})
})
public class SparkBlePlugin extends Plugin {
    private static final UUID SERVICE=UUID.fromString("0000fff0-0000-1000-8000-00805f9b34fb");
    private static final UUID CHARACTERISTIC=UUID.fromString("0000fff1-0000-1000-8000-00805f9b34fb");
    private static final UUID WRITE_CHARACTERISTIC=UUID.fromString("0000fff2-0000-1000-8000-00805f9b34fb");
    private static final UUID CCCD=UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private final Handler main=new Handler(Looper.getMainLooper());
    private final Map<String,BluetoothDevice> found=new HashMap<>();
    private BluetoothAdapter adapter;
    private BluetoothLeScanner scanner;
    private ScanCallback scanCallback;
    private String scanId="", connectionId="", deviceId="";
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic characteristic, writeCharacteristic, fallbackCharacteristic;
    private PluginCall connectCall, operationCall;
    private String operation="";
    private boolean subscribed=false, foreground=true;
    private boolean remoteUsed=false;
    private String closingReason="";
    private final UploadGate uploadGate=new UploadGate();
    private int negotiatedMtu=23;
    private Runnable scanTimeout, connectTimeout, operationTimeout;
    private final BroadcastReceiver radioReceiver=new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            main.post(()->{
                if (!enabled()) {stopScanInternal("bluetoothOff"); closeConnection("手机蓝牙已关闭");}
                notifyListeners("adapterState",state());
            });
        }
    };
    @Override public void load() {
        BluetoothManager manager=(BluetoothManager)getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        adapter=manager==null?null:manager.getAdapter();
        ContextCompat.registerReceiver(getContext(),radioReceiver,new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED),ContextCompat.RECEIVER_EXPORTED);
    }
    private String permissionAlias() {return Build.VERSION.SDK_INT>=31?"nearby":"location";}
    private boolean allowed() {return getPermissionState(permissionAlias())==PermissionState.GRANTED;}
    private boolean enabled() {try {return adapter!=null && adapter.isEnabled();} catch(SecurityException e) {return false;}}
    private boolean locationEnabled() {
        if(Build.VERSION.SDK_INT>=31) return true;
        LocationManager manager=(LocationManager)getContext().getSystemService(Context.LOCATION_SERVICE);
        if(manager==null) return false;
        if(Build.VERSION.SDK_INT>=28) return manager.isLocationEnabled();
        return manager.isProviderEnabled(LocationManager.GPS_PROVIDER)||manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
    }
    private JSObject state() {
        JSObject result=new JSObject();
        result.put("available",adapter!=null);
        result.put("permissionsGranted",allowed());
        result.put("permissionState",getPermissionState(permissionAlias()).toString());
        result.put("bluetoothEnabled",enabled());
        result.put("locationEnabled",locationEnabled());
        result.put("requiresLocation",Build.VERSION.SDK_INT<31);
        result.put("scanning",scanCallback!=null);
        result.put("connected",gatt!=null && characteristic!=null && subscribed);
        result.put("connectionId",connectionId);
        result.put("deviceId",deviceId);
        return result;
    }
    @PluginMethod public void getState(PluginCall call) {main.post(()->call.resolve(state()));}
    @PluginMethod public void requestAccess(PluginCall call) {
        if(allowed()) {getState(call);return;}
        requestPermissionForAlias(permissionAlias(),call,"accessResult");
    }
    @PermissionCallback private void accessResult(PluginCall call) {getState(call);}
    @PluginMethod public void openSettings(PluginCall call) {
        main.post(()->{
            String target=call.getString("target","bluetooth");
            Intent intent=new Intent(target.equals("location")?Settings.ACTION_LOCATION_SOURCE_SETTINGS:
                target.equals("app")?Settings.ACTION_APPLICATION_DETAILS_SETTINGS:Settings.ACTION_BLUETOOTH_SETTINGS);
            if(target.equals("app")) intent.setData(Uri.parse("package:"+getContext().getPackageName()));
            try {getActivity().startActivity(intent);call.resolve();}
            catch(Exception e) {call.reject("无法打开系统设置，请手动进入手机设置。");}
        });
    }
    private boolean ready(PluginCall call, boolean scanning) {
        if(!foreground) {call.reject("应用已进入后台，请返回后重试。");return false;}
        if(!allowed()) {call.reject("请允许蓝牙扫描所需的权限。","PERMISSION_DENIED");return false;}
        if(!enabled()) {call.reject("请先打开手机蓝牙。","BLUETOOTH_OFF");return false;}
        if(scanning && !locationEnabled()) {call.reject("Android 11 及更早版本扫描蓝牙需要开启系统定位。","LOCATION_OFF");return false;}
        return true;
    }
    @PluginMethod public void startScan(PluginCall call) {main.post(()->{
        if(!ready(call,true)) return;
        if(gatt!=null) {call.reject("请先断开当前设备再扫描。");return;}
        stopScanInternal("replaced");found.clear();scanId=call.getString("scanId","");
        final String ticket=scanId;
        scanCallback=new ScanCallback() {
            @Override public void onScanResult(int type,ScanResult result) {main.post(()->{
                if(scanCallback!=this || !ticket.equals(scanId)) return;
                String name=result.getScanRecord()==null?null:result.getScanRecord().getDeviceName();
                try {if(name==null) name=result.getDevice().getName();} catch(SecurityException ignored) {}
                if(name==null || name.isEmpty()) return;
                String id=result.getDevice().getAddress();
                found.put(id,result.getDevice());
                JSObject row=new JSObject();row.put("scanId",ticket);row.put("deviceId",id);row.put("name",name);row.put("rssi",result.getRssi());
                notifyListeners("scanResult",row);
            });}
            @Override public void onScanFailed(int code) {main.post(()->{
                if(scanCallback!=this) return;
                stopScanInternal("扫描失败（"+code+"），请稍后重试。");
            });}
        };
        try {
            scanner=adapter.getBluetoothLeScanner();
            if(scanner==null) throw new IllegalStateException();
            // Do not require an advertised FFF0: some Spark firmware advertises only its name.
            scanner.startScan(null,new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),scanCallback);
            scanTimeout=()->{if(ticket.equals(scanId)) stopScanInternal("finished");};
            main.postDelayed(scanTimeout,10000);
            call.resolve();
        } catch(Exception e) {stopScanInternal("failed");call.reject("无法开始扫描，请检查蓝牙和定位设置。");}
    });}
    @PluginMethod public void stopScan(PluginCall call) {main.post(()->{stopScanInternal("cancelled");call.resolve();});}
    private void stopScanInternal(String reason) {
        if(scanTimeout!=null) main.removeCallbacks(scanTimeout);
        ScanCallback previous=scanCallback;scanCallback=null;
        if(previous==null) return;
        try {if(scanner!=null) scanner.stopScan(previous);} catch(Exception ignored) {}
        JSObject event=new JSObject();event.put("scanId",scanId);event.put("reason",reason);
        notifyListeners("scanStopped",event);
    }
    @PluginMethod public void connect(PluginCall call) {main.post(()->{
        if(!ready(call,false)) return;
        String id=call.getString("deviceId","");
        BluetoothDevice device=found.get(id);
        if(device==null) {call.reject("设备不在本次扫描结果中，请重新搜索。");return;}
        stopScanInternal("connecting");closeConnection("切换连接");
        connectionId=call.getString("connectionId","");deviceId=id;connectCall=call;
        try {
            gatt=device.connectGatt(getContext(),false,callback,BluetoothDevice.TRANSPORT_LE);
            if(gatt==null) throw new IllegalStateException();
            connectTimeout=()->closeConnection("连接超时，请靠近主机并检查是否被其他应用占用。");
            main.postDelayed(connectTimeout,15000);
        } catch(Exception e) {closeConnection("无法建立连接，请检查权限和手机蓝牙。");}
    });}
    private boolean matches(PluginCall call) {
        if(!closingReason.isEmpty()) {call.reject("连接正在关闭。");return false;}
        if(!ready(call,false)) return false;
        if(gatt==null || characteristic==null || writeCharacteristic==null || !connectionId.equals(call.getString("connectionId",""))) {
            call.reject("连接已变化，请重新连接。");return false;
        }
        if(operationCall!=null) {call.reject("上一条蓝牙操作尚未完成。");return false;}
        return true;
    }
    private void beginOperation(PluginCall call,String name) {
        operationCall=call;operation=name;
        operationTimeout=()->closeConnection("蓝牙操作超时，连接已关闭，请重新连接。");
        main.postDelayed(operationTimeout,5000);
    }
    private void finishOperation(int status) {
        if(status!=BluetoothGatt.GATT_SUCCESS) {closeConnection("蓝牙操作失败（GATT "+status+"），请重新连接。");return;}
        if(operationTimeout!=null) main.removeCallbacks(operationTimeout);
        PluginCall call=operationCall;operationCall=null;operation="";
        if(call!=null) call.resolve();
        if(!closingReason.isEmpty()) releaseAndClose(closingReason);
    }
    @PluginMethod public void subscribe(PluginCall call) {main.post(()->{
        if(!matches(call)) return;
        if(subscribed) {call.resolve();return;}
        beginOperation(call,"subscribe");
        try {
            BluetoothGattDescriptor descriptor=characteristic.getDescriptor(CCCD);
            if(descriptor==null || !gatt.setCharacteristicNotification(characteristic,true)) throw new IllegalStateException();
            byte[] value=(characteristic.getProperties()&BluetoothGattCharacteristic.PROPERTY_NOTIFY)!=0
                ? BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE:BluetoothGattDescriptor.ENABLE_INDICATION_VALUE;
            boolean accepted;
            if(Build.VERSION.SDK_INT>=33) accepted=gatt.writeDescriptor(descriptor,value)==BluetoothStatusCodes.SUCCESS;
            else {descriptor.setValue(value);accepted=gatt.writeDescriptor(descriptor);}
            if(!accepted) throw new IllegalStateException();
        } catch(Exception e) {closeConnection("无法订阅主机通知，请重新连接。");}
    });}
    @PluginMethod public void prepareUpload(PluginCall call) {main.post(()->{
        if(!matches(call)) return;
        if(!subscribed) {call.reject("请先订阅主机通知。");return;}
        if(uploadGate.active()) {call.reject("已有文件正在发送。");return;}
        try {uploadGate.begin(call.getInt("bytes",0),call.getInt("slot",0),call.getBoolean("run",false));}
        catch(IllegalArgumentException error) {call.reject(error.getMessage());return;}
        if(negotiatedMtu>=138) {JSObject result=new JSObject();result.put("mtu",negotiatedMtu);call.resolve(result);return;}
        beginOperation(call,"mtu");
        try {if(!gatt.requestMtu(512)) throw new IllegalStateException();}
        catch(Exception error) {closeConnection("无法协商发送所需的 MTU，请重新连接。");}
    });}
    @PluginMethod public void finishUpload(PluginCall call) {main.post(()->{
        if(connectionId.equals(call.getString("connectionId",""))) uploadGate.reset();
        call.resolve();
    });}
    @PluginMethod public void write(PluginCall call) {main.post(()->{
        if(!matches(call)) return;
        if(!subscribed) {call.reject("请先订阅设备通知。");return;}
        byte[] bytes;
        try {bytes=Base64.decode(call.getString("data",""),Base64.NO_WRAP);} catch(Exception e) {call.reject("无效的蓝牙数据。");return;}
        // Only the fixed 17-byte remote and programming frames are allowed.
        boolean remote=RemoteFrame.valid(bytes);
        boolean programming=ProgramFrame.valid(bytes);
        if(remote && uploadGate.active()) {call.reject("程序发送期间不能使用遥控。");return;}
        if(!remote && !programming) {call.reject("无效的小白控制指令。");return;}
        if(remote) remoteUsed=true;
        beginOperation(call,"write");
        BluetoothGattCharacteristic target=writeCharacteristic;
        int type=(target.getProperties()&BluetoothGattCharacteristic.PROPERTY_WRITE)!=0
            ? BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT:BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE;
        try {
            boolean accepted;
            if(Build.VERSION.SDK_INT>=33) accepted=gatt.writeCharacteristic(target,bytes,type)==BluetoothStatusCodes.SUCCESS;
            else {target.setWriteType(type);target.setValue(bytes);accepted=gatt.writeCharacteristic(target);}
            if(!accepted) throw new IllegalStateException();
        } catch(Exception e) {closeConnection("蓝牙写入失败，连接已关闭，未自动重发。");}
    });}
    @PluginMethod public void useFallbackWrite(PluginCall call) {main.post(()->{
        if(!matches(call)) return;
        if(fallbackCharacteristic==null) {call.reject("设备没有可用的备用写入特征。");return;}
        writeCharacteristic=fallbackCharacteristic;
        call.resolve();
    });}
    @PluginMethod public void disconnect(PluginCall call) {main.post(()->{
        // A delayed JS cleanup must not tear down a newer connection.
        String expected=call.getString("connectionId",connectionId);
        if(expected.equals(connectionId)) releaseAndClose("已断开连接");
        call.resolve();
    });}
    private void releaseAndClose(String reason) {
        closingReason=reason;
        if(operation.equals("release")) return;
        if(!remoteUsed || gatt==null || !subscribed) {closeConnection(reason);return;}
        if(!operation.isEmpty()) return;
        remoteUsed=false;
        operation="release";
        operationTimeout=()->closeConnection(reason);
        main.postDelayed(operationTimeout,1000);
        BluetoothGattCharacteristic target=writeCharacteristic;
        int type=(target.getProperties()&BluetoothGattCharacteristic.PROPERTY_WRITE)!=0
            ? BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT:BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE;
        try {
            byte[] bytes=RemoteFrame.released();
            boolean accepted;
            if(Build.VERSION.SDK_INT>=33) accepted=gatt.writeCharacteristic(target,bytes,type)==BluetoothStatusCodes.SUCCESS;
            else {target.setWriteType(type);target.setValue(bytes);accepted=gatt.writeCharacteristic(target);}
            if(!accepted) closeConnection(reason);
        } catch(Exception ignored) {closeConnection(reason);}
    }
    private void closeConnection(String reason) {
        uploadGate.reset();negotiatedMtu=23;
        closingReason="";remoteUsed=false;
        if(connectTimeout!=null) main.removeCallbacks(connectTimeout);
        if(operationTimeout!=null) main.removeCallbacks(operationTimeout);
        BluetoothGatt previous=gatt;gatt=null;characteristic=null;writeCharacteristic=null;fallbackCharacteristic=null;subscribed=false;
        String ticket=connectionId;connectionId="";deviceId="";
        PluginCall pendingConnect=connectCall,pendingOperation=operationCall;
        connectCall=null;operationCall=null;operation="";
        if(pendingConnect!=null) pendingConnect.reject(reason);
        if(pendingOperation!=null) pendingOperation.reject(reason);
        try {if(previous!=null) previous.disconnect();} catch(Exception ignored) {}
        try {if(previous!=null) previous.close();} catch(Exception ignored) {}
        if(!ticket.isEmpty()) {JSObject event=new JSObject();event.put("connectionId",ticket);event.put("reason",reason);notifyListeners("disconnected",event);}
    }
    private void receive(BluetoothGatt source,BluetoothGattCharacteristic item,byte[] value) {
        if(source!=gatt || !CHARACTERISTIC.equals(item.getUuid()) || value==null) return;
        JSObject event=new JSObject();event.put("connectionId",connectionId);event.put("data",Base64.encodeToString(value,Base64.NO_WRAP));
        notifyListeners("notification",event);
    }
    private final BluetoothGattCallback callback=new BluetoothGattCallback() {
        @Override public void onMtuChanged(BluetoothGatt source,int mtu,int status) {main.post(()->{
            if(source!=gatt) return;
            if(status==BluetoothGatt.GATT_SUCCESS) negotiatedMtu=mtu;
            if(!operation.equals("mtu")) return;
            if(status!=BluetoothGatt.GATT_SUCCESS||mtu<138) {closeConnection("主机 MTU 不足，无法发送 128 字节程序分包。");return;}
            if(operationTimeout!=null) main.removeCallbacks(operationTimeout);
            PluginCall call=operationCall;operationCall=null;operation="";
            if(call!=null) {JSObject result=new JSObject();result.put("mtu",mtu);call.resolve(result);}
            if(!closingReason.isEmpty()) releaseAndClose(closingReason);
        });}
        @Override public void onConnectionStateChange(BluetoothGatt source,int status,int newState) {main.post(()->{
            if(source!=gatt) return;
            if(status!=BluetoothGatt.GATT_SUCCESS || newState==BluetoothProfile.STATE_DISCONNECTED) {closeConnection("主机连接已断开（GATT "+status+"）。");return;}
            if(newState==BluetoothProfile.STATE_CONNECTED) {
                try {if(!source.discoverServices()) closeConnection("无法发现主机服务。");}
                catch(Exception e) {closeConnection("服务发现失败，请检查蓝牙权限。");}
            }
        });}
        @Override public void onServicesDiscovered(BluetoothGatt source,int status) {main.post(()->{
            if(source!=gatt || connectCall==null) return;
            if(status!=BluetoothGatt.GATT_SUCCESS) {closeConnection("服务发现失败（GATT "+status+"）。");return;}
            BluetoothGattService service=source.getService(SERVICE);
            characteristic=service==null?null:service.getCharacteristic(CHARACTERISTIC);
            if(characteristic==null) {closeConnection("未找到 Spark_AI 的 FFF0 / FFF1 服务，请检查主机型号。");return;}
            int p=characteristic.getProperties();
            if((p&(BluetoothGattCharacteristic.PROPERTY_NOTIFY|BluetoothGattCharacteristic.PROPERTY_INDICATE))==0) {closeConnection("主机不支持所需的通知能力。");return;}
            fallbackCharacteristic=(p&(BluetoothGattCharacteristic.PROPERTY_WRITE|BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE))!=0?characteristic:null;
            BluetoothGattCharacteristic preferred=service.getCharacteristic(WRITE_CHARACTERISTIC);
            if(preferred!=null&&(preferred.getProperties()&(BluetoothGattCharacteristic.PROPERTY_WRITE|BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE))!=0) writeCharacteristic=preferred;
            else writeCharacteristic=fallbackCharacteristic;
            if(writeCharacteristic==null) {closeConnection("主机不支持所需的写入能力。");return;}
            main.removeCallbacks(connectTimeout);
            JSObject result=new JSObject(),properties=new JSObject();
            properties.put("notify",(p&BluetoothGattCharacteristic.PROPERTY_NOTIFY)!=0);
            properties.put("indicate",(p&BluetoothGattCharacteristic.PROPERTY_INDICATE)!=0);
            int wp=writeCharacteristic.getProperties();
            properties.put("write",(wp&BluetoothGattCharacteristic.PROPERTY_WRITE)!=0);
            properties.put("writeWithoutResponse",(wp&BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)!=0);
            properties.put("fallbackWrite",fallbackCharacteristic!=null&&fallbackCharacteristic!=writeCharacteristic);
            properties.put("writeCharacteristic",writeCharacteristic.getUuid().toString());
            result.put("properties",properties);result.put("connectionId",connectionId);
            PluginCall call=connectCall;connectCall=null;call.resolve(result);
        });}
        @Override public void onDescriptorWrite(BluetoothGatt source,BluetoothGattDescriptor descriptor,int status) {main.post(()->{
            if(source!=gatt || !CCCD.equals(descriptor.getUuid()) || !operation.equals("subscribe")) return;
            if(status==BluetoothGatt.GATT_SUCCESS) subscribed=true;
            finishOperation(status);
        });}
        @Override public void onCharacteristicWrite(BluetoothGatt source,BluetoothGattCharacteristic item,int status) {main.post(()->{
            if(source==gatt && writeCharacteristic!=null && writeCharacteristic.getUuid().equals(item.getUuid()) && operation.equals("release")) {closeConnection(closingReason);return;}
            if(source==gatt && writeCharacteristic!=null && writeCharacteristic.getUuid().equals(item.getUuid()) && operation.equals("write")) finishOperation(status);
        });}
        @Override public void onCharacteristicChanged(BluetoothGatt source,BluetoothGattCharacteristic item) {
            byte[] value=item.getValue();byte[] copy=value==null?null:value.clone();main.post(()->receive(source,item,copy));
        }
        @Override public void onCharacteristicChanged(BluetoothGatt source,BluetoothGattCharacteristic item,byte[] value) {
            byte[] copy=value.clone();main.post(()->receive(source,item,copy));
        }
    };
    @Override protected void handleOnResume() {main.post(()->{foreground=true;notifyListeners("adapterState",state());});}
    @Override protected void handleOnStop() {main.post(()->{foreground=false;stopScanInternal("background");releaseAndClose("应用已进入后台，连接已断开，请返回后重新连接。");});}
    @Override protected void handleOnDestroy() {
        main.post(()->{foreground=false;stopScanInternal("destroyed");closeConnection("应用已关闭");});
        try {getContext().unregisterReceiver(radioReceiver);} catch(Exception ignored) {}
    }
}
