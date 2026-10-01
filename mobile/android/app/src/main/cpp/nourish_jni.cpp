// Java <-> nourish_llm glue for io.github.nourish.Llm.
#include <jni.h>
#include <cstring>
#include <string>
#include <vector>
#include "nourish_llm.h"

static void throw_error(JNIEnv * env, const char * msg) {
    jclass cls = env->FindClass("java/lang/RuntimeException");
    if (cls) env->ThrowNew(cls, msg);
}

static std::string to_string(JNIEnv * env, jstring s) {
    if (!s) return "";
    const char * c = env->GetStringUTFChars(s, nullptr);
    std::string out(c ? c : "");
    if (c) env->ReleaseStringUTFChars(s, c);
    return out;
}

// Java strings are modified UTF-8; a model can emit any byte sequence (even half a character),
// so build the result from raw bytes to avoid a JNI crash.
static jstring utf8_to_jstring(JNIEnv * env, const char * text) {
    const jsize len = (jsize) strlen(text);
    jbyteArray bytes = env->NewByteArray(len);
    env->SetByteArrayRegion(bytes, 0, len, reinterpret_cast<const jbyte *>(text));
    jclass str_cls = env->FindClass("java/lang/String");
    jmethodID ctor = env->GetMethodID(str_cls, "<init>", "([BLjava/lang/String;)V");
    jstring out = (jstring) env->NewObject(str_cls, ctor, bytes, env->NewStringUTF("UTF-8"));
    env->DeleteLocalRef(bytes);
    return out;
}

extern "C" JNIEXPORT jlong JNICALL
Java_io_github_nourish_Llm_load(JNIEnv * env, jclass, jstring path, jint n_ctx, jint gpu_layers, jint threads) {
    char err[512] = "";
    nl_engine * e = nl_load(to_string(env, path).c_str(), n_ctx, gpu_layers, threads, err, sizeof err);
    if (!e) { throw_error(env, err); return 0; }
    return reinterpret_cast<jlong>(e);
}

extern "C" JNIEXPORT jstring JNICALL
Java_io_github_nourish_Llm_generate(JNIEnv * env, jclass, jlong handle, jobjectArray roles, jobjectArray contents,
                                    jstring grammar, jfloat temperature, jint max_tokens) {
    const jsize n = env->GetArrayLength(roles);
    std::vector<std::string> r(n), c(n);
    std::vector<const char *> rp(n), cp(n);
    for (jsize i = 0; i < n; i++) {
        r[i] = to_string(env, (jstring) env->GetObjectArrayElement(roles, i));
        c[i] = to_string(env, (jstring) env->GetObjectArrayElement(contents, i));
        rp[i] = r[i].c_str();
        cp[i] = c[i].c_str();
    }
    std::string g = to_string(env, grammar);
    char err[512] = "";
    char * out = nl_generate(reinterpret_cast<nl_engine *>(handle), rp.data(), cp.data(), n,
                             g.empty() ? nullptr : g.c_str(), temperature, max_tokens, nullptr, nullptr, err, sizeof err);
    if (!out) { throw_error(env, err); return nullptr; }
    jstring result = utf8_to_jstring(env, out);
    nl_free_string(out);
    return result;
}

extern "C" JNIEXPORT void JNICALL
Java_io_github_nourish_Llm_cancel(JNIEnv *, jclass, jlong handle) {
    nl_cancel(reinterpret_cast<nl_engine *>(handle));
}

extern "C" JNIEXPORT jstring JNICALL
Java_io_github_nourish_Llm_describe(JNIEnv * env, jclass, jlong handle) {
    char buf[256] = "";
    nl_describe(reinterpret_cast<nl_engine *>(handle), buf, sizeof buf);
    return env->NewStringUTF(buf);
}

extern "C" JNIEXPORT void JNICALL
Java_io_github_nourish_Llm_free(JNIEnv *, jclass, jlong handle) {
    nl_free(reinterpret_cast<nl_engine *>(handle));
}
