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
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        try VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:]).perform([request])
        // Top to bottom, then left to right (Vision's coordinates start at the bottom left).
        let found = (request.results ?? []).sorted { a, b in
            abs(a.boundingBox.midY - b.boundingBox.midY) > 0.01 ? a.boundingBox.midY > b.boundingBox.midY : a.boundingBox.minX < b.boundingBox.minX
        }
        let lines = found.compactMap { $0.topCandidates(1).first?.string }
        return ["text": lines.joined(separator: "\n"), "lines": lines.count, "width": cg.width, "height": cg.height]
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
