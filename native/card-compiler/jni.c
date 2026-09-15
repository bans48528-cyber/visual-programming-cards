#include <jni.h>
#include "PikaCompiler.h"

/* The parser's diagnostics can include source. Java exposes status, not logcat. */
void pika_platform_printf(char* format, ...) { (void)format; }

/* Paths are generated in private app storage by CompilerService, never by JS. */
JNIEXPORT jint JNICALL
Java_com_cardprogramming_app_CardCompilerNative_compileFiles(
    JNIEnv* env, jclass type, jstring input, jstring output) {
    (void)type;
    const char* in = (*env)->GetStringUTFChars(env, input, NULL);
    if (!in) return -1;
    const char* out = (*env)->GetStringUTFChars(env, output, NULL);
    if (!out) {
        (*env)->ReleaseStringUTFChars(env, input, in);
        return -1;
    }
    int result = pikaCompileFileWithOutputName((char*)out, (char*)in);
    (*env)->ReleaseStringUTFChars(env, output, out);
    (*env)->ReleaseStringUTFChars(env, input, in);
    return result;
}
