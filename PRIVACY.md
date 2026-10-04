# Privacy Policy

**Last updated: 2026**

> **Plain-language summary:** GhostWire has no servers and no accounts. We do not collect,
> transmit, sell, or share your personal data, because there is nowhere for it to go. Your
> messages and keys live only in the memory of your device and disappear when the session ends.

This Privacy Policy explains what GhostWire (the "Software") does and does not do with data. It
applies to the open-source project distributed by the Authors. If you use a **hosted or modified
deployment** run by someone else, that operator's privacy policy applies to their deployment, and
the Authors are not responsible for it.

## 1. Who we are

GhostWire is an open-source, community project. The "Authors" are the project creator and its
contributors. There is no company, no data controller entity, and no data processor operating the
Software on your behalf.

## 2. The short version

- **No account. No sign-up. No email, phone number, or name is ever sent to us.**
- **No backend, no database, no analytics, no telemetry, no crash reporting.**
- **No third-party SDKs that phone home** are included in the core.
- **No tracking pixels, cookies for advertising, or fingerprinting.**
- Message content is **end-to-end encrypted** and is intended to be readable only by people in the
  session.
- Session data is **held in memory only** and is wiped when the session ends or you trigger a panic
  wipe.

## 3. Information we collect

**None.** The Authors operate no servers and receive no data from your use of the Software. We
cannot see your sessions, messages, files, names, keys, IP addresses, or usage patterns.

## 4. Information processed on your device

For the Software to function, the following is processed **locally, in volatile memory only**:

| Data | Purpose | Stored on disk? |
|---|---|---|
| Session key & role tokens | Encrypt/authenticate messages | No — memory only |
| Ephemeral keypairs | Sign messages, key agreement | No — memory only |
| Display name | Shown to session participants | No — memory only |
| Messages & files | Delivered to participants | No — memory only |
| Peer list & presence | Show who is connected | No — memory only |

On native, `expo-secure-store` is used **only** for non-sensitive preferences (for example, theme).
It is **never** used for keys, tokens, or messages. On web, a non-sensitive theme preference may be
kept in `localStorage`; session data is **never** written to `localStorage`, `IndexedDB`, cookies,
or the Cache API.

## 5. Network metadata

GhostWire connects devices directly (peer-to-peer). Depending on the transport, some **metadata**
is inherently visible to parties on the network, even though content is encrypted:

- On the **local network** (Wi-Fi/hotspot), peers and routers can observe that devices are
  communicating, along with timing and approximate traffic size.
- On **Bluetooth**, nearby devices can observe radio activity.
- If you connect through a **self-hosted relay**, the relay operator can observe connection
  metadata (for example, IP addresses and timing) but **cannot read encrypted content**.

We do not collect this metadata. It is a property of the network you choose to use. See the
[Threat Model](./docs/THREAT_MODEL.md) for details.

## 6. No tracking, no profiling, no advertising

We do not track you across sessions or across websites/apps. We do not build profiles. We do not
serve advertising. We do not share data with third parties because we do not have it.

## 7. Data retention

Because nothing is persisted, there is **nothing to retain or delete** on our side. On your device,
data exists only for the duration of a session. Closing the session, reloading the page, or using
**Panic Wipe** clears session state from memory.

## 8. Children's privacy

The Software is not directed at children and is not intended for use by anyone below the age
required to consent to data processing in their jurisdiction. We collect no data from anyone,
including children.

## 9. Your rights

Data-protection laws such as the GDPR and CCPA grant rights to access, correct, delete, or port
personal data. Because the Authors hold **no personal data about you**, there is nothing for us to
disclose, correct, or delete. Any data on your device is under your control and is erased by ending
the session or wiping.

## 10. Security

Message content is protected with modern cryptography (see [Security](./SECURITY.md)). No system is
perfect: a compromised device, a malicious participant you invited, or network metadata can still
reveal information. Use the Software with an appropriate threat model.

## 11. International users

Because there is no data transfer to the Authors, there is no international transfer of your data by
us. A self-hosted relay may be located anywhere; its operator is responsible for that deployment.

## 12. Changes to this policy

We may update this Privacy Policy as the project evolves. The current version is always in this
repository with its "Last updated" date. Continued use after changes means you accept the updated
policy.

## 13. Contact

This is a community project. For questions, open an issue in the repository. This document is **not
legal advice**; consult a qualified attorney for your situation.
