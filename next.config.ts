import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
