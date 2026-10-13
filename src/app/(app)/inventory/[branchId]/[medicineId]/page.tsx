"use client";

import { use, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeftIcon, PackagePlusIcon, SlidersHorizontalIcon, Undo2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { QueryError } from "@/components/shared/query-error";
import { StatusBadge } from "@/components/shared/status-badge";
import { ReceiveStockDialog } from "@/components/inventory/receive-stock-dialog";
import { formatCurrency, formatDate } from "@/lib/format";
import { useLiveData } from "@/lib/data-source";
import { useAdjustBatch, useReverseMovement, useSetReorderLevel, useStockDetail } from "@/hooks/use-inventory";
import type { StockBatch, StockDetail, StockMovementEntry } from "@/services/inventory";

const BATCH_LABEL: Record<StockBatch["status"], { status: string; label: string }> = {
  available: { status: "in_stock", label: "Available" },
  expiring_soon: { status: "expiring_soon", label: "Expiring soon" },
  empty: { status: "out_of_stock", label: "Empty" },
  expired: { status: "expired", label: "Expired" },
};

const istDateTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export default function StockDetailPage({ params }: { params: Promise<{ branchId: string; medicineId: string }> }) {
  const { branchId, medicineId } = use(params);
  const live = useLiveData();
  const { data, isLoading, isError, error, refetch } = useStockDetail(live ? branchId : undefined, live ? medicineId : undefined);

  if (!live) return <EmptyState title="Batch tracking uses the clinic database" description="Sign in to a clinic to see batch-level stock." />;
  if (isLoading) return <Skeleton className="h-[500px] w-full rounded-xl" />;
  if (isError) return <QueryError error={error} what="Stock records" onRetry={() => refetch()} />;
  if (!data) return null;
  return <StockView detail={data} />;
}

function StockView({ detail }: { detail: StockDetail }) {
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<StockBatch | null>(null);
  const [reversing, setReversing] = useState<StockMovementEntry | null>(null);
  const reversibleIds = new Set(detail.movements.filter((m) => m.type !== "reversal" && !m.reversedById).map((m) => m.id));

  return (
    <div className="space-y-5">
      <Link href="/inventory" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="h-4 w-4" /> Inventory
      </Link>

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">{detail.name} <span className="text-muted-foreground">{detail.strength}</span></h1>
            <StatusBadge status={detail.status} />
          </div>
          <p className="text-sm capitalize text-muted-foreground">{detail.dosageForm} · {detail.genericName} · {detail.branchName}</p>
          <p className="mt-1 text-sm text-foreground">
            Usable: <span className="font-semibold">{detail.usableQuantity}</span>
            {detail.expiredQuantity > 0 && <span className="text-danger"> · Expired awaiting write-off: {detail.expiredQuantity}</span>}
          </p>
        </div>
        {detail.canManage && <Button onClick={() => setReceiveOpen(true)}><PackagePlusIcon /> Receive Stock</Button>}
      </div>

      <ReorderLevelCard detail={detail} />

      <Card>
        <CardHeader><CardTitle>Batches</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {detail.batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No batches received at this branch yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Unit cost</TableHead>
                  <TableHead>Supplier</TableHead>
                  {detail.canManage && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.batchNumber}</TableCell>
                    <TableCell>{formatDate(b.expiryDate)}</TableCell>
                    <TableCell className="text-right">{b.quantityOnHand}</TableCell>
                    <TableCell><StatusBadge status={BATCH_LABEL[b.status].status} label={BATCH_LABEL[b.status].label} /></TableCell>
                    <TableCell className="text-right">{b.unitCostPaise !== undefined ? formatCurrency(b.unitCostPaise / 100) : "—"}</TableCell>
                    <TableCell>{b.supplierName ?? "—"}</TableCell>
                    {detail.canManage && (
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setAdjusting(b)} disabled={b.status === "expired" && b.quantityOnHand === 0}>
                          <SlidersHorizontalIcon /> {b.status === "expired" ? "Write off" : "Adjust"}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Stock movements</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {detail.movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No movements yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">After</TableHead>
                  <TableHead>Reason / reference</TableHead>
                  <TableHead>By</TableHead>
                  {detail.canManage && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap">{istDateTime(m.occurredAt)}</TableCell>
                    <TableCell>{m.batchNumber}</TableCell>
                    <TableCell className="capitalize">{m.type}{m.reversedById ? <span className="text-xs text-muted-foreground"> (reversed)</span> : null}</TableCell>
                    <TableCell className={m.quantityDelta > 0 ? "text-right text-success" : "text-right text-danger"}>{m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}</TableCell>
                    <TableCell className="text-right">{m.quantityAfter}</TableCell>
                    <TableCell className="max-w-64 truncate">{[m.reason, m.reference && `Ref ${m.reference}`].filter(Boolean).join(" · ") || "—"}</TableCell>
                    <TableCell>{m.actorName}</TableCell>
                    {detail.canManage && (
                      <TableCell className="text-right">
                        {reversibleIds.has(m.id) && (
                          <Button size="sm" variant="ghost" onClick={() => setReversing(m)}><Undo2Icon /> Reverse</Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ReceiveStockDialog
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        branchId={detail.branchId}
        medicine={{ id: detail.medicineId, name: detail.name, genericName: detail.genericName, strength: detail.strength, dosageForm: detail.dosageForm }}
      />
      <AdjustBatchDialog batch={adjusting} onClose={() => setAdjusting(null)} />
      <ReverseDialog movement={reversing} onClose={() => setReversing(null)} />
    </div>
  );
}

function ReorderLevelCard({ detail }: { detail: StockDetail }) {
  const [value, setValue] = useState(String(detail.reorderLevel));
  const save = useSetReorderLevel();
  const level = Number(value);
  const valid = value !== "" && Number.isInteger(level) && level >= 0 && level <= 1_000_000;
  return (
    <Card>
      <CardHeader><CardTitle>Reorder level</CardTitle></CardHeader>
      <CardContent>
        {detail.canManage ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="reorder">Alert when usable stock is at or below</Label>
              <Input id="reorder" type="number" min={0} className="w-40" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <Button
              variant="outline"
              disabled={!valid || level === detail.reorderLevel || save.isPending}
              onClick={() => save.mutate({ branchId: detail.branchId, medicineId: detail.medicineId, reorderLevel: level }, { onSuccess: () => toast.success("Reorder level saved.") })}
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
            <p className="w-full text-xs text-muted-foreground">Set 0 for no low-stock alert. Applies to this medicine at {detail.branchName}.</p>
          </div>
        ) : (
          <p className="text-sm text-foreground">{detail.reorderLevel > 0 ? `Alert at ${detail.reorderLevel} or fewer usable units.` : "No reorder level set."}</p>
        )}
      </CardContent>
    </Card>
  );
}

function AdjustBatchDialog({ batch, onClose }: { batch: StockBatch | null; onClose: () => void }) {
  return (
    <Dialog open={batch !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">{batch && <AdjustForm batch={batch} onDone={onClose} />}</DialogContent>
    </Dialog>
  );
}

function AdjustForm({ batch, onDone }: { batch: StockBatch; onDone: () => void }) {
  const expired = batch.status === "expired";
  const [direction, setDirection] = useState<"add" | "remove">("remove");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState(expired ? "Expired — written off" : "");
  const adjust = useAdjustBatch();
  const qty = Number(quantity);
  const delta = direction === "add" ? qty : -qty;
  const valid = Number.isInteger(qty) && qty >= 1 && reason.trim().length >= 3 && (direction === "add" ? !expired : qty <= batch.quantityOnHand);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{expired ? "Write off expired stock" : "Adjust stock"} — {batch.batchNumber}</DialogTitle>
        <DialogDescription>On hand: {batch.quantityOnHand}. Every adjustment is recorded with its reason.</DialogDescription>
      </DialogHeader>
      {!expired && (
        <RadioGroup value={direction} onValueChange={(v) => setDirection(v as "add" | "remove")} className="flex gap-4">
          <div className="flex items-center gap-2"><RadioGroupItem value="remove" id="adj-remove" /><Label htmlFor="adj-remove">Remove</Label></div>
          <div className="flex items-center gap-2"><RadioGroupItem value="add" id="adj-add" /><Label htmlFor="adj-add">Add</Label></div>
        </RadioGroup>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="adj-qty">Quantity</Label>
        <Input id="adj-qty" type="number" min={1} max={direction === "remove" ? batch.quantityOnHand : 100000} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        {direction === "remove" && qty > batch.quantityOnHand && <p className="text-xs text-danger">Only {batch.quantityOnHand} on hand.</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="adj-reason">Reason</Label>
        <Input id="adj-reason" maxLength={300} placeholder="e.g. Damaged in storage, count correction" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button
          disabled={!valid || adjust.isPending}
          onClick={() => adjust.mutate({ itemId: batch.id, quantityDelta: delta, reason: reason.trim() }, { onSuccess: () => { toast.success("Stock adjusted."); onDone(); } })}
        >
          {adjust.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

function ReverseDialog({ movement, onClose }: { movement: StockMovementEntry | null; onClose: () => void }) {
  return (
    <Dialog open={movement !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">{movement && <ReverseForm movement={movement} onDone={onClose} />}</DialogContent>
    </Dialog>
  );
}

function ReverseForm({ movement, onDone }: { movement: StockMovementEntry; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const reverse = useReverseMovement();
  const opposite = -movement.quantityDelta;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Reverse this {movement.type}?</DialogTitle>
        <DialogDescription>
          Records {opposite > 0 ? `+${opposite}` : opposite} on batch {movement.batchNumber}. The original entry stays in the history, and a movement can be reversed only once.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="rev-reason">Reason (optional)</Label>
        <Input id="rev-reason" maxLength={300} placeholder="e.g. Entered by mistake" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button
          variant="destructive"
          disabled={reverse.isPending}
          onClick={() => reverse.mutate({ movementId: movement.id, reason: reason.trim() || undefined }, { onSuccess: () => { toast.success("Movement reversed."); onDone(); } })}
        >
          {reverse.isPending ? "Reversing…" : "Reverse"}
        </Button>
      </DialogFooter>
    </>
  );
}
