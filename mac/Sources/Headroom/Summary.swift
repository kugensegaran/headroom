import Foundation

/// Mirrors the JSON from GET /api/summary (see src/summary.js). Only the fields the menu bar needs.
struct Summary: Decodable {
    struct Server: Decodable, Identifiable {
        var id: String { name }
        let name: String
        let toolCount: Int
        let enabledCount: Int
        let usedCount: Int
        let tokens: Int
        let idle: Bool?
    }

    struct Today: Decodable {
        let calls: Int
        let failed: Int
        let medianMs: Int?
    }

    struct Failing: Decodable {
        let server: String
        let failed: Int
        let total: Int
    }

    struct License: Decodable {
        let licensed: Bool
        let mode: String
        let daysLeft: Int?
        let trialEnds: Double
        let updatesUntil: Double?
        let email: String?

        static let trial = License(licensed: true, mode: "trial", daysLeft: nil, trialEnds: 0, updatesUntil: nil, email: nil)
    }

    let paused: Bool
    let contextWindow: Int
    let budgetPct: Double
    let totalTokens: Int
    let pctOfWindow: Double
    let unusedTools: Int
    let trimmableTokens: Int
    let hasUsageData: Bool
    let servers: [Server]
    let today: Today
    var failing: [Failing] = []
    var notifyOverBudget = false
    var notifyFailures = true
    var retentionDays = 30
    var license: License = .trial

    private enum CodingKeys: String, CodingKey {
        case paused, contextWindow, budgetPct, totalTokens, pctOfWindow, unusedTools, trimmableTokens, hasUsageData, servers, today
        case failing, notifyOverBudget, notifyFailures, retentionDays, license
    }

    static let empty = Summary(
        paused: false, contextWindow: 200_000, budgetPct: 20, totalTokens: 0, pctOfWindow: 0,
        unusedTools: 0, trimmableTokens: 0, hasUsageData: false, servers: [],
        today: Today(calls: 0, failed: 0, medianMs: nil)
    )

    var overBudget: Bool { pctOfWindow * 100 > budgetPct }
}

enum Format {
    static func tokens(_ n: Int) -> String {
        if n < 1000 { return "\(n)" }
        let k = Double(n) / 1000
        let s = String(format: "%.1f", k)
        return (s.hasSuffix(".0") ? String(s.dropLast(2)) : s) + "K"
    }

    static func grouped(_ n: Int) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        return f.string(from: NSNumber(value: n)) ?? "\(n)"
    }

    static func percent(_ x: Double) -> String { "\(Int((x * 100).rounded()))%" }
}
