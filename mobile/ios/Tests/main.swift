// Tests for LibraryPaths (the recipe folder paths on iPhone). Built and run on the Mac in CI:
//   swiftc Nourish/LibraryPaths.swift Tests/main.swift -o /tmp/pathtests && /tmp/pathtests
import Foundation

var failures = 0
func check(_ ok: Bool, _ what: String, file: String = #file, line: Int = #line) {
    if ok { print("ok   \(what)") } else { failures += 1; print("FAIL \(what) (line \(line))") }
}

// The 0.1.10 bug: the folder is /var/…, the files come back as /private/var/….
let root = "/var/mobile/Containers/Data/Application/AB12-CD34/Documents"
let file = "/private/var/mobile/Containers/Data/Application/AB12-CD34/Documents/Recipe Books/Puerto Rican Cookery (2nd ed).pdf"
check(LibraryPaths.relative(file, to: root) == "Recipe Books/Puerto Rican Cookery (2nd ed).pdf", "/private file under a /var folder")
check(LibraryPaths.relative(file.replacingOccurrences(of: "/private", with: ""), to: "/private" + root) == "Recipe Books/Puerto Rican Cookery (2nd ed).pdf", "/var file under a /private/var folder")
check(LibraryPaths.relative(file, to: root + "/") != nil, "folder with a trailing slash")

// Inside LiveContainer: Documents is deep inside another app's folder.
let lc = "/var/mobile/Containers/Data/Application/LC-UUID/Documents/Data/Application/NOURISH-UUID/Documents"
check(LibraryPaths.relative("/private" + lc + "/Recipe Books/Cocina Criolla – Recetas.epub", to: lc) == "Recipe Books/Cocina Criolla – Recetas.epub", "LiveContainer, non-English name")
check(LibraryPaths.relative("/private" + lc + "/My Recipes/Mamá's arroz con gandules [final].txt", to: lc) == "My Recipes/Mamá's arroz con gandules [final].txt", "accents, apostrophe, brackets")
check(LibraryPaths.relative(lc + "/Recipe Books/日本の家庭料理.epub", to: lc) == "Recipe Books/日本の家庭料理.epub", "Japanese file name")

// Never outside the folder.
check(LibraryPaths.relative("/var/mobile/other/secret.txt", to: root) == nil, "a file elsewhere is not in the library")
check(LibraryPaths.relative(root + "-evil/x.pdf", to: root) == nil, "a sibling folder with the same start is not in the library")
check(LibraryPaths.relative(root + "/Recipe Books/../../escape.txt", to: root) == nil, "'..' can't climb out")
check(LibraryPaths.relative(root, to: root) == nil, "the folder itself is not a file")

// Paths the app sends back (and indexes saved by 0.1.10).
let folders = ["Recipe Books", "My Recipes"]
check(LibraryPaths.clean("/privateRecipe Books/Puerto Rican Cookery (2nd ed).pdf", folders: folders) == "Recipe Books/Puerto Rican Cookery (2nd ed).pdf", "0.1.10's broken path is repaired")
check(LibraryPaths.clean("Recipe Books/a b (c).epub", folders: folders) == "Recipe Books/a b (c).epub", "a normal path is kept")
check(LibraryPaths.clean("/Recipe Books//x.pdf", folders: folders) == "Recipe Books/x.pdf", "leading and double slashes")
check(LibraryPaths.clean("../Library/secret", folders: folders) == nil, "'..' is refused")
check(LibraryPaths.normalize("/private/tmp/a/./b/../c") == "/tmp/a/c", "normalize")

// A real file through a symlink (macOS has /tmp → /private/tmp, like iPhone's /var).
let dir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("nourish-path-test-\(getpid())/Recipe Books", isDirectory: true)
try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
let real = dir.appendingPathComponent("Libro de cocina (copia).epub")
FileManager.default.createFile(atPath: real.path, contents: Data("x".utf8))
let base = dir.deletingLastPathComponent()
check(LibraryPaths.relative(LibraryPaths.canonical(real), to: LibraryPaths.canonical(base)) == "Recipe Books/Libro de cocina (copia).epub", "real file on disk")
let viaPrivate = URL(fileURLWithPath: "/private" + LibraryPaths.normalize(real.path))
check(LibraryPaths.relative(LibraryPaths.canonical(viaPrivate), to: LibraryPaths.canonical(base)) == "Recipe Books/Libro de cocina (copia).epub", "real file named through /private")
try? FileManager.default.removeItem(at: base)

print(failures == 0 ? "ALL PATH TESTS PASSED" : "\(failures) PATH TEST(S) FAILED")
exit(failures == 0 ? 0 : 1)
