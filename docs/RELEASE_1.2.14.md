# Drluck CodeLab 1.2.14 候选交付

App **1.2.14 / code20**，`com.xiaobai.remote`。修复升级后主机地址变化时，已匹配的 App 仍残留旧 pending 并提示恢复更新的问题。本候选完成软件回归和实际 APK 校验；保留的新板现场已通过真实已安装目标的只读收尾，用户确认“已进入编程”。本版从旧固件开始的整包升级及 post-FINISH 自动重连，尚未在新板重新实测。

## 冻结指纹

- APK：`artifacts/drluck-codelab-1.2.14-debug.apk`，39,723,421 字节。
- SHA-256：`4b7c3031a2e5bc577867327a971838c0b0013d1439c916f4802b50de8ef4f37d`。
- 原签名证书：`242b6364ccae103673501115b8cb4be79ee10ab7632fe1e4e7946ba5a5ef9289`，v2签名验证通过。
- 发布清单：`65f79cba695066ec70e185243a60e4baeb2066066964391ab65fb7f96d900541`。
- 唯一内置固件仍为原冻结 PY32 **1.0.3 / 65539**，board258、protocol1、minBoot65536；包32,440字节、SHA-256 `a4951259ca4ca31cf0ec1acad5ea6e1b1f232d1989e93b86170e074d3a7178d9`。
- 镜像32,312字节，SHA-256 `9401ff24056f6b884f195554c459af85ce31f04530667bdbd8ad1db131ad7514`。原P256公钥不变，无重签固件。
- 原生Java与1.2.13精确相同：`4223f22efb3473cd8af0bed24d567a025379fdf28901d884aa31e9a518d595dd`；历史1.2.10/11/12/13 APK和七条历史发布映射不变。

## 改动与限制

`xiaobai-firmware.js` 以当前连接的全新UID、主板/协议和完整版本/大小/SHA确定已安装目标。相同UID的pending不再要求MAC相同：复用当前epoch的两次真实STATUS，恢复编程和口令初始化，成功后才清pending。其他UID记录保留；存储失败、取消、后台、旧epoch或初始化失败均不能提前清记录或报就绪。

`xiaobai-ota.js` 共用当前App确认与恢复回调。恢复过程中刚读取的App直接用于首轮确认；post-FINISH也在编程/口令初始化成功后才清pending，省去重复断连和重复最终INFO。确认路径不进入Boot，不发送ENTER_BOOT/BEGIN/DATA/FINISH。历史written只与对应目标关联；若旧App完整匹配其旧pending，先只读确认收尾，Gate仍保持未就绪，再单独提示当前canonical目标升级并等待用户明确确认。旧pending不能锁死新版本，也不能授权新目标自动写入。

`android-bluetooth.js` 已有可用App时直接fresh读取；无连接时先找原MAC的本次广播。仅原MAC无广播时，在既有30秒确认预算内探测最多三个新鲜候选，名称只作短名单，须正常服务/C2、两段fresh UID及完整目标INFO均匹配后才迁移定位。Boot-only、不同UID及原MAC身份冲突均不迁移、不写入。候选只清理自身epoch，迟到结果不推进；默认设备仅在仍为旧地址或已为新地址时更新，不覆盖第三台选择。

`xiaobai-ota-ui.js` 将此类失败显示为“待连接确认／重试确认”，确认期间隐藏写入百分比。真实写入保留提交进度。包含已验证的主页缩略图开始图标修复。

## 验证

- 新Gate当前/历史目标确认445项、7组；原Gate6组、恢复和身份门禁35项通过。Session全套使用真实签名包通过，覆盖恢复回调失败、存储失败、绑定替换、取消、旧连接、历史目标及无重复连接。
- 真实生产UI/adapter/Gate/Session、仅native边界模拟：8场景116项；包括同UID新MAC复用且零断连/零升级写入、异UID保留、NUL广播名、新MAC发现、候选模式事件、Boot拒绝、取消及真实30秒期限后迟到连接。
- 既有扫描85项、连接UI77项、正常整包及历史pending UI87项、固定发布门62项、启动校验61项及学习/运行许可回归通过。
- 实际APK版本、签名、唯一冻结固件、2,819项dist资源与13项关键源码核对通过，DEX中ACL屏障标记保留。

### 真实新板只读收尾

2026-11-06，冻结的 **1.2.14 / code20** 在保留的已安装目标及旧定位 pending 现场通过验收，状态为 `REAL_NEW_BOARD_READONLY_COMPLETION_PASS`。真实 UID `4c3450410b37343745a36000` 相同，定位由 `DC:B0:DC:30:78:0E` 经 fresh 设备反馈核对为 `EC:B0:DC:30:78:0E`；canonical INFO 的 board258、protocol1、App mode、有效镜像、1.0.3版本、32,312字节及完整镜像 SHA-256 均匹配。

当前同一 App epoch 的两次真实 STATUS 序号为 **21 / 22**，间隔 **868ms**，电压均 **4051mV**、flags均0。健康验证后恢复编程模式4，口令服务 `initialized:true / query:ready / capability:supported`，10个位置真实反馈均为 `unlearned`；此后才清除 pending，保存默认定位为 EC 地址，Gate已就绪。用户另行确认“已进入编程”。

原生调用证据为 **connect 1、subscribe 1、disconnect 0、beginOta 0、writeOta 0**；`ENTER_BOOT / BEGIN / DATA / FINISH` 均0。正常 C2 查询、模式恢复和心跳仍存在。本次没有重新擦除或刷写主控，候选 APK 及冻结固件指纹保持上述原值。

范围仅为**保留的已安装目标及旧定位 pending 的真实只读收尾**。1.2.14 从旧固件开始的整包传输及 post-FINISH 自动重连，软件回归已通过，但尚未在新板重新实测；不能据本次只读结果宣称新版完整实机 OTA 全链通过。1.2.13 的真实整包 OTA 与用户冷启动通过仍是独立历史结果。

实机证据位于下位机工程 `LBS-XIAOBAI-AI/docs/new_board_ota_confirmation_validation_20261106.json`，附原始状态 `new_board_ota_confirmation_fix_proof_20261106.json` 及原生汇总 `new_board_ota_confirmation_native_20261106.json`。本次文档同步没有修改源码、APK、固件、发布指针或 Git。

本机证据：`outputs/ota-lifecycle-20261106-v1214/REGRESSION_SUMMARY.json`、`APK_1.2.14_VALIDATION.json`、`installed-ui/results.json`及签名/DEX记录。源码基于`eaf4044650c8aac6929b4aab6946ef28fea80254`加本地未提交改动。
