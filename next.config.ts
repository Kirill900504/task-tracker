import type { NextConfig } from "next";


// Security headers. Everything the tracker needs is its own origin plus
// Supabase (REST, auth and the realtime websocket) — no analytics, no fonts,
// no third-party scripts at all — so the policy can be narrow.
//
// 'unsafe-inline' for scripts is the one concession: Next inlines its
// hydration payload and bootstrap in the document, and the alternative (a
// per-request nonce threaded through the proxy) buys little here, where no
// third-party code is loaded and every string that reaches the DOM goes
// through React's escaping — there is no innerHTML, no dangerouslySetInnerHTML
// and no eval anywhere in the client bundle.
const SUPABASE_ORIGIN = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://*.supabase.co";
const SUPABASE_WS = SUPABASE_ORIGIN.replace(/^https:/, "wss:");

const CSP = [
  "default-src 'self'",
  // 'unsafe-eval' only in development: React's dev build uses eval() for
  // debugging features (reconstructing call stacks, and so on) and floods
  // the console with CSP errors without it. The production build never
  // calls eval, so the deployed policy stays without it.
  process.env.NODE_ENV === "production" ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${SUPABASE_ORIGIN} ${SUPABASE_WS}`,
  "media-src 'self' blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Nothing here is ever meant to be embedded in another page — this is the
  // modern equivalent of X-Frame-Options, kept alongside it for older browsers.
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The microphone is used for dictation, by this origin only; nothing else
  // is needed, so everything else is switched off.
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];
const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // Supabase, served from our own domain. Some mobile networks carry this
  // site perfectly and never reach <project>.supabase.co at all, which left
  // the tracker stuck on «нет связи с облаком» on an otherwise working phone.
  // The browser client falls back to this path when the direct host does not
  // answer — see src/lib/supabase/client.ts. Nothing new is exposed: it
  // forwards the same requests, carrying the same keys, to the same public
  // API, still behind the same row-level security.
  async rewrites() {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return [];
    return [{ source: "/sb/:path*", destination: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/:path*` }];
  },
  // Speech-to-text (Telegram voice messages) pulls in ONNX runtime + a
  // Whisper model — large, and does dynamic requires that Next's bundler
  // shouldn't try to trace/tree-shake. Keep them as plain node_modules
  // requires in the serverless function instead of bundling them.
  serverExternalPackages: [
    "@huggingface/transformers",
    "onnxruntime-node",
    "onnxruntime-web",
    "onnxruntime-common",
    "sharp",
    "ogg-opus-decoder",
  ],
  // onnxruntime-node ships prebuilt native binaries for darwin/linux/win32
  // in one package (~210MB total) — Vercel only ever runs on linux, and the
  // speech-to-text feature is forced onto the WASM backend anyway (see
  // src/lib/speechToText.ts), so none of this native binary is actually
  // used. Trimming the other two platforms keeps the deployed function
  // well under Vercel's size limit.
  outputFileTracingExcludes: {
    "**": ["**/onnxruntime-node/bin/napi-v6/darwin/**", "**/onnxruntime-node/bin/napi-v6/win32/**"],
  },
  // speechToText.ts deliberately loads @huggingface/transformers' "web"
  // build through a `new Function`-constructed import (see the comment
  // there for why) so no bundler's static analysis can see or rewrite that
  // call. The unavoidable cost: the same invisibility that protects it from
  // being rewritten also means Next's file tracer never finds a reference
  // to it, so it doesn't get copied into the deployed function either
  // ("Could not locate ... web build", confirmed in production). Forcing
  // it in here, scoped to only the one route that needs it.
  outputFileTracingIncludes: {
    "/api/telegram/webhook": [
      "./node_modules/@huggingface/transformers/**",
      "./node_modules/@huggingface/jinja/**",
      "./node_modules/@huggingface/tokenizers/**",
      "./node_modules/onnxruntime-web/**",
      "./node_modules/onnxruntime-common/**",
    ],
  },
};

export default nextConfig;
