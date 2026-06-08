import iconDark from "@/assets/brand/icon-dark.svg";
import iconLight from "@/assets/brand/icon-light.svg";

interface ConfluxBrandMarkProps {
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
  const src = artwork === "dark" ? iconDark : iconLight;
  const classes = ["conflux-brand-mark", className].filter(Boolean).join(" ");

  return (
    <img
      src={src}
      className={classes}
      data-artwork={artwork}
      alt={decorative ? "" : label}
      aria-hidden={decorative ? "true" : undefined}
      draggable={false}
    />
  );
}
