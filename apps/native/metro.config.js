// Expo monorepo Metro config.
//
// The shared packages live outside this app and are consumed from their built
// output (`packages/*/dist`). Run `pnpm build` at the repo root before starting
// the native app so the dist folders exist.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Resolve the shared packages to their built output.
const shared = {
  "@ghostwire/crypto": "packages/crypto/dist",
  "@ghostwire/protocol": "packages/protocol/dist",
  "@ghostwire/roles": "packages/roles/dist",
  "@ghostwire/qr": "packages/qr/dist",
  "@ghostwire/mesh": "packages/mesh/dist",
  "@ghostwire/transport": "packages/transport/dist",
};
config.resolver.extraNodeModules = Object.fromEntries(
  Object.entries(shared).map(([name, dir]) => [name, path.resolve(monorepoRoot, dir)]),
);

module.exports = config;
