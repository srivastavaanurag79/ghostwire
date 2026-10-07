// React Native autolinking config.
//
// Some libraries ship native Android code but are not auto-detected by the CLI
// (they have no `react-native` field). Listing them explicitly makes the build
// generate and register their native packages, so modules like
// `NativeModules.TcpSockets` and `NativeModules.BlePlx` exist at runtime.
const path = require("path");

module.exports = {
  dependencies: {
    "react-native-tcp-socket": {
      root: path.join(__dirname, "node_modules", "react-native-tcp-socket"),
    },
    "react-native-ble-plx": {
      root: path.join(__dirname, "node_modules", "react-native-ble-plx"),
    },
    // NOTE: react-native-ble-peripheral is intentionally NOT linked: its
    // android/build.gradle still uses the removed `compile()` method and fails
    // Gradle 7+. BLE advertising needs a maintained peripheral module (or a
    // small custom one) before the dual-role mesh can be enabled.
  },
};
