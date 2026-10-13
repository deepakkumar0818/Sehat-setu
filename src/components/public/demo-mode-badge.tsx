const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";

/** Small, deliberately unobtrusive indicator that every doctor, clinic, and stat on this site is fictional demo data. */
export function DemoModeBadge() {
  if (!DEMO_MODE) return null;

  return (
    <div className="fixed bottom-3 left-3 z-30 hidden rounded-full border bg-background/90 px-2.5 py-1 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur sm:block">
      Demo Mode — all data is fictional
    </div>
  );
}
