# Android 迁移交接文档

更新时间：2026-09-15

> 紧凑顶栏（2026-09-15）：设备状态与主页、作品名称、操作按钮保持单排，顶部元素缩到原来的 80%。751 / 892 / 390px 预览均无换行或溢出；华为实机顶栏高约 41px（原约 75px）。新版 APK 已覆盖安装，SHA256 ed94a1a098905698dbca6feae66d74f7547cdb7ee182ad373d428933fef5bb69，截图 artifacts/huawei-compact-toolbar.png。

> 华为环境恢复（2026-09-15）：nova 3 / PAR-AL00，ADB FJH5T18714012850，Android 9，保留 com.huawei.webview 12.1.2.326（Chromium 92）。缺少 structuredClone / Object.hasOwn 的调用已兼容；BlockLayout.clientRect 通过运行时探测修正旧内核 CSS zoom 坐标，并排除根元素的设备倍率。最终 APK 已覆盖安装，SHA256 c495c9cd6918848ae9afc83f9aab7f3bf01b701f719d5d06b17e6ef458a56325。实机通过触摸嵌套、参数、点阵、撤销重做、返回键、强制结束后保存恢复；APK/JNI 29 组各两次字节码一致。扫描开始/停止、约 10 秒超时、返回及后台清理通过（本次发现 0 台，未验证该手机的实物发送/遥控）。记录 artifacts/huawei-device-report.json、huawei-scan-report.json；桌面三尺寸积木回归通过。

> 发送并运行更新（2026-09-14）：按用户要求对齐网页版按钮。黄色按钮发送并以 BC 请求运行，灰色按钮取消发送并按状态跳过 / 单次 / 五次 B9；发送前 run 状态先请求暂停并等待 stop。原主机固件 109 实测 DA/AA/AA/BC 四包确认，状态 run → 点击暂停发送五次 B9 → stop，手机保持连接；日志 artifacts/spark-upload-live.json。旧版仅发送记录保留在下文；最新行为见 docs/ANDROID_UPLOAD.md。

> 发送进展（2026-09-14）：安卓黄色按钮现为“发送”，本机编译后写入 0 号槽位，不自动运行；灰色按钮取消发送。原生增加 MTU 协商与 UploadGate，仅按序放行 DA / AA / BB。一加 7 Pro + Spark_AI 固件 109 实测 287 字节等待程序，MTU 247，四包均收到 FD 01，主机保持 stop。Android 仅接受此文件确认类型，忽略 FF FF 状态回包；硬件执行尚未验收。详见 [发送说明](docs/ANDROID_UPLOAD.md)。下文未开放上传等表述是历史记录。

> 实物连接进展（2026-09-14）：一加 7 Pro（fd0ee072）已扫描并连接 Spark_AI（EC:B2:A9:00:E4:9B），D0 后持续解析分片状态 JSON；本次最新上报为 WillAiState=stop、version=109、电量 76%。原始记录见 artifacts/spark-live-connection.json。未发送非零遥控按键，动作映射和外设信息仍待用户确认；不能把连接通过当作遥控动作验收。华为 nova 3 的兼容工作已按用户切回旧手机暂停，代码尚未作兼容修改；其系统 WebView 在检查时由 Google 79 临时切到华为内核 92，手机拔下前未恢复。

> 遥控进展（2026-09-13）：根据用户给定 APK 的 C1 十键协议新增遥控页和原生帧校验，支持多点触控、最新状态发送、每秒重发、释放与后台断开。入口在首页及编辑器工具栏。仅新增 C1 放行，未开放 B9 或程序上传；模拟连接测试通过，实物响应待验收。详见 [遥控说明](docs/ANDROID_REMOTE.md)。

> 最新编译进展：已完成 `native/card-compiler` 自定义库、三种 ABI 的 `.so`、共享代码生成器、隔离进程的 CardCompiler 插件，以及手机“编译检查”按钮。独立桌面 CLI、手机 ARM64 CLI、APK/JNI 均通过 29 组各两次完整字节对照；APK 通过输入拒绝、语法错误、取消及恢复验证。新版 APK 已覆盖安装，作品未清除。详见 [编译库说明](native/card-compiler/README.md)。以下“安卓 .so 尚未构建 / Pika 未接入”是历史分析，现已完成离线编译；发送与真实硬件执行仍待接入。

> 编译源码核对更新：本次在电脑版 `pika-bytecode-gen-napi` 安装目录找到了 Pika 1.13.4 的 17 个核心 C 文件、生成绑定、标准库、配置和构建清单。下文“尚未找到编译源码”的历史结论已被更新。已完成当前 23 种积木及边界场景共 29 组桌面基准，每组两次产物一致；安卓 `.so` 尚未构建。具体可复用范围、平台适配和验证步骤见 [手机编译库分析](docs/ANDROID_COMPILER_ANALYSIS.md)。

> 后续进展（2026-09-12）：已建立 Capacitor 8 Android 工程并成功构建 0.1.0 debug APK，复用现有 UI，增加返回键、横屏、WebView 版本提示与编辑/后台自动保存。随后在一加 7 Pro（Android 11 / WebView 106）上完成安装、冷启动、触摸嵌套、参数、点阵、原生返回键和强制结束后的作品恢复验证，并修复 core 运行库缺失及旧 WebView 高度兼容问题。安装和最新验证范围见 [ANDROID.md](ANDROID.md)。下文是迁移前的基线记录，其中“没有 package.json / Android 工程”等描述已被这次实现更新；BLE 与 Pika 原生编译仍未接入。

本文记录 `visual-programming-cards` 当前实现、桌面依赖和 Android 迁移建议，供后续对话直接接手。结论基于当前工作区代码，而不是仅依据 README。

> BLE 后续进展（2026-09-12）：已实现显式 transport、原生 SparkBle 插件和手机扫描/连接页面。一加 7 Pro 已通过权限、扫描开始/停止/超时和后台清理；因手头没有 Spark_AI，真实主机连接与 D0 状态读取尚未验收。原生写入目前仅放行 D0，编译/上传/B9 未开放；详细边界和复测方法见 [ANDROID.md](ANDROID.md)。

> 数值输入后续进展（2026-09-12）：网页与 APK 共用 `app.js` / `blocks.css` 内的小键盘，数值入口改为按钮，避免系统输入法。确定才更新模型、历史和自动保存；取消、点外部或切后台丢弃草稿；手机返回先退出小键盘，再关闭参数层。保留加减步进及参数范围/精度。4 种尺寸、10 种数值积木与一加 7 Pro 真机触摸/输入法隐藏检查通过，脚本及记录见 [ANDROID.md](ANDROID.md)。

## 1. 结论摘要

- 当前项目是原生 HTML/CSS/JavaScript Web App，没有 React、Vue、TypeScript、npm 构建或前端路由框架。
- 主页、积木编辑器、布局计算、参数编辑、作品数据模型、代码生成规则和大部分通讯协议算法可以复用。
- 不能直接复用的两个核心部分是 Web Bluetooth 传输层和 Windows Pika 原生编译器。
- 推荐采用“现有 Web UI + Capacitor Android 容器 + 自定义 Kotlin 插件”的路线。Kotlin 插件负责 BLE 和本机 Pika 编译，JavaScript 继续负责编辑器及协议业务流程。
- 当前仓库没有 Android/Gradle 工程，也没有可直接打进 APK 的 Android Pika `.so`。
- 暂停指令 B9 被确认是模拟硬件运行键，不是幂等的急停命令；停止状态下发送可能重新启动程序。Android 版不得把它包装成保证成功的“急停”。

## 2. 当前技术框架

| 层次 | 当前实现 | 主要文件 |
| --- | --- | --- |
| 页面 | 单页原生 HTML，通过 URL hash 切换主页、编辑器和蓝牙页 | `index.html`、`home.js`、`bluetooth.js` |
| 样式 | 原生 CSS，固定积木几何加响应式媒体查询 | `styles.css`、`blocks.css`、`home.css`、`bluetooth.css`、`toolbar.css` |
| 编辑器 | 原生 DOM、Pointer Events、Pointer Capture、自研拖放与嵌套布局 | `app.js`、`block-layout.js` |
| 本地数据 | `localStorage` JSON | `home.js`、`app.js` |
| 代码生成 | CommonJS 模块，将积木树转换成受限的 Pika Python | `program-codegen.cjs` |
| 编译 | Node HTTP 服务、子进程、Windows N-API 二进制 | `compiler-server.cjs`、`compiler-worker.cjs` |
| 蓝牙 | Web Bluetooth，FFF0 服务和 FFF1 特征 | `bluetooth.js` |
| 协议 | UMD 风格纯 JavaScript，帧构造、接收解析、上传队列 | `spark-protocol.js` |
| 测试 | Node `assert` + Playwright + 本机 Edge；BLE 使用模拟 GATT | `tests/*.spec.cjs` |
| 托管 | 静态站点登记文件，没有运行时后端 | `.openai/hosting.json` |

脚本依赖全局变量和固定加载顺序：`block-layout.js` -> `app.js` -> `home.js` -> `spark-protocol.js` -> `bluetooth.js`。Android 迁移初期应保持顺序，之后再逐步模块化，避免同时重写 UI 和通信。

## 3. 已完成功能

### 3.1 主页与作品

- 我的作品和积木示例两个视图。
- 新建、打开、重命名、复制、删除作品。
- 作品缩略图由真实积木数据渲染，普通作品包含开始积木。
- 当前作品在保存、返回主页和页面卸载时写入本地存储。
- 可迁移旧键 `visualProgramV2` / `visualProgramV1` 到作品列表。

### 3.2 图形化编辑器

- 从素材区点击或拖入积木，程序按从左到右执行。
- 程序内排序、删除、循环嵌套和最多多层循环布局。
- 暂存区可保存一组积木并整组拖回。
- 撤销、前进、清空和当前作品保存。
- 参数弹层、数值步进和输入、选项按钮、5x5 点阵绘制。
- 程序区空白拖动可平移画布；空白处长按 0.5 秒可进入框选。
- 可见的手掌按钮已从当前工作区移除，长按框选逻辑仍保留。

### 3.3 已映射积木

当前共 22 种积木，覆盖：

- 单电机功率、定时正反转、持续正反转、停止，端口 E-H。
- 组合电机方向、功率、定时前后左右、持续移动、停止；固定左 E、右 F。
- 超声、灰度、外接触碰和主机按键条件等待，传感器端口 A-D。
- 等待、次数循环、无限循环。
- 音符 1-7 与 0.25/0.5/1/2 拍。
- 5x5 图案转换为硬件 5x7 点阵的居中数据。

`program-codegen.cjs` 会验证积木数量、嵌套层数、参数范围、端口和未知积木，失败时整单阻止发送并给出积木路径。

### 3.4 Spark AI 蓝牙与发送

- 按名称 `Spark_AI` 搜索设备。
- 发现 FFF0 服务和 FFF1 特征，订阅 notification/indication。
- 支持连接、断开、授权设备列表、连接状态和通讯诊断导出。
- 使用 `5A 97 98 LEN CMD DATA SUM A5` 帧格式。
- 上传使用 DA 文件名、AA 数据块、BC 结束并运行，数据块最大 128 字节。
- 解析同一通知流中的二进制帧和 JSON 状态，支持半包、多包及有限恢复。
- 写入经过串行队列；上传支持取消、超时、进度和断连中止。
- 运行前根据设备状态决定直接编译或先请求停止；上传后恢复 D0 状态监控。
- 暂停按钮在已停止状态下不发指令；等待状态下发送 D0 后再发一次 B9；其他状态发送 5 次 B9，间隔 80ms。

详细协议和风险以 `COMMUNICATION.md` 为准。当前 ACK 只确认“收到一个校验正确的二进制帧”，尚未识别真实 ACK 命令、序号或错误码。

## 4. 当前运行方法

项目没有 `package.json`，前端无需构建。

### 4.1 启动页面

在仓库根目录运行：

```powershell
python -m http.server 4173 --bind 0.0.0.0
```

电脑访问：

```text
http://127.0.0.1:4173/
```

常用路由：

- `/#home`：主页。
- `/#editor`：编辑器。
- `/#bluetooth`：蓝牙连接页。

### 4.2 启动桌面编译服务

另开终端运行：

```powershell
node compiler-server.cjs
```

服务只监听 `127.0.0.1:4180`，只接受来自 `http://127.0.0.1:4173` 或 `http://localhost:4173` 的编译请求。

默认编译器路径硬编码为：

```text
E:/Spark AI 1.1.9/Spark-AI/resources/app.asar.unpacked/node_modules/
pika-bytecode-gen-napi/build/Release/pika_bytecode_gen.node
```

可用 `PIKA_ADDON_PATH` 环境变量覆盖。该 `.node` 是 Windows N-API 原生模块，不能在 Android 使用。

### 4.3 测试

测试需要 Node 可解析 `playwright`，并安装 Microsoft Edge。主要命令：

```powershell
node tests/protocol.spec.cjs
node tests/home.spec.cjs
node tests/blocks.spec.cjs
node tests/bluetooth.spec.cjs
node tests/hardware-flow.spec.cjs
node tests/all-cards.spec.cjs
node tests/power.spec.cjs
```

除纯协议测试外，多数测试要求页面服务已在 4173 端口运行；硬件流程和全积木原生编译测试还要求 4180 编译服务可用。测试中的 GATT 是模拟实现，不能代替真实 Android 手机和 Spark AI 硬件测试。

## 5. 依赖桌面或浏览器环境的部分

### 5.1 必须替换

1. `navigator.bluetooth`
   - WebView 内不能把当前 Web Bluetooth 支持当作前提。
   - `bluetooth.js` 直接读取 `navigator.bluetooth`、`BluetoothDevice.gatt` 和 `BluetoothRemoteGATTCharacteristic`。

2. 本机 HTTP 编译服务
   - `bluetooth.js` 限制只能从 `localhost` / `127.0.0.1` 调用 `http://127.0.0.1:4180/compile`。
   - Android 中的 `127.0.0.1` 指手机自身，不会访问开发电脑。

3. Windows Pika N-API 编译器
   - `compiler-worker.cjs` 使用 Node `require()` 加载 `.node`，并依赖 `fs`、`os`、临时目录和子进程。
   - Android 需要 JNI、WASM 或远程编译服务，不能复用该二进制。

4. 浏览器下载
   - 通讯诊断通过 `Blob`、`URL.createObjectURL()` 和带 `download` 的 `<a>` 导出。
   - Android WebView 中应改为系统分享或 Storage Access Framework，避免下载无反馈或保存位置不可控。

### 5.2 可保留但需要封装

- `localStorage` 在 WebView 中通常可用，但它属于 WebView 域数据，清除应用数据、域变化或容器配置变化都可能造成作品丢失。
- hash 路由可继续使用，但 Android 返回键应优先关闭参数弹层、从蓝牙页返回编辑器、从编辑器返回主页，再考虑退出应用。
- `beforeunload` 不足以覆盖 Android 进后台或进程被回收，需要原生生命周期通知和显式保存。
- `crypto.randomUUID()`、`structuredClone()`、`TextEncoder/TextDecoder`、`AbortSignal.timeout()` 需要在目标 WebView 版本上验证或提供兼容实现。

## 6. 界面和程序逻辑复用判断

### 6.1 可直接或低成本复用

- HTML 页面结构和全部现有 CSS 视觉设计。
- 积木定义、参数规范化、作品数据结构和历史记录。
- `block-layout.js` 的积木测量与连接坐标。
- 大部分拖放、循环嵌套、参数编辑和点阵绘制逻辑。
- `program-codegen.cjs` 内的规则本身。需要改成浏览器可加载的 ESM/UMD 或共享模块，不能继续只作为 Node CommonJS 使用。
- `spark-protocol.js` 的帧构造、分块、校验、JSON/二进制接收解析和上传状态机。

### 6.2 应抽象后复用

当前 `SparkProtocol.Link` 同时承担协议和 Web Bluetooth characteristic 调用。建议拆为：

```text
SparkProtocol            纯协议：封包、解包、上传流程、超时和状态机
BleTransport             平台接口：scan/connect/disconnect/write/subscribe
WebBluetoothTransport    保留现有网页实现
AndroidBleTransport      通过 Capacitor/Kotlin 插件实现
CompilerAdapter          compile(program) -> bytecode
```

Android BLE 插件只负责可靠地提供字节流和连接事件；协议命令、状态判断和业务提示继续放在共享 JavaScript 层，可减少网页与 APK 行为分叉。

### 6.3 不建议复用

- `compiler-server.cjs` 和 `compiler-worker.cjs` 不应进入 APK。
- Windows `.node` 文件不能复制到 Android 后使用。
- 不应在 Android WebView 中伪造完整 `navigator.bluetooth` API；显式的 `BleTransport` 接口更容易测试和处理生命周期。

## 7. 触摸操作适配检查

### 7.1 当前基础

- 拖放、画布平移、点阵绘制和暂存组浏览使用统一 Pointer Events。
- 关键拖动使用 `setPointerCapture()`，并监听 `pointercancel` 和窗口失焦。
- 拖动区域大量使用 `touch-action: none`，按钮使用 `touch-action: manipulation`。
- 已有 844x390 和 390x844 等尺寸的 Playwright/CDP 触摸流测试。

因此，编辑器不是依赖桌面 HTML5 Drag and Drop，迁移到现代 Android System WebView 的成功概率较高。

### 7.2 仍需 Android 真机验证

- WebView 的系统返回手势、边缘手势和页面横向拖动是否冲突。
- 多次拖动后的 `pointercancel`、切后台、锁屏和来电中断恢复。
- 软键盘弹出时参数浮层是否被遮挡；需结合 WindowInsets/IME 处理。
- 长按 0.5 秒框选是否与 Android 文本选择、触感反馈或长按菜单冲突。
- 低端设备上复杂嵌套程序的布局和拖动帧率。
- 屏幕密度、字体缩放到 1.3-2.0 倍时按钮和参数文字是否溢出。

### 7.3 屏幕方向注意事项

`styles.css` 定义了手机竖屏提示，但 `blocks.css` 中 `.rotate-note { display: none !important; }` 实际将它永久隐藏。Android 版建议直接在 Activity 中锁定横屏，或重新设计可退出的竖屏提示；不要依赖当前 CSS 覆盖关系。

## 8. 文件保存适配方案

### 8.1 当前数据

作品列表键：

```text
cardProjectsV1
```

当前作品 ID 键：

```text
cardActiveProjectV1
```

每个作品包含 `id`、`name`、`updated` 和 `state`；`state` 中保存 `program` 与 `stagedGroups`。当前“保存”是保存到浏览器存储，不是生成用户可见文件。

### 8.2 Android 推荐

- 第一阶段可继续使用 WebView `localStorage`，尽快获得可运行 APK。
- 正式版增加 Kotlin 持久化接口，使用 Room 或应用私有 JSON 文件保存作品；JavaScript 只持有内存状态。
- 首次升级时读取 `cardProjectsV1` 并迁移到原生存储，迁移成功前不要删除原数据。
- 增加显式 JSON 导入/导出，使用 Android Storage Access Framework 或系统分享。
- 在 `onPause` / `onStop` 前触发保存，恢复后重新读取当前作品；不能只依赖 `beforeunload`。
- 为数据增加 `schemaVersion`，后续积木参数变化时执行可追踪迁移。

## 9. 蓝牙通信 Android 适配方案

### 9.1 Kotlin 插件职责

至少暴露以下异步能力：

```text
requestPermissions()
scan(name, serviceUuid)
connect(deviceId)
disconnect()
requestMtu(size)
subscribe(characteristicUuid)
write(bytes, withoutResponse)
getConnectionState()
```

通过事件把 `notification`、连接状态、写入错误和断连原因回传 JavaScript。字节数据建议用 Base64 穿过桥接层，进入 JavaScript 后立即还原为 `Uint8Array`。

### 9.2 Android 权限

- Android 12 及以上：运行时申请 `BLUETOOTH_SCAN` 和 `BLUETOOTH_CONNECT`。
- Android 11 及以下：扫描通常还要兼容旧蓝牙权限和定位权限要求。
- 本项目不广播设备，不需要 `BLUETOOTH_ADVERTISE`。
- 如果扫描结果不用于定位，可评估 `neverForLocation`；必须在目标手机上验证是否会过滤 Spark AI。

官方参考：<https://developer.android.com/develop/connectivity/bluetooth/bt-permissions>

### 9.3 必须保持的协议行为

- 连接后订阅 FFF1 通知，再发送 D0。
- 所有写入保持严格串行，连接变化后取消剩余写入。
- 优先使用 Write Without Response；不要因为一次失败自动改用另一种写入方式并重发。
- 原生层可以请求 MTU，但不能擅自修改已经验证的 128 字节业务分块。
- 通知可能拆包或粘包，必须继续交给 `Receiver.feed()` 累积解析。
- 上传阶段保持状态监控，不发送 BA。
- 未识别真实 ACK 前保留“兼容 ACK”风险提示，不能把校验正确等同于写入成功。
- B9 是类似物理运行键的切换行为，发送前必须结合最新 `WillAiState`，并保留当前停止状态门槛。

### 9.4 生命周期

- Activity 进入后台时不要自动发送 B9，因为未知状态下可能触发程序运行。
- 后台或进程回收后应将 UI 状态设为未连接，不得沿用旧的 stop/run 状态。
- 上传时可使用保持屏幕唤醒；除非未来明确需要后台运行，不要先引入前台服务。
- Android 蓝牙栈返回 GATT 133、权限撤销、蓝牙关闭等情况要映射为可理解的连接错误。

## 10. Pika 编译器迁移

### 10.1 当前阻塞点

积木到 Python 的生成逻辑是纯 JavaScript，可迁移；Python 到 `.o` 的编译依赖 Windows N-API 二进制，不能迁移。

相邻分析项目 `../apk-protocol-analysis/evidence/pika-native.dex.txt` 显示官方 APK 存在：

```text
PikaMobileModule
System.loadLibrary("pika_mobile_jni")
nativeCompile(source, output)
```

这证明 JNI 是已被产品采用的可行架构，但当前仓库没有该库的源码、构建脚本或可确认授权复用的 Android `.so`。不要把反编译证据误当作可直接发布的依赖。

### 10.2 推荐优先级

1. **JNI 离线编译，正式方案**
   - 从合法来源取得 Pika 编译核心源码或 Android SDK。
   - 用 Android NDK 构建至少 `arm64-v8a`，按目标设备决定是否增加 `armeabi-v7a`。
   - Kotlin 插件接收 Python 字符串，在应用私有目录编译并返回 `.o` Base64/字节数组。

2. **WASM 编译，备选**
   - 只有在 Pika 编译器能稳定编译到 WASM 且产物与 Spark AI 固件兼容时采用。
   - 优点是平台共享；缺点是内存、文件系统和编译产物兼容性仍需验证。

3. **远程 HTTP 编译，过渡方案**
   - APK 把程序提交到受控 HTTPS 服务编译，再下载 `.o`。
   - 需要鉴权、限流、隐私和离线失败处理，不适合作为最终的儿童/课堂离线体验。

## 11. 推荐 Android 架构

```text
android-app/
  app/                         Android Activity、权限、生命周期
  native-ble/                  Kotlin BLE 传输
  native-pika/                 JNI/NDK 编译
web/
  当前页面、样式和编辑器逻辑
  platform/ble-adapter.js
  platform/compiler-adapter.js
shared/
  程序数据模型、代码生成、Spark 协议
```

推荐 Capacitor 的原因是现有 UI 已完成且没有复杂框架依赖，同时自定义插件可以明确控制 BLE 与 JNI。若团队更熟悉纯 Android，也可以直接使用受限 WebView 和 `WebMessagePort`/受控 JS Bridge；无论哪种方案，都只允许 APK 内置可信页面调用原生接口，不允许 WebView 导航到外部网页后继续拥有蓝牙或编译权限。

Android WebView 安全参考：<https://developer.android.com/develop/ui/views/layout/webapps/webview>

## 12. 分阶段迁移计划

### 阶段 A：整理共享边界

- 给现有网页补 `BleTransport` 和 `CompilerAdapter`，先让网页实现通过适配器运行。
- 将 `program-codegen.cjs` 改为浏览器与 Node 都能调用的共享模块。
- 保持现有测试通过，避免 Android 工程建立后才发现行为分叉。

### 阶段 B：可安装 UI APK

- 初始化 Capacitor/Android 工程，将静态资源打入 APK。
- 配置横屏、状态栏、返回键、WebView 调试开关和应用图标。
- 验证主页、作品、拖放、循环、参数、点阵、撤销和前进。

### 阶段 C：原生 BLE

- 实现权限、扫描、连接、订阅、写入队列、断连和 MTU。
- 用原生 BLE transport 驱动现有 `spark-protocol.js`。
- 先验证 D0 状态上报和单帧命令，再验证完整上传。

### 阶段 D：本机编译

- 接入合法的 Pika JNI 编译器。
- 逐一对 22 种积木做 Android 编译，并与桌面生成的 `.o` 和真机行为对照。
- 编译与上传均支持取消，防止旧任务在用户停止后继续运行。

### 阶段 E：持久化与发布

- 迁移作品到原生存储，增加 JSON 导入导出。
- 完成异常恢复、真实设备矩阵测试、签名 APK/AAB 和隐私说明。
- 关闭正式包的 WebView 调试，不加载不可信远程内容。

## 13. Android 验收清单

- [ ] 首次启动、拒绝权限、再次授权均有明确状态。
- [ ] 能搜索并连接名称为 Spark_AI 的设备。
- [ ] D0 后能持续接收并正确显示 run/stop/unknown 状态。
- [ ] 所有 22 种积木能在手机离线编译。
- [ ] 1、128、129、256、257 字节边界程序上传正确。
- [ ] 上传期间切后台、锁屏、关闭蓝牙或远离设备不会继续误发。
- [ ] 停止状态下点击暂停不会发送 B9。
- [ ] 运行、暂停、重新发送不会导致蓝牙假死或沿用旧状态。
- [ ] 作品在强制结束应用和系统回收后仍存在。
- [ ] JSON 导入导出可在不同设备间恢复作品。
- [ ] 横屏触摸拖放、循环嵌套、参数输入和点阵绘制通过真机测试。
- [ ] 大字体、全面屏刘海、手势导航和软键盘不会遮挡关键按钮。

## 14. 接手时建议先做的事

1. 先运行网页和现有测试，确认迁移基线，不要直接删除桌面实现。
2. 创建 `BleTransport` 接口并让当前 Web Bluetooth 通过该接口工作。
3. 创建 Android 外壳，只验证 UI 与触摸，不要在同一个提交里同时移植 Pika。
4. 从官方软件/SDK或有授权的源码中确认 `pika_mobile_jni` 的获取和构建方式；这是离线 APK 的关键阻塞项。
5. BLE 真机调试继续保留诊断导出，并记录 Android 型号、系统版本、MTU、写入类型和原始收发字节。

## 15. 已知风险

- 上传 ACK 的业务含义和错误码仍未确定。
- B9 偶发不生效且具有切换运行状态的风险，不是急停。
- 当前真实硬件验证主要在桌面 Web Bluetooth 环境完成，Android 蓝牙栈行为尚未验证。
- `Receiver` 缓存上限为 64KiB；持续残缺通知仍可能触发缓存超限。
- 设备程序末尾不保证自动停止持续运转的电机，程序必须包含对应停止积木，实机测试需准备断电措施。
- 当前工作区在本文创建前已有未提交的手掌按钮移除改动；接手者提交时应一并核对，不要误当成本文产生的 UI 修改。
