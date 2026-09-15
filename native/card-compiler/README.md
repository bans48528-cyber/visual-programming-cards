# Card Compiler：安卓离线编译库

将现有积木生成的 Pika Python 编译为 `.py.o`，不执行 Python，也不包含手机硬件驱动。版本标识为 `pika-1.13.4-cards-1`。

## 来源与修改

- `vendor/pika-core`：电脑版 `pika-bytecode-gen-napi/pikascript/pikascript-core` 的 17 个 C 文件及头文件；核心自带 MIT 版权声明。原始文件哈希见仓库 `docs/pika-source-audit.json`。
- `vendor/pika-stdlib`：PikaPython 官方仓库 `v1.13.4/package/PikaStdLib` 的 13 个 C 文件及 `PikaStdData_String_Util.h`。13 个 C 文件与安装目录版本忽略换行后全部一致，下载哈希见 `vendor/stdlib-provenance.json`。
- `vendor/pika-api`：同一桌面安装中的自动生成标准库绑定与头文件。仅编译 `__pikaBinding.c`；未保留模块资产和 VM 启动 C 文件。绑定涉及 PikaStdLib、PikaStdData、PikaDebug、PikaStdTask，没有 Spark 硬件模块。
- `vendor/LICENSE-PikaPython`：官方 v1.13.4 的 MIT 许可，APK 同时携带 `assets/public/licenses/PikaPython.txt`。
- `pika_config.h`：保持桌面的缓冲区及断言配置。自有文件包括 CMake、NDK 构建驱动、CLI、JNI 和只提供全局对象符号的 `compiler_context.c`。
- 对供应商核心的修改仅为删除 `PikaCompiler.c` 和 `dataArg.c` 中五处调试 `printf`（包括整份源码输出）；未改变解析或字节码编码。Android JNI 覆盖弱符号 `pika_platform_printf`，不把解析器源码诊断写入 logcat。

## 构建

安装 Android NDK **28.2.13676358**；设置 `ANDROID_HOME`，自定义 NDK 可设置 `ANDROID_NDK_HOME`。系统 Node 18+ 可运行底层构建脚本，完整 Capacitor 打包仍需 Node 22+。

```powershell
node scripts/build-native-compiler.cjs
```

从仓库根目录运行。默认构建 `arm64-v8a`、`armeabi-v7a`、`x86_64`，最低 API 24；也可在命令末尾指定一个 ABI。每种 ABI 输出到本目录的 `build-<ABI>/`，`.so` 自动复制至 `android/app/src/main/jniLibs/<ABI>/`。所有产物均被 Git 忽略。

`scripts/build-android.cjs` 在 Gradle 前自动运行此步骤。直接从 Android Studio/Gradle 构建前，应先运行本脚本。NDK Clang 使用函数段回收、隐藏内部符号及 16 KiB ELF LOAD 对齐；三种 ABI 均已构建，只有 ARM64 在真机运行验证。

保留标准 `CMakeLists.txt` 供桌面回归及正常 CMake 环境使用。本机多版 Windows CMake 在 Android `find_program` 阶段出现 `0xC0000409`，所以 Android 使用 NDK Clang 直接构建，不依赖此问题路径。

## 接口及隔离

前端 `CardCompiler.compile(program)` 使用共享 `program-codegen.js`，返回 `{source, bytecode: Uint8Array, compilerVersion}`。Node 的 `program-codegen.cjs` 是同一生成器的兼容入口。

Capacitor `CardCompiler.compile({source})` 返回 `{bytecode: base64, bytes, compilerVersion}`；`cancel()` 在编译进程退出后完成。JNI 仅接收 Service 生成的私有 ASCII 路径；源码由 Java 明确按 UTF-8 写入文件，不经过 JNI 字符串转换。

`CompilerService` 位于非导出的 `:compiler` 进程。一次一个任务，输入限 64 KiB，输出限 256 KiB（这是手机桥接限制，不代表硬件容量）。编译工作线程之外的主线程在 15 秒时结束进程；桥接在 17 秒仍未返回时取消。切后台、取消、原生崩溃均不结束编辑器进程。requestId 防止取消前的结果覆盖后续请求。成功、普通失败及进程退出后清理临时文件。

## 回归

`tests/fixtures/compiler-baseline/` 保存桌面插件捕获的 29 组输入、源码、完整字节码与哈希，不依赖开发者电脑上的原插件即可比较。重新捕获需显式运行 `scripts/capture-compiler-baseline.cjs`，它输出到 artifacts，不自动更新这些基准。

```powershell
node scripts/verify-native-compiler.cjs host native/card-compiler/build-host/Release/card-compiler.exe
node scripts/verify-native-compiler.cjs android native/card-compiler/build-arm64-v8a/card-compiler <adb完整路径> <设备序列号>
node tests/android-compiler-device.spec.cjs <设备序列号>
```

实际验证：桌面独立 CLI、手机 ARM64 CLI、APK 的 JS → 插件 → JNI 全链路，均为 29 组各两次与原始桌面完整字节一致。APK 还验证空/超长/NUL 输入拒绝、语法错误、取消及随后成功编译，用户作品数据保持一致。超时保护已实现，但尚未通过故意制造原生无限循环单独验收。

2026-09-14：本机编译的 287 字节等待程序已通过一加 7 Pro 发送到 Spark_AI 0 号槽位，未自动运行。发送与回包记录见 [发送说明](../../docs/ANDROID_UPLOAD.md)，固件执行仍待验收。
