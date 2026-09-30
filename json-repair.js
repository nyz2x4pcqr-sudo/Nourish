// Lenient JSON parser for LLM output. Handles: code fences, prose around the JSON,
// // and /* */ comments, trailing commas, and output cut off mid-way (keeps every
// complete item and closes the open brackets).
function parseLLMJSON(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('The AI returned an empty response');
    const start = text.search(/[{[]/);
    if (start === -1) throw new Error('The AI response did not contain any JSON');
    const src = text.slice(start);

    let out = '';
    const stack = [];
    const cuts = []; // points where a complete value just ended: { len, closers }
    let inString = false;

    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (inString) {
            out += c;
            if (c === '\\') { out += src[++i] ?? ''; continue; }
            if (c === '"') inString = false;
            continue;
        }
        if (c === '"') { inString = true; out += c; continue; }
        if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
        if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e === -1 ? src.length : e + 1; continue; }
        if (c === '`') continue; // stray code-fence characters
        if (c === '{' || c === '[') { stack.push(c === '{' ? '}' : ']'); out += c; continue; }
        if (c === '}' || c === ']') {
            out = out.replace(/,\s*$/, ''); // trailing comma
            stack.pop();
            out += c;
            if (!stack.length) break; // top-level value complete; ignore anything after it
            cuts.push({ len: out.length, closers: stack.slice().reverse().join('') });
            continue;
        }
        out += c;
    }

    try {
        return JSON.parse(out);
    } catch (err) {
        // Truncated: roll back to the last complete item and close what is still open.
        for (let k = cuts.length - 1; k >= 0; k--) {
            const candidate = out.slice(0, cuts[k].len).replace(/,\s*$/, '') + cuts[k].closers;
            try { return JSON.parse(candidate); } catch (_) { /* try an earlier cut */ }
        }
        throw new Error('Could not read the AI response as JSON (' + err.message + ')');
    }
}

if (typeof module !== 'undefined') module.exports = { parseLLMJSON };
