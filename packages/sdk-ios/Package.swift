// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "DecisioningSDK",
    defaultLocalization: "en",
    platforms: [.iOS(.v15), .macOS(.v13)],
    products: [
        .library(name: "DecisioningSDK", targets: ["DecisioningSDK"])
    ],
    targets: [
        .target(name: "DecisioningSDK"),
        .testTarget(name: "DecisioningSDKTests", dependencies: ["DecisioningSDK"])
    ],
    swiftLanguageVersions: [.v5]
)
