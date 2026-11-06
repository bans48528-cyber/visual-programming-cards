# 小白主控自动更新（Drluck CodeLab 1.2.15 / 21 候选）

2026-11-06离线历史补丁：1.2.15/code21未发布候选已重建；Boot拒绝前不改历史 pending/written，拒绝后保留 fresh App。新增真实 Gate＋Session 33项回归通过，重建 APK SHA `9dbc9d7c66b801894234d001c7ed04e5d86b90628be509620965a9b429fc46b0`，固件1.0.4和发布pin不变。详见 [1.2.15交付记录](RELEASE_1.2.15.md)。

2026-11-05：手机端固定内置 PY32 1.0.3，补齐 OTA 断连与恢复提示。用户无需选包；无独立升级页面或设置入口。

2026-11-06候选：已安装目标采用同UID/fullINFO/两STATUS确认，复用有效连接；地址仅在完整只读验证后迁移，恢复编程及口令初始化后才清pending。确认失败只待连接确认，历史目标先只读收尾、新目标另行明确确认。当前1.2.14软件及APK验证通过，保留新板的已安装目标/旧定位pending真实只读收尾也已通过（`REAL_NEW_BOARD_READONLY_COMPLETION_PASS`）：同UID从旧DC定位核对为fresh EC，canonical完整INFO匹配；同epoch两STATUS seq21/22间隔868ms、4051mV、flags0，随后恢复program mode4、口令initialized/query ready/supported及10个真实unlearned，最后pending为null且default为EC。原生connect1、subscribe1、disconnect0、beginOta/writeOta0，ENTER_BOOT/BEGIN/DATA/FINISH均0；用户确认已进入编程。此结果不覆盖1.2.14从旧版开始的整包及post-FINISH自动重连，新板上尚未重新实测这些路径，软件回归已通过；见 [1.2.14记录](RELEASE_1.2.14.md)。

2026-11-06当前候选：1.2.15唯一内置已签名1.0.4，minimum Boot1.0.1。旧Boot先通过DAP安装配套组合factory更新Boot+App；手机普通App OTA不更新Boot。fresh INFO不足最低Boot时关闭升级/就绪许可，written/pending不能绕过；只读收尾和身份/取消规则保留。软件与实际APK验证通过，新组合设备实测仍由主线程负责；见 [1.2.15记录](RELEASE_1.2.15.md)。

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

当前绑定：App `com.xiaobai.remote` 1.2.13（19）→ PY32 1.0.3（65539），board 0x0102，protocol 1，minBoot 1.0.0。

- 包：`assets/firmware/xiaobai_py32_1.0.3.ota`，32440 字节。
- 包 SHA256：`a4951259ca4ca31cf0ec1acad5ea6e1b1f232d1989e93b86170e074d3a7178d9`。
- 镜像：32312 字节，SHA256 `9401ff24056f6b884f195554c459af85ce31f04530667bdbd8ad1db131ad7514`。
- 发布清单 SHA256：`3eb856c202f3583476791aa85cb3d0dde42ab6f749ff5ec293fa0a9f1fd4f2bc`。

`firmware-release-plan.json` 和扁平的 `firmware-releases.json` 记录发布映射。同一个 App 版本重新绑定另一包会失败，新增发布必须递增 App 版本。后续 App 可明确复用相同固件，不引入版本区间或云服务。仅使用主控公开开发公钥，手机工程不保存或读取签名私钥，不重新签名冻结固件包。

构建前必须通过 `scripts/check-firmware-release.cjs`；缺包、映射/版本/哈希/签名不一致会在输出变更前失败。构建后核验 APK 真实包名、版本、清单、唯一 `.ota` 及其字节。发布清单 pin 用于运行时资源一致性，不采用哈希链或另一套签名协议。

## 取消和恢复

确认绑定当前 UID、原生设备 ID、连接 epoch 和入口代数。切换主机、离页或后台使旧确认失效；旧引用也不能学习或运行。Boot 无 UID，因此只能沿用已绑定的原生设备，不能按同名猜选。

BEGIN 前有效旧 App 可用空 FINISH 无擦写退出。BEGIN 后中断可能留在恢复 Boot，下次须在编程入口再次确认，从零传输。先检查实际是否已经写入目标，避免丢 FINISH ACK 后重复刷写。明确的错 UID/过期许可必须立即终止，不能当成 Boot 不响应而尝试恢复。

旧 `binding.pending` 只保留设备恢复身份；升级目标永远取当前 App 内置包。旧 1.0.1 待确认记录不能解锁当前 1.0.3 的学习/运行许可。写入意图、已写入证据和启动确认保持独立，不能以进度 100%、连接断开或 ACK 已受理冒充成功。

1.2.10 将 OTA 主动清理、真实断连和用户取消分开处理。BEGIN 前的 ENTER/初始 INFO 可在原有期限内重连原绑定主机；BEGIN 尝试后或 DATA 中断保留目标与已确认进度，必须重新确认才能从零恢复。恢复弹窗不会被已提示记录压住，普通 C2 查询超时只为原绑定设备打开显式恢复入口。原生关链对挂起写入返回 `DISCONNECTED`，取消/后台返回取消，旧 epoch 反馈不影响新连接。最初 GATT 22 的物理触发原因尚未确证。

1.2.11 对旧原生 GATT 增加真实断开屏障。disconnect Promise在旧 STATE_DISCONNECTED 后完成，最多一个新连接排队并重验参数；5秒未确认则失败并保持阻断，不以固定延时推测已断。恢复状态来自真实 Promise/INFO，raw连接不解锁编程。详见 [候选交付记录](RELEASE_1.2.11.md)。

1.2.11的GATT客户端回调屏障实机仍失败。1.2.12以匹配原MAC及已捕获上下文的真实ACL_DISCONNECTED（或STATE_OFF）才放行，client回调只收尾旧资源；保持5秒超时拒绝及传输参数。候选待实机复测，见 [交付记录](RELEASE_1.2.12.md)。

1.2.12实机仍出现GATT133。1.2.13仅在既有connectApp/connectBoot前增加原MAC的本次广播准备：新scanId、includeUnnamed、精确deviceId、先stopScan再connect、原生10秒期限及JS兜底，取消/后台/离开清理扫描和监听。SCAN_TIMEOUT/SCAN_FAILED不触发C2超时的额外fallback；原确认、UID、ACL屏障、重试及BEGIN/DATA策略保持。Native与1.2.12精确不变。早期fresh-scan独立控制已收到BEGIN status0并稳3秒，当次未发送DATA/FINISH；后续真实1.2.13 App已另行完成整包恢复，冷启动也已由用户按正常关机重开流程实体确认通过。详见 [1.2.13交付与实测记录](RELEASE_1.2.13.md)。

## 传输与成功判定

继续使用已实现的 C2 INFO/ENTER 与 XBOT Boot 协议。20B 分片、40ms 节流和 RX 静默；每次一个未确认请求，最多两次相同 ID/字节重传，按实际 ACK next_offset 计进度。BEGIN/FINISH 确认超时分别 12/15 秒，原生 GATT 写入本身 5 秒超时。完整 INFO 重试耗尽后关闭、绑定重连再使用新 ID。FINISH 后约 3.3 秒再确认新 App。

新 App 成功门禁：相同 UID96 与原生设备 ID，协议/板型正确，App mode、有效镜像、目标 version/size/hash 全部一致；两次新连接 epoch、新非零 seq、op=0x04、result=0 的 STATUS 间隔至少 500ms，总确认约 30 秒。产品模式 0..4，三个 IR 兼容槽 0..100 且相等，电压至少 3000mV，task=0、fault=0。

这是基本启动与主循环/ADC 检查，不代表电机、声音、眼睛、SC7 方向等整机功能已验收。

## 蓝牙名称来源

显示优先级：用户本机备注 → 非空扫描广播名 → Android 系统缓存名 → 未命名设备。广播和缓存原始字段及来源在扫描/连接状态中保留，页面显示“本机备注”“广播名”“最近扫描广播名”或“系统缓存名”。本机备注不因固件期望名称而清空或覆盖。

App 没有合成 `BT_＋MAC` 或强制 Spark_AI。2026-11-06独立实测确认原主机当前广播为 `BT_ECB0DC10B443`，不只是界面缓存；恢复继续按原MAC及保存UID绑定，不改名称掩盖连接问题。1.0.2曾修正过主控Spark_AI的AT长度，当前实际名称仍按实机观察记录。 广播名称与传输成功分别验收：本次整包OTA已通过，但实际名称仍为上述广播名，未声称已改名。

## 开发入口与验证

主要实现：`xiaobai-firmware-bundle.js`、`xiaobai-firmware.js`、`xiaobai-ota-ui.js`、`xiaobai-ota.css`、`android-bluetooth.js`；底层复用 `xiaobai-ota.js`、`OtaTransport.java`。运行、Runner、自学习服务均包含固件门禁，停止/取消继续允许。

权威文档：主控 `docs/automatic_firmware_update_protocol.txt`、`docs/py32_ota_protocol.txt`、`Shared/Ota_Layout.h`、`Shared/Ota_PublicKey.h`。D3 0x0A 沿用 17 字节帧，物理 byte5 为 event、byte6 为 counter、byte7..14 为 8 字节数据；原生正常通知没有事件子类型过滤，JS 验证完整帧、字段、epoch 并使用新 INFO 兜底。

`npm run test:firmware` 覆盖固定映射、主动事件/旧固件兜底、取消/去重/旧引用/身份/历史恢复及浏览器交互。`npm run test:ota` 保留底层包、Java、启动向量和 Session 回归。真实 C 模拟互通使用 `npm run test:ota:interop -- --package assets/firmware/xiaobai_py32_1.0.3.ota`。

1.2.13新增准备步骤通过162项源码/native mock回归，实际APK已独立校验。早期独立Android控制组只验证fresh扫描后INFO与BEGIN成功、稳定3秒，未验证DATA/FINISH，该历史范围保持。

2026-11-06后续由主线程完成真实1.2.13 App整包OTA恢复：32,312字节全部提交并完成FINISH，新App epoch的原UID/MAC、1.0.3版本和完整镜像SHA256正确；Gate为 `success / ready:true / busy:false / READY`，`written:true / recovery:false`，保存pending清除，编程模式4。两次状态间隔1,028ms，电池约3.650V／3.678V，flags均0；首条DATA至最终成功459.116秒。证据为下位机工程 `docs/ota_full_app_validation_20261106.json`、`docs/app_ota_final_proof_20261106.json`，最终状态 `FULL_APP_OTA_AND_COLD_START_PASS`。

**完整真实App整包OTA通过，冷启动复测已由用户实体确认通过。** 用户退出编程并断开连接，正常关机重开后确认欢迎语只播放一次、眼睛和模式键正常；重新连接进入编程无再次升级提示，回复“一切正常”。此项记录为 `cold_start_validation.evidence_type = user_confirmation`；完整OTA仍依据上述协议自动证据。其余供电/掉电情形和外设功能保留各自验收范围，实际广播名作为独立观察项记录。
