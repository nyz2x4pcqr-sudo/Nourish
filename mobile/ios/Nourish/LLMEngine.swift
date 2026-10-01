import Foundation

/// The on-device AI engine: llama.cpp through the shared C interface in mobile/shared/llm.
/// One model is loaded at a time. Calls other than cancel() must come from one queue.
final class LLMEngine {
    struct EngineError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private var engine: OpaquePointer?
    private var loadedKey: String?
    private(set) var cancelRequested = false

    func ensureLoaded(path: String, nCtx: Int, gpu: Bool) throws {
        let key = "\(path)|\(nCtx)|\(gpu)"
        if engine != nil && key == loadedKey { return }
        unload()
        #if targetEnvironment(simulator)
        let gpuLayers: Int32 = 0              // the simulator has no usable Metal for this
        #else
        let gpuLayers: Int32 = gpu ? -1 : 0   // -1: every layer on the GPU
        #endif
        let threads = Int32(max(2, min(4, ProcessInfo.processInfo.activeProcessorCount - 2)))
        var err = [CChar](repeating: 0, count: 512)
        let loaded = err.withUnsafeMutableBufferPointer { buf in
            nl_load(path, Int32(nCtx), gpuLayers, threads, buf.baseAddress, buf.count)
        }
        guard let loaded else { throw EngineError(message: String(cString: err)) }
        engine = loaded
        loadedKey = key
    }

    func generate(messages: [(role: String, content: String)], grammar: String?, temperature: Float, maxTokens: Int) throws -> String {
        guard let engine else { throw EngineError(message: "No model is loaded.") }
        cancelRequested = false
        var roles: [UnsafePointer<CChar>?] = messages.map { UnsafePointer(strdup($0.role)) }
        var contents: [UnsafePointer<CChar>?] = messages.map { UnsafePointer(strdup($0.content)) }
        defer {
            for p in roles { free(UnsafeMutablePointer(mutating: p)) }
            for p in contents { free(UnsafeMutablePointer(mutating: p)) }
        }
        var err = [CChar](repeating: 0, count: 512)
        let count = Int32(messages.count)
        let out: UnsafeMutablePointer<CChar>? = roles.withUnsafeMutableBufferPointer { r in
            contents.withUnsafeMutableBufferPointer { c in
                err.withUnsafeMutableBufferPointer { e in
                    if let grammar {
                        return grammar.withCString { g in
                            nl_generate(engine, r.baseAddress, c.baseAddress, count, g, temperature, Int32(maxTokens), nil, nil, e.baseAddress, e.count)
                        }
                    }
                    return nl_generate(engine, r.baseAddress, c.baseAddress, count, nil, temperature, Int32(maxTokens), nil, nil, e.baseAddress, e.count)
                }
            }
        }
        guard let out else { throw EngineError(message: String(cString: err)) }
        defer { nl_free_string(out) }
        // A model can stop halfway through a character; decoding this way never fails.
        return String(decoding: Data(bytes: out, count: strlen(out)), as: UTF8.self)
    }

    /// Safe to call from any thread: stops the running generate(), which returns the text so far.
    func cancel() {
        cancelRequested = true
        if let engine { nl_cancel(engine) }
    }

    func unload() {
        if let engine { nl_free(engine) }
        engine = nil
        loadedKey = nil
    }

    func isLoaded(path: String) -> Bool {
        loadedKey?.hasPrefix(path + "|") == true
    }
}
