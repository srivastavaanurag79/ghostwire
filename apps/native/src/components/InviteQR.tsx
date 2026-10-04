import React from "react";
import { StyleSheet, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

/** Renders a GhostWire invite payload as a scannable QR. */
export function InviteQR({ value, size = 240 }: { value: string; size?: number }) {
  return (
    <View style={styles.wrap}>
      <QRCode value={value} size={size} backgroundColor="#ffffff" color="#0e1621" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: "#ffffff", padding: 12, borderRadius: 16, alignSelf: "center" },
});
