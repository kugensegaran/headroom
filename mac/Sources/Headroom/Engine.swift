import AppKit
import Foundation

/// Runs the Node engine (`headroom serve`) and polls its local API.
@MainActor
final class Engine: ObservableObject {
    static let shared = Engine()

    @Published var summary: Summary = .empty
    @Published var reachable = false
    @Published var lastError: String?

    private(set) var port: Int
    private let preferredPort: Int
    private var process: Process?
    private var timer: Timer?
    private var stopping = false
    private var restarts: [Date] = []

    var baseURL: URL { URL(string: "http://127.0.0.1:\(port)")! }

    init(port: Int = Int(ProcessInfo.processInfo.environment["HEADROOM_PORT"] ?? "") ?? 7777) {
        self.port = port
        self.preferredPort = port
    }

    // MARK: Lifecycle

    func start() {
        guard timer == nil else { return }
        stopping = false
        Task {
            await connectOrLaunch()
            await refresh()
        }
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            Task { await self?.refresh() }
        }
    }

    func stop() {
        stopping = true
        timer?.invalidate()
        timer = nil
        process?.terminate()
        process = nil
    }

    /// Use a Headroom engine already on the port (e.g. `headroom serve` in a terminal),
    /// otherwise start one on the first free port from 7777 up.
    private func connectOrLaunch() async {
        for candidate in preferredPort..<(preferredPort + 10) {
            switch await probe(candidate) {
            case .headroom:
                port = candidate
                return
            case .free:
                port = candidate
                launchEngine()
                return
            case .taken:
                continue
            }
        }
        lastError = "Ports \(preferredPort) to \(preferredPort + 9) are all in use. Quit whatever is using them and reopen Headroom."
    }

    private enum PortState { case headroom, free, taken }

    private func probe(_ candidate: Int) async -> PortState {
        var req = URLRequest(url: URL(string: "http://127.0.0.1:\(candidate)/api/health")!)
        req.timeoutInterval = 1
        do {
            let (data, _) = try await URLSession.shared.data(for: req)
            let health = try? JSONDecoder().decode(Health.self, from: data)
            return health?.app == "headroom" ? .headroom : .taken
        } catch let error as URLError where error.code == .cannotConnectToHost {
            return .free
        } catch {
            return .taken
        }
    }

    private struct Health: Decodable { let app: String }

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
        p.arguments = [cli.path, "serve", "--port", "\(port)", "--parent-pid", "\(ProcessInfo.processInfo.processIdentifier)"]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        p.terminationHandler = { [weak self] _ in
            Task { @MainActor in self?.engineExited() }
        }
        do {
            try p.run()
            process = p
        } catch {
            lastError = "Could not start engine: \(error.localizedDescription)"
        }
    }

    /// Restart a crashed engine, but give up after 5 crashes in 2 minutes.
    private func engineExited() {
        process = nil
        guard !stopping else { return }
        restarts = restarts.filter { $0.timeIntervalSinceNow > -120 } + [Date()]
        if restarts.count > 5 {
            lastError = "The engine keeps stopping. Quit and reopen Headroom. If it keeps happening, check that Node.js is installed."
            return
        }
        Task {
            try? await Task.sleep(for: .seconds(1))
            await connectOrLaunch()
            await refresh()
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

    func refresh() async {
        do {
            let (data, _) = try await URLSession.shared.data(from: baseURL.appendingPathComponent("api/summary"))
            summary = try JSONDecoder().decode(Summary.self, from: data)
            reachable = true
            lastError = nil
            Notifier.shared.check(summary)
        } catch {
            reachable = false
        }
    }

    @discardableResult
    private func post(_ path: String, body: [String: Any] = [:]) async -> Data? {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.timeoutInterval = 300
        req.setValue("1", forHTTPHeaderField: "x-headroom")
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        let data = try? await URLSession.shared.data(for: req).0
        await refresh()
        return data
    }

    func setPaused(_ paused: Bool) async { await post("api/pause", body: ["paused": paused]) }
    func trim() async { await post("api/trim", body: ["days": 7]) }
    func updateSettings(_ patch: [String: Any]) async { await post("api/settings", body: patch) }

    func audit() async -> [AuditResult] {
        guard let data = await post("api/audit") else { return [] }
        return (try? JSONDecoder().decode([AuditResult].self, from: data)) ?? []
    }

    func openDashboard() {
        NSWorkspace.shared.open(baseURL)
    }
}

/// One row of POST /api/audit (see src/audit.js).
struct AuditResult: Decodable, Identifiable {
    var id: String { name }
    let name: String
    let ok: Bool
    let tools: Int?
    let error: String?
    let clients: [String]
    let readOnly: String?
}
