// React Native autolinking config.
//
// `react-native-tcp-socket` ships native Android code but is not auto-detected
// by the CLI (no `react-native` field), so it is listed explicitly to make the
// build register `NativeModules.TcpSockets` (used by the on-phone relay).
//
// BLE now comes from `munim-bluetooth` (Nitro modules), which is auto-detected.
const path = require("path");

module.exports = {
  dependencies: {
    "react-native-tcp-socket": {
      root: path.join(__dirname, "node_modules", "react-native-tcp-socket"),
    },
  },
};
