import AVFAudio
import Foundation
import Speech

private enum CommandError: LocalizedError {
    case invalidArguments(String)
    case speechTranscriberUnavailable
    case unsupportedLocale(String)
    case assetsNotInstalled(String)
    case assetsUnavailable(String)
    case emptyAudio(String)

    var errorDescription: String? {
        switch self {
        case .invalidArguments(let message):
            return message
        case .speechTranscriberUnavailable:
            return "SpeechTranscriber is unavailable on this Mac"
        case .unsupportedLocale(let locale):
            return "The selected Apple transcriber does not support locale '\(locale)' on this Mac"
        case .assetsNotInstalled(let locale):
            return "Apple transcription assets for '\(locale)' are not installed; run the prepare command for the selected engine"
        case .assetsUnavailable(let locale):
            return "Apple could not create a transcription asset installation request for '\(locale)'"
        case .emptyAudio(let path):
            return "Audio file contains no frames: \(path)"
        }
    }
}

private enum Engine: String {
    case dictation
    case speechTranscriber = "speech-transcriber"

    var displayName: String {
        switch self {
        case .dictation:
            return "DictationTranscriber"
        case .speechTranscriber:
            return "SpeechTranscriber"
        }
    }
}

private struct Arguments {
    let engine: Engine
    let localeIdentifier: String
    let prepare: Bool
    let audioPath: String?

    static func parse(_ raw: [String]) throws -> Arguments {
        var engine = Engine.speechTranscriber
        var localeIdentifier = "ja-JP"
        var prepare = false
        var audioPath: String?
        var index = 0

        while index < raw.count {
            let argument = raw[index]
            switch argument {
            case "--engine":
                index += 1
                guard index < raw.count, let parsed = Engine(rawValue: raw[index]) else {
                    throw CommandError.invalidArguments(
                        "--engine must be 'dictation' or 'speech-transcriber'"
                    )
                }
                engine = parsed
            case "--locale":
                index += 1
                guard index < raw.count else {
                    throw CommandError.invalidArguments("--locale requires an identifier")
                }
                localeIdentifier = raw[index]
            case "--prepare":
                prepare = true
            case "--help", "-h":
                throw CommandError.invalidArguments(Self.usage)
            default:
                guard !argument.hasPrefix("-"), audioPath == nil else {
                    throw CommandError.invalidArguments("Unexpected argument: \(argument)\n\(Self.usage)")
                }
                audioPath = argument
            }
            index += 1
        }

        guard prepare || audioPath != nil else {
            throw CommandError.invalidArguments(Self.usage)
        }
        guard !(prepare && audioPath != nil) else {
            throw CommandError.invalidArguments("--prepare does not accept an audio file")
        }

        return Arguments(
            engine: engine,
            localeIdentifier: localeIdentifier,
            prepare: prepare,
            audioPath: audioPath
        )
    }

    static let usage = "Usage: apple-speech-transcriber [--engine speech-transcriber] [--locale ja-JP] <audio-file>\n       apple-speech-transcriber --prepare [--engine speech-transcriber] [--locale ja-JP]"
}

private func ensureAssets(
    modules: [any SpeechModule],
    localeIdentifier: String,
    install: Bool
) async throws {
    let status = await AssetInventory.status(forModules: modules)
    if status == .installed {
        return
    }
    if !install {
        throw CommandError.assetsNotInstalled(localeIdentifier)
    }

    guard let request = try await AssetInventory.assetInstallationRequest(supporting: modules) else {
        throw CommandError.assetsUnavailable(localeIdentifier)
    }
    try await request.downloadAndInstall()

    guard await AssetInventory.status(forModules: modules) == .installed else {
        throw CommandError.assetsNotInstalled(localeIdentifier)
    }
}

private func makeSpeechTranscriber(
    localeIdentifier: String,
    installAssets: Bool
) async throws -> SpeechTranscriber {
    guard SpeechTranscriber.isAvailable else {
        throw CommandError.speechTranscriberUnavailable
    }

    let requestedLocale = Locale(identifier: localeIdentifier)
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requestedLocale) else {
        throw CommandError.unsupportedLocale(localeIdentifier)
    }

    let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
    try await ensureAssets(
        modules: [transcriber],
        localeIdentifier: localeIdentifier,
        install: installAssets
    )
    return transcriber
}

private func makeDictationTranscriber(
    localeIdentifier: String,
    installAssets: Bool
) async throws -> DictationTranscriber {
    let requestedLocale = Locale(identifier: localeIdentifier)
    guard let locale = await DictationTranscriber.supportedLocale(equivalentTo: requestedLocale) else {
        throw CommandError.unsupportedLocale(localeIdentifier)
    }

    let transcriber = DictationTranscriber(locale: locale, preset: .longDictation)
    try await ensureAssets(
        modules: [transcriber],
        localeIdentifier: localeIdentifier,
        install: installAssets
    )
    return transcriber
}

private func transcribeWithSpeechTranscriber(
    audioPath: String,
    localeIdentifier: String
) async throws -> String {
    let transcriber = try await makeSpeechTranscriber(
        localeIdentifier: localeIdentifier,
        installAssets: false
    )
    let audioFile = try AVAudioFile(forReading: URL(fileURLWithPath: audioPath))
    guard audioFile.length > 0 else {
        throw CommandError.emptyAudio(audioPath)
    }

    async let transcription = transcriber.results.reduce("") { partial, result in
        partial + String(result.text.characters)
    }

    let analyzer = SpeechAnalyzer(modules: [transcriber])
    if let lastSample = try await analyzer.analyzeSequence(from: audioFile) {
        try await analyzer.finalizeAndFinish(through: lastSample)
    } else {
        await analyzer.cancelAndFinishNow()
    }

    return try await transcription
}

private func transcribeWithDictationTranscriber(
    audioPath: String,
    localeIdentifier: String
) async throws -> String {
    let transcriber = try await makeDictationTranscriber(
        localeIdentifier: localeIdentifier,
        installAssets: false
    )
    let audioFile = try AVAudioFile(forReading: URL(fileURLWithPath: audioPath))
    guard audioFile.length > 0 else {
        throw CommandError.emptyAudio(audioPath)
    }

    async let transcription = transcriber.results.reduce("") { partial, result in
        partial + String(result.text.characters)
    }

    let analyzer = SpeechAnalyzer(modules: [transcriber])
    if let lastSample = try await analyzer.analyzeSequence(from: audioFile) {
        try await analyzer.finalizeAndFinish(through: lastSample)
    } else {
        await analyzer.cancelAndFinishNow()
    }

    return try await transcription
}

private func prepare(engine: Engine, localeIdentifier: String) async throws {
    switch engine {
    case .dictation:
        _ = try await makeDictationTranscriber(
            localeIdentifier: localeIdentifier,
            installAssets: true
        )
    case .speechTranscriber:
        _ = try await makeSpeechTranscriber(
            localeIdentifier: localeIdentifier,
            installAssets: true
        )
    }
}

private func transcribe(
    engine: Engine,
    audioPath: String,
    localeIdentifier: String
) async throws -> String {
    switch engine {
    case .dictation:
        return try await transcribeWithDictationTranscriber(
            audioPath: audioPath,
            localeIdentifier: localeIdentifier
        )
    case .speechTranscriber:
        return try await transcribeWithSpeechTranscriber(
            audioPath: audioPath,
            localeIdentifier: localeIdentifier
        )
    }
}

@main
private struct AppleSpeechTranscriberCommand {
    static func main() async {
        do {
            let arguments = try Arguments.parse(Array(CommandLine.arguments.dropFirst()))
            if arguments.prepare {
                try await prepare(
                    engine: arguments.engine,
                    localeIdentifier: arguments.localeIdentifier
                )
                print(
                    "Apple \(arguments.engine.displayName) assets are ready for \(arguments.localeIdentifier)."
                )
                return
            }

            guard let audioPath = arguments.audioPath else {
                throw CommandError.invalidArguments(Arguments.usage)
            }
            print(try await transcribe(
                engine: arguments.engine,
                audioPath: audioPath,
                localeIdentifier: arguments.localeIdentifier
            ))
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
            FileHandle.standardError.write(Data("Error: \(message)\n".utf8))
            Foundation.exit(EXIT_FAILURE)
        }
    }
}
