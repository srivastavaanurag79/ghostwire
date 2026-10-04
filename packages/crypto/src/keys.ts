/** A public/private keypair where both halves are raw bytes. */
export interface KeyPair {
  /** Raw public key bytes. */
  readonly publicKey: Uint8Array;
  /** Raw private (secret) key bytes. */
  readonly privateKey: Uint8Array;
}
