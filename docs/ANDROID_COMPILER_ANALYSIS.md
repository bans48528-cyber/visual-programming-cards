# 手机自定义编译库：源码核对与实现方案

核对日期：2026-09-12。本文保留最初的可行性分析及桌面基准记录。

> 实现更新：第一阶段已实现。桌面 CLI、ARM64 CLI 和 APK/JNI 均通过 29 组各两次的完整字节对照。三种 ABI `.so`、进程隔离、输入限制、取消和界面入口已接入；尚未验证实体主机执行。源码出处、构建命令与验收边界见 [编译库说明](../native/card-compiler/README.md)。下文保留最初的分析依据和执行顺序。

## 结论

可行。当前可以从已有 C 源码构建手机自定义编译库，无需从 Windows `.node` 反编译出一套新编译器。建议以同版本 Pika 编译核心为基础，自己维护 Android 平台适配、JNI 和 Capacitor 接口。

此前交接文档只记录了 Windows 二进制和官方 APK 的 JNI 证据。本次检查发现电脑版安装目录还带有 C 源码、配置及 Visual Studio 构建清单，原先“尚未找到编译核心源码”的限制需要更新。

## 1. 实际找到的内容

安装目录：

`E:/Spark AI 1.1.9/Spark-AI/resources/app.asar.unpacked/node_modules/pika-bytecode-gen-napi/`

| 文件或目录 | 实际用途 | 手机版处理 |
| --- | --- | --- |
| 本仓库 `program-codegen.cjs` | 积木 JSON → 受限 Pika Python；校验参数和积木位置 | 直接复用逻辑，增加浏览器可用的导出方式和共享测试 |
| `src/addon.cpp` | N-API 两个路径参数 → `pikaCompileFileWithOutputName(output, input)` → 返回状态码 | 用我们自己的 JNI 封装替代；不保留 Node/Electron 依赖 |
| `pikascript/pikascript-core/PikaParser.c` | 语法分析与生成指令相关逻辑 | 保留对应版本 |
| `pikascript/pikascript-core/PikaCompiler.c` | 源码预处理、编译及 `.py.o` 写出 | 保留格式和预处理行为，调整平台入口 |
| `PikaVM.c`、`PikaObj.c`、`data*.c` 等 | 编译过程共享的数据结构、指令、常量池和内存支持 | 先保留必要依赖；通过链接结果决定可裁剪部分 |
| `pikascript-api`、`pikascript-lib/PikaStdLib` | 自动生成绑定及标准库依赖 | 核对编译链是否需要；未证明无依赖前不要删除 |
| `pika_config.h` | 编译器缓冲区和断言配置 | 第一版对齐桌面，再逐项评估 |
| `build/Release/pika_bytecode_gen.node` | 已编好的 Windows Node 原生模块 | 仅作本机基准，不装进 APK |
| `compiler-server.cjs` / `compiler-worker.cjs` | 本机 HTTP、子进程和临时文件管理 | 安卓使用自身任务与私有存储，不运行 Node 服务 |

源码中的版本声明为 **Pika 1.13.4**，编辑时间声明为 `2024/08/09 03:29:21`。这不能单独证明安装的二进制恰好由这份源码构建，仍须重新构建后对照产物。

核心目录有 **17 个 C 文件**。桌面工程列出 35 个编译项，34 个存在；缺少的是安装目录之外的 Node `win_delay_load_hook.cc`，属于 Windows 加载层，不是 Pika 核心源码。文件清单及 SHA256 见 [pika-source-audit.json](pika-source-audit.json)。

`PikaCompiler.c`、`PikaParser.c` 等核心源文件含 MIT 许可声明，上游也采用 [MIT 许可](https://raw.githubusercontent.com/pikasTech/PikaPython/master/LICENSE)。复用时保留原版权和许可；部分标准库/自动生成文件没有逐文件许可头，应对照同版本上游确认来源和改动，不把整个厂商安装包直接视为 MIT 依赖。我们的 JNI 和插件可以自行实现。

## 2. 推荐的自定义库边界

```text
现有图形化编辑器 / 积木 JSON
    ↓ 同一份 program-codegen
Pika Python 源码
    ↓ CompilerAdapter
Capacitor CardCompiler 插件（任务、取消、错误、私有目录）
    ↓ JNI
libcard_compiler.so（Pika 1.13.4 核心 + 自有平台适配）
    ↓
Pika .py.o 字节码
    ↓ 后续独立接入
现有 Spark 协议与 Android BLE transport
```

手机 `.so` 是运行编译器的 ARM 原生代码；输出的 `.py.o` 是交给主机 Pika VM 的字节码。两者不是同一种文件。手机端不需要实现 `_motor`、`_matrix` 等硬件驱动来生成这些调用的字节码，实际执行仍由主机固件负责。

建议底层 C 接口保持小而稳定：编译 UTF-8 源码，返回状态、字节码和有限长度诊断；另提供释放结果和查询编译核心版本的接口。不开放执行 Python、任意文件读写或硬件调用接口。

第一版可以使用应用内部临时文件维持与桌面相同的 `pikaCompileFileWithOutputName` 路径；由插件自己生成目录和文件名，前端只传源码。稳定后再考虑内存输入输出，避免首次移植同时改变预处理和输出行为。Java/JNI 用明确的 UTF-8 字节数组边界，避免直接混用 JNI modified UTF-8 与普通 UTF-8。

使用 [Android NDK 支持的 ABI](https://developer.android.com/ndk/guides/abis) 分别构建：先做 `arm64-v8a`，再按目标设备增加 `armeabi-v7a`，模拟器需要时增加 `x86_64`。具体 ABI 和 API 下限必须记录在构建配置中。当前项目缓存 SDK 中未发现 NDK，需要补充 NDK/CMake 工具链。

## 3. 为什么不能只复制两个 C 文件

`PikaCompiler.c` 使用 `ByteCodeFrame`、`InstructArray`、常量池、对象、字符串和内存管理。桌面工程也编译了 `PikaVM.c`、对象层和标准库相关文件。

“手机只开放编译功能”不意味着“所有 VM 源文件都能直接删掉”。第一版先打通依赖闭包，保持源码和配置接近桌面；随后结合链接 map、函数段回收和回归对照做裁剪。暂时不能给出最终 `.so` 体积或编译耗时，它们需要实际构建和真机测量。

也不建议为当前积木直接手写一套字节码生成器：循环跳转、常量池、浮点、指令表和后续固件变化都会变成我们需要独立维护的兼容性工作。

## 4. 必须核对的兼容细节

1. **固定源码快照，而非直接升级最新版。** 核对 `PikaVersion.h`、`__instruction_table.h`、编译器、解析器、VM 和生成绑定。
2. **对齐配置。** 桌面启用了 `PIKA_CONFIG_ENABLE`、`CROSS_BUILD`；配置含行缓冲 1280、栈缓冲 2560、路径缓冲 640、文件读缓冲 1 MiB 等。不要把 Node/Electron 宏带进 Android；`CROSS_BUILD` 在当前源码中的影响要逐处确认。
3. **保持预处理和序列化行为。** 桌面文件入口调用 `strsFilePreProcess`；输出包含 `0F 70 79 6F`、长度字段、指令区和常量池。只检查文件头或返回码不足以证明兼容，需比较完整字节，尤其是整数宽度、指令结构布局、浮点及换行处理。
4. **处理平台故障路径。** `dataMemory.c` 和 `PikaPlatform.c` 含内存/错误路径的死循环；直接把它们放进应用进程可能留下不可结束的任务。不能认为 Java Future 超时就能终止正在跑的 JNI。
5. **保留桌面的进程隔离能力。** 推荐独立、非导出的 `:compiler` Service 承载串行编译任务；超时或严重故障可回收编译进程。若原型先用普通后台线程，必须明确只实现“丢弃过期结果”，不是硬取消。
6. **清理调试输出。** 本地 `PikaCompiler.c` 含直接打印完整源码和内部信息的 `printf`，Android 适配需要移除或转成有界诊断；不要仅拦截 `pika_platform_printf` 就认为覆盖了全部输出。
7. **编译与发送分别验收。** 保留 requestId/取消检查；编译成功不能直接解除现有 BLE 的 D0-only 限制。

这些是本次源码中已经看到的移植工作，不是需要用户逐项确认的审批步骤。[JNI 官方说明](https://developer.android.com/ndk/guides/jni-tips)用于核对跨语言对象、线程和字符串处理。

## 5. 本次实际验证

新增命令：

```powershell
node scripts/capture-compiler-baseline.cjs
```

它从当前 `app.js` 的声明式积木目录获取默认参数，调用现有桌面编译 worker，保存积木 JSON、生成源码、`.py.o` 和 SHA256。不会连接或写入蓝牙。

本次结果：**当前实际有 23 种积木**（旧文档里的 22 已过时），逐个编译，加上嵌套循环、小数时长、传感器边界、不对称点阵、组合功率顺序、128 块长程序，共 **29 组**。每组使用两个独立桌面 worker 编译，58 次调用全部成功，同组完整字节一致。

输出目录：`artifacts/compiler-baseline/`；清单：`artifacts/compiler-baseline/report.json`。

桌面 `.node` SHA256：`902f43061019656d118f27e2856ec6a04116bdf161a62d5d84d587b2cc85e2f5`。

这些是**桌面参考产物**，尚未与重建核心或 Android 输出对比。测试没有把 `.py.o` 发到主机；当前手头没有 Spark_AI。

## 6. 可直接执行的后续顺序

1. 按清单固定核心版本和许可证；核对所需标准库的同版本来源，建立自有 `native/card-compiler` CMake 工程。
2. 先重建一个独立桌面 CLI，运行这 29 组样本，与现有 `.node` 逐字节比较，以区分源码差异和 Android 平台差异。
3. 用 NDK 编译 `arm64-v8a`，先在手机单独调用编译入口，再重复完整字节对照、错误源码、连续编译、内存回收和超时测试。
4. 让 `program-codegen` 同时支持 Node 和 WebView，接入 `CompilerAdapter`、Capacitor 插件及任务隔离。先提供离线编译成功/错误反馈。
5. 编译通过后再接上传。硬件到手后验证实际执行、固件版本、程序大小、分包和停止/取消，不把无设备的字节一致测试当作最终实机验收。

第一阶段交付目标：**手机离线生成与现有桌面编译器一致的 `.py.o`**。不以“成功生成一个 `.so`”或“文件头正确”作为完成标准。
