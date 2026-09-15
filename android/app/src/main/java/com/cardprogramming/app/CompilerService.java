package com.cardprogramming.app;

import android.app.Service;
import android.content.Intent;
import android.os.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;

/** Private, separate process. Native failure or timeout cannot kill the editor. */
public class CompilerService extends Service {
    static final int COMPILE = 1, CANCEL = 2, RESULT = 3;
    static final int MAX_SOURCE = 64 * 1024, MAX_OUTPUT = 256 * 1024;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final java.util.concurrent.ExecutorService worker = Executors.newSingleThreadExecutor();
    private boolean busy;
    private final Messenger endpoint = new Messenger(new Handler(Looper.getMainLooper(), msg -> {
        if (msg.what == CANCEL) { android.os.Process.killProcess(android.os.Process.myPid()); return true; }
        if (msg.what != COMPILE || busy || msg.replyTo == null) return true;
        busy = true;
        final Messenger receiver = msg.replyTo;
        final int requestId = msg.arg1;
        final String source = msg.getData().getString("source", "");
        // Handler runs independently of the native worker, including native infinite loops.
        final Runnable timeout = () -> android.os.Process.killProcess(android.os.Process.myPid());
        main.postDelayed(timeout, 15000);
        worker.execute(() -> {
            Bundle result = new Bundle();
            File input = new File(getCacheDir(), "card-compiler-input.py");
            File output = new File(getCacheDir(), "card-compiler-output.py.o");
            try {
                byte[] bytes = source.getBytes(StandardCharsets.UTF_8);
                if (bytes.length == 0 || bytes.length > MAX_SOURCE || source.indexOf('\0') >= 0)
                    throw new IOException("程序为空或超过编译长度限制。");
                if (output.exists() && !output.delete()) throw new IOException("无法清理旧编译结果。");
                try (FileOutputStream stream = new FileOutputStream(input)) { stream.write(bytes); }
                int status = CardCompilerNative.compileFiles(input.getAbsolutePath(), output.getAbsolutePath());
                if (status != 0) throw new IOException("程序编译失败（" + status + "）。");
                long size = output.length();
                if (size < 16 || size > MAX_OUTPUT) throw new IOException("编译结果大小无效或超出限制。");
                byte[] code = new byte[(int)size];
                try (DataInputStream stream = new DataInputStream(new FileInputStream(output))) { stream.readFully(code); }
                if (code[0] != 15 || code[1] != 'p' || code[2] != 'y' || code[3] != 'o')
                    throw new IOException("编译结果格式无效。");
                result.putByteArray("bytecode", code);
            } catch (Exception | LinkageError error) {
                result.putString("error", error.getMessage() == null ? "本机编译失败。" : error.getMessage());
            } finally {
                input.delete(); output.delete();
            }
            main.post(() -> {
                main.removeCallbacks(timeout);
                busy = false;
                Message reply = Message.obtain(null, RESULT);
                reply.arg1 = requestId;
                reply.setData(result);
                try { receiver.send(reply); } catch (RemoteException ignored) { }
            });
        });
        return true;
    }));
    @Override public IBinder onBind(Intent intent) { return endpoint.getBinder(); }
    @Override public void onDestroy() {
        worker.shutdownNow();
        super.onDestroy();
        // Interrupting a Java worker does not interrupt C. End this process on unbind.
        android.os.Process.killProcess(android.os.Process.myPid());
    }
}
