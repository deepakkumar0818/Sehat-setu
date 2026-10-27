"use client";

import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { CheckIcon, CopyIcon, ExternalLinkIcon, LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { joinClinicPath } from "@/lib/clinic-join";

const noSubscribe = () => () => {};

/** A clinic's patient link (full URL) and copying it to the clipboard. */
function useJoinLink(code: string) {
  const path = joinClinicPath(code);
  // The browser's origin; "" on the server, so the first render matches.
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");
  const [copied, setCopied] = useState(false);
  const url = `${origin}${path}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Patient link copied.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Open the link and copy it from the address bar instead.");
    }
  }
  return { path, url, ready: Boolean(origin), copied, copy };
}

/**
 * A clinic's patient link (/join/<CODE>) with copy and open buttons. Patients
 * who register through it join this clinic and book with its doctors only.
 */
export function ClinicJoinLink({ code, id = "clinic-join-link" }: { code: string; id?: string }) {
  const { path, url, ready, copied, copy } = useJoinLink(code);
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input id={id} readOnly value={url} className="font-mono text-sm" onFocus={(e) => e.currentTarget.select()} aria-label="Patient registration and booking link" />
      <div className="flex shrink-0 gap-2">
        <Button type="button" onClick={copy} disabled={!ready}>
          {copied ? <CheckIcon className="h-4 w-4" aria-hidden /> : <CopyIcon className="h-4 w-4" aria-hidden />}
          {copied ? "Copied" : "Copy link"}
        </Button>
        <Button asChild type="button" variant="outline">
          <a href={path} target="_blank" rel="noopener noreferrer">
            <ExternalLinkIcon className="h-4 w-4" aria-hidden /> Open
          </a>
        </Button>
      </div>
    </div>
  );
}

/** The same link as one small button, for lists of clinics. */
export function CopyClinicJoinLinkButton({ code, clinicName }: { code: string; clinicName: string }) {
  const { ready, copied, copy } = useJoinLink(code);
  return (
    <Button type="button" variant="link" size="sm" className="h-auto gap-1 p-0 text-xs" onClick={copy} disabled={!ready} aria-label={`Copy the patient link for ${clinicName}`}>
      {copied ? <CheckIcon className="h-3 w-3" aria-hidden /> : <LinkIcon className="h-3 w-3" aria-hidden />}
      {copied ? "Copied" : "Copy patient link"}
    </Button>
  );
}
