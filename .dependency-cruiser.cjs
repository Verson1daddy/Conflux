// 反向依赖守卫（M① S-1）：锁住分层方向，禁止下层/独立层反向依赖上层 app。
//   conmux-app ↛ conflux-app（两个 app 互不依赖）
//   packages/terminal-core ↛ 任一 app（共享包必须 agent/产品无关）
module.exports = {
  forbidden: [
    {
      name: "no-conmux-to-conflux",
      comment: "conmux-app 不得依赖 conflux-app（两个产品 app 解耦）。",
      severity: "error",
      // to 用 (^|/) 而非 ^：相对越级 import（../../conflux-app/...）会被 resolver
      // 记成未解析相对路径，^ 锚定会漏判（守卫自检实测）。
      from: { path: "(^|/)conmux-app/" },
      to: { path: "(^|/)conflux-app/" },
    },
    {
      name: "no-core-to-app",
      comment: "terminal-core 不得反向依赖任一 app（共享包保持 agent/产品无关）。",
      severity: "error",
      from: { path: "(^|/)packages/terminal-core/" },
      to: { path: "(^|/)(conflux-app|conmux-app)/" },
    },
  ],
  options: {
    tsConfig: { fileName: "conflux-app/tsconfig.json" },
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
  },
};
