// Must be first: installs TextEncoder/TextDecoder that Hermes lacks.
import "./src/polyfills";
import { registerRootComponent } from "expo";
import App from "./App";

registerRootComponent(App);
