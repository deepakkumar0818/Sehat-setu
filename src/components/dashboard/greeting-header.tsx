import { DEMO_NOW } from "@/lib/demo-clock";

function timeOfDayGreeting(): string {
  const hour = DEMO_NOW.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** `greeting` overrides the demo-clock greeting (the live dashboard passes one computed from real IST time). */
export function GreetingHeader({ name, subtitle, greeting }: { name: string; subtitle: string; greeting?: string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        {greeting ?? timeOfDayGreeting()}, {name} 👋
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}
