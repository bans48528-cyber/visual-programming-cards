# 小白主控自动更新（Drluck CodeLab 1.2.10 / 16）

2026-11-05：手机端固定内置 PY32 1.0.3，补齐 OTA 断连与恢复提示。用户无需选包；无独立升级页面或设置入口。

## 用户流程

1. 蓝牙连接、订阅反馈后进入编程。App 每个连接 epoch 只启动一个固件核对任务；D3 DEVICE_VERSION 只作快速提示，新 INFO 十段及 UID 两段决定实际许可。旧 1.0.0/1.0.1 没有主动事件，同样自动查询。
2. 设备版本、有效镜像大小及 SHA256 与内置包完全匹配，才能学习和运行。较旧或同版无效镜像提示更新/修复；用户点一次“确定”后自动执行。取消仍可编辑，后续主动学习或运行可重新提示。
3. 版本未知显示未知并允许重试；较新固件提示更新 App，禁止降级。同版本不同有效镜像遵守原协议的版本唯一性规则，不能覆盖。
4. 更新使用当前编程界面的模态进度。先校验内置签名包和身份，停止任务后独占 OTA，再 ENTER、Boot INFO、BEGIN、DATA、FINISH。
5. FINISH 仅代表写入；新连接必须重新读取同 UID、目标 INFO 及两次跨至少 500ms 的真实非零 seq STATUS。全部通过后自动恢复 ENTER_PROGRAM、心跳、新一轮目标核对及真实学习状态查询。
6. 完成后不会自动运行作品，用户仍需点击“运行”。断连、取消、离页、后台或模式切换不能成为成功，也不自动续跑。

未连接时可编辑作品，不学习、不运行。没有 OTA Boot 的旧主控仍需要首次 DAP 工厂安装。

## 固定发布绑定

`assets/firmware/release.json` 固定 applicationId、App versionName/code、目标板型/协议、固件版本、镜像/包大小和 SHA256、唯一 asset 路径。`xiaobai-firmware-bundle.js` 固定该清单 SHA256，并在运行时验证映射、包长度、启动向量、SHA256、P-256 签名。

当前绑定：App `com.xiaobai.remote` 1.2.10（16）→ PY32 1.0.3（65539），board 0x0102，protocol 1，minBoot 1.0.0。

- 包：`assets/firmware/xiaobai_py32_1.0.3.ota`，32440 字节。
- 包 SHA256：`a4951259ca4ca31cf0ec1acad5ea6e1b1f232d1989e93b86170e074d3a7178d9`。
- 镜像：32312 字节，SHA256 `9401ff24056f6b884f195554c459af85ce31f04530667bdbd8ad1db131ad7514`。
- 发布清单 SHA256：`94ad4838bb1d29ceee8b03865e8a0ebfcb7744dd5882ed0ce051d5c50d7848f0`。

`firmware-release-plan.json` 和扁平的 `firmware-releases.json` 记录发布映射。同一个 App 版本重新绑定另一包会失败，新增发布必须递增 App 版本。后续 App 可明确复用相同固件，不引入版本区间或云服务。仅使用主控公开开发公钥，手机工程不保存或读取签名私钥，不重新签名冻结固件包。

构建前必须通过 `scripts/check-firmware-release.cjs`；缺包、映射/版本/哈希/签名不一致会在输出变更前失败。构建后核验 APK 真实包名、版本、清单、唯一 `.ota` 及其字节。发布清单 pin 用于运行时资源一致性，不采用哈希链或另一套签名协议。

## 取消和恢复

确认绑定当前 UID、原生设备 ID、连接 epoch 和入口代数。切换主机、离页或后台使旧确认失效；旧引用也不能学习或运行。Boot 无 UID，因此只能沿用已绑定的原生设备，不能按同名猜选。

BEGIN 前有效旧 App 可用空 FINISH 无擦写退出。BEGIN 后中断可能留在恢复 Boot，下次须在编程入口再次确认，从零传输。先检查实际是否已经写入目标，避免丢 FINISH ACK 后重复刷写。明确的错 UID/过期许可必须立即终止，不能当成 Boot 不响应而尝试恢复。

旧 `binding.pending` 只保留设备恢复身份；升级目标永远取当前 App 内置包。旧 1.0.1 待确认记录不能解锁当前 1.0.3 的学习/运行许可。写入意图、已写入证据和启动确认保持独立，不能以进度 100%、连接断开或 ACK 已受理冒充成功。

1.2.10 将 OTA 主动清理、真实断连和用户取消分开处理。BEGIN 前的 ENTER/初始 INFO 可在原有期限内重连原绑定主机；BEGIN 尝试后或 DATA 中断保留目标与已确认进度，必须重新确认才能从零恢复。恢复弹窗不会被已提示记录压住，普通 C2 查询超时只为原绑定设备打开显式恢复入口。原生关链对挂起写入返回 `DISCONNECTED`，取消/后台返回取消，旧 epoch 反馈不影响新连接。最初 GATT 22 的物理触发原因尚未确证。

## 传输与成功判定

继续使用已实现的 C2 INFO/ENTER 与 XBOT Boot 协议。20B 分片、40ms 节流和 RX 静默；每次一个未确认请求，最多两次相同 ID/字节重传，按实际 ACK next_offset 计进度。BEGIN/FINISH 确认超时分别 12/15 秒，原生 GATT 写入本身 5 秒超时。完整 INFO 重试耗尽后关闭、绑定重连再使用新 ID。FINISH 后约 3.3 秒再确认新 App。

新 App 成功门禁：相同 UID96 与原生设备 ID，协议/板型正确，App mode、有效镜像、目标 version/size/hash 全部一致；两次新连接 epoch、新非零 seq、op=0x04、result=0 的 STATUS 间隔至少 500ms，总确认约 30 秒。产品模式 0..4，三个 IR 兼容槽 0..100 且相等，电压至少 3000mV，task=0、fault=0。

这是基本启动与主循环/ADC 检查，不代表电机、声音、眼睛、SC7 方向等整机功能已验收。

## 蓝牙名称来源

显示优先级：用户本机备注 → 非空扫描广播名 → Android 系统缓存名 → 未命名设备。广播和缓存原始字段及来源在扫描/连接状态中保留，页面显示“本机备注”“广播名”“最近扫描广播名”或“系统缓存名”。本机备注不因固件期望名称而清空或覆盖。

App 没有合成 `BT_＋MAC` 或强制 Spark_AI。用户图示 `BT_ECB0DC10B443` 不能仅凭截图判定为广播、缓存或旧备注。1.0.2 主控已修正 Spark_AI 的 8 字节 AT 长度，但手机侧本次未访问无线电，实际广播仍待实机核对。

## 开发入口与验证

主要实现：`xiaobai-firmware-bundle.js`、`xiaobai-firmware.js`、`xiaobai-ota-ui.js`、`xiaobai-ota.css`、`android-bluetooth.js`；底层复用 `xiaobai-ota.js`、`OtaTransport.java`。运行、Runner、自学习服务均包含固件门禁，停止/取消继续允许。

权威文档：主控 `docs/automatic_firmware_update_protocol.txt`、`docs/py32_ota_protocol.txt`、`Shared/Ota_Layout.h`、`Shared/Ota_PublicKey.h`。D3 0x0A 沿用 17 字节帧，物理 byte5 为 event、byte6 为 counter、byte7..14 为 8 字节数据；原生正常通知没有事件子类型过滤，JS 验证完整帧、字段、epoch 并使用新 INFO 兜底。

`npm run test:firmware` 覆盖固定映射、主动事件/旧固件兜底、取消/去重/旧引用/身份/历史恢复及浏览器交互。`npm run test:ota` 保留底层包、Java、启动向量和 Session 回归。真实 C 模拟互通使用 `npm run test:ota:interop -- --package assets/firmware/xiaobai_py32_1.0.3.ota`。

本轮仅软件开发、浏览器/native mock、生产 Java 测试及 APK 校验。没有安装、连接主机、烧录或完成真实 OTA 验收。实机仍需验证 1.0.0 自动兜底升级、真实长帧/9600 节流、供电与掉电恢复、实际名称、启动身份/状态及整机功能。
