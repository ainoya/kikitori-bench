// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "apple-speech-transcriber",
    platforms: [.macOS(.v26)],
    products: [
        .executable(
            name: "apple-speech-transcriber",
            targets: ["AppleSpeechTranscriber"]
        )
    ],
    targets: [
        .executableTarget(name: "AppleSpeechTranscriber")
    ]
)
