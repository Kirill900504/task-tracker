import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Speech-to-text (Telegram voice messages) pulls in ONNX runtime + a
  // Whisper model — large, and does dynamic requires that Next's bundler
  // shouldn't try to trace/tree-shake. Keep them as plain node_modules
  // requires in the serverless function instead of bundling them.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "onnxruntime-web", "sharp", "ogg-opus-decoder"],
  // onnxruntime-node ships prebuilt native binaries for darwin/linux/win32
  // in one package (~210MB total) — Vercel only ever runs on linux, and the
  // speech-to-text feature is forced onto the WASM backend anyway (see
  // src/lib/speechToText.ts), so none of this native binary is actually
  // used. Trimming the other two platforms keeps the deployed function
  // well under Vercel's size limit.
  outputFileTracingExcludes: {
    "**": ["**/onnxruntime-node/bin/napi-v6/darwin/**", "**/onnxruntime-node/bin/napi-v6/win32/**"],
  },
};

export default nextConfig;
