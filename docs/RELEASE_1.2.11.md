# Drluck CodeLab 1.2.11 候选交付

版本 **1.2.11 / code17**，包名 `com.xiaobai.remote`。用于旧 GATT 关闭边界及恢复状态修复的独立平板复测。实际整机恢复尚待验证，本次 App 构建未操作硬件、安装或刷写，也未提交 Git。

## 冻结候选包

- APK：`artifacts/drluck-codelab-1.2.11-debug.apk`，39,717,165 字节。
- APK SHA-256：`e4f997c7eb3e0ea197bb387ce07d21cb9d87d50619ee094b866fda35ea442e85`。
- 签名证书 SHA-256：`242b6364ccae103673501115b8cb4be79ee10ab7632fe1e4e7946ba5a5ef9289`，与 1.2.10 一致，可覆盖安装保留作品和设备绑定。
- 固定发布清单 SHA-256：`58b049bdd33fc508008ce7bcc453146c981187625876bef5cfb96b3c73faee95`。
- 唯一内置 PY32 固件仍为 **1.0.3 / 65539**，board258、protocol1、minBoot65536。
- 原冻结包 SHA-256：`a4951259ca4ca31cf0ec1acad5ea6e1b1f232d1989e93b86170e074d3a7178d9`，32,440 字节；镜像 32,312 字节，SHA-256 `9401ff24056f6b884f195554c459af85ce31f04530667bdbd8ad1db131ad7514`。
- 既有 1.2.10 APK 及四条历史发布映射保持不变；没有重签或修改固件。

## 原因与范围

主线程真实对照显示：同一新 GATT 的 INFO/BEGIN/E2 成功；普通 C2 探测及 FFF1 fallback 后立即 close/reconnect，稳定出现 GATT22 并丢失 BEGIN ACK；诊断性等旧关闭稳定后重连则成功。主控保存的真实 E2 已成功生成，真实 ACK 的生产 Java 分片重放亦通过。实际 APK 的 FFF2/WRITE_TYPE_DEFAULT 与 PC response=True 一致。

旧 native.disconnect 仅调用 disconnect/close 就完成 Promise，不能代表旧物理连接已断。此版本用真实事件关闭屏障修复该边界；不更换特征、写类型、固件，不延长 BEGIN 超时，也不采用固定 sleep。

## 源码变更

- `SparkBlePlugin.java`：保留 closingGatt/epoch 到真实 STATE_DISCONNECTED 才 close、完成 disconnect Promise并放行最多一个排队连接。5秒未确认则明确失败并保持阻断；超时不冒充已断。旧源、旧 timer、取消、后台、蓝牙关闭与销毁不能放行失效连接。原15秒连接、5秒操作及1秒停机 timer 加 source/epoch/operation 围栏，时长不变。
- 新连接参数与扫描候选在断开现有主机前校验，出队再次校验；无效 profile、UUID 或过期候选不会误断正常主机。原安全停止和 OTA 禁止 C1 保持。
- `android-bluetooth.js` / `bluetooth-page.js`：独立只读升级连接状态，来自真实 connect/subscribe/beginOta Promise；同 epoch 断连或取消清除，旧事件不污染新状态。raw transport提供只读 connectionId。
- `xiaobai-ota.js`：真实 INFO 到达后记录当前 bootInfoEpoch，新任务清空。仅用于展示，不改变 BEGIN、ACK、重试或程序执行路径。
- `xiaobai-firmware.js` / `xiaobai-ota-ui.js` / `xiaobai-ota.css`：恢复入口明确尚待连接，按钮“连接并恢复”；区分连接中、通道已连接、已读取引导状态。公共 connected、identity、固件许可、原 UID 绑定和确认次数保持原值；raw 通道不等于可编程连接。

## 针对性验证

- 原生生产 codec/transport：861项；生产关闭/回调/队列/参数/timer方法编译执行 GREEN。旧立即关闭行为 RED 精确失败于 disconnect Promise 必须等待物理回调。
- 覆盖真实迟到断开、一次队列、超时不放行、取消/后台/蓝牙检查、旧 epoch/timer、无效和过期候选不影响旧连接、出队重验。
- 真实生产 UI + adapter + Gate + Session：77项/6组通过，仅 BLE边界模拟；包括各 Promise/INFO 阶段、业务许可不变、旧事件、三处取消与连接失败。751×360、568×280截图已检查。
- Gate及Session针对性回归通过；固定发布门禁62项通过。
- Android assembleDebug通过。实际APK签名、包名、版本和固定固件映射已核验；2819个资源逐字节与dist一致，12个关键资源与最终源码一致。DEX已确认包含关闭屏障方法、先校验新请求的顺序，以及分开的 disconnect/完成后close路径。
- 保留既有 Ring/Grid、倾倒 WebView兼容和其他型号功能；未扩展其他页面或功能。

证据：`tests/xiaobai-ota-native.spec.cjs`、`tests/xiaobai-ota-connection-ui.spec.cjs`；本机 `outputs/ota-lifecycle-20261105/APK_1.2.11_VALIDATION.json`、`ux-20261106/regression-summary.json` 与相关 DEX/签名记录。

下一步由主线程覆盖安装候选包，保留原绑定/pending，验证立即请求重连会等待旧物理断开，再验证完整App恢复。候选包字节至独立复核完成保持不变。

## 后续实机结果（2026-11-06）

1.2.11生产原生重连回归失败：旧GATT客户端回调约56ms即到，实际ACL断开约晚3.8秒；立即重连后仍在BEGIN末写后约866ms出现GATT22。此包未通过实机恢复。下一版改用原MAC匹配的真实ACL_DISCONNECTED广播作为屏障，不修改固件、写类型或BEGIN超时。
