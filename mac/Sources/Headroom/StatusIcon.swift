import AppKit

/// The Headroom mark drawn in code so the menu bar icon can show the live level.
/// An open-top vessel: the filled part is context used by tool definitions, the
/// empty space above it is the headroom left. Template image, so macOS tints it.
enum StatusIcon {
    /// `level` is the share of the context window used by tools (0...1).
    static func image(level: Double) -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { _ in
            NSColor.black.set()

            // Vessel: stroke a rounded rect whose top edge sits above the clip, leaving a U.
            NSGraphicsContext.saveGraphicsState()
            NSBezierPath(rect: NSRect(x: 0, y: 2.5, width: 18, height: 15.5)).addClip()
            let vessel = NSBezierPath(roundedRect: NSRect(x: 4, y: -5, width: 10, height: 20.5), xRadius: 3, yRadius: 3)
            vessel.lineWidth = 1.6
            vessel.stroke()
            NSGraphicsContext.restoreGraphicsState()

            // Round caps on the two rims.
            for x in [4.0, 14.0] {
                NSBezierPath(ovalIn: NSRect(x: x - 0.8, y: 1.7, width: 1.6, height: 1.6)).fill()
            }

            // Level: grows from the floor of the vessel.
            let clamped = min(max(level, 0), 1)
            let maxHeight = 9.8
            let height = max(1.6, clamped * maxHeight)
            let fill = NSRect(x: 6.2, y: 13.8 - height, width: 5.6, height: height)
            let radius = min(1.5, height / 2)
            NSBezierPath(roundedRect: fill, xRadius: radius, yRadius: radius).fill()
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "Headroom"
        return image
    }
}
