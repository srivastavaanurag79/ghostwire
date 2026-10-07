import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  BackHandler,
  Image,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { ChatMessage, Role } from "@ghostwire/protocol";
import { NativeSession } from "./src/session";
import { InviteQR } from "./src/components/InviteQR";
import { QrScanner } from "./src/components/QrScanner";

const session = new NativeSession();
const DEFAULT_RELAY = "ws://192.168.1.10:8787";
const WEB_URL = "https://qrghostwire.vercel.app";

const ROLE_COLOR: Record<Role, string> = {
  admin: "#8774e1",
  moderator: "#2aabee",
  speaker: "#4fbe87",
  listener: "#94a3b8",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

function hue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

function timeOf(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const [name, setName] = useState("");
  const [relay, setRelay] = useState(DEFAULT_RELAY);
  const [pin, setPin] = useState("");
  const [mode, setMode] = useState<"home" | "create" | "join" | "hostphone" | "ble" | "blejoin">(
    "home",
  );
  const [text, setText] = useState("");
  const [blePayload, setBlePayload] = useState("");
  const [scanning, setScanning] = useState(false);
  const [help, setHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSpeak = state.role === "admin" || state.role === "moderator" || state.role === "speaker";

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (scanning) {
        setScanning(false);
        return true;
      }
      if (help) {
        setHelp(false);
        return true;
      }
      if (mode !== "home") {
        setMode("home");
        return true;
      }
      if (state.screen === "active") return true;
      return false;
    });
    return () => subscription.remove();
  }, [scanning, help, mode, state.screen]);

  const messages = useMemo(() => state.messages, [state.messages]);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (state.screen === "active") {
    return (
      <>
        <StatusBar style="light" />
        <View style={styles.screen}>
          <SafeAreaView edges={["top"]} style={styles.headerSafe}>
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.headerTitle}>GhostWire</Text>
                <Text style={styles.headerSub}>
                  {state.role}
                  {state.isHost && state.pin ? ` · PIN ${state.pin}` : ""} · {state.peers.length + 1}{" "}
                  connected
                </Text>
              </View>
              <TouchableOpacity style={styles.headerBtn} onPress={() => setHelp(true)}>
                <Text style={styles.headerBtnText}>?</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.headerBtn, styles.wipeBtn]}
                onPress={() => session.panicWipe()}
              >
                <Text style={styles.wipeText}>Wipe</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>

          {state.transport === "ble" && state.bleQr && (
            <View style={styles.bleBox}>
              <Text style={styles.bleTitle}>Bluetooth invite</Text>
              <InviteQR value={state.bleQr} size={200} />
            </View>
          )}

          {state.isHost && state.joinRequests.length > 0 && (
            <View style={styles.requests}>
              {state.joinRequests.map((req) => (
                <View key={req.peerId} style={styles.requestRow}>
                  <Text style={styles.requestName}>{req.name} wants to join</Text>
                  <View style={styles.requestActions}>
                    {(["listener", "speaker", "moderator"] as Role[]).map((role) => (
                      <TouchableOpacity
                        key={role}
                        style={[styles.chip, { backgroundColor: ROLE_COLOR[role] }]}
                        onPress={() => session.approve(req.peerId, role)}
                      >
                        <Text style={styles.chipText}>{role}</Text>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity
                      style={[styles.chip, styles.chipGhost]}
                      onPress={() => session.reject(req.peerId)}
                    >
                      <Text style={styles.chipText}>decline</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}

          <ScrollView
            style={styles.messages}
            contentContainerStyle={styles.messagesContent}
            keyboardShouldPersistTaps="handled"
          >
            {messages.map((m) => (
              <Bubble key={m.id} message={m} mine={!m.isSystem && m.name === state.name} />
            ))}
          </ScrollView>

          <SafeAreaView edges={["bottom"]} style={styles.composerSafe}>
            <View style={styles.composer}>
              <TouchableOpacity
                style={[styles.attach, !canSpeak && styles.disabled]}
                disabled={!canSpeak}
                onPress={() =>
                  void session.sendFile().catch((e) =>
                    setError(e instanceof Error ? e.message : "Could not send the file"),
                  )
                }
              >
                <Text style={styles.attachText}>📎</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={setText}
                editable={canSpeak}
                placeholder={canSpeak ? "Message" : "Listener (read only)"}
                placeholderTextColor="#7f91a4"
                multiline
              />
              <TouchableOpacity
                style={[styles.send, !canSpeak && styles.disabled]}
                disabled={!canSpeak}
                onPress={() => {
                  session.send(text);
                  setText("");
                }}
              >
                <Text style={styles.sendText}>➤</Text>
              </TouchableOpacity>
            </View>
            {error && <Text style={styles.errorInline}>{error}</Text>}
          </SafeAreaView>
        </View>
        <HelpModal visible={help} onClose={() => setHelp(false)} />
        <QrScanner
          visible={scanning}
          onResult={(data) => {
            setScanning(false);
            void run(() => session.joinFromQr(data, name));
          }}
          onClose={() => setScanning(false)}
        />
      </>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <View style={styles.screen}>
        <SafeAreaView edges={["top", "bottom"]} style={styles.homeSafe}>
          <ScrollView contentContainerStyle={styles.homeContent}>
            <Image source={require("./assets/icon.png")} style={styles.logoImage} />
            <Text style={styles.logo}>GhostWire</Text>
            <Text style={styles.tagline}>
              Serverless, ephemeral, encrypted mesh chat. No accounts. Nothing stored.
            </Text>

            {error && <Text style={styles.error}>{error}</Text>}

            {mode === "home" && (
              <>
                <TouchableOpacity style={styles.primary} onPress={() => setMode("create")}>
                  <Text style={styles.primaryText}>Create a session (relay + PIN)</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondary} onPress={() => setMode("hostphone")}>
                  <Text style={styles.secondaryText}>Host on this phone (no computer)</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondary} onPress={() => setMode("join")}>
                  <Text style={styles.secondaryText}>Join with a PIN</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondary} onPress={() => setMode("ble")}>
                  <Text style={styles.secondaryText}>Start Bluetooth mesh</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondary} onPress={() => setMode("blejoin")}>
                  <Text style={styles.secondaryText}>Join with a QR / invite</Text>
                </TouchableOpacity>
                <View style={styles.homeLinks}>
                  <TouchableOpacity onPress={() => setHelp(true)}>
                    <Text style={styles.linkText}>How to use GhostWire</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => void Linking.openURL(WEB_URL)}>
                    <Text style={styles.linkText}>Open web version in browser</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {mode !== "home" && (
              <>
                <Text style={styles.label}>Display name</Text>
                <TextInput
                  style={styles.inputSingle}
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Field team 2"
                  placeholderTextColor="#7f91a4"
                />

                {(mode === "create" || mode === "join") && (
                  <>
                    <Text style={styles.label}>Relay URL</Text>
                    <TextInput
                      style={styles.inputSingle}
                      value={relay}
                      onChangeText={setRelay}
                      autoCapitalize="none"
                      placeholder="ws://192.168.1.10:8787"
                      placeholderTextColor="#7f91a4"
                    />
                  </>
                )}

                {mode === "join" && (
                  <>
                    <Text style={styles.label}>Session PIN</Text>
                    <TextInput
                      style={[styles.inputSingle, styles.pinInput]}
                      value={pin}
                      onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 8))}
                      keyboardType="number-pad"
                      placeholder="6-digit PIN"
                      placeholderTextColor="#7f91a4"
                    />
                  </>
                )}

                {mode === "blejoin" && (
                  <>
                    <Text style={styles.label}>Invite (QR or pasted link)</Text>
                    <TextInput
                      style={[styles.inputSingle, styles.multiline]}
                      value={blePayload}
                      onChangeText={setBlePayload}
                      multiline
                      autoCapitalize="none"
                      placeholder="Paste a GW1:… invite link"
                      placeholderTextColor="#7f91a4"
                    />
                    <TouchableOpacity style={styles.secondary} onPress={() => setScanning(true)}>
                      <Text style={styles.secondaryText}>Scan invite QR with camera</Text>
                    </TouchableOpacity>
                  </>
                )}

                <TouchableOpacity
                  style={[styles.primary, busy && styles.disabled]}
                  disabled={busy}
                  onPress={() =>
                    run(() => {
                      if (mode === "create") return session.createRelay(name, relay.trim());
                      if (mode === "join") return session.joinRelay(name, relay.trim(), pin.trim());
                      if (mode === "hostphone") return session.hostOnPhone(name);
                      if (mode === "ble") return session.createBle(name).then(() => undefined);
                      return session.joinFromQr(blePayload.trim(), name);
                    })
                  }
                >
                  <Text style={styles.primaryText}>
                    {busy
                      ? "Connecting…"
                      : mode === "create"
                        ? "Open session"
                        : mode === "hostphone"
                          ? "Start hosting"
                          : mode === "join"
                            ? "Join session"
                            : mode === "ble"
                              ? "Start mesh"
                              : "Join session"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondary} onPress={() => setMode("home")}>
                  <Text style={styles.secondaryText}>Back</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
      <HelpModal visible={help} onClose={() => setHelp(false)} />
      <QrScanner
        visible={scanning}
        onResult={(data) => {
          setScanning(false);
          void run(() => session.joinFromQr(data, name));
        }}
        onClose={() => setScanning(false)}
      />
    </>
  );
}

function Bubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  if (message.isSystem) {
    return <Text style={styles.systemText}>{message.content}</Text>;
  }
  const color = ROLE_COLOR[message.role];
  return (
    <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
      {!mine && (
        <View style={[styles.avatar, { backgroundColor: `hsl(${hue(message.name)} 60% 42%)` }]}>
          <Text style={styles.avatarText}>{initials(message.name)}</Text>
        </View>
      )}
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {!mine && (
          <Text style={[styles.bubbleName, { color }]}>
            {message.name}
            <Text style={styles.bubbleRole}> {message.role}</Text>
          </Text>
        )}
        <Text style={styles.bubbleText}>{message.content}</Text>
        <Text style={styles.bubbleTime}>{timeOf(message.ts)}</Text>
      </View>
    </View>
  );
}

function HelpModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1 }}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>How to use GhostWire</Text>
            <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
              <Text style={styles.headerBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.helpContent}>
            <Text style={styles.helpH}>What it is</Text>
            <Text style={styles.helpP}>
              A private group chat with no account that keeps nothing. Messages are encrypted and
              live only in memory; when the session ends they are gone.
            </Text>
            <Text style={styles.helpH}>Host on this phone (no computer)</Text>
            <Text style={styles.helpP}>
              Tap it, and you get a 6-digit PIN. Others on the same Wi‑Fi type{" "}
              <Text style={styles.b}>Join with a PIN</Text> and enter the relay URL shown by the host
              (“ws://&lt;this phone's IP&gt;:8787”) plus the PIN.
            </Text>
            <Text style={styles.helpH}>Create a session (relay + PIN)</Text>
            <Text style={styles.helpP}>
              Same, but the host uses a relay on a computer or a hosted relay URL.
            </Text>
            <Text style={styles.helpH}>Bluetooth mesh (no internet)</Text>
            <Text style={styles.helpP}>
              Not available in this build yet; it needs two physical phones and a BLE peripheral
              module we’re still wiring up.
            </Text>
            <Text style={styles.helpH}>Roles</Text>
            <Text style={styles.helpP}>
              Host = admin (approves/declines and revokes). Moderators help approve. Speakers can
              send; listeners read only.
            </Text>
            <Text style={styles.helpH}>Staying safe</Text>
            <Text style={styles.helpP}>
              Invite only people you trust. Use “Wipe” to erase everything from the device.
            </Text>
            <TouchableOpacity style={styles.primary} onPress={() => void Linking.openURL(WEB_URL)}>
              <Text style={styles.primaryText}>Open web version</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0e1621" },
  homeSafe: { flex: 1 },
  homeContent: { padding: 24, gap: 10, flexGrow: 1, justifyContent: "center" },
  logoImage: { width: 96, height: 96, borderRadius: 24, alignSelf: "center", marginBottom: 4 },
  logo: { color: "#fff", fontSize: 32, fontWeight: "700", textAlign: "center" },
  tagline: { color: "#8aa0b4", fontSize: 14, textAlign: "center", marginBottom: 14, lineHeight: 20 },
  label: { color: "#c8d3de", fontSize: 13, fontWeight: "600", marginTop: 8 },
  inputSingle: {
    backgroundColor: "#17212b",
    borderRadius: 12,
    borderColor: "#24313f",
    borderWidth: 1,
    color: "#fff",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  multiline: { minHeight: 76, textAlignVertical: "top" },
  pinInput: { textAlign: "center", fontSize: 22, letterSpacing: 5 },
  primary: { backgroundColor: "#2aabee", borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 6 },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  secondary: { borderColor: "#24313f", borderWidth: 1, borderRadius: 14, paddingVertical: 13, alignItems: "center" },
  secondaryText: { color: "#c8d3de", fontSize: 15, fontWeight: "600" },
  homeLinks: { marginTop: 14, gap: 10, alignItems: "center" },
  linkText: { color: "#5fb0e8", fontSize: 14, fontWeight: "600" },
  error: { color: "#ff8f8f", fontSize: 13, textAlign: "center" },
  errorInline: { color: "#ff8f8f", fontSize: 12, paddingHorizontal: 12, paddingBottom: 6 },
  disabled: { opacity: 0.5 },

  headerSafe: { backgroundColor: "#17212b" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#17212b",
    borderBottomColor: "#24313f",
    borderBottomWidth: 1,
  },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  headerSub: { color: "#7f91a4", fontSize: 12, marginTop: 2 },
  headerBtn: {
    minWidth: 34,
    height: 34,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  headerBtnText: { color: "#c8d3de", fontSize: 15, fontWeight: "700" },
  wipeBtn: { backgroundColor: "rgba(225,112,118,0.15)" },
  wipeText: { color: "#e17076", fontSize: 12, fontWeight: "700" },

  bleBox: { padding: 12, alignItems: "center", gap: 6 },
  bleTitle: { color: "#7fe0a8", fontSize: 13, fontWeight: "700" },

  requests: { padding: 10, gap: 8, borderBottomColor: "#24313f", borderBottomWidth: 1 },
  requestRow: { backgroundColor: "#1c2733", borderRadius: 12, padding: 12, gap: 8 },
  requestName: { color: "#fff", fontSize: 13 },
  requestActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  chipGhost: { backgroundColor: "#33404f" },
  chipText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  messages: { flex: 1 },
  messagesContent: { padding: 12, gap: 8 },
  systemText: { color: "#7f91a4", fontSize: 12, fontStyle: "italic", textAlign: "center", marginVertical: 6 },

  bubbleRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, maxWidth: "100%" },
  rowTheirs: { justifyContent: "flex-start" },
  rowMine: { justifyContent: "flex-end" },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  bubble: { maxWidth: "78%", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleTheirs: { backgroundColor: "#182533", borderTopLeftRadius: 4 },
  bubbleMine: { backgroundColor: "#2b5278", borderTopRightRadius: 4 },
  bubbleName: { fontSize: 12, fontWeight: "700", marginBottom: 2 },
  bubbleRole: { color: "#7f91a4", fontSize: 10, fontWeight: "600" },
  bubbleText: { color: "#fff", fontSize: 15, lineHeight: 21 },
  bubbleTime: { color: "rgba(255,255,255,0.5)", fontSize: 10, alignSelf: "flex-end", marginTop: 3 },

  composerSafe: { backgroundColor: "#17212b", borderTopColor: "#24313f", borderTopWidth: 1 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  attach: { backgroundColor: "#1c2733", borderRadius: 22, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  attachText: { fontSize: 18 },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    backgroundColor: "#1c2733",
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    color: "#fff",
    fontSize: 16,
  },
  send: { backgroundColor: "#2aabee", borderRadius: 22, width: 48, height: 44, alignItems: "center", justifyContent: "center" },
  sendText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  helpContent: { padding: 20, gap: 4, paddingBottom: 40 },
  helpH: { color: "#fff", fontSize: 15, fontWeight: "700", marginTop: 14 },
  helpP: { color: "#c8d3de", fontSize: 14, lineHeight: 21 },
  b: { fontWeight: "700", color: "#fff" },
});

export default App;
