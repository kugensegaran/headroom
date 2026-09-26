import SwiftUI

@main
struct HeadroomApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var engine = Engine.shared

    var body: some Scene {
        MenuBarExtra {
            PopoverView()
                .environmentObject(engine)
        } label: {
            // Status item: gauge plus context share, e.g. "29%"
            HStack(spacing: 4) {
                Image(nsImage: StatusIcon.image(level: engine.summary.pctOfWindow))
                if engine.reachable, engine.summary.headlineClient != nil, engine.summary.totalTokens > 0 {
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
        Updater.shared.start()
        switch UserDefaults.standard.string(forKey: "appearance") {
        case "light": NSApp.appearance = NSAppearance(named: .aqua)
        case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
        default: break
        }
        // `-show settings|onboarding|about|popover` opens a window at launch (handy for QA screenshots).
        switch UserDefaults.standard.string(forKey: "show") {
        case "settings": AppWindows.shared.showSettings()
        case "about": AppWindows.shared.showAbout()
        case "onboarding": AppWindows.shared.showOnboarding()
        case "popover": AppWindows.shared.show("popover", title: "Headroom") { PopoverView() }
        default:
            if !UserDefaults.standard.bool(forKey: "onboarded") { AppWindows.shared.showOnboarding() }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        Engine.shared.stop()
    }
}
