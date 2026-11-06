# Drluck CodeLab 1.2.13 交付与实测

App **1.2.13 / versionCode 19**，包名 `com.xiaobai.remote`。APK 已构建并经独立校验，保留原签名，可覆盖安装并保留作品、原设备 UID/MAC 绑定和 pending 恢复记录。安装及后续实机操作由主线程统一接管。

## 冻结文件

- APK：`artifacts/drluck-codelab-1.2.13-debug.apk`，39,718,217 字节。
- APK SHA-256：`8d411eec8402d2b65403f991ee8f02afc59c88237c9390d22a0b4378845ddc25`。
- 发布清单 SHA-256：`3eb856c202f3583476791aa85cb3d0dde42ab6f749ff5ec293fa0a9f1fd4f2bc`。
- 唯一内置固件仍为原冻结 `assets/firmware/xiaobai_py32_1.0.3.ota`，32,440 字节，SHA-256 `a4951259ca4ca31cf0ec1acad5ea6e1b1f232d1989e93b86170e074d3a7178d9`。
- 镜像 32,312 字节，SHA-256 `9401ff24056f6b884f195554c459af85ce31f04530667bdbd8ad1db131ad7514`；board 258、protocol 1、minBoot 65536、version 65539。
- `SparkBlePlugin.java` 与 1.2.12 精确不变，SHA-256 `4223f22efb3473cd8af0bed24d567a025379fdf28901d884aa31e9a518d595dd`。本版不修改原生关闭屏障、ATT 参数或固件字节。

## 最新实机验收（2026-11-06）

**完整真实 App 整包 OTA 恢复通过，冷启动复测也已获用户实体确认通过。** 最终状态为 `FULL_APP_OTA_AND_COLD_START_PASS`。本次使用上述冻结1.2.13 APK，由用户重新确认后，在原绑定主机完成真实 DATA、FINISH、新 App 重连及成功门禁。

- 32,312字节全部提交，FINISH后 `written:true`、`recovery:false`；保存的 `pending:null`。
- 新 App epoch比对原 UID/MAC、1.0.3版本及完整镜像SHA256均正确；Gate最终 `success / ready:true / busy:false / READY`，编程模式为4。
- 两次新 App 状态记录间隔1,028ms，电池约3.650V／3.678V，任务/故障flags均为0。从第一条DATA到最终成功为459.116秒。
- 用户退出编程并断开连接，再正常关机、重新开机，确认欢迎语只播放一次、眼睛和模式键正常；重新连接并进入编程没有再次提示升级。用户回复“一切正常”。
- 完整OTA的协议自动证据来自最终Gate/Session、镜像和状态反馈；上述冷启动实体项目来自 `cold_start_validation.evidence_type = user_confirmation`，分别记录证据类型。
- 证据：下位机工程 `docs/ota_full_app_validation_20261106.json`、`docs/app_ota_final_proof_20261106.json`。

当前实际广播名为 `BT_ECB0DC10B443`，作为独立名称观察项记录；本版没有改写该名称。OTA成功由完整镜像、绑定身份及启动健康门禁确认，名称不是成功判定条件。冷启动确认覆盖上述正常关机重开、欢迎语、眼睛、模式键及重连项目；其余功能保留各自验收范围。

## 实测依据与改动

1.2.12 在平板实测中仍出现 GATT 133，不能视为完整 OTA 已修复。独立 Android 控制组只增加了连接前的真实原 MAC 扫描：旧连接 ACL 断开后，179ms 收到本次广播，再调用 connect，随后收到 INFO 和 BEGIN 的 status0 ACK，并保持连接稳定至少3秒。该控制没有发送 DATA 或 FINISH；证据在下位机工程 `docs/android_acl_scan_reconnect_retest_20261106.json`。

1.2.13 在既有 `connectApp` / `connectBoot` 重连调用前复用同一小型准备步骤：

- 每次新建 scanId，开启 `includeUnnamed:true`，只接受该 scanId 下原 deviceId 的真实广播；空名称允许，不按名称、最强信号或缓存设备替代。
- 保留已有 disconnect / ACL 屏障，收到匹配广播后先完成 stopScan 和临时监听清理，再调用原 native.connect。
- 原生10秒扫描期限加 JS 10秒兜底。取消、后台、离开编程会停止本次扫描并移除监听；各异步边界保持现有任务代数、确认身份和 OTA 独占围栏。
- 扫描超时/失败使用 `SCAN_TIMEOUT` / `SCAN_FAILED`，不冒充 C2 超时，不因此再裸连或新增一次 App→Boot fallback。

不增加用户确认、自动重连、BEGIN/DATA 重试或中断续刷。原 UID 校验、公共 connected/运行许可和原有传输策略保持。FINISH 后已有启动确认若调用 connectApp，同样只准备原主机的重连，不新增写入步骤。

## 验证与验收边界

- 新增扫描专测85项／7组通过：freshId、精确 MAC、旧 scanId、强错误 MAC、空名弱正确设备、stopScan 完成屏障、取消、后台、离开、原生停止/失败及真实10秒兜底；临时监听均已清理。
- 原恢复界面77项／6组通过，包括连接、beginOta、INFO、旧 epoch、raw连接不解锁业务、取消和失败、751×360 / 568×280 横屏。合计 **162项**。
- 独立核验实际 APK code19、签名、哈希、2,819个 dist 资源及12个关键源文件，唯一内置固件与原冻结1.0.3一致；Native保持不变。

前述控制组仅到BEGIN，162项回归使用模拟原生边界；它们各自的验收范围保持不变。其后，主线程已用真实1.2.13 App单独完成整包OTA恢复及原主机启动/UID/健康状态验证，结果见上方最新实机验收。冷启动随后已由用户按上述流程实体复测确认通过。历史交付记录保留于 [1.2.10](RELEASE_1.2.10.md)、[1.2.11](RELEASE_1.2.11.md)、[1.2.12](RELEASE_1.2.12.md)。
