import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";

/** Full-screen QR scanner using the device camera. */
export function QrScanner({
  onResult,
  onClose,
}: {
  onResult: (text: string) => void;
  onClose: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();

  if (!permission) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Requesting camera…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Camera permission is required to scan a QR.</Text>
        <TouchableOpacity style={styles.button} onPress={() => void requestPermission()}>
          <Text style={styles.buttonText}>Grant camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          if (data) onResult(data);
        }}
      />
      <View style={styles.frame} pointerEvents="none" />
      <TouchableOpacity style={styles.cancel} onPress={onClose}>
        <Text style={styles.buttonText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12, backgroundColor: "#0e1621" },
  text: { color: "#c8d3de", textAlign: "center" },
  frame: {
    position: "absolute",
    top: "25%",
    left: "12%",
    right: "12%",
    bottom: "25%",
    borderColor: "#ffffff",
    borderWidth: 2,
    borderRadius: 16,
    opacity: 0.8,
  },
  cancel: {
    position: "absolute",
    bottom: 48,
    alignSelf: "center",
    backgroundColor: "#2aabee",
    borderRadius: 14,
    paddingHorizontal: 28,
    paddingVertical: 14,
  },
  button: { backgroundColor: "#2aabee", borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14 },
  buttonText: { color: "#fff", fontWeight: "700" },
});
