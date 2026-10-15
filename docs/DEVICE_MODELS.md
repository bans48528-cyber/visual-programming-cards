# 设备型号接入

目录包含现有 `xiaobai` 和待实物验证的 `lbs2206`；LBS2206 的业务发送默认关闭，见 [LBS2206_INTEGRATION.md](LBS2206_INTEGRATION.md)。型号选择与具体蓝牙设备分开保存；不通过广播名称猜测或切换型号。

## 代码职责

- `device-models.js`：型号注册、分型号作品存储、旧数据迁移、切换会话和统一执行调度。
- `xiaobai-model.js`：小白的名称、插图、侧栏入口、积木与参数、示例、蓝牙和执行模块配置。复用现有主页中的小白插图。
- `app.js` / `home.js`：共用编辑器与作品界面。切换时重建当前型号目录和参数，隔离历史记录、暂存区及作品。
- `device-picker.js` / `device-models.css`：首次选择和主页切换入口。取消或再次选择当前型号不会切换连接。
- `android-bluetooth.js`：小白蓝牙适配器工厂。保留默认设备 10 秒扫描、首次 3 秒扫描、手动优先、本地改名和 C1/C2 行为；实例销毁后忽略旧扫描、连接及通知。
- `xiaobai-ui.js`：共用运行/停止入口；执行方式由型号配置决定。
- `device-preview.js`：网页说明页。网页不使用旧 Spark 编译上传链路控制小白。

## 本地数据

`cardDefaultModelV1` 保存默认型号。

每种型号分别保存：

- `cardModel:<id>:projects:v1`：作品和非空草稿，每个记录含 `modelId`。
- `cardModel:<id>:active:v1`：最近编辑的作品。
- `cardModel:<id>:bluetooth:v1`：默认蓝牙设备的唯一标识。

`xiaobaiDeviceNamesV1` 继续以硬件唯一标识保存本地名称，改名不改变型号或默认蓝牙设备。

启动时将旧作品列表（含未命名作品）、旧工作区和默认蓝牙设备迁入小白。旧键保留为备份；迁移标记写在最后，重复启动不重复导入；损坏的数据不覆盖。没有型号选择记录时显示首次选择页。

非空草稿持久化且保留 `needsName`；点击保存才命名。空白新程序不写入作品列表。切换前保存旧型号草稿，返回型号主页可通过“返回编辑”继续。

## 新型号配置

在启动编辑器前向 `CardModels.register` 注册一个正式可用的型号，填写：

1. `id / name / image / description`：稳定标识、名称、图片、说明。
2. `features`：侧栏入口，现有公共入口为 `files / examples / remote`；提供 `label / icon`。建议沿用这一顺序。遥控入口由型号的 `remote.open / close` 实现。
3. `catalog / legacyCards / examples`：积木目录、参数 schema、需要兼容的旧积木和示例；独立图标可通过积木 `icon` 指定。新积木形状或特殊参数编辑器需要另加对应 UI。
4. `bluetooth.create({model})`：返回型号的蓝牙适配器，暴露 `ensureConnected / remoteConnection / dispose`。`dispose` 必须取消扫描、连接和待发送任务，移除监听并断开连接。现有小白复用 SparkBle 的 FFF0/FFF1/FFF2 原生传输；其他服务/特征或传输要求需要提供新的原生实现或扩展原生插件。
5. `execution`：统一点击运行后，选择以下方式。

| kind | 型号需提供 |
| --- | --- |
| `stream` | `validate(program)`、`createRunner(connection, context)`；runner 有 `run / cancel / stop` |
| `upload` | `validate`、`sendProgram(program, context)`、可选 `startProgram(context)` / `stop(context)` |
| `compiled` | `validate`、`compile(program, context)`、`sendProgram(bytecode, context)`、可选 `startProgram` / `stop` |

context 提供 `signal / isCurrent / onProgress / onStep / connection`。编译服务应响应 AbortSignal；每个分包/写入前必须检查 signal 和 isCurrent。公共调度器会在编译、发送、启动的边界检查会话，屏蔽旧任务的进度和错误。不能把异步结果写入全局“当前连接”；连接必须绑定自己的唯一会话 ID。

切换会立即撤销旧会话并取消自动连接，尝试停止程序/释放遥控；停止操作最多等 1.5 秒后销毁连接，避免无回报时卡住切换。已送达硬件的指令无法撤回；断连后的硬件停止与模式恢复仍由设备固件保证。

## 验证

运行 `npm test`、`npm run test:models`、`npm run test:ui`、`npm run test:android-ble`、`npm run test:catalog`。浏览器测试需要 4173 本地 HTTP 服务，Android 桥接测试先运行 `npm run build:web`；这个命令仅生成网页资源，不打包 APK。

测试中的第二型号只在测试运行时注入，不进入生产注册表。覆盖首次选择、重启记忆、取消、草稿和默认蓝牙隔离、参数目录切换、旧数据迁移、迟到编译/连接结果、取消的发送队列，以及现有小白的自动连接、遥控和编程。

待真机：实际 BLE 权限和扫描、断开旧硬件、停止电机/释放遥控、固件模式切换与超时保护、真实广播兼容性。未来新型号的编译器、完整程序格式和设备执行回报需用其实际固件验证。

接入新型号需提供：名称/图片、功能与积木参数表、BLE 广播规则及服务/特征 UUID、完整控制协议及回报/超时规则、程序执行方式（完整程序格式或编译器）、停止/断连/模式切换规则，以及可测试硬件与固件版本。
