import { HeartHandshakeIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
  className?: string;
  dark?: boolean;
}

const MARK_SIZES = { sm: "h-7 w-7", md: "h-9 w-9", lg: "h-12 w-12" };
const ICON_SIZES = { sm: "h-4 w-4", md: "h-5 w-5", lg: "h-6 w-6" };
const TEXT_SIZES = { sm: "text-sm", md: "text-base", lg: "text-xl" };

export function Logo({ size = "md", showWordmark = true, className, dark }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className={cn("flex shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground", MARK_SIZES[size])}>
        <HeartHandshakeIcon className={ICON_SIZES[size]} strokeWidth={2.25} />
      </div>
      {showWordmark && (
        <span className={cn("font-semibold tracking-tight", TEXT_SIZES[size], dark ? "text-white" : "text-foreground")}>
          Sehat Setu
        </span>
      )}
    </div>
  );
}
