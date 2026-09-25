import SwiftUI

/// The menu bar popover. Layout follows the approved Figma frame "Mac app / Menu bar popover".
struct PopoverView: View {
    @EnvironmentObject private var engine: Engine
    @State private var busy = false
    @State private var message: String?

    private static let palette: [Color] = [.blue, .purple, .orange, .teal, .green, .gray]

    private var s: Summary { engine.summary }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if let err = engine.lastError {
                Text(err).font(.system(size: 12)).foregroundStyle(.secondary)
                    .padding(.horizontal, 14).padding(.bottom, 10)
            }
            hero
            Divider().padding(.horizontal, 14)
            serverList
            if s.hasUsageData, s.trimmableTokens > 0 {
                Divider().padding(.horizontal, 14)
                notice
            }
            if let message {
                Text(message).font(.system(size: 11)).foregroundStyle(.secondary)
                    .padding(.horizontal, 14).padding(.vertical, 6)
            }
            Divider().padding(.horizontal, 14)
            menu
        }
        .padding(.vertical, 6)
        .frame(width: 340)
    }

    // MARK: Sections

    private var header: some View {
        HStack {
            Text("MCP Meter").font(.system(size: 13, weight: .semibold))
            Spacer()
            Toggle(isOn: Binding(
                get: { !s.paused },
                set: { on in Task { await engine.setPaused(!on) } }
            )) {
                Text("Proxy").font(.system(size: 12)).foregroundStyle(.secondary)
            }
            .toggleStyle(.switch)
            .controlSize(.mini)
            .disabled(!engine.reachable)
        }
        .padding(EdgeInsets(top: 8, leading: 14, bottom: 6, trailing: 14))
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Context loaded per turn").font(.system(size: 11)).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(Format.grouped(s.totalTokens))
                    .font(.system(size: 30, weight: .semibold)).monospacedDigit().kerning(-0.6)
                Text("tokens").font(.system(size: 15, weight: .medium)).foregroundStyle(.secondary)
            }
            StorageBar(servers: s.servers, window: s.contextWindow, colors: Self.palette)
                .frame(height: 10)
                .padding(.top, 4)
            Text("\(Format.percent(s.pctOfWindow)) of \(Format.tokens(s.contextWindow)) · budget \(Int(s.budgetPct))%")
                .font(.system(size: 11))
                .foregroundStyle(s.overBudget ? Color.orange : Color.secondary)
        }
        .padding(EdgeInsets(top: 6, leading: 14, bottom: 12, trailing: 14))
    }

    private var serverList: some View {
        VStack(spacing: 0) {
            if s.servers.isEmpty {
                Text(engine.reachable ? "No servers measured yet. Choose Audit Servers below." : "Starting engine…")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 8).padding(.vertical, 8)
            }
            ForEach(Array(s.servers.prefix(8).enumerated()), id: \.element.id) { i, server in
                HStack(spacing: 9) {
                    Circle().fill(Self.palette[i % Self.palette.count]).frame(width: 8, height: 8)
                    Text(server.name).font(.system(size: 13)).lineLimit(1)
                    Spacer()
                    Text(s.hasUsageData ? "\(server.usedCount)/\(server.enabledCount)" : "\(server.toolCount)")
                        .font(.system(size: 12)).foregroundStyle(.secondary).monospacedDigit()
                        .frame(width: 52, alignment: .trailing)
                    Text(Format.grouped(server.tokens))
                        .font(.system(size: 13)).monospacedDigit()
                        .frame(width: 58, alignment: .trailing)
                }
                .frame(height: 26)
                .padding(.horizontal, 8)
            }
        }
        .padding(6)
    }

    private var notice: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange)
            Text("\(s.unusedTools) tools unused this week. Trim to save about \(Format.tokens(s.trimmableTokens)) tokens.")
                .font(.system(size: 12))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button("Trim…") {
                Task {
                    busy = true
                    await engine.trim()
                    message = "Trimmed. Restart your MCP clients to reload tool lists."
                    busy = false
                }
            }
            .controlSize(.small)
            .disabled(busy)
        }
        .padding(EdgeInsets(top: 10, leading: 14, bottom: 10, trailing: 14))
    }

    private var menu: some View {
        VStack(spacing: 0) {
            MenuRow(title: "Open Dashboard…", shortcut: "⌘D") { engine.openDashboard() }
                .keyboardShortcut("d")
            MenuRow(title: "Audit Servers") {
                Task {
                    busy = true
                    message = "Measuring servers…"
                    await engine.audit()
                    message = nil
                    busy = false
                }
            }
            MenuRow(title: "Route Clients Through MCP Meter") {
                Task {
                    let out = await engine.runCLI(["install"])
                    message = out.contains("proxied") ? "Done. Restart your MCP clients." : "Nothing to change."
                }
            }
            MenuRow(title: "Quit MCP Meter", shortcut: "⌘Q") {
                engine.stop()
                NSApp.terminate(nil)
            }
            .keyboardShortcut("q")
        }
        .padding(EdgeInsets(top: 5, leading: 6, bottom: 0, trailing: 6))
    }
}

/// Proportional bar like System Settings > Storage.
struct StorageBar: View {
    let servers: [Summary.Server]
    let window: Int
    let colors: [Color]

    var body: some View {
        GeometryReader { geo in
            HStack(spacing: 1.5) {
                ForEach(Array(servers.enumerated()), id: \.element.id) { i, server in
                    Rectangle()
                        .fill(colors[i % colors.count])
                        .frame(width: max(1, geo.size.width * CGFloat(server.tokens) / CGFloat(max(window, 1))))
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 3))
        }
    }
}

/// A menu-style row that highlights on hover, like a native NSMenu item.
struct MenuRow: View {
    let title: String
    var shortcut: String = ""
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack {
                Text(title)
                Spacer()
                Text(shortcut).foregroundStyle(hover ? Color.white.opacity(0.85) : Color.secondary)
            }
            .font(.system(size: 13))
            .foregroundStyle(hover ? Color.white : Color.primary)
            .padding(.horizontal, 8)
            .frame(height: 24)
            .background(hover ? Color.accentColor : Color.clear, in: RoundedRectangle(cornerRadius: 5))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}
