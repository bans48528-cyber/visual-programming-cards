# Drluck CodeLab 1.2.12 候选交付

App **1.2.12 / code18**，`com.xiaobai.remote`。本次仅修原生真实 ACL 关闭边界，保持 1.2.11 已验证 UX、确认门、原绑定和冻结固件不变。候选尚待同平板真实回归，不宣称整机 OTA 恢复通过。

## 候选指纹

- APK：`artifacts/drluck-codelab-1.2.12-debug.apk`，39,717,169 字节。
- SHA-256：`5a36fab8dd9d16c4da679f1993a5bf6a1433616f4339a567302767843245315d`。
- 原签名证书 SHA-256：`242b6364ccae103673501115b8cb4be79ee10ab7632fe1e4e7946ba5a5ef9289`，覆盖安装保留作品、UID绑定和pending。
- 发布清单 SHA-256：`5eb7f0b381551a6aa65505c038470500b48e7b06ac5778326fc0bb5f65cee639`。
- 唯一内置固件仍为 PY32 **1.0.3/65539**，board258、protocol1、minBoot65536。
- 原冻结包 32,440字节，SHA-256 `a4951259ca4ca31cf0ec1acad5ea6e1b1f232d1989e93b86170e074d3a7178d9`；镜像32,312字节，SHA-256 `9401ff24056f6b884f195554c459af85ce31f04530667bdbd8ad1db131ad7514`。
- 1.2.10/1.2.11旧APK和五条历史发布映射保持不变；无固件重签或字节修改。

## 实机证据与修复

1.2.11仍未通过真实重连测试：旧客户端GATT断开回调约56ms即到，但真实ACL断开约晚3.8秒。只等待客户端回调仍会立即重连并再次GATT22；它不能作为物理实断证明。

1.2.12 的 `SparkBlePlugin.java` 改为：

- GATT clientDown只关闭旧客户端资源，保留原MAC、epoch和原生代数的关闭屏障；匹配原主机的真实ACL_DISCONNECTED才完成disconnect Promise并放行最多一个等待连接。真实STATE_OFF可作为另一独立边界。
- receiver保持RECEIVER_EXPORTED；Android9缺transport字段时接收，字段存在时仅接受LE。广播收到时先捕获当前对象/epoch/代数，再交主Handler复验；不同MAC、已捕获的旧上下文及旧回调不影响新连接。
- 覆盖client先、ACL先及active源先收到ACL；不要求第二次ACL事件。5秒未确认仍拒绝并阻断，不按定时器假定成功；晚ACL不恢复已拒绝/取消的队列。
- 保留参数校验、出队重验、旧timer围栏、停机和OTA禁止C1。FFF2、WRITE_TYPE_DEFAULT、20B/40ms、BEGIN超时均未更改。
- 原生日志仅增加真实 `closing request`、`clientDown`、`aclDown`、`next connect` 时间点，包含epoch/MAC/elapsed，便于实机确认由事件放行。

[Android ACL_DISCONNECTED定义](https://developer.android.com/reference/android/bluetooth/BluetoothDevice#ACTION_ACL_DISCONNECTED)；[广播接收器导出规则](https://developer.android.com/develop/background-work/background-tasks/broadcasts#context-registered-receivers)。

ACL广播本身不含App epoch；当前实现保证接收时已捕获的旧上下文不会污染新代数，不宣称能从系统尚未投递、同MAC的旧广播中读取不存在的epoch。

## 必要验证

- 861项原生codec/transport检查通过；生产方法的ACL窄回归通过：client先不放行、ACL先/后、Android9无transport、LE/BR过滤、错误MAC/旧token、取消、超时、晚事件、参数和旧timer隔离。
- 旧immediate-close及1.2.11仅等client回调两种行为均RED复现。
- 发布门禁62项通过；Android assembleDebug通过。
- 实际APK：签名/包名/code18校验，唯一原冻结1.0.3，2819项dist资源字节一致，12项关键资源等于最终源码。DEX包含ACL注册与closingDeviceId屏障。
- 与1.2.11实际APK逐字节比较，已通过77项/6组专测的UX与相关业务JS均未改动，仅发布pin递增。旧候选字节保持。

本次App开发未访问硬件、安装或刷写，也未提交Git。下一步由主线程覆盖安装，在同平板重跑原失败序列，检查 `aclDown` 先于 `next connect` 且BEGIN ACK可达，再验证完整App恢复。

证据：`tests/xiaobai-ota-native.spec.cjs`；本机 `outputs/ota-lifecycle-20261105/APK_1.2.12_VALIDATION.json`、签名/DEX及历史实机对照记录。
