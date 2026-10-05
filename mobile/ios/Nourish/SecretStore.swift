import Foundation
import Security

/// API keys for the free recipe and nutrition services (Settings → Recipe and nutrition services),
/// kept in the iPhone's Keychain: encrypted by iOS, on this device only (never in iCloud or a backup
/// restored to another phone), and never in the app's own files, logs or sync data.
enum SecretStore {
    private static let service = "io.github.nourish.keys"

    static func validName(_ name: String) -> Bool {
        name.range(of: "^[a-z0-9_]{1,40}$", options: .regularExpression) != nil
    }

    private static func base(_ name: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: name]
    }

    static func get(_ name: String) -> String? {
        var q = base(name)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func set(_ name: String, _ value: String) -> Bool {
        delete(name)
        guard !value.isEmpty else { return true }
        var q = base(name)
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    @discardableResult
    static func delete(_ name: String) -> Bool {
        let status = SecItemDelete(base(name) as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    /// Which keys are saved (names only, never the keys).
    static func names() -> [String] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecReturnAttributes as String: true, kSecMatchLimit as String: kSecMatchLimitAll]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let items = out as? [[String: Any]] else { return [] }
        q.removeAll()
        return items.compactMap { $0[kSecAttrAccount as String] as? String }.sorted()
    }
}
