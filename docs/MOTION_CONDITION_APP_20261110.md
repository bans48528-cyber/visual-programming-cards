# 运动状态与“重复直到”条件循环

配套App1.2.20/code26、主控App2.1.0，Boot2.0.0与ASRPRO1.4.4不改。旧1.2.19 APK和2.0.2原签固件保持冻结。

## 积木与编辑

- `motion-wait`：`state=still/shaking/up/down`。平稳不限朝向；持续晃动为独立持续交替检测；上下要求大致水平并完成静止→动作→停稳。上下每个新等待都需要在该任务之后开始并完成的新动作，手机不根据姿态值推断成功。
- `tilt-wait`：只提供forward/backward/left/right，不自动迁移旧作品。已有wire目标1不删。
- `loop-infrared`：`comparison=greater/less` 与整数阈值0..100，严格大于/小于，等于不满足。
- `loop-tilt`：四方向。
- `loop-time`：从进入计时，秒数0..86400；0在设备入口立即满足。

三类新循环均为原C形结构，显示两行“重复直到＋实际参数”，保留完整数字。参数层明确说明入口先检查、整轮边界、内层等待/无限循环限制、停止立即生效。各型号目录、图标、参数编辑、自由画布、撤销及保存继续复用；新卡片只属于小白。

## 共用执行框架

单组与多组调用同一个 `xiaobai-control-flow.js`。次数和一直循环也走同一框架。

条件循环入口ARM并等待设备READY或DONE。初始DONE跳过内部；READY后开始一整轮，期间真实DONE只锁存。整轮返回后若尚未收到命中，QUERY读取设备持续观察并锁存的结果，再退出或开始下一轮。设备QUERY也会采样并可在READY时锁存新命中，但不会清除之前的锁存；不能用手机轮尾查询代替设备的持续观察。

时间条件也由设备观察器从首次ARM受理计时，重发不重置。5秒条件、每轮3秒应在约6秒完成整轮后退出，可能另有通信时间。本层命中不会中断内层一直循环或当前等待；该轮永不结束时本层也不会结束。手停、模式、断连、心跳和真实故障仍立即中止全部执行，异常finally不等待CLOSE确认才停机。

控制嵌套上限20层。红外、倾倒、时间条件合计每组最多同时嵌套4层、4组共16个观察槽；不是按循环出现总数计数。超限在整作品预检阶段拒绝，不能先执行前面的电机，也不在运行中截断。错误保留groupID、blockUID和准确path定位。

## 独立观察器传输

完整原始契约复制在 `MOTION_CONDITION_PROTOCOL_V1_20261110.txt`；24条原始共享golden位于 `tests/fixtures/motion_condition_vectors_v1.json`。

`WAIT_MOTION=0x34`，C2七个保留参数字节为0，C4 ACTION一字节kind1..4；现有seq/task去重和真实DONE机制不变。上下动作serial及开始时间新鲜性由主控判定，ACCEPTED或APPLIED不能完成运动等待。

观察器用独立C4 kinds12/13/14/15（ARM/QUERY/CLOSE/ACK），不替换PC动作，不占用或打断其他组。单组绑定已确认RUN_CONTROL的sid=(runId,0)、group0；多组绑定实际session64/group1..4。每组observerId32单调递增，同次运行不复用；完整sid/group/id/condition匹配才处理回包。READY ACK不屏蔽后续DONE，旧READY不能清除锁存，关闭后的ID不能影响下一层或下一次循环。

正常finally确认CLOSE并释放，异常时优先停止并退役本地观察器。传感器FAILED等主动反馈会在当前动作仍等待时立即中止，不等轮尾。IR仅使用真实PA1归一值，不将恒定ADC值伪装成已检测的硬件故障。

新功能运行前仍需签名固件门禁就绪，并匹配当前App INFO、完整镜像长度/SHA/布局/地址/页大小以及连接epoch，最低2.1.0。保留学习互斥、单会话保护和重连不自动续跑。

## 验证边界

Node核心74项、真实JS栈/分片模拟wire17项、生产C跨语言16项、目录4项通过；C2原生3570帧、C4原生11843帧及12033项发送/生命周期断言通过。手机844×390和平板1280×800各8项UI场景通过。

跨语言使用实际Link、观察客户端和循环/执行器对接真实C parser/executor/encoder；仅BSP输入、设备tick和Flash INFO为显式测试seam，完成通知由真实C产生。覆盖初始命中、短命中恢复、时间超整轮、内外层边界、永久等待、组隔离、旧反馈、动作新鲜性、停止/心跳/故障及旧MP_STOP不清新legacy观察。

这些验证不代表2.1.0实际主板运动灵敏度、误触发或完整交互已验收。本App线程不连接、刷写或安装设备，不提交Git。APK及sourceHashes详见 `RELEASE_1.2.20.md` 和 `MOTION_CONDITION_APP_VALIDATION_20261110.json`。
