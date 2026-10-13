"use client";

import { useState } from "react";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDataStore } from "@/store/data-store";
import { useLiveData } from "@/lib/data-source";
import { usePatient, usePatients } from "@/hooks/use-patients";
import { cn } from "@/lib/utils";

interface PatientComboboxProps {
  value: string | undefined;
  onChange: (patientId: string) => void;
  disabled?: boolean;
}

export function PatientCombobox({ value, onChange, disabled }: PatientComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const live = useLiveData();
  const mockPatients = useDataStore((s) => s.db.patients);
  // Live: search the database (server-side, permission-scoped) instead of loading every patient.
  const { data: livePage } = usePatients({ search: query, status: "active", pageSize: 20 });
  const { data: liveSelected } = usePatient(live && value ? value : undefined);
  const patients = live ? (livePage?.items ?? []) : mockPatients;
  const selected = live ? liveSelected : patients.find((p) => p.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          {selected ? `${selected.name} (${selected.patientNumber ?? selected.id})` : "Select patient..."}
          <ChevronsUpDownIcon className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command shouldFilter={!live}>
          <CommandInput placeholder="Search patients..." value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No patients found.</CommandEmpty>
            <CommandGroup>
              {patients.slice(0, 200).map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.name} ${p.id} ${p.phone}`}
                  onSelect={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                >
                  <CheckIcon className={cn("h-4 w-4", value === p.id ? "opacity-100" : "opacity-0")} />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{p.patientNumber ?? p.id} · {p.phone}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
