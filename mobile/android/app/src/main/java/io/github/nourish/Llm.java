package io.github.nourish;

/** The on-device AI engine (llama.cpp through mobile/shared/llm/nourish_llm). */
final class Llm {
    static {
        System.loadLibrary("nourish_llm");
    }

    private Llm() {}

    /** Loads a GGUF model; throws RuntimeException with a readable message on failure. */
    static native long load(String path, int nCtx, int gpuLayers, int threads);

    /** Runs a chat; grammar (GBNF) may be null. Throws RuntimeException on failure. */
    static native String generate(long handle, String[] roles, String[] contents, String grammar, float temperature, int maxTokens);

    /** Stops a running generate() from another thread; it then returns the text so far. */
    static native void cancel(long handle);

    static native String describe(long handle);

    static native void free(long handle);
}
