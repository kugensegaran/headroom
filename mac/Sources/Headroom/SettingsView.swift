import ServiceManagement
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var engine: Engine
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @State private var loginError: String?

    private var s: Summary { engine.summary }

    private func binding<T>(_ get: @escaping (Summary) -> T, _ key: String, map: @escaping (T) -> Any = { $0 }) -> Binding<T> {
        Binding(get: { get(engine.summary) }, set: { value in Task { await engine.updateSettings([key: map(value)]) } })
    }

    var body: some View {
        Form {
            Section("Context") {
                Picker("Context window", selection: binding({ $0.contextWindow }, "contextWindow")) {
                    ForEach([128_000, 200_000, 400_000, 1_000_000], id: \.self) { Text("\(Format.tokens($0)) tokens").tag($0) }
                    if ![128_000, 200_000, 400_000, 1_000_000].contains(s.contextWindow) {
                        Text("\(Format.tokens(s.contextWindow)) tokens").tag(s.contextWindow)
                    }
                }
                Picker("Budget for MCP tools", selection: binding({ Int($0.budgetPct) }, "budgetPct")) {
                    ForEach([5, 10, 15, 20, 25, 30, 40, 50], id: \.self) { Text("\($0)% of the window").tag($0) }
                    if ![5, 10, 15, 20, 25, 30, 40, 50].contains(Int(s.budgetPct)) {
                        Text("\(Int(s.budgetPct))% of the window").tag(Int(s.budgetPct))
                    }
                }
            }
            Section("History") {
                Picker("Keep call history for", selection: binding({ $0.retentionDays }, "retentionDays")) {
                    ForEach([7, 14, 30, 90, 365], id: \.self) { Text($0 == 365 ? "1 year" : "\($0) days").tag($0) }
                    if ![7, 14, 30, 90, 365].contains(s.retentionDays) { Text("\(s.retentionDays) days").tag(s.retentionDays) }
                }
                Toggle("Pause logging", isOn: binding({ $0.paused }, "paused"))
            }
            Section("Notifications") {
                Toggle("When a server keeps failing", isOn: Binding(
                    get: { s.notifyFailures },
                    set: { on in
                        if on { Notifier.shared.requestPermission() }
                        Task { await engine.updateSettings(["notifyFailures": on]) }
                    }))
                Toggle("When tools go over the budget", isOn: Binding(
                    get: { s.notifyOverBudget },
                    set: { on in
                        if on { Notifier.shared.requestPermission() }
                        Task { await engine.updateSettings(["notifyOverBudget": on]) }
                    }))
            }
            Section {
                Toggle("Open at login", isOn: Binding(get: { launchAtLogin }, set: setLaunchAtLogin))
                if let loginError {
                    Text(loginError).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .disabled(!engine.reachable)
        .frame(width: 440)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func setLaunchAtLogin(_ on: Bool) {
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            loginError = nil
        } catch {
            loginError = "Could not change this: \(error.localizedDescription)"
        }
        launchAtLogin = SMAppService.mainApp.status == .enabled
    }
}
