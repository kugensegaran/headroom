import SwiftUI

@main
struct MCPMeterApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var engine = Engine.shared

    var body: some Scene {
        MenuBarExtra {
            PopoverView()
                .environmentObject(engine)
        } label: {
            // Status item: gauge plus context share, e.g. "29%"
            HStack(spacing: 4) {
                Image(systemName: "gauge.with.dots.needle.33percent")
                if engine.reachable, engine.summary.totalTokens > 0 {
                    Text(Format.percent(engine.summary.pctOfWindow))
                        .monospacedDigit()
                }
            }
        }
        .menuBarExtraStyle(.window)
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Menu bar only: no Dock icon (LSUIElement is also set in Info.plist).
        NSApp.setActivationPolicy(.accessory)
        Engine.shared.start()
    }

    func applicationWillTerminate(_ notification: Notification) {
        Engine.shared.stop()
    }
}
