"use client";

import { useEffect, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMedicineSearch } from "@/hooks/use-clinical";
import { dosageFormLabel } from "@/lib/dosage-forms";
import { cn } from "@/lib/utils";
import type { CatalogMedicine } from "@/services/clinical";

export const medicineLabel = (m: CatalogMedicine) => `${m.name} ${m.strength} · ${dosageFormLabel(m.dosageForm)}`;

interface MedicinePickerProps {
  /** The selected entry (kept by the parent, so it shows even when it isn't in the current results). */
  value: CatalogMedicine | null;
  onChange: (medicine: CatalogMedicine) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Extra action under the results, e.g. "Add medicine to catalogue". */
  footer?: (close: () => void) => React.ReactNode;
}

/**
 * Searchable picker for the shared medicine catalogue. Searches on the server
 * (name or generic name), 20 results per page with "Load more", so the whole
 * catalogue is reachable however large it grows.
 */
export function MedicinePicker({ value, onChange, disabled, placeholder = "Select medicine…", footer }: MedicinePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const search = useMedicineSearch(debounced, open);
  const items = search.data?.pages.flatMap((p) => p.items) ?? [];
  const total = search.data?.pages[0]?.total ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} disabled={disabled} className="w-full justify-between font-normal">
          <span className={cn("truncate", !value && "text-muted-foreground")}>{value ? medicineLabel(value) : placeholder}</span>
          <ChevronsUpDownIcon className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search name or generic name…" value={query} onValueChange={setQuery} />
          <CommandList>
            {search.isError ? (
              <p className="px-3 py-4 text-sm text-danger">Couldn&apos;t search the catalogue: {search.error.message}</p>
            ) : search.isLoading ? (
              <p className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground"><Loader2Icon className="h-4 w-4 animate-spin" /> Searching…</p>
            ) : (
              <CommandEmpty>No medicines match “{debounced}”.</CommandEmpty>
            )}
            {items.length > 0 && (
              <CommandGroup heading={`${total} match${total === 1 ? "" : "es"}`}>
                {items.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={m.id}
                    onSelect={() => {
                      onChange(m);
                      setOpen(false);
                    }}
                  >
                    <CheckIcon className={cn("h-4 w-4", value?.id === m.id ? "opacity-100" : "opacity-0")} />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{m.name} <span className="text-muted-foreground">{m.strength}</span></span>
                      <span className="truncate text-xs text-muted-foreground">{dosageFormLabel(m.dosageForm)} · {m.genericName}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          {search.hasNextPage && (
            <div className="border-t p-1">
              <Button type="button" variant="ghost" size="sm" className="w-full" disabled={search.isFetchingNextPage} onClick={() => search.fetchNextPage()}>
                {search.isFetchingNextPage ? "Loading…" : `Load more (${items.length} of ${total})`}
              </Button>
            </div>
          )}
          {footer && <div className="border-t p-1">{footer(() => setOpen(false))}</div>}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
