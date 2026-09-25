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
