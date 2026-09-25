import XCTest
@testable import Headroom

final class UpdateWindowTests: XCTestCase {
    let day: TimeInterval = 86400
    lazy var releases = [
        UpdateWindow.Release(version: "1.0.0", date: Date(timeIntervalSince1970: 0)),
        UpdateWindow.Release(version: "1.2.0", date: Date(timeIntervalSince1970: 200 * day)),
        UpdateWindow.Release(version: "1.10.0", date: Date(timeIntervalSince1970: 400 * day)),
        UpdateWindow.Release(version: "1.1.0", date: Date(timeIntervalSince1970: 100 * day)),
    ]

    func testNewestInsideTheWindow() {
        XCTAssertEqual(UpdateWindow.pick(releases, until: Date(timeIntervalSince1970: 250 * day)), 1)
    }

    func testNoWindowMeansNewest() {
        XCTAssertEqual(UpdateWindow.pick(releases, until: nil), 2, "1.10.0 beats 1.2.0")
    }

    func testWindowBeforeEveryReleaseOffersOnlyTheFirst() {
        XCTAssertEqual(UpdateWindow.pick(releases, until: Date(timeIntervalSince1970: 50 * day)), 0)
        XCTAssertNil(UpdateWindow.pick(Array(releases.dropFirst()), until: Date(timeIntervalSince1970: 50 * day)))
    }
}
