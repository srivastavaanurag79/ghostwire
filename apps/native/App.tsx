import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  BackHandler,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import type { Role } from "@ghostwire/protocol";
import { NativeSession } from "./src/session";
import { InviteQR } from "./src/components/InviteQR";
import { QrScanner } from "./src/components/QrScanner";

const session = new NativeSession();
const DEFAULT_RELAY = "ws://192.168.1.10:8787";

export default function App() {
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSpeak = state.role === "admin" || state.role === "moderator" || state.role === "speaker";

  // Android back gesture/button should navigate inside the app, not exit it.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (scanning) {
        setScanning(false);
        return true;
      }
      if (mode !== "home") {
        setMode("home");
        return true;
      }
      // Stay in an active session rather than closing the app.
      if (state.screen === "active") return true;
      return false;
    });
    return () => subscription.remove();
  }, [scanning, mode, state.screen]);

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
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>GhostWire</Text>
            <Text style={styles.subtitle}>
              {state.transport === "ble" ? "Bluetooth mesh" : state.role} ·{" "}
              {state.peers.length + 1} connected
              {state.isHost && state.pin ? ` · PIN ${state.pin}` : ""}
            </Text>
          </View>
          <TouchableOpacity style={styles.danger} onPress={() => session.panicWipe()}>
            <Text style={styles.dangerText}>Wipe</Text>
          </TouchableOpacity>
        </View>

        {state.transport === "ble" && state.bleQr && (
          <View style={styles.bleBox}>
            <Text style={styles.bleTitle}>Bluetooth invite — show this QR</Text>
            <InviteQR value={state.bleQr} size={220} />
            <Text style={styles.bleHint}>
              One QR only — BLE needs no answer handshake. Nearby devices scan it to join.
            </Text>
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
                      style={styles.smallButton}
                      onPress={() => session.approve(req.peerId, role)}
                    >
                      <Text style={styles.smallButtonText}>{role}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    style={styles.declineButton}
                    onPress={() => session.reject(req.peerId)}
                  >
                    <Text style={styles.smallButtonText}>decline</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {state.peers.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.people}
            contentContainerStyle={styles.peopleContent}
          >
            {state.peers.map((peer) => (
              <View key={peer.id} style={styles.person}>
                <Text style={styles.personName}>{peer.name}</Text>
                <Text style={styles.personRole}>{peer.role}</Text>
                {(state.role === "admin" || state.role === "moderator") && peer.role !== "admin" && (
                  <TouchableOpacity onPress={() => session.revoke(peer.pubkey)}>
                    <Text style={styles.revokeText}>revoke</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </ScrollView>
        )}

        <ScrollView style={styles.messages} contentContainerStyle={styles.messagesContent}>
          {state.messages.map((m) => (
            <View
              key={m.id}
              style={[
                styles.bubble,
                m.isSystem ? styles.systemBubble : m.name === state.name ? styles.outBubble : styles.inBubble,
              ]}
            >
              {!m.isSystem && m.name !== state.name && (
                <Text style={styles.bubbleName}>{m.name}</Text>
              )}
              <Text style={m.isSystem ? styles.systemText : styles.bubbleText}>{m.content}</Text>
            </View>
          ))}
        </ScrollView>

        {state.transfers.length > 0 && (
          <View style={styles.transfers}>
            {state.transfers.slice(0, 3).map((t) => (
              <View key={t.id} style={styles.transferRow}>
                <Text style={styles.transferName} numberOfLines={1}>
                  {t.direction === "in" ? "↓ " : "↑ "}
                  {t.name}
                </Text>
                <Text style={styles.transferMeta}>
                  {t.status === "done" ? (t.direction === "in" ? "received" : "sent") : `${t.progress}%`}
                </Text>
                {t.direction === "in" && t.status === "done" && (
                  <TouchableOpacity onPress={() => void session.shareFile(t.id)} style={styles.shareBtn}>
                    <Text style={styles.shareText}>Save</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}

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
            placeholder={canSpeak ? "Encrypted message…" : "Listener (read only)"}
            placeholderTextColor="#7f91a4"
          />
          <TouchableOpacity
            style={[styles.send, !canSpeak && styles.disabled]}
            disabled={!canSpeak}
            onPress={() => {
              session.send(text);
              setText("");
            }}
          >
            <Text style={styles.sendText}>Send</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.homeContent}>
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
              <Text style={styles.secondaryText}>Start Bluetooth mesh (no internet)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => setMode("blejoin")}>
              <Text style={styles.secondaryText}>Join Bluetooth mesh (paste invite)</Text>
            </TouchableOpacity>
            <Text style={styles.note}>
              Relay + PIN needs a meeting point (a relay on a computer or hosted). The Bluetooth mesh
              needs no internet, no hotspot and no relay — one QR to join. BLE is in progress and
              needs a development build.
            </Text>
          </>
        )}

        {mode !== "home" && (
          <>
            <Text style={styles.label}>Display name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Field team 2"
              placeholderTextColor="#7f91a4"
            />

            {(mode === "create" || mode === "join") && (
              <>
                <Text style={styles.label}>Relay URL</Text>
                <TextInput
                  style={styles.input}
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
                  style={[styles.input, styles.pinInput]}
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
                <Text style={styles.label}>Invite payload</Text>
                <TextInput
                  style={[styles.input, styles.multiline]}
                  value={blePayload}
                  onChangeText={setBlePayload}
                  multiline
                  autoCapitalize="none"
                  placeholder="Paste the GW1:… invite from the host"
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
                  return session.joinBle(blePayload.trim(), name);
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
                          : "Join mesh"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => setMode("home")}>
              <Text style={styles.secondaryText}>Back</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
      {scanning && (
        <QrScanner
          onResult={(data) => {
            setScanning(false);
            void run(() => session.joinBle(data, name));
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0e1621" },
  homeContent: { padding: 24, gap: 12, flexGrow: 1, justifyContent: "center" },
  logo: { color: "#fff", fontSize: 34, fontWeight: "700", textAlign: "center" },
  tagline: { color: "#8aa0b4", fontSize: 15, textAlign: "center", marginBottom: 12, lineHeight: 22 },
  label: { color: "#fff", fontSize: 13, fontWeight: "600", marginTop: 8 },
  input: {
    backgroundColor: "#17212b",
    borderRadius: 12,
    borderColor: "#24313f",
    borderWidth: 1,
    color: "#fff",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  pinInput: { textAlign: "center", fontSize: 24, letterSpacing: 6 },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  bleBox: {
    backgroundColor: "#132a1f",
    borderColor: "#2f6b4a",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    margin: 12,
    gap: 6,
  },
  bleTitle: { color: "#7fe0a8", fontSize: 13, fontWeight: "700" },
  blePayload: { color: "#cfe9dc", fontSize: 11 },
  bleHint: { color: "#7fae95", fontSize: 11 },
  primary: { backgroundColor: "#2aabee", borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  secondary: { borderColor: "#24313f", borderWidth: 1, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  secondaryText: { color: "#c8d3de", fontSize: 15, fontWeight: "600" },
  note: { color: "#7f91a4", fontSize: 12, lineHeight: 18, marginTop: 12 },
  error: { color: "#ff8f8f", fontSize: 13 },
  disabled: { opacity: 0.5 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomColor: "#24313f",
    borderBottomWidth: 1,
  },
  title: { color: "#fff", fontSize: 18, fontWeight: "700" },
  subtitle: { color: "#7f91a4", fontSize: 12, marginTop: 2 },
  danger: { borderColor: "#e17076", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  dangerText: { color: "#e17076", fontSize: 12, fontWeight: "600" },
  requests: { padding: 12, gap: 8, borderBottomColor: "#24313f", borderBottomWidth: 1 },
  requestRow: { backgroundColor: "#1c2733", borderRadius: 12, padding: 12, gap: 8 },
  requestName: { color: "#fff", fontSize: 13 },
  requestActions: { flexDirection: "row", gap: 8 },
  smallButton: { backgroundColor: "#2aabee", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  smallButtonText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  messages: { flex: 1 },
  messagesContent: { padding: 12, gap: 6 },
  bubble: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, maxWidth: "85%" },
  inBubble: { backgroundColor: "#182533", alignSelf: "flex-start" },
  outBubble: { backgroundColor: "#2b5278", alignSelf: "flex-end" },
  systemBubble: { alignSelf: "center", backgroundColor: "transparent" },
  bubbleName: { color: "#5fb0e8", fontSize: 11, fontWeight: "700", marginBottom: 2 },
  bubbleText: { color: "#fff", fontSize: 14 },
  systemText: { color: "#7f91a4", fontSize: 12, fontStyle: "italic" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12, borderTopColor: "#24313f", borderTopWidth: 1 },
  send: { backgroundColor: "#2aabee", borderRadius: 12, paddingHorizontal: 18, justifyContent: "center" },
  sendText: { color: "#fff", fontWeight: "700" },
  attach: { backgroundColor: "#1c2733", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  attachText: { fontSize: 18 },
  declineButton: {
    backgroundColor: "#3a2a2f",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  people: { borderBottomColor: "#24313f", borderBottomWidth: 1, maxHeight: 76 },
  peopleContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 8, flexDirection: "row" },
  person: {
    backgroundColor: "#1c2733",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 90,
    gap: 2,
  },
  personName: { color: "#fff", fontSize: 13, fontWeight: "600" },
  personRole: { color: "#7f91a4", fontSize: 11 },
  revokeText: { color: "#e17076", fontSize: 11, marginTop: 2 },
  transfers: { paddingHorizontal: 12, paddingTop: 8, gap: 4 },
  transferRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  transferName: { color: "#c8d3de", fontSize: 12, flex: 1 },
  transferMeta: { color: "#7f91a4", fontSize: 11 },
  shareBtn: { backgroundColor: "#2aabee", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  shareText: { color: "#fff", fontSize: 11, fontWeight: "600" },
});
