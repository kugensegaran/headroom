import AppKit
import SwiftUI

/// Plain AppKit windows hosting SwiftUI views; a menu bar only app has no window scenes of its own.
@MainActor
final class AppWindows {
    static let shared = AppWindows()
    private var windows: [String: NSWindow] = [:]

    func show<Content: View>(_ id: String, title: String, @ViewBuilder content: () -> Content) {
        NSApp.activate(ignoringOtherApps: true)
        if let existing = windows[id] {
            existing.makeKeyAndOrderFront(nil)
            return
        }
        let window = NSWindow(contentRect: .zero, styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = title
        window.isReleasedWhenClosed = false
        window.contentViewController = NSHostingController(rootView: content().environmentObject(Engine.shared))
        window.center()
        windows[id] = window
        window.makeKeyAndOrderFront(nil)
    }

    func close(_ id: String) {
        windows[id]?.close()
    }

    func showOnboarding() {
        show("onboarding", title: "Welcome to Headroom") { OnboardingView() }
    }

    func showSettings() {
        show("settings", title: "Headroom Settings") { SettingsView() }
    }

    func showAbout() {
        NSApp.activate(ignoringOtherApps: true)
        NSApp.orderFrontStandardAboutPanel(options: [.credits: NSAttributedString(string: "")])
    }
}
