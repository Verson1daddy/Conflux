// ===== conmux 启动项注册表（M⑤b F1 契约 §2）=====
//
// 用户可注册的「快捷启动目标」：每项 = 一条真能跑的命令（program + args），由 Home
// 的 QUICK LAUNCH chips 一键起为新会话（D-1：注册命令 parse→program+args→create_session
// 当 ConPTY 启动程序，非 stdin 注入）。
//
// 持久化 localStorage（key `conmux.launchEntries`），store + subscribe（useSyncExternalStore）。
// 首次无存储时写入内置种子（用户可改可删）：Shell（powershell.exe）· WSL（wsl）。
//
// 诚实（§2）：注册表是真能跑的启动目标，不放无法执行的占位。命令解析走简单 shell-word
// split（空格 + 双引号），不支持管道 / 重定向 / 变量展开（D-5，超范围按字面 program）。

/** 单条启动项（注册表的值）。 */
export interface LaunchEntry {
  /** 稳定 id（chip 的 data-entry-id；UI 侧生成，时间戳 + 随机后缀）。 */
  id: string;
  /** 显示名（chip 文字 + 会话 launchName，e.g. "WSL" / "claude"）。 */
  name: string;
  /** 启动命令原文（含 args，e.g. "wsl -d Ubuntu" / "claude --resume"）。 */
  command: string;
  /** 工作目录（可选；None = 继承当前目录）。 */
  cwd?: string;
}

const STORAGE_KEY = "conmux.launchEntries";

/** 内置种子（首次无存储时写入；用户可改可删）。 */
const SEED_ENTRIES: LaunchEntry[] = [
  { id: "seed-shell", name: "Shell", command: "powershell.exe" },
  { id: "seed-wsl", name: "WSL", command: "wsl" },
];

let entries: LaunchEntry[] = loadEntries();
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

/** 从 localStorage 读注册表；空 / 损坏 / 不可用 → 写入种子并返回。 */
function loadEntries(): LaunchEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(isLaunchEntry);
        // 解析成功（即便用户删空成 [] 也尊重——不复活种子）。
        return valid;
      }
    }
  } catch {
    /* 损坏 / 私密模式 —— 回退种子 */
  }
  // 首次无存储 / 损坏：写入种子（持久化一次，使后续可改可删）。
  const seed = SEED_ENTRIES.map((e) => ({ ...e }));
  persist(seed);
  return seed;
}

/** 运行时类型守卫（拒绝损坏条目）。 */
function isLaunchEntry(v: unknown): v is LaunchEntry {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.command === "string" &&
    (o.cwd === undefined || typeof o.cwd === "string")
  );
}

function persist(list: LaunchEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* 私密模式等 —— 内存态仍有效 */
  }
}

// ===== useSyncExternalStore 接口 =====

export function subscribeLaunchEntries(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getLaunchEntries(): LaunchEntry[] {
  return entries;
}

// ===== CRUD =====

/** 生成新条目 id（运行时 app 侧，Date.now + 随机后缀避碰撞；非脚本环境，时间戳可用）。 */
function genId(): string {
  return `le-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 新增启动项（name+command 必填，cwd 可选）。返回新建条目。 */
export function addEntry(input: {
  name: string;
  command: string;
  cwd?: string;
}): LaunchEntry {
  const entry: LaunchEntry = {
    id: genId(),
    name: input.name,
    command: input.command,
    ...(input.cwd ? { cwd: input.cwd } : {}),
  };
  entries = [...entries, entry];
  persist(entries);
  notify();
  return entry;
}

/** 更新启动项（按 id 局部覆盖 name/command/cwd）。无该 id 则忽略。 */
export function updateEntry(
  id: string,
  patch: { name?: string; command?: string; cwd?: string }
): void {
  let changed = false;
  entries = entries.map((e) => {
    if (e.id !== id) return e;
    changed = true;
    const next: LaunchEntry = { ...e };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.command !== undefined) next.command = patch.command;
    if (patch.cwd !== undefined) {
      if (patch.cwd === "") delete next.cwd;
      else next.cwd = patch.cwd;
    }
    return next;
  });
  if (changed) {
    persist(entries);
    notify();
  }
}

/** 删除启动项（按 id）。无该 id 则忽略。 */
export function removeEntry(id: string): void {
  const next = entries.filter((e) => e.id !== id);
  if (next.length === entries.length) return;
  entries = next;
  persist(entries);
  notify();
}

// ===== 命令解析（D-5 简单 shell-word split）=====

/**
 * 解析命令行为 `{program, args}`：空格分隔，支持双引号包裹含空格段（引号本身剥除）。
 * 不支持管道 / 重定向 / 变量展开 / 单引号 / 转义（超范围按字面）。
 *   - `program` = 首词（无则空串——调用方应已校验 command 非空）。
 *   - `args` = 其余词。
 *
 * 例：`wsl -d Ubuntu` → {program:"wsl", args:["-d","Ubuntu"]}；
 *     `"C:\\Program Files\\x.exe" --flag` → {program:'C:\\Program Files\\x.exe', args:["--flag"]}。
 */
export function parseCommand(command: string): { program: string; args: string[] } {
  const tokens: string[] = [];
  let cur = "";
  let inQuote = false;
  let hasCur = false; // 标记是否已开始累积一个 token（区分空 token 与未开始）。

  for (const ch of command) {
    if (ch === '"') {
      inQuote = !inQuote;
      hasCur = true; // 引号即开始一个 token（即便内容空，如 ""）。
      continue;
    }
    if (!inQuote && (ch === " " || ch === "\t")) {
      if (hasCur) {
        tokens.push(cur);
        cur = "";
        hasCur = false;
      }
      continue;
    }
    cur += ch;
    hasCur = true;
  }
  if (hasCur) tokens.push(cur);

  const program = tokens.length > 0 ? tokens[0] : "";
  const args = tokens.slice(1);
  return { program, args };
}
