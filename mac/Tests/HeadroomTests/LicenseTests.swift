import XCTest
@testable import Headroom

/// Answers licence API calls from a table, and records what was sent.
final class FakeLicenseServer: URLProtocol {
    nonisolated(unsafe) static var responses: [String: String] = [:]
    nonisolated(unsafe) static var requests: [(action: String, body: String)] = []
    nonisolated(unsafe) static var offline = false

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let action = request.url!.lastPathComponent
        var body = ""
        if let stream = request.httpBodyStream {
            stream.open()
            var buf = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable { let n = stream.read(&buf, maxLength: buf.count); if n <= 0 { break }; body += String(decoding: buf[0..<n], as: UTF8.self) }
        }
        Self.requests.append((action, body))
        if Self.offline {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let res = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: res, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data((Self.responses[action] ?? "{}").utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class MemoryStore: SecretStore {
    var values: [String: String] = [:]
    func get(_ account: String) -> String? { values[account] }
    func set(_ account: String, _ value: String?) { values[account] = value }
}

@MainActor
final class LicenseTests: XCTestCase {
    let meta = #""meta":{"store_id":11,"product_id":22,"customer_email":"buyer@example.com"}"#

    func makeClient(store: Int? = 11, product: Int? = 22) -> LicenseClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FakeLicenseServer.self]
        return LicenseClient(session: URLSession(configuration: config), base: URL(string: "https://licence.test/v1/licenses/")!, storeID: store, productID: product)
    }

    override func setUp() {
        FakeLicenseServer.requests = []
        FakeLicenseServer.offline = false
        FakeLicenseServer.responses = [
            "activate": #"{"activated":true,"error":null,"license_key":{"status":"active","created_at":"2026-03-01T10:00:00.000000Z"},"instance":{"id":"inst-1"},"# + meta + "}",
            "validate": #"{"valid":true,"error":null,"license_key":{"status":"active"},"instance":{"id":"inst-1"},"# + meta + "}",
            "deactivate": #"{"deactivated":true,"error":null,"# + meta + "}",
        ]
    }

    func testActivateReturnsInstanceEmailAndTwelveMonthsOfUpdates() async throws {
        let a = try await makeClient().activate(key: "KEY-1&x", instanceName: "Kugen's Mac")
        XCTAssertEqual(a.instanceID, "inst-1")
        XCTAssertEqual(a.email, "buyer@example.com")
        let comps = Calendar(identifier: .gregorian).dateComponents(in: TimeZone(identifier: "UTC")!, from: a.updatesUntil!)
        XCTAssertEqual([comps.year, comps.month, comps.day], [2027, 3, 1])
        XCTAssertEqual(FakeLicenseServer.requests.first?.action, "activate")
        XCTAssertTrue(FakeLicenseServer.requests.first!.body.contains("license_key=KEY-1%26x"), "form values are encoded")
    }

    func testKeysFromAnotherStoreOrProductAreRefused() async {
        do {
            _ = try await makeClient(store: 99).activate(key: "k", instanceName: "m")
            XCTFail("should refuse")
        } catch {
            XCTAssertEqual((error as? LicenseError)?.message, "This key is for a different product.")
        }
        do {
            _ = try await makeClient(store: nil, product: nil).activate(key: "k", instanceName: "m")
            XCTFail("should refuse")
        } catch {
            XCTAssertEqual((error as? LicenseError)?.message, "Licensing is not set up in this build yet.")
        }
    }

    func testServerErrorsAreShownAsIs() async {
        FakeLicenseServer.responses["activate"] = #"{"activated":false,"error":"This license key has reached the activation limit.","license_key":null,"instance":null,"meta":null}"#
        do {
            _ = try await makeClient().activate(key: "k", instanceName: "m")
            XCTFail("should throw")
        } catch {
            XCTAssertEqual((error as? LicenseError)?.message, "This license key has reached the activation limit.")
        }
    }

    func testManagerActivatesValidatesAndDeactivates() async {
        let manager = LicenseManager()
        let store = MemoryStore()
        var reports: [[String: Any]] = []
        manager.client = makeClient()
        manager.store = store
        manager.defaults = UserDefaults(suiteName: "headroom-tests-\(UUID())")!
        manager.report = { reports.append($0) }

        await manager.activate("  KEY-1  ")
        XCTAssertNil(manager.error)
        XCTAssertEqual(store.values["key"], "KEY-1")
        XCTAssertEqual(store.values["instance"], "inst-1")
        XCTAssertEqual(reports.last?["status"] as? String, "active")
        XCTAssertEqual(reports.last?["email"] as? String, "buyer@example.com")

        // Not due yet: no network call.
        FakeLicenseServer.requests = []
        await manager.validateIfDue()
        XCTAssertTrue(FakeLicenseServer.requests.isEmpty)

        // Due, but offline: nothing changes, the engine's grace period covers it.
        FakeLicenseServer.offline = true
        let later = Date().addingTimeInterval(8 * 86400)
        let before = reports.count
        await manager.validateIfDue(now: later)
        XCTAssertEqual(reports.count, before)
        XCTAssertEqual(store.values["instance"], "inst-1")

        // Due and refunded: the engine is told at once.
        FakeLicenseServer.offline = false
        FakeLicenseServer.responses["validate"] = #"{"valid":false,"error":"license_key not found.","license_key":null,"instance":null,"meta":null}"#
        await manager.validateIfDue(now: later)
        XCTAssertEqual(reports.last?["status"] as? String, "none")
        XCTAssertNotNil(manager.error)

        // Deactivate clears the Keychain.
        store.values["instance"] = "inst-1"
        await manager.deactivate()
        XCTAssertNil(store.values["key"])
        XCTAssertEqual(reports.last?["status"] as? String, "none")
    }
}
