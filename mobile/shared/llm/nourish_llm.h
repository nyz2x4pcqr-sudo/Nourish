// Nourish on-device AI: a small C interface over llama.cpp, shared by the iPhone (Swift) and
// Android (JNI) apps. One model is loaded at a time; each request starts from an empty context.
#pragma once

#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct nl_engine nl_engine;

// Called for each generated piece of text. `n_generated` counts tokens so far.
// Return false to stop early.
typedef bool (*nl_progress_cb)(const char * piece, int n_generated, void * user);

// Loads a GGUF model. n_gpu_layers: -1 = all on the GPU (Metal), 0 = CPU only.
// Returns NULL on failure, with a readable message in err.
nl_engine * nl_load(const char * model_path, int n_ctx, int n_gpu_layers, int n_threads, char * err, size_t err_len);

// Runs a chat completion. roles/contents are parallel arrays ("system", "user", "assistant").
// grammar: optional GBNF (root rule "root") that the output must follow, e.g. to force valid JSON.
// Returns the reply (free it with nl_free_string), or NULL on failure with a message in err.
char * nl_generate(nl_engine * e, const char ** roles, const char ** contents, int n_messages,
                   const char * grammar, float temperature, int max_tokens,
                   nl_progress_cb cb, void * user, char * err, size_t err_len);

// Stops a running nl_generate from another thread. It then returns the text so far.
void nl_cancel(nl_engine * e);

// Model details for display, e.g. "llama 1B Q4_K - Medium".
void nl_describe(nl_engine * e, char * buf, size_t buf_len);

void nl_free_string(char * s);
void nl_free(nl_engine * e);

#ifdef __cplusplus
}
#endif
