"use client";

import { useId, useMemo, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface TagInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
}

// Suggestions are an in-app list (not a native <datalist>, whose popup the
// browser draws in its own dark style and which can't be themed): filtered as
// the user types, picked with a click or the arrow keys + Enter.
export function TagInput({ value, onChange, placeholder = "Type and press Enter...", suggestions }: TagInputProps) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    return (suggestions ?? []).filter((s) => !value.includes(s) && (!q || s.toLowerCase().includes(q)));
  }, [suggestions, value, draft]);
  const showList = open && matches.length > 0;

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !value.includes(trimmed)) onChange([...value, trimmed]);
    setDraft("");
    setActive(-1);
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 pr-1">
              {tag}
              <button type="button" onClick={() => onChange(value.filter((t) => t !== tag))} className="rounded-full p-0.5 hover:bg-muted-foreground/20" aria-label={`Remove ${tag}`}>
                <XIcon className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="relative">
        <Input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && matches.length) {
              e.preventDefault();
              setOpen(true);
              setActive((i) => (i + 1) % matches.length);
            } else if (e.key === "ArrowUp" && matches.length) {
              e.preventDefault();
              setActive((i) => (i <= 0 ? matches.length - 1 : i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              addTag(showList && active >= 0 ? matches[active] : draft);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          role={suggestions ? "combobox" : undefined}
          aria-expanded={suggestions ? showList : undefined}
          aria-controls={suggestions ? listId : undefined}
          aria-autocomplete={suggestions ? "list" : undefined}
          placeholder={placeholder}
        />
        {showList && (
          <ul
            id={listId}
            role="listbox"
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {matches.map((s, i) => (
              <li
                key={s}
                role="option"
                aria-selected={i === active}
                // mousedown + preventDefault: pick before the input's blur closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  addTag(s);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-sm",
                  i === active ? "bg-accent text-accent-foreground" : "text-foreground"
                )}
              >
                {s}
                {i === active && <PlusIcon className="h-3.5 w-3.5 text-muted-foreground" />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
