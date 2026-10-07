// React Native autolinking config.
//
// `react-native-tcp-socket` ships native Android code but is not auto-detected,
// so it is listed explicitly. BLE now uses `@syncmesh/rn-ble`, which is an Expo
// Module and is wired by its own config plugin (see app.json).
const path = require("path");

module.exports = {
  dependencies: {
    "react-native-tcp-socket": {
      root: path.join(__dirname, "node_modules", "react-native-tcp-socket"),
    },
  },
};
