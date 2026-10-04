import Foundation

/// Paths inside the recipe folders, compared and cut safely.
///
/// On an iPhone the same folder has two spellings: /var/mobile/… and /private/var/… (/var is a
/// shortcut to /private/var). The folder Nourish asks for comes back as one, the files listed in it
/// can come back as the other. 0.1.10 cut "…/Documents/" off the front of a file's path as plain
/// text, so when the spellings differed "/private" stayed glued on ("/privateRecipe Books/x.pdf") and
/// no book was ever read. Here both sides are put in the same form first: symlinks resolved when the
/// files exist, then "/private" dropped, "." and ".." and double slashes removed. Inside
/// LiveContainer the Documents folder is deep inside another app's folder; that works the same way.
/// Plain Foundation only, so it's tested on its own (mobile/ios/Tests/main.swift).
enum LibraryPaths {
    /// One spelling for a path: /private/var/x → /var/x, "a//b/./c/../d/" → "a/b/d".
    static func normalize(_ path: String) -> String {
        var parts: [String] = []
        for piece in path.split(separator: "/", omittingEmptySubsequences: true) {
            if piece == "." { continue }
            if piece == ".." { if !parts.isEmpty { parts.removeLast() }; continue }
            parts.append(String(piece))
        }
        // /private/var, /private/tmp and /private/etc are the same places as /var, /tmp and /etc.
        if parts.count >= 2, parts[0] == "private", ["var", "tmp", "etc"].contains(parts[1]) { parts.removeFirst() }
        return "/" + parts.joined(separator: "/")
    }

    /// The real location of a file or folder: symlinks resolved when it exists, then normalized.
    static func canonical(_ url: URL) -> String {
        normalize(url.standardizedFileURL.resolvingSymlinksInPath().path)
    }

    /// The path of `path` inside `root` ("Recipe Books/Puerto Rican Cookery (2nd ed).pdf"), or nil
    /// when it isn't inside it. Both may use either spelling.
    static func relative(_ path: String, to root: String) -> String? {
        let p = normalize(path), r = normalize(root)
        if r == "/" { return p == "/" ? nil : String(p.dropFirst()) }
        guard p.hasPrefix(r + "/") else { return nil }
        let rel = String(p.dropFirst(r.count + 1))
        return rel.isEmpty ? nil : rel
    }

    /// A relative path from the app made safe: no leading slash, no "..", no stray "/private" glued
    /// on by an older version ("/privateRecipe Books/x.pdf" → "Recipe Books/x.pdf"). nil when it tries
    /// to leave the folder.
    static func clean(_ rel: String, folders: [String]) -> String? {
        var r = rel
        while r.hasPrefix("/") { r.removeFirst() }
        // An index saved by 0.1.10 can hold "privateRecipe Books/…": repaired here.
        for f in folders where r.hasPrefix("private" + f + "/") { r = String(r.dropFirst("private".count)) }
        if r.split(separator: "/").contains("..") { return nil }
        let n = normalize(r)
        return n == "/" ? nil : String(n.dropFirst())
    }
}
