import Foundation
import Sparkle

/// Sparkle updates.
@MainActor
final class Updater {
    static let shared = Updater()
    private var controller: SPUStandardUpdaterController?

    /// Sparkle refuses to run without a public signing key, so updates stay off until one is in Info.plist.
    var isConfigured: Bool {
        let key = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String
        let feed = Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") as? String
        return !(key ?? "").isEmpty && !(feed ?? "").isEmpty
    }

    func start() {
        guard isConfigured, controller == nil else { return }
        controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
    }

    func checkForUpdates() {
        controller?.checkForUpdates(nil)
    }
}
