import React, { useEffect } from "react";
import { Modal, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";

/**
 * Full-screen QR scanner presented as a proper modal: a top bar with a close
 * button, a centred viewfinder frame, and a hint at the bottom. Nothing is
 * layered behind the controls.
 */
export function QrScanner({
  visible = true,
  onResult,
  onClose,
}: {
  visible?: boolean;
  onResult: (text: string) => void;
  onClose: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [visible, permission, requestPermission]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <SafeAreaView style={styles.safe}>
          <View style={styles.topBar}>
            <Text style={styles.title}>Scan invite QR</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton} accessibilityLabel="Close scanner">
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        <View style={styles.body}>
          {!permission ? (
            <Text style={styles.message}>Requesting camera…</Text>
          ) : !permission.granted ? (
            <View style={styles.permissionBox}>
              <Text style={styles.message}>
                {permission.canAskAgain
                  ? "Camera permission is required to scan a QR."
                  : "Camera access is blocked. Enable it in Settings → Apps → GhostWire → Permissions."}
              </Text>
              {permission.canAskAgain && (
                <TouchableOpacity style={styles.button} onPress={() => void requestPermission()}>
                  <Text style={styles.buttonText}>Grant camera</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={({ data }) => {
                  if (data) onResult(data);
                }}
              />
              <View pointerEvents="none" style={styles.dim} />
              <View pointerEvents="none" style={styles.frame} />
              <Text style={styles.hint}>Point the camera at a GhostWire invite</Text>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const FRAME_INSET = 40;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0e1621" },
  safe: { backgroundColor: "#0e1621" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { color: "#fff", fontSize: 17, fontWeight: "700" },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  closeText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  body: { flex: 1, overflow: "hidden" },
  permissionBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  message: { color: "#c8d3de", textAlign: "center", fontSize: 15, lineHeight: 22 },
  button: { backgroundColor: "#2aabee", borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14 },
  buttonText: { color: "#fff", fontWeight: "700" },
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
  frame: {
    position: "absolute",
    top: FRAME_INSET,
    bottom: FRAME_INSET,
    left: FRAME_INSET,
    right: FRAME_INSET,
    borderColor: "rgba(42,171,238,0.9)",
    borderWidth: 3,
    borderRadius: 20,
  },
  hint: {
    position: "absolute",
    bottom: 28,
    alignSelf: "center",
    color: "#fff",
    fontSize: 13,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    overflow: "hidden",
  },
});
