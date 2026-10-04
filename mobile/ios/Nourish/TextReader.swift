import Foundation
import UIKit
import Vision

/// The text in a picture (a recipe someone shared as a screenshot), read on the phone with Apple's
/// Vision framework: nothing is sent anywhere. The web app redraws the picture upright as a JPEG
/// first, so its orientation is always "up".
enum TextReader {
    static func read(base64: String) throws -> [String: Any] {
        guard let data = Data(base64Encoded: base64), let image = UIImage(data: data), let cg = image.cgImage else {
            throw NSError(domain: "Nourish", code: 1, userInfo: [NSLocalizedDescriptionKey: "That picture couldn't be opened."])
        }
        let lines = try lines(of: cg)
        return ["text": lines.joined(separator: "\n"), "lines": lines.count, "width": cg.width, "height": cg.height]
    }

    /// The lines of text in a picture, in reading order. A page in two columns (ingredients on the
    /// left, method on the right, as many cookbooks print them) is read one column after the other,
    /// not across: lines that span the page (a recipe's title) split it into bands, and each band's
    /// left column comes before its right column.
    static func lines(of cg: CGImage) throws -> [String] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        // Cookbooks mix languages ("Arroz con pollo", "crème fraîche").
        request.automaticallyDetectsLanguage = true
        try VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:]).perform([request])
        let found = (request.results ?? []).compactMap { o -> (box: CGRect, text: String)? in
            guard let t = o.topCandidates(1).first?.string, !t.isEmpty else { return nil }
            return (o.boundingBox, t)
        }
        return ordered(found)
    }

    /// Reading order for boxes in Vision's coordinates (0…1, starting at the bottom left).
    static func ordered(_ found: [(box: CGRect, text: String)]) -> [String] {
        // Top to bottom, then left to right (boxes on the same line).
        let byRow = found.sorted { a, b in
            abs(a.box.midY - b.box.midY) > 0.01 ? a.box.midY > b.box.midY : a.box.minX < b.box.minX
        }
        let left = byRow.filter { $0.box.maxX < 0.53 }.count
        let right = byRow.filter { $0.box.minX > 0.47 }.count
        let spanning = byRow.filter { $0.box.minX < 0.45 && $0.box.maxX > 0.55 }.count
        guard byRow.count >= 6, left >= byRow.count / 4, right >= byRow.count / 4, spanning <= byRow.count / 3 else {
            return byRow.map { $0.text }
        }
        var out: [String] = []
        var band: [(box: CGRect, text: String)] = []
        let flush = {
            out += band.filter { $0.box.midX < 0.5 }.map { $0.text }
            out += band.filter { $0.box.midX >= 0.5 }.map { $0.text }
            band = []
        }
        for item in byRow {
            if item.box.minX < 0.45 && item.box.maxX > 0.55 { flush(); out.append(item.text) } else { band.append(item) }
        }
        flush()
        return out
    }

    /// The number on a product barcode (EAN, UPC) in a photo, read on the phone (for the food log).
    static func barcode(base64: String) throws -> [String: Any] {
        guard let data = Data(base64Encoded: base64), let image = UIImage(data: data), let cg = image.cgImage else {
            throw NSError(domain: "Nourish", code: 1, userInfo: [NSLocalizedDescriptionKey: "That picture couldn't be opened."])
        }
        let request = VNDetectBarcodesRequest()
        request.symbologies = [.ean13, .ean8, .upce, .code128, .itf14]
        try VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:]).perform([request])
        let code = (request.results ?? []).compactMap { $0.payloadStringValue }.first { !$0.isEmpty }
        return ["code": code ?? ""]
    }
}
