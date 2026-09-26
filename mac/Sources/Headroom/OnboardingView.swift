import SwiftUI

/// First run: explain, measure the servers, then offer to route clients through Headroom.
struct OnboardingView: View {
    @EnvironmentObject private var engine: Engine
    @AppStorage("onboarded") private var onboarded = false

    private enum Step { case intro, auditing, results, installing, installed }
    @State private var step: Step = .intro
    @State private var results: [AuditResult] = []
    @State private var installOutput = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 56, height: 56)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Welcome to Headroom").font(.title2.weight(.semibold))
                    Text("Every MCP server, working in every client. See every call.").foregroundStyle(.secondary)
                }
            }
            switch step {
            case .intro: intro
            case .auditing: progress("Connecting to each server and listing its tools…")
            case .results: resultsView
            case .installing: progress("Updating client configs…")
            case .installed: installedView
            }
        }
        .padding(24)
        .frame(width: 520)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Label("Headroom sits between your apps and your MCP servers and shows every call as it happens.", systemImage: "list.bullet.rectangle")
                Label("It smooths over small differences, so a server that works in one app works in the others, and gives each app its own set of tools.", systemImage: "checkmark.circle")
                Label("It estimates what tool definitions cost in each app. Some apps load tools on demand; others send every tool with every message.", systemImage: "gauge.with.dots.needle.33percent")
                Label("Everything stays on this Mac. Nothing is sent anywhere.", systemImage: "lock")
            }
            .labelStyle(OnboardingLabelStyle())
            Text("First, Headroom checks the servers in Claude Desktop, Claude Code, Cursor and VS Code. It starts each one briefly to list its tools.")
                .font(.callout).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("Skip") { finish() }
                Spacer()
                Button("Check my servers") { runAudit() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(!engine.reachable)
            }
        }
    }

    private var resultsView: some View {
        VStack(alignment: .leading, spacing: 12) {
            if results.isEmpty {
                Text("No MCP servers found in Claude Desktop, Claude Code, Cursor or VS Code. Add one to a client, then choose Audit Servers from the menu bar.")
                    .fixedSize(horizontal: false, vertical: true)
                HStack { Spacer(); Button("Done") { finish() }.keyboardShortcut(.defaultAction) }
            } else {
                Text("\(results.filter(\.ok).count) of \(results.count) servers answered. Their tool definitions come to about \(Format.grouped(engine.summary.totalTokens)) tokens, estimated.")
                    .font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(results) { r in
                            HStack(alignment: .firstTextBaseline) {
                                Image(systemName: r.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                                    .foregroundStyle(r.ok ? Color.green : Color.orange)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(r.name)
                                    Text(r.ok ? r.clients.joined(separator: ", ") : (r.error ?? "Could not connect"))
                                        .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }
                                Spacer()
                                if let tools = r.tools, r.ok {
                                    Text("\(tools) tools · \(Format.grouped(tokens(for: r.name)))").monospacedDigit().foregroundStyle(.secondary)
                                }
                            }
                            .padding(.vertical, 6)
                            Divider()
                        }
                    }
                }
                .frame(maxHeight: 220)
                Text("To see every call, apply compatibility fixes and set tools per app, route your clients through Headroom. It backs up each config first, and you can undo this any time with Restore Original Configs in the menu bar.")
                    .font(.callout).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack {
                    Button("Not now") { finish() }
                    Spacer()
                    Button("Route through Headroom") { install() }.keyboardShortcut(.defaultAction)
                }
            }
        }
    }

    private var installedView: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(installOutput).font(.system(.callout, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 6))
            Text("Restart your MCP clients so they pick up the change. Tool calls then show up in the menu bar.")
                .fixedSize(horizontal: false, vertical: true)
            HStack { Spacer(); Button("Done") { finish() }.keyboardShortcut(.defaultAction) }
        }
    }

    private func progress(_ text: String) -> some View {
        HStack(spacing: 10) {
            ProgressView().controlSize(.small)
            Text(text).foregroundStyle(.secondary)
        }
        .padding(.vertical, 20)
    }

    private func tokens(for server: String) -> Int {
        engine.summary.servers.first { $0.name == server }?.tokens ?? 0
    }

    private func runAudit() {
        step = .auditing
        Task {
            results = await engine.audit().sorted { tokens(for: $0.name) > tokens(for: $1.name) }
            step = .results
        }
    }

    private func install() {
        step = .installing
        Task {
            let out = await engine.runCLI(["install"])
            installOutput = out.replacingOccurrences(of: "\n\nRestart your MCP clients so they pick up the change.", with: "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            step = .installed
        }
    }

    private func finish() {
        onboarded = true
        Notifier.shared.requestPermission()
        AppWindows.shared.close("onboarding")
    }
}

private struct OnboardingLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            configuration.icon.foregroundStyle(.tint).frame(width: 20)
            configuration.title.fixedSize(horizontal: false, vertical: true)
        }
    }
}
