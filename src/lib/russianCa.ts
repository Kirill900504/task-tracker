import https from "node:https";
import tls from "node:tls";
import fs from "node:fs";
import path from "node:path";

// Russian services sign their certificates with the Ministry of Digital
// Development's own root CA, which is not in anybody's default trust store.
// A Windows machine here has it installed, so every such call works from a
// laptop and fails on the server — and Node reports that failure as the two
// useless words «fetch failed». GigaChat hit this first; MAX hit it again
// when the bot was finally connected, so the answer now lives in one place.
//
// The root is ADDED to Node's normal list, never substituted for it: calls
// that use this agent still verify ordinary public certificates the ordinary
// way, and every other HTTPS call in the app is untouched.
const RUSSIAN_ROOT_CA = fs.readFileSync(
  path.join(process.cwd(), "certs", "russian-trusted-root-ca.pem"),
  "utf-8",
);

export const russianCaAgent = new https.Agent({ ca: [...tls.rootCertificates, RUSSIAN_ROOT_CA] });

// A `fetch` that trusts that root, shaped exactly like `fetch` so a call site
// changes by one word. Node's own fetch cannot be told about an https.Agent,
// which is the whole reason this exists rather than an option somewhere.
export function russianFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method || "GET";
  const headers = (init?.headers as Record<string, string>) || {};
  const body = typeof init?.body === "string" ? init.body : undefined;

  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, agent: russianCaAgent }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf-8");
        // A 204 or 304 must not carry a body, and Response throws if given
        // one — MAX answers some calls that way.
        const empty = res.statusCode === 204 || res.statusCode === 304;
        // Only the content type is carried over. `content-length` and
        // `content-encoding` describe the wire, which node:https has already
        // unwrapped by the time we get here — copying them would make
        // Response describe a body that no longer exists.
        const type = res.headers["content-type"];
        resolve(
          new Response(empty ? null : text, {
            status: res.statusCode || 0,
            headers: type ? { "content-type": String(type) } : {},
          }),
        );
      });
    });
    // Without a ceiling a blocked host hangs the request until the platform
    // kills the function, and the owner sees a spinner rather than a reason.
    req.setTimeout(20_000, () => req.destroy(new Error("MAX не ответил за 20 секунд")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
