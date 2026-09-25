import SwiftUI

struct LicenseView: View {
    @EnvironmentObject private var engine: Engine
    @ObservedObject private var manager = LicenseManager.shared
    @State private var key = ""

    private var l: Summary.License { engine.summary.license }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 48, height: 48)
                VStack(alignment: .leading, spacing: 2) {
                    Text(headline).font(.headline)
                    Text(detail).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            if l.mode == "licensed" || manager.hasKey {
                HStack {
                    Spacer()
                    Button("Deactivate on this Mac") { Task { await manager.deactivate() } }
                        .disabled(manager.busy)
                }
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Licence key").font(.callout)
                    TextField("XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX", text: $key)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(.body, design: .monospaced))
                        .onSubmit(activate)
                }
                HStack {
                    Text("A licence includes \(LicenseConfig.updateMonths) months of updates.")
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    if manager.busy { ProgressView().controlSize(.small) }
                    Button("Activate", action: activate)
                        .keyboardShortcut(.defaultAction)
                        .disabled(key.trimmingCharacters(in: .whitespaces).isEmpty || manager.busy)
                }
            }
            if let error = manager.error {
                Text(error).font(.callout).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(20)
        .frame(width: 460)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var headline: String {
        switch l.mode {
        case "licensed": return "Licensed"
        case "trial": return "Free trial"
        case "recheck": return "Licence needs a check"
        default: return "Trial ended"
        }
    }

    private var detail: String {
        let date = { (ms: Double) in Date(timeIntervalSince1970: ms / 1000).formatted(date: .long, time: .omitted) }
        switch l.mode {
        case "licensed":
            let who = l.email.map { "Licensed to \($0). " } ?? ""
            guard let until = l.updatesUntil else { return who + "Thank you." }
            return who + (until > Date().timeIntervalSince1970 * 1000 ? "Updates until \(date(until))." : "Updates ended \(date(until)). This version keeps working.")
        case "trial":
            let days = l.daysLeft ?? 0
            return "\(days) day\(days == 1 ? "" : "s") left. Everything works during the trial."
        case "recheck":
            return "Headroom could not reach the licence server for 30 days. Connect to the internet and reopen Headroom."
        default:
            return "Audit and the dashboard still work. Live logging, trim and notifications need a licence."
        }
    }

    private func activate() {
        Task { await manager.activate(key) }
    }
}
