# Drluck CodeLab 1.2.10

App versionName **1.2.10**，versionCode **16**，applicationId `com.xiaobai.remote`。调试签名沿用上一版，覆盖安装保留用户作品、设备绑定和待恢复记录。

## 冻结交付

- 本地安装包：`artifacts/drluck-codelab-1.2.10-debug.apk`，39,699,489 字节。
- APK SHA-256：`ea63cac2a05e8d3ded426ab824bdf8f60018513268b1c102959078efcac3c937`。
- 证书 SHA-256：`242b6364ccae103673501115b8cb4be79ee10ab7632fe1e4e7946ba5a5ef9289`。
- 唯一内置固件：`assets/firmware/xiaobai_py32_1.0.3.ota`，32,440 字节；版本 65539、board 258、protocol 1、minBoot 65536。
- 固件包 SHA-256：`a4951259ca4ca31cf0ec1acad5ea6e1b1f232d1989e93b86170e074d3a7178d9`。
- 镜像 32,312 字节，SHA-256：`9401ff24056f6b884f195554c459af85ce31f04530667bdbd8ad1db131ad7514`。
- 发布清单 SHA-256：`94ad4838bb1d29ceee8b03865e8a0ebfcb7744dd5882ed0ce051d5c50d7848f0`。

此 APK 已冻结，不因文档或工作区清理而重建。二进制安装包保存在本地，不提交 Git；正式固件、固定发布清单与历史映射随源代码提交。固件包和公钥保持原值。

## 本次功能

升级期间真实断连不再误当用户取消，恢复提示不再被旧提示记录隐藏。原生挂起写入关链返回 `DISCONNECTED`，保留原错误原因。只在 BEGIN 前使用原有期限重连原绑定主机；BEGIN 尝试后或 DATA 中断保留待恢复目标与已确认进度，必须再次确认才能从零恢复。取消、停止、离页和后台不自动重连或运行。

普通 C2 探测超时仅为原绑定设备打开现有编程恢复弹窗；同名或更强信号的其他主机不能代替绑定身份。重新读到 App 后仍验证 UID、目标镜像及真实健康状态。保留运行 Ring、停止按钮红白状态、16 点 Grid、旧 WebView 兼容与各型号原有功能。

## 已完成验证与边界

- 真实生产 Android handler、Gate、Session、签名固件和弹窗联合验证：190 项；原界面回归：245 项，共 435 项。仅原生 BLE 边界模拟。
- 覆盖写入拒绝与断连的两种顺序、INFO 有界重连、0%/中途 DATA 掉线、ENTER 丢 ACK、旧 epoch、显式取消/停止/后台/返回、原绑定 Boot 恢复、错 UID、历史 pending 和四种屏幕布局。
- Session 回归、62 项固定发布门禁、35 项身份/许可检查、861 项原生传输检查及生产关链方法编译执行通过。
- 实际 APK 签名与版本校验通过；2,819 个网页资源逐字节等于构建结果，关键资源等于最终源文件；唯一 OTA 与冻结包完全一致。最终 DEX 已核对包含两处带 `DISCONNECTED` 的双参数 reject。
- 下位机线程独立复核相同 APK、证书、11 个关键资源、P-256、镜像、固定清单和 ZIP CRC。

未宣称实机 OTA 恢复成功。最初 GATT 22 的物理触发仍待新日志；整机恢复、无线链路、供电及外设动作继续按硬件联调结果验收。

## 源码与重建

保留源码、正式素材、协议、回归和构建脚本。`npm ci` 恢复依赖，`npm run build:web` 生成预览，`npm run android:build` 构建 Android。生成的 dist、Gradle/CMake 缓存、截图和诊断输出无需归档到 Git。正式测试基准在 `tests/fixtures/`，不随缓存清理。
