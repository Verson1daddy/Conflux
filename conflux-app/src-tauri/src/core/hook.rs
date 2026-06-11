// ===== 控制面 / mux V1-core: Claude Code hook 事件源 =====
//
// X4 实机 smoke（2026-06-11）抓到 A.2 FAIL：真实 Claude Code 的权限请求是 TUI ANSI
// 重绘，行缓冲 parser 刮屏检测不到 → 控制面对真实 agent 权限态是瞎的。
//
// 修复：改走 agent 自带 hook 的**结构化**事件源（契约 §4.7：hook 优先于刮屏）。
// 本模块是该方案的**纯逻辑层**——解析 PreToolUse hook 的 stdin JSON（协议由
// `research/hook-spike-2026-06-11/HOOK_SPIKE_RESULT.md` 实测确认，claude 2.1.173），
// 映射为现有 `PermissionRequest`（kind=Permission 的 payload），随后由调用方喂
// AttentionQueue::ingest 上浮灵动岛。
//
// 职责边界：本模块**只做解析与语义映射**（纯函数，无 IO）。事件如何从 hook 子进程
// 传到 Conflux（IPC 形态）、spawn 时如何注入 hook settings、approve 闭环（复用 PTY
// 注入）均在命令/spawn 层，不在此。source_kind=Hook（通道 types.rs 已预留）。

use serde::{Deserialize, Serialize};

use crate::core::{InstanceId, PermissionRequest, PermissionStatus};

/// 默认权限超时（与 PermissionRequest 现状一致，附录 B3）。
const DEFAULT_PERMISSION_TIMEOUT_SECS: u32 = 120;

/// 随 app 落盘的 hook relay 脚本内容（实测裁决 = node relay，
/// research/hook-spike-2026-06-11）。读 claude 经 stdin 传来的 hook JSON，压成单行
/// append 到 `--out` 指定的 per-instance ndjson；不输出决策 → claude 走正常 permission
/// 流程（交互态弹终端权限框，Conflux approve 复用 PTY 注入 Y/N）。node 在 claude
/// 运行期必然存在（claude 本身是 node 应用）。
pub const HOOK_RELAY_JS: &str = r#"// conmux hook relay (provisioned by Conflux). Do not edit.
const fs = require('fs');
function argval(name){const i=process.argv.indexOf(name);return i>=0&&i+1<process.argv.length?process.argv[i+1]:null;}
const out = argval('--out');
let data='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',c=>data+=c);
process.stdin.on('end',()=>{
  if(!out){process.exit(0);}
  const line=data.replace(/[\r\n]+/g,' ').trim();
  try{fs.appendFileSync(out,line+'\n','utf8');}catch(_){}
  process.exit(0);
});
"#;

/// PreToolUse hook 的 stdin JSON 载荷（claude 2.1.173 实测协议）。
///
/// 仅声明本修复需要的字段；`#[serde(default)]` + 多余字段忽略，保证 claude 后续
/// 版本增删字段不致解析失败（系统边界容错）。未知工具/缺字段降级处理，不 panic。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct PreToolUseHookEvent {
    /// claude 自生成的会话 ID（与 conflux instance_id 不同源，仅记录用）。
    #[serde(default)]
    pub session_id: String,
    /// hook 事件名，正常恒为 "PreToolUse"。
    #[serde(default)]
    pub hook_event_name: String,
    /// 工具名（Bash / Edit / Write / Read / mcp__* 等）。
    #[serde(default)]
    pub tool_name: String,
    /// 工具参数（结构因工具而异），原样保留供摘要。
    #[serde(default)]
    pub tool_input: serde_json::Value,
    /// 工具调用唯一 ID（去重/关联用，claude 2.1.173 提供）。
    #[serde(default)]
    pub tool_use_id: String,
    /// 当前权限模式（default/plan/bypassPermissions 等）。
    #[serde(default)]
    pub permission_mode: String,
    /// cwd（仅展示，绝不作 open/exec 入参，控制面 §13.8）。
    #[serde(default)]
    pub cwd: String,
}

impl PreToolUseHookEvent {
    /// 从 hook 子进程的 stdin JSON 解析。容错：多余字段忽略、缺字段取默认。
    pub fn parse(stdin_json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(stdin_json)
    }

    /// 是否为有效的 PreToolUse 事件（事件名匹配 + 有工具名）。
    /// 其它 hook 事件（Stop/Notification 等）走本通道时据此过滤。
    pub fn is_pre_tool_use(&self) -> bool {
        self.hook_event_name == "PreToolUse" && !self.tool_name.is_empty()
    }

    /// 是否为 PermissionRequest 事件——**语义正确的"需用户批准"信号**
    /// （只在 claude 真要弹权限框时触发，不像 PreToolUse 对所有工具触发）。
    /// 对照实测见 research/hook-spike-2026-06-11/HOOK_SPIKE_RESULT.md「关键语义发现」。
    pub fn is_permission_request(&self) -> bool {
        self.hook_event_name == "PermissionRequest"
    }

    /// 是否为应上浮为"待用户批准"的信号。当前 = PermissionRequest（语义精确）。
    /// PreToolUse **不**计入（对只读工具也触发，会误报）。
    pub fn is_approval_signal(&self) -> bool {
        self.is_permission_request() && self.requires_user_approval()
    }

    /// `bypassPermissions` 模式下 agent 不会要人批准（= 启动预设"免权限"），
    /// 此时 PreToolUse 仍触发但**不应**上浮为待批准项（否则灵动岛假报）。
    pub fn requires_user_approval(&self) -> bool {
        self.permission_mode != "bypassPermissions"
    }

    /// 人读的操作摘要：`tool_name` + 关键参数（Bash→command，Write/Edit→file_path）。
    /// 用于 PermissionRequest.description / AttentionItem.payload_summary。
    pub fn action_summary(&self) -> String {
        let detail = match self.tool_name.as_str() {
            "Bash" => self.tool_input.get("command").and_then(|v| v.as_str()),
            "Write" | "Edit" | "Read" | "NotebookEdit" => self
                .tool_input
                .get("file_path")
                .and_then(|v| v.as_str()),
            _ => self
                .tool_input
                .get("description")
                .and_then(|v| v.as_str()),
        };
        match detail {
            Some(d) if !d.is_empty() => format!("{}: {}", self.tool_name, truncate(d, 160)),
            _ => self.tool_name.clone(),
        }
    }

    /// 映射为现有 `PermissionRequest`（kind=Permission 的 payload）。
    ///
    /// `instance_id` 由调用方（按 hook settings 注入的 conflux instance_id）传入——
    /// **不**用 claude 自生成的 session_id，避免跨源对账（见修复架构 instance 关联）。
    /// `id` = `tool_use_id`（claude 提供的稳定工具调用 ID，天然去重键）；缺失时回退
    /// 由调用方补 uuid（此处仅透传，空则保持空让上层处理）。
    pub fn to_permission_request(&self, instance_id: &str, created_at: i64) -> PermissionRequest {
        PermissionRequest {
            id: self.tool_use_id.clone(),
            instance_id: InstanceId(instance_id.to_string()),
            action: self.tool_name.clone(),
            description: self.action_summary(),
            // raw_context：hook 源不刮 PTY，留空（与刮屏源区分；上层可选补终端尾行）。
            raw_context: Vec::new(),
            status: PermissionStatus::Pending,
            created_at,
            timeout_seconds: DEFAULT_PERMISSION_TIMEOUT_SECS,
        }
    }
}

/// 构建注入给 claude `--settings` 的内联 JSON 串：配置 PreToolUse hook，命令为
/// `node "<relay_js>" --out "<hook_out>"`（relay 见 research/hook-spike：把 stdin
/// JSON 单行 append 到 per-instance 文件）。
///
/// 实测裁决（research/hook-spike-2026-06-11）：node relay 输出干净 ndjson；cmd/findstr
/// 一行被 claude 的 hook shell 包裹后混入 banner 污染、PowerShell relay 读不到 stdin，
/// 二者均弃用。node 在 claude 运行期必然存在（claude 本身是 node 应用）。
///
/// 用 serde_json 构建——路径里的反斜杠/引号由序列化自动转义，杜绝手写转义 bug。
/// matcher="" 匹配所有工具；hook 不输出决策 → claude 走正常 permission 流程（交互态弹
/// 终端权限框，Conflux approve 复用 PTY 注入）。
pub fn build_claude_hook_settings_arg(relay_js_path: &str, hook_out_path: &str) -> String {
    let command = format!("node \"{}\" --out \"{}\"", relay_js_path, hook_out_path);
    // 同一 command 同时挂 PreToolUse + PermissionRequest（JSON 里 hook_event_name 自带区分）：
    // PermissionRequest 是语义正确的"待批准"源（watcher 据此上浮）；PreToolUse 一并落盘
    // 仅供实机诊断 PermissionRequest 在交互模式是否触发（见 HOOK_SPIKE_RESULT.md）。
    let handler = serde_json::json!([{
        "matcher": "",
        "hooks": [{ "type": "command", "command": command }]
    }]);
    let settings = serde_json::json!({
        "hooks": {
            "PreToolUse": handler,
            "PermissionRequest": handler
        }
    });
    serde_json::to_string(&settings).expect("hook settings 序列化不应失败")
}

/// 解析累积的 hook ndjson（每行一条 hook JSON），跳过空行/坏行，保留所有带工具名的
/// PreToolUse / PermissionRequest 事件（由调用方按 `is_approval_signal` 等再筛）。
pub fn parse_hook_ndjson(content: &str) -> Vec<PreToolUseHookEvent> {
    content
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .filter_map(|l| PreToolUseHookEvent::parse(l).ok())
        .filter(|e| e.is_pre_tool_use() || e.is_permission_request())
        .collect()
}

/// 截断到 max 字符（按 char 边界，避免切碎多字节）。
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let cut: String = s.chars().take(max).collect();
        format!("{cut}…")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// spike 实测的真实 stdin（claude 2.1.173，逐字节取自 captured-pretooluse.json）。
    const REAL_CAPTURED: &str = r#"{"session_id":"f0949ace-062e-4970-97e8-3163989c9f14","transcript_path":"C:\\Users\\zwm\\.claude\\projects\\x\\s.jsonl","cwd":"D:\\Trae_rela_pro\\Conflux","permission_mode":"default","effort":{"level":"xhigh"},"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo conmux-hook-spike","description":"Echo test string"},"tool_use_id":"toolu_011kWLKxKRnSStNWAMcnDcoo"}"#;

    #[test]
    fn parses_real_captured_pretooluse_payload() {
        // 用真实 spike 落盘的协议——这是对"测试喂干净行 vs 真实形态"那道缝的直接弥合。
        let ev = PreToolUseHookEvent::parse(REAL_CAPTURED).expect("真实 PreToolUse 应解析成功");
        assert_eq!(ev.tool_name, "Bash");
        assert_eq!(ev.tool_use_id, "toolu_011kWLKxKRnSStNWAMcnDcoo");
        assert_eq!(ev.permission_mode, "default");
        assert!(ev.is_pre_tool_use());
        assert!(ev.requires_user_approval());
        assert_eq!(
            ev.tool_input.get("command").and_then(|v| v.as_str()),
            Some("echo conmux-hook-spike")
        );
    }

    #[test]
    fn tolerates_unknown_and_missing_fields() {
        // claude 后续版本增删字段不应炸（系统边界容错）。
        let ev = PreToolUseHookEvent::parse(
            r#"{"hook_event_name":"PreToolUse","tool_name":"Read","tool_input":{"file_path":"a.rs"},"some_future_field":42}"#,
        )
        .expect("缺字段 + 多余字段应解析成功");
        assert_eq!(ev.tool_name, "Read");
        assert_eq!(ev.session_id, ""); // 缺字段取默认
        assert_eq!(ev.tool_use_id, "");
        assert!(ev.requires_user_approval()); // permission_mode 缺 → 非 bypass → 需批准
    }

    #[test]
    fn bash_summary_uses_command() {
        let ev = PreToolUseHookEvent::parse(REAL_CAPTURED).unwrap();
        assert_eq!(ev.action_summary(), "Bash: echo conmux-hook-spike");
    }

    #[test]
    fn write_summary_uses_file_path() {
        let ev = PreToolUseHookEvent::parse(
            r#"{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"src/main.rs","content":"..."}}"#,
        )
        .unwrap();
        assert_eq!(ev.action_summary(), "Write: src/main.rs");
    }

    #[test]
    fn unknown_tool_falls_back_to_tool_name_or_description() {
        let with_desc = PreToolUseHookEvent::parse(
            r#"{"hook_event_name":"PreToolUse","tool_name":"WebFetch","tool_input":{"description":"fetch docs"}}"#,
        )
        .unwrap();
        assert_eq!(with_desc.action_summary(), "WebFetch: fetch docs");

        let bare = PreToolUseHookEvent::parse(
            r#"{"hook_event_name":"PreToolUse","tool_name":"WeirdTool","tool_input":{}}"#,
        )
        .unwrap();
        assert_eq!(bare.action_summary(), "WeirdTool");
    }

    #[test]
    fn bypass_permissions_does_not_require_approval() {
        // 免权限模式（启动预设"--dangerously-skip-permissions"）：PreToolUse 仍触发，
        // 但不应上浮待批准项（避免灵动岛假报"在等批准"）。
        let ev = PreToolUseHookEvent::parse(
            r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls"},"permission_mode":"bypassPermissions"}"#,
        )
        .unwrap();
        assert!(ev.is_pre_tool_use());
        assert!(!ev.requires_user_approval());
    }

    #[test]
    fn non_pretooluse_event_is_filtered() {
        let stop = PreToolUseHookEvent::parse(
            r#"{"hook_event_name":"Stop","tool_name":""}"#,
        )
        .unwrap();
        assert!(!stop.is_pre_tool_use());
    }

    #[test]
    fn maps_to_permission_request_with_conflux_instance_id() {
        let ev = PreToolUseHookEvent::parse(REAL_CAPTURED).unwrap();
        // 关键：用 conflux 传入的 instance_id，不用 claude 的 session_id。
        let req = ev.to_permission_request("conflux-inst-7", 1_700_000_000_000);
        assert_eq!(req.instance_id.0, "conflux-inst-7");
        assert_eq!(req.id, "toolu_011kWLKxKRnSStNWAMcnDcoo"); // tool_use_id 作去重键
        assert_eq!(req.action, "Bash");
        assert_eq!(req.description, "Bash: echo conmux-hook-spike");
        assert!(matches!(req.status, PermissionStatus::Pending));
        assert_eq!(req.timeout_seconds, 120);
        assert!(req.raw_context.is_empty()); // hook 源不刮 PTY
    }

    #[test]
    fn truncates_overlong_command_summary() {
        let long_cmd = "x".repeat(300);
        let json = format!(
            r#"{{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{{"command":"{long_cmd}"}}}}"#
        );
        let ev = PreToolUseHookEvent::parse(&json).unwrap();
        let summary = ev.action_summary();
        assert!(summary.starts_with("Bash: "));
        assert!(summary.ends_with('…'));
        assert!(summary.chars().count() <= "Bash: ".chars().count() + 161);
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(PreToolUseHookEvent::parse("not json").is_err());
        assert!(PreToolUseHookEvent::parse("").is_err());
    }

    #[test]
    fn hook_settings_arg_configures_both_hooks_with_node_relay() {
        let arg =
            build_claude_hook_settings_arg(r"C:\app\hook-relay.js", r"C:\app\hooks\inst-1.ndjson");
        // 必须是合法 JSON（claude 会解析它）
        let v: serde_json::Value = serde_json::from_str(&arg).expect("settings 应为合法 JSON");
        // PreToolUse 与 PermissionRequest 两个 hook 都配上，指向同一 relay command
        for event in ["PreToolUse", "PermissionRequest"] {
            let cmd = v["hooks"][event][0]["hooks"][0]["command"]
                .as_str()
                .unwrap_or_else(|| panic!("{event} command 字段应存在"));
            assert!(cmd.contains(r"C:\app\hook-relay.js"), "{event} 含 relay 路径");
            assert!(cmd.contains(r"C:\app\hooks\inst-1.ndjson"), "{event} 含 out 路径");
            assert!(cmd.starts_with("node "));
            assert!(cmd.contains("--out"));
            assert_eq!(v["hooks"][event][0]["matcher"].as_str(), Some(""));
        }
    }

    #[test]
    fn parse_ndjson_keeps_pretooluse_and_permreq_skips_blank_malformed() {
        // 模拟真实 relay 落盘：PreToolUse + PermissionRequest + 空行 + 坏行 + 非 hook(Stop)。
        let content = concat!(
            r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo one"},"tool_use_id":"t1"}"#,
            "\n\n",
            "garbage not json\n",
            r#"{"hook_event_name":"Stop","tool_name":""}"#,
            "\n",
            r#"{"hook_event_name":"PermissionRequest","tool_name":"Write","tool_input":{"file_path":"a.rs"},"tool_use_id":"t2"}"#,
            "\n"
        );
        let events = parse_hook_ndjson(content);
        assert_eq!(events.len(), 2, "保留 PreToolUse + PermissionRequest");
        assert!(events[0].is_pre_tool_use());
        assert!(events[1].is_permission_request());
        assert!(events[1].is_approval_signal(), "PermissionRequest 是批准信号");
        assert!(!events[0].is_approval_signal(), "PreToolUse 不是批准信号");
    }

    #[test]
    fn parse_ndjson_empty_content_yields_nothing() {
        assert!(parse_hook_ndjson("").is_empty());
        assert!(parse_hook_ndjson("\n\n  \n").is_empty());
    }

    #[test]
    fn permission_request_in_bypass_mode_is_not_approval_signal() {
        let ev = PreToolUseHookEvent::parse(
            r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"ls"},"permission_mode":"bypassPermissions"}"#,
        )
        .unwrap();
        assert!(ev.is_permission_request());
        assert!(!ev.is_approval_signal(), "bypass 模式不上浮待批准");
    }
}
