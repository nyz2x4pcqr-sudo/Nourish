import Foundation
import PDFKit
import UIKit

/// The personal recipe library on the iPhone: Documents/Recipe Books and Documents/My Recipes,
/// shown in the Files app under On My iPhone → Nourish (UIFileSharingEnabled and
/// LSSupportsOpeningDocumentsInPlace in Info.plist). The web app lists and reads them (library.js).
enum RecipeLibrary {
    static let folders = ["Recipe Books", "My Recipes"]
    static let kinds: [String: String] = ["txt": "text", "text": "text", "md": "text", "markdown": "text", "html": "html", "htm": "html",
                                          "webarchive": "html", "mhtml": "html", "pdf": "pdf", "jpg": "image", "jpeg": "image",
                                          "png": "image", "heic": "image", "webp": "image"]
    static let maxBytes = 40 * 1024 * 1024

    static var root: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }

    /// Creates the folders (with a short note in each) the first time Nourish starts.
    static func setUp() {
        let fm = FileManager.default
        for name in folders {
            let dir = root.appendingPathComponent(name, isDirectory: true)
            if !fm.fileExists(atPath: dir.path) { try? fm.createDirectory(at: dir, withIntermediateDirectories: true) }
        }
        let readme = root.appendingPathComponent("About these folders.txt")
        if !fm.fileExists(atPath: readme.path) {
            try? """
            Put recipe files in "Recipe Books" (cookbooks) or "My Recipes" (your own): PDF, text, Markdown, \
            saved web pages or photos. Nourish reads them and uses them in your meal plans first.
            """.write(to: readme, atomically: true, encoding: .utf8)
        }
    }

    static func list() -> [String: Any] {
        setUp()
        var files: [[String: Any]] = []
        let fm = FileManager.default
        for name in folders {
            let dir = root.appendingPathComponent(name, isDirectory: true)
            guard let walker = fm.enumerator(at: dir, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey],
                                             options: [.skipsHiddenFiles]) else { continue }
            for case let url as URL in walker {
                guard kinds[url.pathExtension.lowercased()] != nil,
                      let v = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey]), v.isRegularFile == true else { continue }
                let rel = url.path.replacingOccurrences(of: root.path + "/", with: "")
                files.append(["path": rel, "folder": name, "size": v.fileSize ?? 0, "mtime": Int(v.contentModificationDate?.timeIntervalSince1970 ?? 0)])
                if files.count >= 2000 { break }
            }
        }
        return ["folder": "On My iPhone › Nourish", "files": files]
    }

    struct LibraryError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    static func read(_ rel: String) throws -> [String: Any] {
        let base = root.standardizedFileURL.path
        let url = root.appendingPathComponent(rel).standardizedFileURL
        guard url.path.hasPrefix(base + "/"), FileManager.default.fileExists(atPath: url.path) else {
            throw LibraryError(message: "That file isn't in the recipe library.")
        }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if size > maxBytes { throw LibraryError(message: "That file is too big to read (over 40 MB).") }
        switch kinds[url.pathExtension.lowercased()] ?? "" {
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
            return ["folder": "On My iPhone › Nourish", "opened": true]
        }
        return ["folder": "On My iPhone › Nourish", "opened": false]
    }
}
