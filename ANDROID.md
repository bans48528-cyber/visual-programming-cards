# Android 界面、离线编译与蓝牙状态预览版 0.1.0

本版本复用仓库根目录的 HTML/CSS/JavaScript 编辑器，通过 Capacitor 8 打包为离线 Android 应用。不是重写一套积木界面。Android 工程在 `android/`，不依赖电脑上的页面服务器或编译服务器。

## 安装

- 构建产物：`artifacts/card-programming-0.1.0-debug.apk`。
- 应用名：卡片编程；包名：`com.cardprogramming.app`。
- Android 7.0 / API 24 及以上，Android System WebView / Chrome 内核 105 及以上。旧内核会显示更新提示。
- 将 APK 传到手机后，在文件管理器中点击安装；或通过 USB 调试执行：

```powershell
adb install -r artifacts/card-programming-0.1.0-debug.apk
adb shell am start -n com.cardprogramming.app/.MainActivity
```

这是使用本机 debug 密钥签名的测试包，尚非商店发布包。后续更新应沿用相同签名和包名，以便覆盖安装保留作品。

## 当前可用

- 遥控页：方向、A/B/X/Y、L/R，多点触控、按住发送、松手释放。首页及编辑器手柄按钮进入。原生新增严格校验的 C1 遥控帧，其他硬件命令仍受限制；真实主机响应待验收。协议来源、测试与边界见 [遥控说明](docs/ANDROID_REMOTE.md)。

- 离线主页、新建/打开/重命名/复制/删除作品、积木示例。
- 主页顶部使用 EST 风格引导卡，演示复用本软件真实横向积木；提供新建和返回编辑入口，横屏紧凑显示，最近作品每行 4 个。动画仅作界面展示，系统减少动态效果设置下停用。
- 原有 23 种积木、触摸拖放、嵌套循环、暂存区、参数、点阵、撤销/前进。
- 下方选择区积木等比缩放为 70%，包括循环和暂存组；按参考图使用白色分类栏、浅灰积木背景、分类浅色选中态、积木名称及右侧暂存组数量。加入名称后选择区高度为常规 147px、矮屏横屏 134px（缩小前为 180/164px）。拖入程序区后使用原有尺寸。三种视口的拖放/嵌套回归通过。
- 本机编译发送：黄色按钮离线编译当前程序并发送至主机 0 号槽位，灰色按钮按网页版逻辑请求暂停；发送后请求运行。编译使用独立原生进程，详见 [发送说明](docs/ANDROID_UPLOAD.md)。
- 数值参数使用应用内小键盘：点数值打开，支持数字、小数点、逐位删除、清空、取消和确定，保留原有加减步进。按参数限制整数、小数精度及范围，空值或越界时不能确定。数值区使用按钮和 output，不创建可编辑输入框，不唤起系统输入法；作品名称仍使用文字键盘。网页与 APK 共用此实现。
- 手机横屏（两个横屏方向均可）；Android 16 大屏设备可能由系统忽略方向限制，仍需平板验证。
- 默认沉浸式全屏，隐藏状态栏与导航栏；边缘滑动可临时呼出系统栏，回到应用时恢复全屏。已在一加 7 Pro 验证启动和后台返回后两类系统栏均隐藏，WebView 可用高度由 361 增至约 411 CSS 像素。
- 系统返回键：关闭作品对话框 → 取消小键盘草稿、回到参数控件 → 关闭参数弹层 → 蓝牙页返回编辑器 → 编辑器保存并回主页 → 主页退到后台。
- Android 每次完成编辑、撤销和前进后立即保存到现有 localStorage；数值点确定后作为一次编辑保存，取消或切后台丢弃未确认的数值草稿。切后台会结束拖动、提交点阵笔画并再次保存。保存域固定为 `https://localhost`。
- 原有网页蓝牙行为保留；Android 使用手机蓝牙页面，支持权限提示、系统设置入口、10 秒扫描/停止、信号强度、选择连接/断开和状态显示。连接状态链路已实现，真实 Spark_AI 主机尚待验收。
- 安卓原生层允许 D0、校验通过的 C1 和经 UploadGate 校验的 DA / AA / BB / BC，以及固定的 B9 暂停帧。后台取消编译和发送、释放遥控、断开连接，返回后手动重连。
- 系统栏采用 Capacitor 原生安全区处理，软键盘使用 adjustResize；未开放远程页面白名单，未启用 HTTP 明文或混合内容。只有 debug 包开启 WebView 调试。

保存仍是应用 WebView 数据，尚未接入原生文件、Room 或导入导出。清除应用数据、卸载应用会删除作品；系统备份当前关闭。后台通知属于补充保障，不能把 beforeunload/onPause 当作强制结束进程时必然执行的回调。

## 构建

工具要求：Node.js 22+、JDK 21、Android SDK Platform 36、Build Tools 35.0.0、Platform Tools、NDK 28.2.13676358。Gradle 8.14.3 由 wrapper 下载，已固定官方 SHA256；Android Gradle Plugin 为 8.13.0。配置 `JAVA_HOME` 与 `ANDROID_HOME`，或通过 Android Studio 安装工具。完整构建入口会先生成三种 ABI 的编译库；直接运行 Gradle 前需先执行 `node scripts/build-native-compiler.cjs`。

```powershell
npm ci
npm run android:build
```

当前电脑已在 `%USERPROFILE%/.cache/cards-android/` 准备 JDK 和 SDK，构建脚本会在环境变量未指定时使用这些工具。系统 Node 为 18 时，可用下列入口自动使用本机已有的 Node 24 runtime：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/android.ps1
```

流程为 `build-web.cjs` 白名单复制根目录资源到 `dist/` 并在打包页面中插入官方 Capacitor core 运行库 → `cap sync android` → Gradle `assembleDebug` → 复制 APK 和 SHA256 到 `artifacts/`。原生桥本身不提供 `registerPlugin`，不能省略 core 运行库。不要直接编辑 `dist/` 或 `android/app/src/main/assets/public/`，它们下次同步会被覆盖。APK 不包含 Node 编译服务、Windows `.node` 或协议分析材料。

根目录网页仍可按原方式运行：

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

## 验证记录（2026-09-12）

- Gradle `assembleDebug` 成功，`apksigner verify --verbose` 通过 v2 签名校验。
- `aapt dump badging` 确认包名、0.1.0 版本、启动 Activity、minSdk 24 / targetSdk 36。BLE 版本增加 Android 11 及以下定位/旧蓝牙权限、Android 12+ 附近设备权限；未申请存储权限。
- `node tests/protocol.spec.cjs`：协议、上传边界、取消/断连、代码生成通过。
- `node tests/home.spec.cjs`：1280 / 390 宽作品操作通过。
- `node tests/blocks.spec.cjs`：1280×800、844×390、390×844 的几何、三层嵌套、触摸移入移出、暂存、参数及历史记录通过。
- `node tests/bluetooth.spec.cjs`：桌面浏览器原有模拟蓝牙测试通过。
- `npm run build:web` 后执行 `npm run test:android`：独立服务加载实际打包资源，在 Edge 触摸模式下模拟原生生命周期，验证触摸嵌套、小键盘确定保存/返回取消/后台取消草稿、编辑自动保存、撤销持久化、点阵笔画被后台打断时保存、返回路由和硬件入口限制。该测试不等同于 Android WebView 真机测试。
- 后续已接入一加 7 Pro（GM1910），Android 11、WebView 106.0.5249.126，完成 APK 覆盖安装与冷启动实测。修复了原生桥缺少 core 的插件初始化问题，以及旧 WebView 不支持 `dvh` 导致积木库被裁切的问题；添加 `100%` / `vh` 回退及低矮横屏布局。
- `node tests/android-device.spec.cjs <adb-serial>` 在已解锁真机上通过：892×361 CSS 像素横屏、创建独立测试作品、真实 WebView 触摸拖入循环、参数步进、系统返回关闭参数、撤销/前进、点阵触摸、蓝牙页/编辑器系统返回、强制结束进程后重开并恢复完整作品。使用真实 core 和原生 App 插件；测试保留已有作品，不清除应用数据。
- 真机报告：`artifacts/android-device-report.json`；WebView 截图：`artifacts/android-phone-editor.png`。测试中新建的作品保留在手机上，可以继续操作。当前只验证了一台手机，软键盘完整输入流程、复杂手势和其他设备仍需扩展验证。

### 数值小键盘验证

加减按钮统一每次增减 1（达到参数上下限时按边界限制）；小键盘仍按原参数精度允许输入小数，例如 2.5 秒。

- `npm run test:keypad`：1280×800、844×390、390×844、568×320，覆盖全部 10 种含数值参数的积木；验证小数精度、整数/范围限制、删除清空、取消、一次确认对应一次撤销、物理键盘输入，以及无需滚动即可看到全部按钮（触摸目标至少 44px）。
- 参数气泡统一在完整 click 后打开弹层，避免触摸 pointerup 后生成的 click 落到新弹层里的数值或选择按钮。
- `node tests/android-keypad-device.spec.cjs <adb-serial>`：一加 7 Pro 真机验证数值按钮、逐键触摸、整数与小数、删除清空、返回取消、撤销/前进、自动保存后重载；每次按键检查 Android `ITYPE_IME` 为隐藏，WebView 高度保持 412 CSS 像素。测试只创建独立作品，不清除已有数据。
- 真机截图：`artifacts/android-keypad-phone.png`；记录：`artifacts/android-keypad-report.json`。

## Android BLE 首阶段

实现文件：`android-bluetooth.js` / `android-bluetooth.css` 为手机页面和 JS transport；`android/app/src/main/java/com/cardprogramming/app/SparkBlePlugin.java` 为原生插件。桌面 `bluetooth.js` 在安卓不初始化。`SparkProtocol.Link` 支持显式注入 transport，默认包装原有 Web Bluetooth characteristic；帧格式、解析器与写入队列共用，没有伪造 navigator.bluetooth。

- 权限：Android 11 及以下按需申请前台定位权限，并检查系统定位开关；Android 12+ 申请 SCAN/CONNECT，设置 neverForLocation，后续需真机验证目标广播未被系统过滤。应用不读取地理坐标。
- 扫描：按广播名称 `Spark_AI` 前缀筛选，显示短设备标识及 RSSI。同名设备分别列出；保留稳定的行和连接按钮，信号更新不会重排点击目标。不要求广播中含 FFF0，连接后再验证服务。
- 连接：15 秒建立 GATT 并发现 FFF0 / FFF1 → 5 秒内完成 CCCD 通知/指示订阅 → 共用 Link 发送 D0。写入优先 Write Without Response，等待 Android 写入回调，失败/超时关闭连接、不换方式重发。
- 发送前协商 MTU（请求 512，至少 138；实测 247），原生校验槽位、文件长度、Pika 文件头、分包顺序和显式选择的 BB / BC 终包。Android 等待 FD 01 确认，其他合法回包不推进发送。
- 每次扫描/连接有独立 ID，原生回调检查 GATT 实例，JS 忽略旧连接通知；连接取消和后台切换不发送 B9。`WillAiState` 仅接受 run/stop，超过 2 秒未更新显示过期。收到校验正确的帧不等于主机成功执行。
- 诊断保留最近 200 条事件/字节信息，可展开查看或复制，不包含后台上传功能。

已通过：`node tests/transport.spec.cjs`、`node tests/android-bluetooth.spec.cjs`（需 4173 服务和最新 dist）。覆盖顺序写入、订阅后 D0、状态分包、权限拒绝、蓝牙/定位关闭、扫描停止、取消后晚到连接、GATT 断连、状态过期和后台清理；模拟底层 native bridge，加载真实 Capacitor core。

一加 7 Pro 已通过实际 Android 定位权限弹窗授权、原生扫描开始/手动停止、约 10 秒自动结束（记录 9990 ms）、返回编辑器停止扫描、进入后台停止扫描，原生扫描器注册成功（status=0）。脚本：`node tests/android-scan-device.spec.cjs <adb-serial>`；记录：`artifacts/android-scan-device-report.json`；截图：`artifacts/android-bluetooth-phone.png`。

2026-09-14：一加 7 Pro 已完成实际 GATT 连接、CCCD 订阅、D0 状态读取和 287 字节程序发送，主机固件 109 已验证等待程序发送后 run、软件暂停后 stop。电机动作、无线异常恢复和 Android 12+ 权限分支仍待实机验收。

## 手机验收与后续开发

1. 安装 APK，断网启动，创建作品并拖入循环和电机积木。
2. 点击参数中的数值打开小键盘，测试确定、取消、系统返回、范围限制及不弹出系统输入法；再测试点阵、撤销/前进和暂存区。
3. 切后台、锁屏、强制结束后重开，检查已完成的编辑是否保留。
4. 检查刘海、手势导航栏、大字体和键盘是否遮挡操作；记录手机型号、系统和 WebView 版本。
5. 编译、连接、状态读取和程序发送已完成实测，等待程序运行与软件暂停也已通过状态上报验证，接下来验证实际外设动作；原生持久化、JSON 导入导出后续处理。不得把 B9 作为幂等急停。

官方参考：[Capacitor 环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)、[Android 配置](https://capacitorjs.com/docs/config)、[App 生命周期与返回键](https://capacitorjs.com/docs/apis/app)。
