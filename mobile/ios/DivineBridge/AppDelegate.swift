import Expo
import React
import ReactAppDependencyProvider

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

#if DEBUG
    let metroHost = "metro.divinebridge.io"
    RCTBundleURLProvider.sharedSettings().jsLocation = metroHost
    NSLog("[DivineBridge] jsLocation = \(metroHost)")
#endif

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    let resolved = bridge.bundleURL ?? bundleURL()
    NSLog("[DivineBridge] sourceURL resolved = \(resolved?.absoluteString ?? "nil")")
    return resolved
  }

  override func bundleURL() -> URL? {
#if DEBUG
    let metroHost = "metro.divinebridge.io"
    let url = URL(string: "http://\(metroHost):8081/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&minify=false&lazy=true")
    NSLog("[DivineBridge] bundleURL() = \(url?.absoluteString ?? "nil")")
    return url
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
