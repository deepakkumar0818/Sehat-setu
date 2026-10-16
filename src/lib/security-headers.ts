// Browser security headers for every page (wired in next.config.ts).
//
// Content-Security-Policy WITHOUT nonces (the approach Next.js documents for
// apps that keep static rendering): a nonce needs every page rendered per
// request, which would make the ~90 static pages dynamic. Hence script-src
// still allows 'unsafe-inline' (Next.js's own inline bootstrap scripts); the
// policy's value is in everything else it shuts: no third-party scripts,
// styles, fonts, frames or connections, no plugins, no <base> hijacking, no
// cross-site form posts, and no framing (clickjacking).
//
// What the app needs, from an inventory of the source (see security-headers.test.ts):
//   * scripts/styles/fonts: same origin (next/font self-hosts the fonts);
//     inline <style> (charts, Next.js) → style-src 'unsafe-inline'.
//   * images: same origin, data: and blob: (document previews are object URLs).
//   * connections: same origin (/api/v1) and the Supabase project (the
//     browser client on /auth/set-password). Nothing else.
//   * no iframes, workers, eval, camera, microphone or geolocation.
//   * ONLY when Razorpay online payments are configured (`razorpay: true`): its
//     Checkout script (checkout.razorpay.com), its payment frame and API
//     (api.razorpay.com), its telemetry (lumberjack.razorpay.com) and images
//     (cdn.razorpay.com); the Payment Request API for those origins; and popups
//     (some banks' verification pages) — nothing else from third parties.
// Development additionally needs 'unsafe-eval' (React debugging) and the HMR
// websocket.
//
// /api responses are excluded: JSON needs no CSP, and file downloads set their
// own stricter sandbox CSP (src/server/api/route-handler.ts).
//
// HSTS is sent only from production builds and without includeSubDomains or
// preload: those affect every subdomain of the production domain and are an
// owner decision (see docs/security.md).

export interface SecurityHeaderOptions {
  /** `next dev` */
  isDev: boolean;
  /** The Supabase project origin the browser may call, if configured. */
  supabaseOrigin?: string | null;
  /** Razorpay online payments are configured (RAZORPAY_KEY_ID set at build). */
  razorpay?: boolean;
}

const RAZORPAY = {
  script: "https://checkout.razorpay.com",
  frame: "https://api.razorpay.com https://checkout.razorpay.com",
  connect: "https://api.razorpay.com https://lumberjack.razorpay.com",
  img: "https://cdn.razorpay.com",
};

export type HeaderRule = { source: string; headers: { key: string; value: string }[] };

export function contentSecurityPolicy({ isDev, supabaseOrigin, razorpay = false }: SecurityHeaderOptions): string {
  const connect = ["'self'", supabaseOrigin, razorpay ? RAZORPAY.connect : null, isDev ? "ws: wss:" : null].filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${razorpay ? ` ${RAZORPAY.script}` : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${razorpay ? ` ${RAZORPAY.img}` : ""}`,
    "font-src 'self' data:",
    `connect-src ${connect}`,
    razorpay ? `frame-src ${RAZORPAY.frame}` : "frame-src 'none'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Features the app never uses, switched off for the page and anything it embeds. */
export const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "bluetooth=()",
  "midi=()",
  "magnetometer=()",
  "gyroscope=()",
  "accelerometer=()",
  "browsing-topics=()",
].join(", ");

export const HSTS = "max-age=31536000";

/** With Razorpay: the Payment Request API for this site and Razorpay's frames only. */
export function permissionsPolicyWithPayments(): string {
  return PERMISSIONS_POLICY.replace("payment=()", 'payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com")');
}

export function securityHeaders(options: SecurityHeaderOptions): HeaderRule[] {
  const everywhere = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    ...(options.isDev ? [] : [{ key: "Strict-Transport-Security", value: HSTS }]),
  ];
  return [
    { source: "/:path*", headers: everywhere },
    {
      // Pages only (not /api).
      source: "/((?!api/).*)",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: options.razorpay ? permissionsPolicyWithPayments() : PERMISSIONS_POLICY },
        { key: "Cross-Origin-Opener-Policy", value: options.razorpay ? "same-origin-allow-popups" : "same-origin" },
      ],
    },
  ];
}
