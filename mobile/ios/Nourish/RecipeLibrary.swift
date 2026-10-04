import Foundation
import PDFKit
import UIKit
import UniformTypeIdentifiers

/// The personal recipe library on the iPhone: Documents/Recipe Books and Documents/My Recipes,
/// shown in the Files app under On My iPhone → Nourish (UIFileSharingEnabled and
/// LSSupportsOpeningDocumentsInPlace in Info.plist; inside LiveContainer they're in LiveContainer's
/// folder instead, see location()). The web app lists and reads them (library.js).
enum RecipeLibrary {
    static let folders = ["Recipe Books", "My Recipes"]
    static let kinds: [String: String] = ["txt": "text", "text": "text", "md": "text", "markdown": "text", "html": "html", "htm": "html",
                                          "webarchive": "html", "mhtml": "html", "pdf": "pdf", "jpg": "image", "jpeg": "image",
                                          "png": "image", "heic": "image", "webp": "image", "epub": "epub", "docx": "docx",
                                          "mobi": "kindle", "azw": "kindle", "azw3": "kindle", "kfx": "kindle"]
    static let maxBytes = 40 * 1024 * 1024
    /// Books (EPUB, Word) are read a slice at a time (range), so they can be much bigger.
    static let maxBookBytes = 400 * 1024 * 1024
    static let maxSlice = 8 * 1024 * 1024

    static var root: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }

    static let readmeName = "Read me.txt"
    static let readmes: [String: String] = [
        "Recipe Books": """
        Recipe Books

        Drop cookbooks here: EPUB or PDF books, Word, text or Markdown files, saved web pages, or photos of pages.
        Nourish reads them in the background and learns from them: which ingredients go together,
        how dishes are seasoned and cooked. Their recipes can also turn up in your plans, next to
        recipes from other places.

        Scanned books work best as photos (one page per photo).
        You can also add files from Nourish: Settings → Recipes → Add files.
        """,
        "My Recipes": """
        My Recipes

        Drop your own recipes here: family recipes, notes, saved web pages or photos of recipe cards.
        Each one needs a title, a list of ingredients and the steps.
        Nourish reads them in the background and can use them in your plans.

        You can also add files from Nourish: Settings → Recipes → Add files.
        """,
    ]

    /// Creates the folders, each with a short "Read me", so they're never empty (the Files app
    /// doesn't show an app with an empty Documents folder). Runs at every launch; cheap.
    static func setUp() {
        let fm = FileManager.default
        for name in folders {
            let dir = root.appendingPathComponent(name, isDirectory: true)
            if !fm.fileExists(atPath: dir.path) { try? fm.createDirectory(at: dir, withIntermediateDirectories: true) }
            let readme = dir.appendingPathComponent(readmeName)
            if !fm.fileExists(atPath: readme.path) { try? (readmes[name] ?? "").write(to: readme, atomically: true, encoding: .utf8) }
        }
        let about = root.appendingPathComponent("About these folders.txt")
        if !fm.fileExists(atPath: about.path) {
            try? """
            Put cookbooks in "Recipe Books" and your own recipes in "My Recipes": PDF, text, Markdown, \
            EPUB, Word, saved web pages or photos. Nourish reads them and learns from them.
            """.write(to: about, atomically: true, encoding: .utf8)
        }
    }

    /// Where the folders are in the Files app. Installed normally: On My iPhone → Nourish. Inside
    /// LiveContainer, Nourish's files live in LiveContainer's own folder (its Data → Application →
    /// <app folder>), because iOS only knows LiveContainer is installed.
    static func location() -> [String: Any] {
        let path = root.standardizedFileURL.path
        var display = "On My iPhone › Nourish"
        var inContainer = false
        if let range = path.range(of: "/Documents/Data/Application/") {
            inContainer = true
            let inner = path[range.upperBound...].split(separator: "/").map(String.init)   // <app folder>/Documents
            display = (["On My iPhone", "LiveContainer", "Data", "Application"] + inner).joined(separator: " › ")
        } else if !NativeBridge.environment().contains("looks like a normally installed app") {
            inContainer = true
            display = "Inside the app that runs Nourish (not a Nourish folder): use Add files"
        }
        let plist = Bundle.main.infoDictionary ?? [:]
        let sharing = (plist["UIFileSharingEnabled"] as? Bool ?? false) && (plist["LSSupportsOpeningDocumentsInPlace"] as? Bool ?? false)
        let made = folders.allSatisfy { FileManager.default.fileExists(atPath: root.appendingPathComponent($0).path) }
        return ["folder": display, "path": path, "container": inContainer, "fileSharing": sharing, "foldersMade": made]
    }

    /// The system file picker (a second way in): the chosen files are copied into My Recipes,
    /// or Recipe Books for PDFs bigger than 3 MB (most likely books). Blocks until the person is done.
    /// `progress` is told how the copying goes ({ state: "copying", done, total, name } then "done"),
    /// so the app can show it: big books take a while, and this never blocks the app's screen.
    static func pick(progress: @escaping ([String: Any]) -> Void = { _ in }) throws -> [String: Any] {
        setUp()
        let done = DispatchSemaphore(value: 0)
        var picked: [URL] = []
        DispatchQueue.main.async {
            let types: [UTType] = [.pdf, .plainText, .text, .html, .webArchive, .image, .jpeg, .png, .heic, .epub]
                + ["md", "markdown", "mhtml", "webp", "docx", "mobi", "azw", "azw3"].compactMap { UTType(filenameExtension: $0) }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
            picker.allowsMultipleSelection = true
            let delegate = PickerDelegate { urls in picked = urls; done.signal() }
            picker.delegate = delegate
            objc_setAssociatedObject(picker, &PickerDelegate.key, delegate, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
            guard let top = topController() else { done.signal(); return }
            top.present(picker, animated: true)
        }
        done.wait()
        let fm = FileManager.default
        var added: [String] = []
        var rejected: [String] = []
        if !picked.isEmpty { progress(["state": "copying", "done": 0, "total": picked.count, "name": picked[0].lastPathComponent]) }
        for (i, url) in picked.enumerated() {
            defer { progress(["state": i + 1 == picked.count ? "done" : "copying", "done": i + 1, "total": picked.count, "name": i + 1 < picked.count ? picked[i + 1].lastPathComponent : ""]) }
            let kind = kinds[url.pathExtension.lowercased()]
            // Kindle books can't be read (see books.js KINDLE_NOTE): not copied, and the app says why.
            guard kind != nil, kind != "kindle" else { rejected.append(url.lastPathComponent); continue }
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            let folder = kind == "epub" || (kind == "pdf" && size > 3_000_000) ? "Recipe Books" : "My Recipes"
            var dest = root.appendingPathComponent(folder).appendingPathComponent(url.lastPathComponent)
            var n = 2
            while fm.fileExists(atPath: dest.path) {
                dest = root.appendingPathComponent(folder).appendingPathComponent("\(url.deletingPathExtension().lastPathComponent) \(n).\(url.pathExtension)")
                n += 1
            }
            do { try fm.copyItem(at: url, to: dest); added.append(folder + "/" + dest.lastPathComponent) } catch { continue }
        }
        return ["added": added.count, "files": added, "rejected": rejected, "folder": location()["folder"] ?? ""]
    }

    private static func topController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        var top = scenes.flatMap { $0.windows }.first { $0.isKeyWindow }?.rootViewController
        while let next = top?.presentedViewController { top = next }
        return top
    }

    private final class PickerDelegate: NSObject, UIDocumentPickerDelegate {
        static var key = 0
        let finish: ([URL]) -> Void
        private var finished = false
        init(_ finish: @escaping ([URL]) -> Void) { self.finish = finish }
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { end(urls) }
        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { end([]) }
        private func end(_ urls: [URL]) { if !finished { finished = true; finish(urls) } }
    }

    static func list() -> [String: Any] {
        setUp()
        var files: [[String: Any]] = []
        let fm = FileManager.default
        let base = LibraryPaths.canonical(root)
        for name in folders {
            let dir = root.appendingPathComponent(name, isDirectory: true)
            guard let walker = fm.enumerator(at: dir, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey],
                                             options: [.skipsHiddenFiles]) else { continue }
            for case let url as URL in walker {
                guard kinds[url.pathExtension.lowercased()] != nil, url.lastPathComponent != readmeName,
                      let v = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey]), v.isRegularFile == true else { continue }
                // Both paths in one spelling first (/var vs /private/var), see LibraryPaths.
                guard let rel = LibraryPaths.relative(LibraryPaths.canonical(url), to: base) else { continue }
                files.append(["path": rel, "folder": name, "size": v.fileSize ?? 0, "mtime": Int(v.contentModificationDate?.timeIntervalSince1970 ?? 0)])
                if files.count >= 2000 { break }
            }
        }
        return ["folder": location()["folder"] ?? "On My iPhone › Nourish", "files": files]
    }

    struct LibraryError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private static func resolve(_ rel: String) throws -> URL {
        guard let clean = LibraryPaths.clean(rel, folders: folders) else { throw LibraryError(message: "That file isn't in the recipe library.") }
        let url = root.appendingPathComponent(clean)
        guard LibraryPaths.relative(LibraryPaths.canonical(url), to: LibraryPaths.canonical(root)) != nil,
              FileManager.default.fileExists(atPath: url.path) else {
            throw LibraryError(message: "That file isn't in the recipe library (\(clean)).")
        }
        return url
    }

    /// A slice of a file (a book is read this way, a part at a time): base64 of at most 8 MB.
    static func range(_ rel: String, offset: Int, length: Int) throws -> [String: Any] {
        let url = try resolve(rel)
        guard offset >= 0, length >= 0, length <= maxSlice else { throw LibraryError(message: "That part of the file is too big to read at once.") }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        try handle.seek(toOffset: UInt64(offset))
        let data = try handle.read(upToCount: length) ?? Data()
        return ["data": data.base64EncodedString()]
    }

    static func read(_ rel: String) throws -> [String: Any] {
        let url = try resolve(rel)
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        let kind = kinds[url.pathExtension.lowercased()] ?? ""
        // Books are read by the app a slice at a time (range); here only their size is given.
        if kind == "epub" || kind == "docx" {
            if size > maxBookBytes { throw LibraryError(message: "That book is too big to read (over 400 MB).") }
            return ["kind": kind, "size": size]
        }
        if kind == "kindle" { return ["kind": "kindle"] }
        if size > maxBytes { throw LibraryError(message: "That file is too big to read (over 40 MB).") }
        switch kind {
        case "text":
            return ["kind": "text", "text": (try? String(contentsOf: url, encoding: .utf8)) ?? (try? String(contentsOf: url, encoding: .isoLatin1)) ?? ""]
        case "html":
            return ["kind": "html", "html": (try? String(contentsOf: url, encoding: .utf8)) ?? ""]
        case "pdf":
            guard let doc = PDFDocument(url: url) else { return ["kind": "pdf", "text": "", "note": "This PDF couldn't be opened."] }
            var parts: [String] = []
            var total = 0
            for i in 0..<min(doc.pageCount, 600) {
                let text = doc.page(at: i)?.string ?? ""
                parts.append(text)
                total += text.count
                if total > 2_000_000 { break }
            }
            let text = parts.joined(separator: "\n")
            return ["kind": "pdf", "text": text,
                    "note": text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "No text in this PDF (a scanned book): save the pages as photos instead." : ""]
        case "image":
            // Redrawn as a JPEG at most 2000 px wide so the text reader (TextReader) can take it.
            guard let image = UIImage(contentsOfFile: url.path) else { throw LibraryError(message: "That picture couldn't be opened.") }
            let scale = min(1, 2000 / max(image.size.width, image.size.height))
            let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            let jpeg = UIGraphicsImageRenderer(size: size).jpegData(withCompressionQuality: 0.88) { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
            return ["kind": "image", "image": jpeg.base64EncodedString()]
        default:
            throw LibraryError(message: "Nourish can't read that kind of file.")
        }
    }

    /// Opens the Files app at the Nourish folder.
    static func open() -> [String: Any] {
        setUp()
        let path = root.appendingPathComponent("My Recipes").path
        if let url = URL(string: "shareddocuments://" + (path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? path)) {
            DispatchQueue.main.async { UIApplication.shared.open(url) }
            return ["folder": location()["folder"] ?? "", "opened": true]
        }
        return ["folder": location()["folder"] ?? "", "opened": false]
    }
}
