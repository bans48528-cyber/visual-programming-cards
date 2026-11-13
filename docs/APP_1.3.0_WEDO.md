# App 1.3.0 / PY32 2.3.0

This release replaces XiaoBai's per-block acknowledgement runner with a shared App scheduler and the C4/D4 version 2 streaming protocol. It requires the single signed PY32 2.3.0 package pinned in `assets/firmware/release.json`. An unknown firmware version cannot start a program. Boot 2.0.3 and the ASRPRO project are unchanged.

## Execution

- Ordinary control blocks advance when the complete local Bluetooth write finishes. All groups share the existing writer, with a 100 ms logical-frame interval. STOP, heartbeat and recognition acknowledgements retain higher priority. START and global STOP still require device confirmation.
- App time controls and the current, shared sensor sample determine ordinary waits and loops. Samples older than 600 ms cannot satisfy a condition. Short up/down gestures and speech recognition use real task-correlated device events; an acceptance response cannot complete them.
- A later motor command controls the same physical port immediately. A prior command's timer cannot stop the replacement. Single and combined motor power share one setting; changing power adjusts moving motors and does not start a stopped motor. This last behavior intentionally retains XiaoBai's existing semantics.
- A script finishing leaves its outputs and heartbeat active. Global STOP remains enabled. An idle held session displays “重新运行”. Running globally stops the previous session before starting again.
- Clicking an idle program head starts that script; clicking its running head cancels that script. Only an initialized XiaoBai v2 session unlocks these controls. Other models and structural editing keep their existing locks.
- Running one ordinary head still registers all message receivers in the work. A broadcast restarts the matching receiver's current invocation. “发送消息并等待” waits for the specific invocations it started, rather than any replacement invoked by a later broadcast. Ordinary start and message start remain the only head types.
- Stop, disconnect, mode change and heartbeat loss invalidate pending tasks. A canceled or old event cannot advance a new invocation. Consecutive speech waits require separate recognitions. Learned-command prompts and success continue to depend on real device results.

## Reproduction and evidence

- `npm run test:multi`: targeted runtime/UI/snapshot/workspace/canvas suite (40 tests), browser checks (3 scenarios), and native frame checks (20,341 frames / 20,724 assertions).
- `node tests/xiaobai-firmware-bundle.spec.cjs`: current release gate checks (63 assertions).
- `node tests/wedo-c-interop.cjs`: App Link, GATT-sized fragmentation and production C parser/execution integration. Build the current firmware repository's `tools/build_motion_condition_host.py` bridge first; set `XIAOBAI_C_BRIDGE` and `XIAOBAI_FIRMWARE_ROOT`. The bridge's source hash sidecar must match. This test injects the BSP sensor/ASR boundary and is not a physical-device test.
- `scripts/android.ps1`: web assets, Capacitor sync, Android build and the actual APK's fixed release gate. APK 1.3.0 (38) contains exactly one signed OTA package. All eight changed production JS assets were separately compared byte for byte with the APK. APK Signature Scheme v2 verification passes with the existing debug signer.

`APP_1.3.0_WEDO_VALIDATION.json` records the APK, package and source hashes. `WEDO_C_INTEROP_1.3.0.json` records the 13-step / 59-wire-row C interop trace. The historical v1 scheduler tests describe the replaced execution semantics and are not the current `test:multi` gate; pure v1 frame compatibility remains covered by the native frame suite.

The baseline App 1.2.31 and firmware 2.2.3 remain available on the cloud baseline branches. App 1.3.0 and firmware 2.3.0 are delivered on `feature/wedo-stream-v2`. No hardware was flashed and no tablet installation was performed for this release; physical BLE timing, motor behavior and upgrade/reconnect acceptance remain to be tested together.
