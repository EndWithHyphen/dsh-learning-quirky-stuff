import Foundation
import Vision
import AppKit
import PDFKit

func emit(_ value: Any) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
}

do {
    let args = CommandLine.arguments
    guard args.count >= 3 else { throw NSError(domain: "Studyboard", code: 1, userInfo: [NSLocalizedDescriptionKey: "缺少输入文件"]) }
    let url = URL(fileURLWithPath: args[2])
    if args[1] == "pdf" {
        guard let document = PDFDocument(url: url) else { throw NSError(domain: "Studyboard", code: 2, userInfo: [NSLocalizedDescriptionKey: "PDF 无法读取"]) }
        var pages: [[String: Any]] = []
        for index in 0..<min(document.pageCount, 80) {
            pages.append(["page": index + 1, "text": document.page(at: index)?.string ?? ""])
        }
        try emit(["pages": pages, "pageCount": document.pageCount])
    } else {
        guard let image = NSImage(contentsOf: url), let original = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { throw NSError(domain: "Studyboard", code: 3, userInfo: [NSLocalizedDescriptionKey: "图片无法读取"]) }
        var cgImage = original
        if args.count > 3, let data = args[3].data(using: .utf8), let crop = try JSONSerialization.jsonObject(with: data) as? [String: Double], let x = crop["x"], let y = crop["y"], let width = crop["width"], let height = crop["height"] {
            let sx = Double(original.width) / (crop["naturalWidth"] ?? Double(original.width))
            let sy = Double(original.height) / (crop["naturalHeight"] ?? Double(original.height))
            if let cropped = original.cropping(to: CGRect(x: x * sx, y: y * sy, width: width * sx, height: height * sy)) { cgImage = cropped }
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        let supported = try request.supportedRecognitionLanguages()
        request.recognitionLanguages = ["zh-Hans", "en-US"].filter { supported.contains($0) }
        if #available(macOS 13.0, *) { request.automaticallyDetectsLanguage = true }
        try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
        let observations = (request.results ?? []).sorted { a, b in
            abs(a.boundingBox.midY - b.boundingBox.midY) > 0.012 ? a.boundingBox.midY > b.boundingBox.midY : a.boundingBox.minX < b.boundingBox.minX
        }
        let lines: [[String: Any]] = observations.compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let box = observation.boundingBox
            return ["text": candidate.string, "confidence": candidate.confidence, "x": box.minX, "y": 1 - box.maxY, "width": box.width, "height": box.height]
        }
        try emit(["lines": lines, "width": cgImage.width, "height": cgImage.height])
    }
} catch {
    try? emit(["error": error.localizedDescription])
    exit(1)
}
