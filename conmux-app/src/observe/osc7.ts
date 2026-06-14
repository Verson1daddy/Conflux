// ===== OSC 7 cwd 解析（M3-ext F1 契约 §1 / §2）=====
//
// OSC 7 = 终端「当前工作目录」上报序列，shell（含 PowerShell prompt hook）与部分
// agent 都可能发。形态：
//   ESC ] 7 ; file://<host>/<path> <ST>
// 其中 <ST>（string terminator）= ESC \（`\x1b\x5c`）或 BEL（`\x07`）。
//
// 诚实：只有真在输出流里收到 OSC7 才更新 cwd；收不到 = 维持上次 / null（→ UI 显 `—`）。
// 不猜、不编路径。
//
// 实现按「流式分块」设计：调用方累积 recentRaw 缓冲，本函数对当前缓冲做全扫，
// 返回最后一个完整 OSC7 的 cwd（最新者优先）。不完整（无 ST）的尾段不解析，
// 由调用方保留缓冲等下一块补齐。

const ESC = "\x1b";
const BEL = "\x07";

// 匹配 ESC ] 7 ; <payload> <ST>，ST = ESC\ 或 BEL。
// 用非贪婪 payload + 两种终止符；全局扫描取最后一个完整匹配。
const OSC7_RE = new RegExp(
  `${ESC}\\]7;([^${ESC}${BEL}]*)(?:${ESC}\\\\|${BEL})`,
  "g"
);

/**
 * 从原始输出缓冲解析最新的 OSC7 cwd。
 * @returns 解析到 → 绝对路径（已 percent-decode、去 file://host 前缀）；无完整 OSC7 → null。
 */
export function parseOsc7Cwd(rawBuffer: string): string | null {
  let lastPayload: string | null = null;
  OSC7_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OSC7_RE.exec(rawBuffer)) !== null) {
    lastPayload = m[1];
  }
  if (lastPayload === null) return null;
  return payloadToPath(lastPayload);
}

/**
 * file://<host>/<path> → 本地路径（诚实解析，不规整化推测）。
 * 解析失败（非预期形态）→ null（不编）。
 */
function payloadToPath(payload: string): string | null {
  // 形态 1：file://host/path（标准 OSC7）。
  if (payload.startsWith("file://")) {
    const afterScheme = payload.slice("file://".length);
    // host 到第一个 '/' 为止；其后为路径。host 可能为空（file:///path）。
    const slashIdx = afterScheme.indexOf("/");
    if (slashIdx < 0) return null;
    let path = afterScheme.slice(slashIdx); // 含前导 '/'
    path = safeDecode(path);
    // Windows OSC7 常作 file:///C:/Users/... → 去掉前导 '/' 还原盘符路径。
    if (/^\/[A-Za-z]:\//.test(path)) {
      path = path.slice(1);
    }
    return path || null;
  }
  // 形态 2：无 scheme，部分 shell 直接发裸路径（容错，仍要求像路径）。
  if (payload.startsWith("/") || /^[A-Za-z]:[\\/]/.test(payload)) {
    return safeDecode(payload) || null;
  }
  // 其它 → 不认识，诚实返回 null（不猜）。
  return null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    // percent 序列损坏 → 原样返回（诚实：至少是真收到的字节，不再加工）。
    return s;
  }
}
