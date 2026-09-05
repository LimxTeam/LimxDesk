# LimxDesk 架构评估

评估对象：`C:\Development\LimxDesk`，113 次提交，最后一次 2026-06-16。
定位：把 SuperConsole 从 UE 里抽出来做成独立程序的重构版本，技术栈 Tauri v2 + React 19 + Rust。

结论先行：**架构分层是对的，最有价值的部分与 Tauri 完全无关；性能问题也不是 Tauri 的锅，
是一处具体的数据流设计。** 下面是依据。

---

## 1. 规模与分层

| 层 | 内容 | 规模 |
|---|---|---|
| 领域 crate | 13 个纯 Rust crate | 7,286 行 |
| Tauri 适配层 | `backend/src/*.rs`，83 个 `#[tauri::command]` | 3,797 行 |
| 前端包 | console / settings / shell / ui / notifications / naming | 19,956 行 |
| 合计 | | ≈ 31,000 行 |

领域 crate 清单：

```
limxdesk-fixture-types      541    limxdesk-programmer   1036
limxdesk-fixture-selection  137    limxdesk-sequence     1068
limxdesk-patch              591    limxdesk-cue           386
limxdesk-gdtf              1234    limxdesk-playback      431
limxdesk-dmx                528    limxdesk-showfile      677
limxdesk-artnet             175    limxdesk-network       291
limxdesk-platform           191
```

---

## 2. 最有价值的资产：13 个 crate 零 Tauri 依赖

逐个查过 `Cargo.toml`，**没有一个领域 crate 依赖 tauri**：

```
limxdesk-artnet             tauri 依赖 0
limxdesk-cue                tauri 依赖 0
limxdesk-dmx                tauri 依赖 0
limxdesk-fixture-selection  tauri 依赖 0
limxdesk-fixture-types      tauri 依赖 0
limxdesk-gdtf               tauri 依赖 0
limxdesk-network            tauri 依赖 0
limxdesk-patch              tauri 依赖 0
limxdesk-platform           tauri 依赖 0
limxdesk-playback           tauri 依赖 0
limxdesk-programmer         tauri 依赖 0
limxdesk-sequence           tauri 依赖 0
limxdesk-showfile           tauri 依赖 0
```

Tauri 只出现在 `backend/src/` 那 3,797 行适配层里，职责就是「把命令暴露给前端、把事件发给前端」。

**这意味着 7,286 行的核心逻辑是可以整体搬走的** —— 换 UI 框架、编成 cdylib 给别的宿主调、
甚至做成命令行工具，都不需要改这些 crate。`Cargo.toml` 里 `crate-type = ["lib", "cdylib", "staticlib"]`
说明这条路当初就考虑过。

这是这个项目最值钱的东西，与「Tauri 行不行」是两件事。

---

## 3. LimxDesk 有、SuperConsole 没有的

### 3.1 命令行运行时 —— SuperConsole 最大的空缺

`packages/console/src/command/commandRuntime.ts`（703 行）是一套 MA 风格的命令行状态机：

```ts
DeskCommandMode   = idle | store | update | edit | delete | copy | move
                  | assign | select | on | off | stomp
DeskCommandTarget = fixture | group | preset | sequence | cue | executor
DeskCommandOperator = Thru | + | - | If | At | / | .
```

带对象短语（`objectPhrases`）、历史栈、以及 `scripts/test-command-runtime.mjs` 的回归测试。

对照：SuperConsole 侧完全没有命令行，`GetSelectionText()` 只是把选中灯具 ID 拼成一行字显示。
我在 SuperStage 的差距评估里把「命令行」列为**性价比最高的一项**，这里已经有一份可用的实现。

### 3.2 领域模型上的差异

| | LimxDesk | SuperConsole |
|---|---|---|
| 灯具身份 | `fixtureTypeId` 字符串 + 独立的 fixture-types crate | 直到最近才补上型号身份 |
| DMX 渲染 | 独立 crate，输入是纯数据（fixtures / types / outputValues） | 与 UE Actor、配接子系统耦合 |
| 通道来源标记 | 每通道记录 `DmxChannelSource`（none/default/sequence/effect/programmer） | 有分层但不逐通道回报来源 |
| GDTF | 独立 crate 1,234 行 | 在 SuperTools 里，与导入 UI 耦合 |

**逐通道来源标记**这一条值得注意 —— DMX 表里能一眼看出「这个通道现在是谁在压」，
排查串台时非常有用。SuperConsole 的分层信息在 `FinalValues` 里有但没往 UI 送。

---

## 4. 性能问题的实际所在

### 4.1 症状链路

以 DMX 表窗口为例（`workspace/DmxSheetView.tsx:127`）：

```ts
listen("output:sent", () => {
  clearWorkspaceRuntimeCache(["frames"]);
  void loadFrames();          // ← 一次完整 IPC 往返
});
```

后端的事件只是个**通知**（`events.rs` 里 `emit_show` 只发 `{id, name, path}`），
所以前端收到通知后要**把数据整份取回来**。取回的是：

```rust
pub struct DmxUniverseFrame {
    pub universe: u16,
    pub data: Vec<u8>,                    // 512 字节
    pub sources: Vec<DmxChannelSource>,   // 512 个枚举
}
```

`DmxChannelSource` 标了 `#[serde(rename_all = "camelCase")]`，序列化成**字符串**。

### 4.2 实测载荷

按一个域 512 通道、三分之一有值的典型情况算 JSON 大小：

```
单个域 JSON: 6011 字节
  其中 data   : 1367  （23%）
  其中 sources: 4611  （77%）

 4 个域 →   23.5 KB / 次
16 个域 →   93.9 KB / 次
64 个域 →  375.7 KB / 次
```

**77% 的载荷花在逐通道的来源字符串上。** 一个 `u8` 枚举被编码成 `"programmer"` 这样的文本，
每域 512 次。

而 `output:sent` 是**脏驱动**的（`output.rs:176` 的 worker：有变化就发，不做节流），
也就是说拧编码器的每一次变化都会触发一轮。

### 4.3 还有一次白做的计算

`request_output_send` 的 worker 线程里：

1. `send_current_output(...)` —— 渲染出所有域的帧，打包成 Art-Net 发出去
2. 发完 `emit_output_sent`
3. 前端收到，调 `output_render_dmx`
4. `render_current_dmx` **把刚才那份帧从头再渲染一遍**

而且每次渲染都要 `cache.fixtures.clone()` 和 `cache.fixture_types.clone()`
（`output.rs:239-240`）—— 整份配接表和所有灯具档案的深拷贝，每次渲染一次。

所以每拧一格编码器，实际发生的是：**渲染两遍 + 两次全量深拷贝 + 一次几十 KB 的 JSON 编解码 + React setState**。

### 4.4 这不是 Tauri 的锅

同一份代码里已经有做对的地方：

```ts
// ControlPanel.tsx:227、FixtureSheetWindow.tsx:290
listen<Programmer>("programmer:changed", (event) => { ... event.payload ... })
```

编程器状态是**随事件推过来**的，不用回头取。只有 DMX 帧走了「通知 + 回取」。

可做的改法，按收益排：

1. **`sources` 不要传字符串** —— 改成 `u8`，或者干脆和 `data` 交错成一个 `Vec<u8>`。
   单这一项就砍掉 77% 的载荷
2. **帧随事件推送，不要回取** —— 与 `programmer:changed` 一致，省掉一次往返和一次重复渲染
3. **走二进制通道** —— Tauri v2 有 `tauri::ipc::Response` 支持原始字节，
   512 字节的域直接按 `&[u8]` 过去，前端用 `Uint8Array` 收。彻底绕开 JSON
4. **只发变化的域** —— 大多数时候只有一两个域在动
5. **给 `output:sent` 加节流** —— UI 刷新 30Hz 足够，不必跟着每次值变化走

前三项做完，94 KB/次 大致能压到 1 KB/次 量级，且不再有第二次渲染。

### 4.5 Tauri 确实不适合的地方

上面那些是设计问题，改了就好。但有两条是框架层面的，值得单独记：

**没有固定速率的输出循环。** 当前的 worker 是「有变化才发」。真实控台的 Art-Net / sACN
需要**持续刷新**（常见 40Hz），很多接收端在若干秒收不到包就会超时归零。这条与 Tauri 无关
（Rust 侧起个定时线程即可），但目前的实现确实没有。

**UI 与输出的时基是分开的。** 控台的手感很大程度来自「推杆动 → 灯立刻动」的确定性延迟。
webview 的合成、React 的调度、IPC 的排队叠在一起，这个延迟是不可控且抖动的。
这一条无论怎么优化 IPC 都改善有限 —— 它是「把控台 UI 放进浏览器」的固有代价。

---

## 5. 几条可选的路

不替你做决定，只把选项和代价摆出来：

| 选项 | 要动什么 | 保住什么 |
|---|---|---|
| **修 Tauri 版** | 4.4 的五条改法 + 加固定速率输出线程 | 全部保住，工作量最小 |
| **换原生 UI 壳** | 重写 19,956 行前端；13 个 crate 原样保留 | 核心逻辑 + 命令行状态机（后者要从 TS 移植） |
| **把 crate 编回 UE** | 领域 crate 出 `cdylib`，SuperConsole 侧走 FFI | 复用 Rust 核心，但要处理 UE 与 Rust 的所有权/生命周期边界 |
| **只收割资产** | 把命令行状态机、逐通道来源标记、GDTF crate 的思路搬进 SuperConsole | 成本最低，但 LimxDesk 本身停在这里 |

从 SuperConsole 当前的状态看，**第四条的即时回报最高** —— 命令行是 SuperConsole 排第一的
空缺，而这里已经有一份带测试的实现可以照着搬。

---

## 6. 一句话总结

Tauri 版跑不快，主要不是因为 Tauri，是因为「后端只发通知、前端整份回取、
逐通道来源编码成字符串、并且同一份帧被渲染两遍」。这几条都能改。

真正与 Tauri 绑死的只有「UI 与输出时基分离、延迟不可控」这一条 ——
如果最终目标是做一台**手感确定**的控台，这一条迟早要面对；
如果目标是做一个**预演 / 编程工具**，它并不致命。

而无论走哪条路，那 13 个零 Tauri 依赖的领域 crate 都不会白写。
