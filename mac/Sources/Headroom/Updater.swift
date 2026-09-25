import Foundation
import Sparkle

/// Sparkle updates, offered only for releases published inside the licence's update window.
@MainActor
final class Updater: NSObject, SPUUpdaterDelegate {
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
        controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: self, userDriverDelegate: nil)
    }

    func checkForUpdates() {
        controller?.checkForUpdates(nil)
    }

    nonisolated func bestValidUpdate(in appcast: SUAppcast, for updater: SPUUpdater) -> SUAppcastItem? {
        let until = UserDefaults.standard.object(forKey: UpdateWindow.defaultsKey) as? Date
        let items = appcast.items.filter { $0.minimumOperatingSystemVersionIsOK && $0.maximumOperatingSystemVersionIsOK }
        let pick = UpdateWindow.pick(items.map { UpdateWindow.Release(version: $0.versionString, date: $0.date) }, until: until)
        return pick.map { items[$0] } ?? SUAppcastItem.empty()
    }
}

/// The rule, kept apart from Sparkle so it can be tested.
enum UpdateWindow {
    static let defaultsKey = "licenceUpdatesUntil"

    struct Release {
        let version: String
        let date: Date?
    }

    /// Newest release published on or before `until`. No date limit when there is no licence window
    /// (trial, or unlicensed), so people can always get the version they would be buying.
    static func pick(_ releases: [Release], until: Date?) -> Int? {
        let comparator = SUStandardVersionComparator()
        var best: Int?
        for (i, r) in releases.enumerated() {
            if let until, let date = r.date, date > until { continue }
            if let b = best, comparator.compareVersion(r.version, toVersion: releases[b].version) != .orderedDescending { continue }
            best = i
        }
        return best
    }
}
