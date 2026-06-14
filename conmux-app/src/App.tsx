import { XtermTerminal } from "@conmux/terminal-core";

// Milestone ① 最小验证：在新 app 里渲染 terminal-core 的 XtermTerminal（demo 模式，
// 不订阅 PTY、不接 daemon）——证明共享终端切片可被 conmux-app 消费、可渲染。
// 真实会感知壳（缩点条 / 运行信息 / 命令面板）见后续里程碑。
export default function App() {
  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        background: "#F6F1E7",
        padding: 16,
        boxSizing: "border-box",
      }}
    >
      <XtermTerminal
        instanceId="demo"
        content={
          "conmux · terminal-core demo\r\n" +
          "$ echo hello from @conmux/terminal-core\r\n" +
          "hello from @conmux/terminal-core\r\n"
        }
        interactive={false}
        subscribeToPty={false}
      />
    </div>
  );
}
