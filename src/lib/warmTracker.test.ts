import { describe, expect, it } from "vitest";
import { assetUrls } from "./warmTracker";

describe("assetUrls", () => {
  it("берёт файлы сборки из оболочки, каждый по разу, и только их", () => {
    const html = `<link rel="stylesheet" href="/_next/static/immutable/chunks/a1.css"/>
      <script src="/_next/static/immutable/chunks/b2.js" async></script>
      <script src="/_next/static/immutable/chunks/b2.js" async></script>
      <script>self.__next_f.push([1,"I[\\"/_next/static/immutable/chunks/c3.js\\"]"])</script>
      <img src="/favicon.png"/><script src="https://example.com/x.js"></script>`;
    expect(assetUrls(html)).toEqual([
      "/_next/static/immutable/chunks/a1.css",
      "/_next/static/immutable/chunks/b2.js",
      "/_next/static/immutable/chunks/c3.js",
    ]);
  });
});
