import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

interface PersonAvatarProps {
  name: string;
  color: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<PersonAvatarProps["size"]>, string> = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-xs",
  lg: "h-12 w-12 text-sm",
  xl: "h-16 w-16 text-base",
};

export function PersonAvatar({ name, color, size = "md", className }: PersonAvatarProps) {
  return (
    <Avatar className={cn(SIZE_CLASSES[size], className)}>
      <AvatarFallback style={{ backgroundColor: `${color}1a`, color }} className="font-semibold">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
