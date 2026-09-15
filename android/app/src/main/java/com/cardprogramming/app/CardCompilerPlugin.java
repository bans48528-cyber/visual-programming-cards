package com.cardprogramming.app;

import android.content.*;
import android.os.*;
import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "CardCompiler")
public class CardCompilerPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private Messenger remote;
    private PluginCall pending;
    private boolean bound;
    private boolean resetting;
    private final java.util.ArrayList<PluginCall> cancelCalls = new java.util.ArrayList<>();
    private int requestId;
    private final Runnable timeout = () -> fail("编译超时，请重试。", true);
    private final Messenger replies = new Messenger(new Handler(Looper.getMainLooper(), message -> {
        if (message.what != CompilerService.RESULT || pending == null || message.arg1 != requestId) return true;
        Bundle data = message.getData();
        String error = data.getString("error");
        if (error != null) { fail(error, false); return true; }
        byte[] bytes = data.getByteArray("bytecode");
        if (bytes == null) { fail("未收到编译结果。", false); return true; }
        PluginCall call = pending;
        pending = null;
        main.removeCallbacks(timeout);
        JSObject result = new JSObject();
        result.put("bytecode", Base64.encodeToString(bytes, Base64.NO_WRAP));
        result.put("bytes", bytes.length);
        result.put("compilerVersion", "pika-1.13.4-cards-1");
        call.resolve(result);
        return true;
    }));
    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder service) {
            remote = new Messenger(service);
            if (pending != null) send();
        }
        @Override public void onServiceDisconnected(ComponentName name) {
            remote = null;
            fail("编译进程已结束，请重试。", false);
            unbind();
            new java.io.File(getContext().getCacheDir(), "card-compiler-input.py").delete();
            new java.io.File(getContext().getCacheDir(), "card-compiler-output.py.o").delete();
            resetComplete();
        }
        @Override public void onBindingDied(ComponentName name) { onServiceDisconnected(name); }
        @Override public void onNullBinding(ComponentName name) { onServiceDisconnected(name); }
    };
    @PluginMethod public void compile(PluginCall call) {
        main.post(() -> {
            String source = call.getString("source");
            if (source == null || source.isEmpty() || source.indexOf('\0') >= 0 ||
                source.getBytes(StandardCharsets.UTF_8).length > CompilerService.MAX_SOURCE) {
                call.reject("程序为空或超过编译长度限制。"); return;
            }
            if (resetting) { call.reject("编译器正在重置，请稍后重试。"); return; }
            if (pending != null) { call.reject("已有程序正在编译。"); return; }
            pending = call;
            requestId++;
            main.postDelayed(timeout, 17000);
            if (remote != null) send();
            else if (!bound) {
                try {
                    bound = getContext().bindService(new Intent(getContext(), CompilerService.class), connection, Context.BIND_AUTO_CREATE);
                    if (!bound) fail("无法启动本机编译器。", false);
                } catch (RuntimeException error) { fail("无法启动本机编译器。", false); }
            }
        });
    }
    private void send() {
        Message message = Message.obtain(null, CompilerService.COMPILE);
        message.arg1 = requestId;
        Bundle data = new Bundle();
        data.putString("source", pending.getString("source"));
        message.setData(data);
        message.replyTo = replies;
        try { remote.send(message); } catch (RemoteException error) { fail("编译器连接中断，请重试。", true); }
    }
    private void unbind() {
        if (bound) { getContext().unbindService(connection); bound = false; }
        remote = null;
    }
    private void fail(String reason, boolean cancel) {
        main.removeCallbacks(timeout);
        if (pending != null) { PluginCall call = pending; pending = null; call.reject(reason); }
        if (cancel && !resetting) {
            if (remote == null) { unbind(); resetComplete(); return; }
            resetting = true;
            try {
                remote.send(Message.obtain(null, CompilerService.CANCEL));
            } catch (RemoteException ignored) { unbind(); resetComplete(); }
        }
    }
    private void resetComplete() {
        resetting = false;
        for (PluginCall call : cancelCalls) call.resolve();
        cancelCalls.clear();
    }
    @PluginMethod public void cancel(PluginCall call) {
        main.post(() -> {
            cancelCalls.add(call);
            if (resetting) return;
            if (pending != null) fail("编译已取消。", true);
            else resetComplete();
        });
    }
    @Override protected void handleOnPause() {
        main.post(() -> fail("已暂停编译。", true));
    }
    @Override protected void handleOnDestroy() {
        main.post(() -> { fail("编译已取消。", true); });
    }
}
