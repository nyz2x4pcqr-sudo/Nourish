#include "nourish_llm.h"

#if __has_include(<llama/llama.h>)
#include <llama/llama.h>   // iOS: llama.cpp as llama.xcframework
#else
#include "llama.h"
#endif

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>

struct nl_engine {
    llama_model * model = nullptr;
    llama_context * ctx = nullptr;
    const llama_vocab * vocab = nullptr;
    std::atomic<bool> cancel{false};
    std::mutex busy;   // one request at a time
};

static void set_err(char * err, size_t len, const std::string & msg) {
    if (err && len) snprintf(err, len, "%s", msg.c_str());
}

static void quiet_log(enum ggml_log_level level, const char * text, void *) {
    if (level >= GGML_LOG_LEVEL_ERROR) fprintf(stderr, "%s", text);
}

static bool abort_cb(void * data) {
    return static_cast<std::atomic<bool> *>(data)->load();
}

nl_engine * nl_load(const char * model_path, int n_ctx, int n_gpu_layers, int n_threads, char * err, size_t err_len) {
    static std::once_flag init;
    std::call_once(init, [] {
        llama_log_set(quiet_log, nullptr);
        llama_backend_init();
    });

    auto * e = new nl_engine();
    llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = n_gpu_layers;
    e->model = llama_model_load_from_file(model_path, mp);
    if (!e->model) {
        set_err(err, err_len, "Couldn't load the model. The file may be damaged or not a GGUF model this version supports.");
        delete e;
        return nullptr;
    }
    e->vocab = llama_model_get_vocab(e->model);

    llama_context_params cp = llama_context_default_params();
    const int train_ctx = llama_model_n_ctx_train(e->model);
    cp.n_ctx = (uint32_t) (train_ctx > 0 && train_ctx < n_ctx ? train_ctx : n_ctx);
    cp.n_batch = 512;
    cp.n_ubatch = 512;
    cp.n_seq_max = 1;
    if (n_threads > 0) {
        cp.n_threads = n_threads;
        cp.n_threads_batch = n_threads;
    }
    cp.abort_callback = abort_cb;
    cp.abort_callback_data = &e->cancel;
    e->ctx = llama_init_from_model(e->model, cp);
    if (!e->ctx) {
        set_err(err, err_len, "Not enough memory to run this model. Try a smaller one.");
        llama_model_free(e->model);
        delete e;
        return nullptr;
    }
    return e;
}

static bool format_chat(nl_engine * e, const std::vector<llama_chat_message> & msgs, std::string & out) {
    const char * tmpl = llama_model_chat_template(e->model, nullptr);
    std::vector<char> buf(8192);
    for (const char * t : {tmpl, "chatml"}) {   // fall back to ChatML if the model's template isn't supported
        if (!t) continue;
        int n = llama_chat_apply_template(t, msgs.data(), msgs.size(), true, buf.data(), (int32_t) buf.size());
        if (n > (int) buf.size()) {
            buf.resize(n);
            n = llama_chat_apply_template(t, msgs.data(), msgs.size(), true, buf.data(), (int32_t) buf.size());
        }
        if (n >= 0) {
            out.assign(buf.data(), n);
            return true;
        }
    }
    return false;
}

char * nl_generate(nl_engine * e, const char ** roles, const char ** contents, int n_messages,
                   const char * grammar, float temperature, int max_tokens,
                   nl_progress_cb cb, void * user, char * err, size_t err_len) {
    if (!e) { set_err(err, err_len, "No model is loaded."); return nullptr; }
    std::lock_guard<std::mutex> lock(e->busy);
    e->cancel = false;

    std::vector<llama_chat_message> msgs;
    for (int i = 0; i < n_messages; i++) msgs.push_back({roles[i], contents[i]});
    std::string prompt;
    if (!format_chat(e, msgs, prompt)) { set_err(err, err_len, "This model has no chat format Nourish understands."); return nullptr; }

    const int n_ctx = (int) llama_n_ctx(e->ctx);
    const int n_prompt = -llama_tokenize(e->vocab, prompt.c_str(), (int32_t) prompt.size(), nullptr, 0, true, true);
    std::vector<llama_token> tokens(n_prompt);
    if (n_prompt <= 0 || llama_tokenize(e->vocab, prompt.c_str(), (int32_t) prompt.size(), tokens.data(), n_prompt, true, true) < 0) {
        set_err(err, err_len, "Couldn't read the request.");
        return nullptr;
    }
    if (n_prompt >= n_ctx - 16) {
        set_err(err, err_len, "The request is too long for this model's memory (" + std::to_string(n_prompt) + " of " + std::to_string(n_ctx) + " tokens).");
        return nullptr;
    }
    const int budget = std::min(max_tokens > 0 ? max_tokens : n_ctx, n_ctx - n_prompt);

    llama_memory_clear(llama_get_memory(e->ctx), true);

    llama_sampler * smpl = llama_sampler_chain_init(llama_sampler_chain_default_params());
    if (grammar && *grammar) {
        llama_sampler * g = llama_sampler_init_grammar(e->vocab, grammar, "root");
        if (!g) { llama_sampler_free(smpl); set_err(err, err_len, "Invalid output format (grammar)."); return nullptr; }
        llama_sampler_chain_add(smpl, g);
    }
    if (temperature <= 0.0f) {
        llama_sampler_chain_add(smpl, llama_sampler_init_greedy());
    } else {
        llama_sampler_chain_add(smpl, llama_sampler_init_min_p(0.05f, 1));
        llama_sampler_chain_add(smpl, llama_sampler_init_temp(temperature));
        llama_sampler_chain_add(smpl, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));
    }

    llama_batch_ext * batch = llama_batch_ext_init(e->ctx);
    const int n_batch = (int) llama_n_batch(e->ctx);
    std::string reply;
    std::string failure;
    int pos = 0;

    // Feed the prompt in chunks; logits only for its last token.
    for (int start = 0; start < n_prompt && failure.empty(); start += n_batch) {
        const int n = std::min(n_batch, n_prompt - start);
        llama_batch_ext_clear(batch);
        for (int i = 0; i < n; i++) {
            const int32_t idx = llama_batch_ext_add_token(batch, 0, tokens[start + i]);
            const llama_pos p = pos + i;
            llama_batch_ext_set_pos(batch, idx, &p);
        }
        if (start + n == n_prompt) llama_batch_ext_set_output_logits(batch, n - 1, true);
        const int ret = llama_process(e->ctx, LLAMA_PROCESS_TYPE_DECODE, batch);
        if (ret == 2) failure = "cancelled";
        else if (ret != 0) failure = "The model failed while reading the request (code " + std::to_string(ret) + ").";
        pos += n;
    }

    for (int generated = 0; failure.empty() && generated < budget && !e->cancel; generated++) {
        llama_token tok = llama_sampler_sample(smpl, e->ctx, -1);
        if (llama_vocab_is_eog(e->vocab, tok)) break;
        char piece[256];
        const int len = llama_token_to_piece(e->vocab, tok, piece, sizeof(piece), 0, false);
        if (len < 0) { failure = "Couldn't decode the model's output."; break; }
        reply.append(piece, len);
        if (cb && !cb(reply.c_str() + reply.size() - len, generated + 1, user)) break;

        llama_batch_ext_clear(batch);
        const int32_t idx = llama_batch_ext_add_token(batch, 0, tok);
        const llama_pos p = pos++;
        llama_batch_ext_set_pos(batch, idx, &p);
        llama_batch_ext_set_output_logits(batch, idx, true);
        const int ret = llama_process(e->ctx, LLAMA_PROCESS_TYPE_DECODE, batch);
        if (ret == 2) break;   // cancelled: keep what we have
        if (ret != 0) { failure = "The model stopped unexpectedly (code " + std::to_string(ret) + ")."; break; }
    }

    llama_batch_ext_free(batch);
    llama_sampler_free(smpl);
    if (failure == "cancelled") failure.clear();
    if (!failure.empty()) { set_err(err, err_len, failure); return nullptr; }
    return strdup(reply.c_str());
}

void nl_cancel(nl_engine * e) {
    if (e) e->cancel = true;
}

void nl_describe(nl_engine * e, char * buf, size_t buf_len) {
    if (!e || !buf || !buf_len) return;
    llama_model_desc(e->model, buf, buf_len);
}

void nl_free_string(char * s) { free(s); }

void nl_free(nl_engine * e) {
    if (!e) return;
    nl_cancel(e);
    std::lock_guard<std::mutex> lock(e->busy);
    llama_free(e->ctx);
    llama_model_free(e->model);
    delete e;
}
