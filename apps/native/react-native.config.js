// React Native autolinking config.
//
// Two libraries ship native Android code without a `react-native` package field,
// so the CLI does not auto-detect them; they are listed explicitly:
//  - `react-native-tcp-socket` → `NativeModules.TcpSockets` (on-phone relay)
//  - `react-native-ble-plx`    → central BLE (scan/connect/subscribe/write)
//
// `react-native-ble-peripheral-manager` (peripheral/GATT server) declares
// codegen + android and is auto-detected.
const path = require("path");

module.exports = {
  dependencies: {
    "react-native-tcp-socket": {
      root: path.join(__dirname, "node_modules", "react-native-tcp-socket"),
    },
    "react-native-ble-plx": {
      root: path.join(__dirname, "node_modules", "react-native-ble-plx"),
    },
  },
};
