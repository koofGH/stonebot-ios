import UIKit
import WebKit

// Stonebot for iOS is a thin shell: all of the game lives in www/ (HTML + JavaScript).
@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let win = UIWindow(frame: UIScreen.main.bounds)
        win.rootViewController = WebViewController()
        win.makeKeyAndVisible()
        window = win
        return true
    }
}

class WebViewController: UIViewController {
    private var web: WKWebView!
    private let bg = UIColor(red: 0.149, green: 0.145, blue: 0.133, alpha: 1)

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = bg
        web.scrollView.backgroundColor = bg
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsLinkPreview = false
        view = web
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        guard let dir = Bundle.main.url(forResource: "www", withExtension: nil) else { return }
        web.loadFileURL(dir.appendingPathComponent("index.html"), allowingReadAccessTo: dir)
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    override var prefersHomeIndicatorAutoHidden: Bool { false }
}
