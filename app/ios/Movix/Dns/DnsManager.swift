import Foundation
import NetworkExtension

/// Gestion du DNS via NEDNSSettingsManager (iOS 14+).
/// Utilise DNS-over-HTTPS (DoH) vers Cloudflare 1.1.1.1.
@objc(DnsManager)
class DnsManager: NSObject {

  @objc
  static func enable(
    primaryDns: String,
    secondaryDns: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    if #available(iOS 14.0, *) {
      let manager = NEDNSSettingsManager.shared()

      let dohSettings = NEDNSOverHTTPSSettings(servers: [primaryDns, secondaryDns])
      dohSettings.serverURL = URL(string: "https://cloudflare-dns.com/dns-query")

      manager.dnsSettings = dohSettings

      manager.saveToPreferences { error in
        if let error = error {
          reject("DNS_ERROR", "Impossible de configurer le DNS: \(error.localizedDescription)", error)
          return
        }

        manager.loadFromPreferences { error in
          if let error = error {
            reject("DNS_ERROR", "Impossible de charger la config DNS: \(error.localizedDescription)", error)
            return
          }

          resolve(true)
        }
      }
    } else {
      reject("DNS_UNSUPPORTED", "iOS 14+ requis pour la configuration DNS", nil)
    }
  }

  @objc
  static func disable(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    if #available(iOS 14.0, *) {
      let manager = NEDNSSettingsManager.shared()
      manager.removeFromPreferences { error in
        if let error = error {
          reject("DNS_ERROR", "Impossible de désactiver le DNS: \(error.localizedDescription)", error)
          return
        }
        resolve(true)
      }
    } else {
      resolve(true)
    }
  }

  @objc
  static func isEnabled(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    if #available(iOS 14.0, *) {
      let manager = NEDNSSettingsManager.shared()
      manager.loadFromPreferences { error in
        if error != nil {
          resolve(false)
          return
        }
        resolve(manager.dnsSettings != nil)
      }
    } else {
      resolve(false)
    }
  }
}
