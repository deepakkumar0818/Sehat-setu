"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarPlusIcon,
  LayoutDashboardIcon,
  SparklesIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useUiStore } from "@/store/ui-store";
import { useGlobalSearch } from "@/hooks/use-search";
import { useCurrentUser } from "@/hooks/use-current-user";

export function CommandPalette() {
  const router = useRouter();
  const user = useCurrentUser();
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const setPendingAiQuestion = useUiStore((s) => s.setPendingAiQuestion);
  const [query, setQuery] = useState("");
  const { data: results } = useGlobalSearch(query);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, setOpen]);

  const go = (href: string) => {
    router.push(href);
    setOpen(false);
    setQuery("");
  };

  const askAi = () => {
    setPendingAiQuestion(query);
    const aiHref = user?.role === "patient" ? "/portal/ai-assistant" : "/ai-assistant";
    go(aiHref);
  };

  const hasResults = results && Object.values(results).some((list) => list.length > 0);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search Sehat Setu" description="Search patients, appointments, reports, or ask Sehat AI">
      <CommandInput placeholder="Search patients, appointments, reports… or ask a question" value={query} onValueChange={setQuery} />
      <CommandList>
        {query.trim().length > 1 && !hasResults && <CommandEmpty>No results found.</CommandEmpty>}

        {!query.trim() && (
          <CommandGroup heading="Quick actions">
            <CommandItem onSelect={() => go("/dashboard")}>
              <LayoutDashboardIcon /> Go to dashboard
            </CommandItem>
            <CommandItem onSelect={() => go("/patients?new=1")}>
              <UserPlusIcon /> Add new patient
            </CommandItem>
            <CommandItem onSelect={() => go("/appointments?new=1")}>
              <CalendarPlusIcon /> Book new appointment
            </CommandItem>
          </CommandGroup>
        )}

        {query.trim().length > 1 && (
          <>
            {results?.patients && results.patients.length > 0 && (
              <CommandGroup heading="Patients">
                {results.patients.map((r) => (
                  <CommandItem key={r.id} onSelect={() => go(r.href)}>
                    <UsersIcon /> {r.title} <span className="ml-auto text-xs text-muted-foreground">{r.subtitle}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results?.doctors && results.doctors.length > 0 && (
              <CommandGroup heading="Doctors">
                {results.doctors.map((r) => (
                  <CommandItem key={r.id} onSelect={() => go(r.href)}>
                    {r.title} <span className="ml-auto text-xs text-muted-foreground">{r.subtitle}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results?.appointments && results.appointments.length > 0 && (
              <CommandGroup heading="Appointments">
                {results.appointments.map((r) => (
                  <CommandItem key={r.id} onSelect={() => go(r.href)}>
                    {r.title} <span className="ml-auto text-xs text-muted-foreground">{r.subtitle}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results?.prescriptions && results.prescriptions.length > 0 && (
              <CommandGroup heading="Prescriptions">
                {results.prescriptions.map((r) => (
                  <CommandItem key={r.id} onSelect={() => go(r.href)}>
                    {r.title} <span className="ml-auto text-xs text-muted-foreground">{r.subtitle}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results?.reports && results.reports.length > 0 && (
              <CommandGroup heading="Reports">
                {results.reports.map((r) => (
                  <CommandItem key={r.id} onSelect={() => go(r.href)}>
                    {r.title} <span className="ml-auto text-xs text-muted-foreground">{r.subtitle}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results?.invoices && results.invoices.length > 0 && (
              <CommandGroup heading="Invoices">
                {results.invoices.map((r) => (
                  <CommandItem key={r.id} onSelect={() => go(r.href)}>
                    {r.title} <span className="ml-auto text-xs text-muted-foreground">{r.subtitle}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandSeparator />
            <CommandGroup heading="Ask Sehat AI">
              <CommandItem onSelect={askAi}>
                <SparklesIcon className="text-ai" /> Ask &ldquo;{query}&rdquo;
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
