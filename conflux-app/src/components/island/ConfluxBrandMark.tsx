// Conflux 品牌花瓣标记（暗图字形：5 瓣 + 青绿点 #4B8788）。
// 软件内自适应：花瓣体走 currentColor，自动继承所在表面的前景色 →
// 暗底渲浅、浅底渲深，始终与背景有对比、永远可见。无背景方块。
// （桌面/系统图标走 design/icon/conflux-mark.svg 的固定米白原色，另路不在此。）
const ACCENT = "#4B8788";

interface ConfluxBrandMarkProps {
  /** 历史保留：颜色已改为 currentColor 自适应，此值仅作 data 标记，不再切换资产。 */
  artwork?: "light" | "dark";
  className?: string;
  decorative?: boolean;
  label?: string;
}

export function ConfluxBrandMark({
  artwork = "light",
  className,
  decorative = true,
  label = "Conflux",
}: ConfluxBrandMarkProps) {
  const classes = ["conflux-brand-mark", className].filter(Boolean).join(" ");

  return (
    <svg
      className={classes}
      data-artwork={artwork}
      viewBox="0 0 120 120"
      xmlns="http://www.w3.org/2000/svg"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? "true" : undefined}
      aria-label={decorative ? undefined : label}
      focusable="false"
    >
      <path fill="currentColor" d="m61.8 32.4 0.1 10.3c0.2 7.2 4.2 9.3 7 12.8 2.3 2.8 3.2 3.8 6.8 3 4.1-1.1 11-2.6 11-10.1v-4.9c0-6.4-5.6-13.5-14.1-14h-8.1c-1.5 0-2.5 1.1-2.7 2.9z" />
      <path fill="currentColor" d="m33.2 43.4v4.2c0 1.8 1.3 3.3 3.4 3.2 7.2-0.2 10.1 0 13.7 2.8 3.4 2.9 5.4 5.6 12.6 5.8 2.3 0 4.7-0.1 4-1.6-2.8-3.5-6.8-5.5-7.9-13.6-0.4-5.1-0.4-11.1-1-12.7-0.6-1.2-1.6-2.1-2.9-2.1h-7.2c-7.6 0-14.4 6-14.7 14z" />
      <path fill="currentColor" d="m33.3 58.2 0.1 6.4c0.1 1.6 1.2 2.6 2.8 2.6 6.7 0.2 9.5-0.5 11.8-2 3.1-1.9 5.2-4.3 11-4.5-4.2-0.4-6.8-1.9-9-3.4-3.4-2.2-5.4-2.5-10.6-2.4-2.8 0-6-0.3-6.1 3.3z" />
      <path fill="currentColor" d="m33.1 74.4 0.1 2.2c0.4 6.6 6 13.3 14.1 14.4h7.8c2.2 0 3-1.5 3.1-3.1 0.5-6.4-0.1-12.6 3.5-17.9 2.4-3.9 5.4-5.3 3.7-6.7-7-1.4-10.9-0.8-14.4 2.3-4.4 4.2-8 4.5-14.9 5.3-1.7 0.2-3.1 1.5-3 3.5z" />
      <path fill="currentColor" d="m61.7 77.2v10.7c0 1.6 1.2 3.2 3.3 3.1h7.6c7 0 14-5.5 14.1-14.5v-7c-0.4-4.5-3.8-7.7-8.8-7.8-3.8 0-7.4 1.2-11.3 4.8-3.2 2.9-4.9 6.5-4.9 10.7z" />
      <path fill={ACCENT} d="m62.2 61c2.4 0.1 5.8 0 6.6-1.8 1.3 1.1 3.1 1.4 5 1.4-1.8 0.3-3.5 0.8-5.1 1.5-2.8-0.5-3.7-0.7-6.5-1.1z" />
    </svg>
  );
}
