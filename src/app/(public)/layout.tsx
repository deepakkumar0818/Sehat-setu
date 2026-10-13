import { PublicHeader } from "@/components/public/public-header";
import { PublicFooter } from "@/components/public/public-footer";
import { PublicAiWidget } from "@/components/public/public-ai-widget";
import { DemoModeBadge } from "@/components/public/demo-mode-badge";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <PublicHeader />
      <main className="flex-1">{children}</main>
      <PublicFooter />
      <PublicAiWidget />
      <DemoModeBadge />
    </div>
  );
}
