"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Supabase emails built from the DEFAULT templates use the implicit flow and
// land on the Site URL with the session in the URL fragment
// (#access_token=…&refresh_token=…) or an error (#error=…). This app only
// accepts the server-side token_hash flow (/auth/confirm), so such links can't
// sign anyone in. Rather than leave a live token sitting in the address bar
// and browser history, discard the fragment immediately — never reading or
// storing the tokens — and explain on the login page.

const AUTH_FRAGMENT_KEYS = ["access_token", "refresh_token", "provider_token", "error", "error_code", "error_description"];

export function AuthFragmentGuard() {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.length < 2) return;
    const params = new URLSearchParams(hash.slice(1));
    if (!AUTH_FRAGMENT_KEYS.some((key) => params.has(key))) return;

    const expired = params.get("error_code") === "otp_expired";
    // Remove the fragment from the current history entry before anything else.
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    router.replace(`/login?reason=${expired ? "link_invalid" : "link_unsupported"}`);
  }, [router]);

  return null;
}
