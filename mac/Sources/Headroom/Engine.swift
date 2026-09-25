import AppKit
import Foundation

/// Runs the Node engine (`headroom serve`) and polls its local API.
@MainActor
final class Engine: ObservableObject {
    static let shared = Engine()

    @Published var summary: Summary = .empty
    @Published var reachable = false
    @Published var lastError: String?

    let port: Int
    private var process: Process?
    private var timer: Timer?

    var baseURL: URL { URL(string: "http://127.0.0.1:\(port)")! }

    init(port: Int = Int(ProcessInfo.processInfo.environment["HEADROOM_PORT"] ?? "") ?? 7777) {
        self.port = port
    }

    // MARK: Lifecycle

    func start() {
        guard timer == nil else { return }
        Task {
            if await ping() == false { launchEngine() }
            await refresh()
        }
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            Task { await self?.refresh() }
        }
    }

    func stop() {
        timer?.invalidate()
        process?.terminate()
        process = nil
    }

    /// Engine files: bundled in the .app (Resources/engine) or the repo checkout (HEADROOM_ENGINE).
    private var engineCLI: URL? {
        if let override = ProcessInfo.processInfo.environment["HEADROOM_ENGINE"] {
            return URL(fileURLWithPath: override).appendingPathComponent("src/cli.js")
        }
        if let res = Bundle.main.resourceURL?.appendingPathComponent("engine/src/cli.js"),
           FileManager.default.fileExists(atPath: res.path) {
            return res
        }
        return nil
    }

    /// Prefer a Node binary bundled in the app, then common install locations.
    private var nodeBinary: URL? {
        var candidates: [String] = []
        if let bundled = Bundle.main.resourceURL?.appendingPathComponent("bin/node").path { candidates.append(bundled) }
        candidates += ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
        if let nvm = ProcessInfo.processInfo.environment["NVM_BIN"] { candidates.append(nvm + "/node") }
        return candidates.map(URL.init(fileURLWithPath:)).first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }

    private func launchEngine() {
        guard let node = nodeBinary else {
            lastError = "Node.js not found. Install it with Homebrew: brew install node"
            return
        }
        guard let cli = engineCLI else {
            lastError = "Engine files missing. Rebuild with scripts/build-app.sh."
            return
        }
        let p = Process()
        p.executableURL = node
        p.arguments = [cli.path, "serve", "--port", "\(port)"]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        do {
            try p.run()
            process = p
        } catch {
            lastError = "Could not start engine: \(error.localizedDescription)"
        }
    }

    /// Run a one-off CLI command (install, uninstall, audit) and return its output.
    func runCLI(_ args: [String]) async -> String {
        guard let node = nodeBinary, let cli = engineCLI else { return "Engine not available." }
        return await withCheckedContinuation { cont in
            let p = Process()
            p.executableURL = node
            p.arguments = [cli.path] + args
            let pipe = Pipe()
            p.standardOutput = pipe
            p.standardError = pipe
            p.terminationHandler = { _ in
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                cont.resume(returning: String(data: data, encoding: .utf8) ?? "")
            }
            do { try p.run() } catch { cont.resume(returning: error.localizedDescription) }
        }
    }

    // MARK: API

    private func ping() async -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/summary"))
        req.timeoutInterval = 1
        return (try? await URLSession.shared.data(for: req)) != nil
    }

    func refresh() async {
        do {
            let (data, _) = try await URLSession.shared.data(from: baseURL.appendingPathComponent("api/summary"))
            summary = try JSONDecoder().decode(Summary.self, from: data)
            reachable = true
            lastError = nil
        } catch {
            reachable = false
        }
    }

    private func post(_ path: String, body: [String: Any] = [:]) async {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("1", forHTTPHeaderField: "x-headroom")
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        _ = try? await URLSession.shared.data(for: req)
        await refresh()
    }

    func setPaused(_ paused: Bool) async { await post("api/pause", body: ["paused": paused]) }
    func trim() async { await post("api/trim", body: ["days": 7]) }
    func audit() async { await post("api/audit") }

    func openDashboard() {
        NSWorkspace.shared.open(baseURL)
    }
}
