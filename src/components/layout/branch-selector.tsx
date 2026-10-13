"use client";

import { BuildingIcon, CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useBranches } from "@/hooks/use-branches";
import { useUiStore } from "@/store/ui-store";

export function BranchSelector() {
  const branches = useBranches();
  const activeBranchId = useUiStore((s) => s.activeBranchId);
  const setActiveBranchId = useUiStore((s) => s.setActiveBranchId);
  const active = branches.find((b) => b.id === activeBranchId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="hidden gap-1.5 sm:flex">
          <BuildingIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="max-w-32 truncate">{active ? active.name : "All branches"}</span>
          <ChevronsUpDownIcon className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={() => setActiveBranchId(null)}>
          {!activeBranchId && <CheckIcon className="h-3.5 w-3.5" />}
          <span className={!activeBranchId ? "" : "ml-[22px]"}>All branches</span>
        </DropdownMenuItem>
        {branches.map((branch) => (
          <DropdownMenuItem key={branch.id} onClick={() => setActiveBranchId(branch.id)}>
            {activeBranchId === branch.id && <CheckIcon className="h-3.5 w-3.5" />}
            <span className={activeBranchId === branch.id ? "" : "ml-[22px]"}>{branch.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
