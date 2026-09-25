# Headroom icon

An open-top vessel. The filled part is the context your tools take up; the empty space above it is your headroom.

| File | Use |
| --- | --- |
| `appicon.svg`, `AppIcon-1024.png` | Master app icon (macOS grid: 824 px rounded square on a 1024 canvas) |
| `../../mac/AppIcon.icns` | App icon for the bundle, all sizes 16 to 1024 |
| `menubar.svg`, `MenuBarIcon.png`, `MenuBarIcon@2x.png` | Static menu bar mark (template, black on transparent) for docs and the website |
| `../../mac/Sources/Headroom/StatusIcon.swift` | Same mark drawn in code; the fill follows the live context share |

## Wiring it in (for Claude Code)

1. `HeadroomApp.swift`: replace the `gauge.with.dots.needle.33percent` SF Symbol in the `MenuBarExtra` label with
   `Image(nsImage: StatusIcon.image(level: engine.summary.pctOfWindow))`. Keep the percentage text next to it.
2. `mac/Info.plist`: add `<key>CFBundleIconFile</key><string>AppIcon</string>`.
3. `scripts/build-app.sh`: copy `mac/AppIcon.icns` into `Contents/Resources/` before signing.
4. Rebuild with `scripts/build-app.sh --run`, check the icon in light and dark menu bars, then commit.
