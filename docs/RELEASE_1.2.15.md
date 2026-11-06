# Drluck CodeLab 1.2.15 候选交付

App **1.2.15 / versionCode21**，`com.xiaobai.remote`，唯一绑定已签名 PY32 **1.0.4 / 65540**。手机端软件回归、Android构建和实际APK独立核验完成，候选冻结；主线程已完成主控工厂更新与电池冷启动体验验收，App安装、编程匹配及新版完整OTA仍待验证。

## 实际文件与指纹

- APK：`artifacts/drluck-codelab-1.2.15-debug.apk`，39,734,716字节。
- APK SHA-256：`9dbc9d7c66b801894234d001c7ed04e5d86b90628be509620965a9b429fc46b0`。
- 原Android签名证书：`242b6364ccae103673501115b8cb4be79ee10ab7632fe1e4e7946ba5a5ef9289`，APK v2签名核验通过。
- 正式发布manifest/pin SHA-256：`3d44cafdcece1572f970cf2732269cad6d289bcd43fc8ca1ac21354168d380c9`。
- 唯一OTA：`assets/firmware/xiaobai_py32_1.0.4.ota`，32,388字节，SHA-256 `d9f1777bd27a01a8650a4e2c320fd3213a9b9ad89d3aee2ab33f2e0e73ce9e9d`。
- 镜像32,260字节，SHA-256 `fc473b50f3f37ef8b151f07fd6f20e6a99e6824ee8bebcff67a6b148240edbce`；board258、protocol1、最低Boot **1.0.1 / 65537**。
- P256公钥不变，原始公钥SHA-256 `bcd0665deeea7c4b7adc1f9c7a86b594f8f1836a83748937bdc949e278a4599d`。实际新包已用该公钥完成验签。

## 首次 Boot 更新边界

本次新App固件要求Boot1.0.1。旧Boot设备需要由DAP安装配套组合factory镜像，更新Boot和App；手机普通App OTA不能更新Boot。ASR工程由主线程保持不变。手机取得fresh UID/INFO后，在版本判断、pending收尾和就绪放行之前严格检查最低Boot：版本不足显示“需要通过 DAP 更新主控引导程序及配套固件”，`canUpgrade=false`；缺失或非法版本为`BOOT_UNKNOWN`。旧written记录不能绕过该门，不能显示普通蓝牙升级确认或发送ENTER_BOOT/raw写入。

受限App重连与读取结果也检查最低Boot。Boot错误结束确认重试并保留pending，不切换到重新刷写。弹窗隐藏蓝牙升级确认、写入百分比及旧恢复文案；未知Boot允许重新核对。既有1.2.14的当前App只读收尾、同UID定位迁移、恢复编程/口令后清pending、身份/取消/旧epoch保护、ACL与fresh扫描逻辑保留。

同步的公开JS/Java契约只有App/Boot版本常量变化（65540/65537），协议和公钥不变。`SparkBlePlugin.java`传输逻辑精确保持，SHA-256 `4223f22efb3473cd8af0bed24d567a025379fdf28901d884aa31e9a518d595dd`。旧1.0.3包原字节归档在`artifacts/firmware-history/xiaobai_py32_1.0.3.ota`；原1.2.10～1.2.14 APK及八条历史发布映射不变。

## 离线历史 pending 补丁（同版本候选重建）

本候选取代尚未安装、发布的旧 SHA `b742d3137aecfcbde7c5c10af3f666dc3f14127a2f1a83b66ff6240639421568`。旧 APK 与旧报告分别保留在 `artifacts/superseded/` 和本机验证目录 `superseded-b742/`；它们不代表当前候选。

Gate 不再在读取设备前把离线历史 1.0.3/written=true 记录提前改成当前 1.0.4/written=false。目标归一化仅由 Session 在 fresh UID、兼容性、地址和电量检查后完成。App 探测遇到 BOOT_VERSION 或 BOOT_UNKNOWN 直接保留已读到的可用 App 连接，并原样保留持久化及内存 binding，不回退到 Boot 写入。

新增真实生产 Gate＋Session 组件回归，采用真实签名历史 1.0.3 与当前 1.0.4 包，仅模拟 adapter 边界。先复现提前覆写，再通过 33 项检查：Boot 65536／缺失两类拒绝、pending 原字节与内存不变、零保存、原 binding 传递、零断连、零 Boot/raw/health/编程恢复及重复确认仍拒绝。补丁后显式重跑最低 Boot 321 项、已安装确认 445 项、生产恢复与 Session 全套全部通过；原 Gate 六组亦通过。既有浏览器及原生回归沿用补丁前结果，不计为补丁后重跑。

App 仍为 1.2.15/code21；唯一固件 1.0.4、发布 pin、公钥、原生 BLE、历史包及 1.2.10～1.2.14 APK 均不变。当前 APK 经过重建后的独立资源、DEX、签名及绑定核验，未安装、未操作设备、未提交 Git。

## 最终候选冻结

2026-11-06 冻结上述 SHA `9dbc9d7c66b801894234d001c7ed04e5d86b90628be509620965a9b429fc46b0` 的 1.2.15/code21 APK，后续不再改动源码或重建此候选。实际 APK 已包含首页示例与最近作品缩略图的开始图标修复；`assets/public/home.js` 与当前源码逐字节一致，SHA `5543be6a2700661bb7b1e2eb523b1ed1df5e9e06a04579a313fb94352485bd98`。已有五机型／两尺寸、260 项缩略图检查通过；最终网页直接确认首页示例及七个作品的开始图标均已加载。

主线程另行独立核对相同 APK 的指纹、原签名、11 项关键源码、唯一内置 1.0.4、P256/hash/pin/minBoot65537 及原生 ACL 标记通过。本线程冻结时再核对实际 APK 与全部 13 项关键源码哈希一致。固件1.0.4和 pin 保持不变。设备操作始终由主线程负责。本段为冻结时点状态，后续主控冷启动结果见下方交接状态；App1.2.15安装、编程匹配和新版完整OTA尚未验收。冻结记录位于本机验证目录 `FROZEN_CANDIDATE_1.2.15.json`。

## 主线程主控验收状态同步（2026-11-06）

主线程已在新板 UID `4c3450410b37343745a36000` 完成 Boot1.0.1＋App1.0.4 工厂镜像共43,364字节的直接SWD写入与逐字节读回：先失效Meta，body核验后最后写commit并核对。用户拔下DAP、保留电池冷启动后反馈“明显更快，欢迎语一次且模式正常”。这是主控工厂安装与冷启动体验验收，未进行仪器精确计时。

App候选仍冻结为本记录的 `9dbc9d7c66b801894234d001c7ed04e5d86b90628be509620965a9b429fc46b0`；App1.2.15实际安装、与新主控的编程匹配和新版完整OTA硬件流程均尚未通过，不能借用历史OTA结果。本App线程本次仅同步资料，未操作设备、Git或重建APK。

主线程证据：`LBS-XIAOBAI-AI/docs/py32_fast_startup_validation_20261106.json`、`py32_fast_startup_flash_20261106.json`；状态及这两份报告的文件哈希保存在本机验证目录 `MAIN_FIRMWARE_HANDOFF_STATUS.json`。主控报告中top-level application_start_verified及用户反馈为本次新增结果；旧嵌套构建快照不扩张为App验收。

## 必要验证

- Boot门禁321项／6组；旧Boot65536对minimum65537的生产界面34项／两横屏尺寸通过。覆盖缺失字段、pending旁路、受限恢复、旧epoch与DAP-only弹窗。
- 原Gate6组、身份35项、已安装目标确认445项及恢复通过。Session全套使用真实签名1.0.0→1.0.4通过。
- 真实生产UI/adapter/Gate/Session仅模拟native BLE：正常整包与历史pending87项、已安装目标116项／8场景、关键生命周期62项／4场景通过（Boot INFO断连、DATA0%/中途断连、ENTER丢ACK断连）。
- 原生861项及两种RED对照通过；历史包/codec1622断言通过。新1.0.4本体另经P256验签、正式绑定与62项固定发布门验证。契约与权威C头文件一致。
- 实际APK：包名/code21、原证书、唯一冻结1.0.4、2,819项dist资源和13项关键源码一致；DEX中的ACL屏障与App/Boot新常量均核对。

所有以上手机测试均为软件或模拟native边界，不等于1.2.15与新Boot/App的真实整机通过。首次DAP组合更新、真实冷启动与时序、外设和安装/蓝牙由主线程负责。本App线程没有ADB、安装、蓝牙、烧录、修改用户pending或提交Git。此前1.2.13完整OTA/冷启动及1.2.14保留现场只读收尾结果保持各自历史范围，不替代新版实机验收。

证据：本机`outputs/ota-lifecycle-20261106-v1215/REGRESSION_SUMMARY.json`、`APK_1.2.15_VALIDATION.json`、`native-checks/`、`bound-boot-ui/`、`bound-upload-ui/`、`bound-installed-ui/`与`bound-lifecycle-ui/`；Gate日志在`outputs/v1215/gate-review/`。本轮源码基于`eaf4044650c8aac6929b4aab6946ef28fea80254`加本地未提交变更，候选已冻结。
