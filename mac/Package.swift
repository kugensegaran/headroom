// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "MCPMeter",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "MCPMeter",
            path: "Sources/MCPMeter"
        )
    ]
)
