import Foundation
import Security

/// Which Lemon Squeezy product a key must belong to. Keys from any other store or product are refused.
/// Fill these in from the Lemon Squeezy dashboard (Settings > Stores, Products > the product > variant).
enum LicenseConfig {
    static let storeID: Int? = nil
    static let productID: Int? = nil
    /// Updates included with a purchase.
    static let updateMonths = 12
    static let apiBase = URL(string: "https://api.lemonsqueezy.com/v1/licenses/")!
    /// Re-check an active licence this often; the engine allows 30 days offline.
    static let revalidateAfter: TimeInterval = 7 * 86400
}

struct LicenseError: LocalizedError, Equatable {
    let message: String
    var errorDescription: String? { message }
}

/// Lemon Squeezy License API: activate, validate, deactivate. No API secret is involved.
struct LicenseClient {
    var session: URLSession = .shared
    var base: URL = LicenseConfig.apiBase
    var storeID: Int? = LicenseConfig.storeID
    var productID: Int? = LicenseConfig.productID

    struct Response: Decodable {
        struct Key: Decodable {
            let status: String
            let created_at: String?
        }
        struct Instance: Decodable { let id: String }
        struct Meta: Decodable {
            let store_id: Int
            let product_id: Int
            let customer_email: String?
        }
        let activated: Bool?
        let valid: Bool?
        let deactivated: Bool?
        let error: String?
        let license_key: Key?
        let instance: Instance?
        let meta: Meta?
    }

    struct Activation: Equatable {
        let instanceID: String
        let email: String?
        let updatesUntil: Date?
    }

    func activate(key: String, instanceName: String) async throws -> Activation {
        let r = try await call("activate", ["license_key": key, "instance_name": instanceName])
        guard r.activated == true, let instance = r.instance else {
            throw LicenseError(message: r.error ?? "This key could not be activated.")
        }
        try checkProduct(r)
        return Activation(instanceID: instance.id, email: r.meta?.customer_email, updatesUntil: updatesUntil(r.license_key?.created_at))
    }

    /// true: still good. false: refunded, disabled or deactivated elsewhere. Throws when offline.
    func validate(key: String, instanceID: String) async throws -> Bool {
        let r = try await call("validate", ["license_key": key, "instance_id": instanceID])
        guard r.valid == true else { return false }
        try checkProduct(r)
        return r.license_key?.status != "disabled" && r.license_key?.status != "expired"
    }

    func deactivate(key: String, instanceID: String) async throws {
        let r = try await call("deactivate", ["license_key": key, "instance_id": instanceID])
        if r.deactivated != true { throw LicenseError(message: r.error ?? "This key could not be deactivated.") }
    }

    private func checkProduct(_ r: Response) throws {
        guard let storeID, let productID else {
            throw LicenseError(message: "Licensing is not set up in this build yet.")
        }
        guard r.meta?.store_id == storeID, r.meta?.product_id == productID else {
            throw LicenseError(message: "This key is for a different product.")
        }
    }

    private func updatesUntil(_ createdAt: String?) -> Date? {
        guard let createdAt else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = f.date(from: createdAt) ?? ISO8601DateFormatter().date(from: createdAt)
        return date.flatMap { Calendar(identifier: .gregorian).date(byAdding: .month, value: LicenseConfig.updateMonths, to: $0) }
    }

    private func call(_ action: String, _ form: [String: String]) async throws -> Response {
        var req = URLRequest(url: base.appendingPathComponent(action))
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        req.httpBody = form.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }
            .joined(separator: "&").data(using: .utf8)
        let (data, _) = try await session.data(for: req)
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw LicenseError(message: "The licence server sent an answer Headroom did not understand.")
        }
    }
}

/// Where the key and this Mac's activation id live.
protocol SecretStore {
    func get(_ account: String) -> String?
    func set(_ account: String, _ value: String?)
}

struct KeychainStore: SecretStore {
    let service = "com.kugensegaran.headroom.licence"

    func get(_ account: String) -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                    kSecAttrAccount as String: account, kSecReturnData as String: true]
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func set(_ account: String, _ value: String?) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                    kSecAttrAccount as String: account]
        SecItemDelete(query as CFDictionary)
        guard let value else { return }
        var add = query
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }
}

/// Keeps the engine's licence status in step with Lemon Squeezy.
@MainActor
final class LicenseManager: ObservableObject {
    static let shared = LicenseManager()

    @Published var busy = false
    @Published var error: String?

    var client = LicenseClient()
    var store: SecretStore = KeychainStore()
    var defaults = UserDefaults.standard
    /// Sends the status to the engine (POST /api/license).
    var report: ([String: Any]) async -> Void = { await Engine.shared.postLicense($0) }

    var hasKey: Bool { store.get("key") != nil }

    func activate(_ rawKey: String) async {
        let key = rawKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { return }
        busy = true
        defer { busy = false }
        do {
            let a = try await client.activate(key: key, instanceName: Host.current().localizedName ?? "Mac")
            store.set("key", key)
            store.set("instance", a.instanceID)
            defaults.set(Date(), forKey: "licenceValidatedAt")
            defaults.set(a.updatesUntil, forKey: UpdateWindow.defaultsKey)
            error = nil
            await report(["status": "active", "validatedAt": Self.ms(Date()), "updatesUntil": a.updatesUntil.map(Self.ms) ?? NSNull(), "email": a.email ?? NSNull()])
        } catch {
            self.error = Self.describe(error)
        }
    }

    func deactivate() async {
        guard let key = store.get("key"), let instance = store.get("instance") else { return }
        busy = true
        defer { busy = false }
        do {
            try await client.deactivate(key: key, instanceID: instance)
        } catch let e as LicenseError {
            // The server no longer knows this activation: clear it here anyway.
            error = e.message
        } catch {
            self.error = "Could not reach the licence server. Try again when you are online."
            return
        }
        store.set("key", nil)
        store.set("instance", nil)
        defaults.removeObject(forKey: UpdateWindow.defaultsKey)
        await report(["status": "none"])
    }

    /// Run at launch and daily. Offline is fine: the engine allows 30 days between checks.
    func validateIfDue(now: Date = Date()) async {
        guard let key = store.get("key"), let instance = store.get("instance") else { return }
        if let last = defaults.object(forKey: "licenceValidatedAt") as? Date, now.timeIntervalSince(last) < LicenseConfig.revalidateAfter { return }
        do {
            if try await client.validate(key: key, instanceID: instance) {
                defaults.set(now, forKey: "licenceValidatedAt")
                await report(["status": "active", "validatedAt": Self.ms(now)])
            } else {
                store.set("instance", nil)
                await report(["status": "none"])
                error = "This licence is no longer active. Activate it again or use another key."
            }
        } catch {
            // Offline or the server is down: keep going on the grace period.
        }
    }

    static func ms(_ d: Date) -> Double { (d.timeIntervalSince1970 * 1000).rounded() }

    static func describe(_ error: Error) -> String {
        if let e = error as? LicenseError { return e.message }
        return "Could not reach the licence server. Check your connection and try again."
    }
}
