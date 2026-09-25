import Foundation
import UserNotifications

/// Local notifications: a server failing repeatedly (on by default) and going over budget (off by default).
@MainActor
final class Notifier {
    static let shared = Notifier()

    private var wasOverBudget: Bool?
    private var lastFailureNotice: [String: Date] = [:]

    /// UNUserNotificationCenter needs a real app bundle; the bare debug binary has none.
    private var center: UNUserNotificationCenter? {
        Bundle.main.bundleIdentifier == nil ? nil : UNUserNotificationCenter.current()
    }

    func requestPermission() {
        guard let center else { return }
        Task { _ = try? await center.requestAuthorization(options: [.alert, .sound]) }
    }

    func check(_ s: Summary) {
        guard s.license.licensed else { return }
        let over = s.overBudget && s.totalTokens > 0
        if s.notifyOverBudget, over, wasOverBudget == false {
            post(id: "budget", title: "Over your context budget",
                 body: "MCP tools now load \(Format.tokens(s.totalTokens)) tokens per turn, \(Format.percent(s.pctOfWindow)) of the window. Your budget is \(Int(s.budgetPct))%.")
        }
        wasOverBudget = over

        guard s.notifyFailures else { return }
        for f in s.failing {
            if let last = lastFailureNotice[f.server], last.timeIntervalSinceNow > -3600 { continue }
            lastFailureNotice[f.server] = Date()
            post(id: "failing-\(f.server)", title: "\(f.server) is failing",
                 body: "\(f.failed) of its last \(f.total) tool calls failed in the past 15 minutes.")
        }
    }

    private func post(id: String, title: String, body: String) {
        guard let center else { return }
        Task { @MainActor in
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            if await center.notificationSettings().authorizationStatus == .notDetermined {
                guard (try? await center.requestAuthorization(options: [.alert, .sound])) == true else { return }
            }
            try? await center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
        }
    }
}
