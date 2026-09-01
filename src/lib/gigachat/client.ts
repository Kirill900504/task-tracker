import https from "node:https";
import tls from "node:tls";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// GigaChat's servers use a certificate chain issued by the Russian Ministry
// of Digital Development's own root CA, which isn't in Node's default trust
// store. We extend (not replace) Node's normal trusted CA list with that one
// root cert, scoped to a dedicated Agent — every other HTTPS call in the app
// keeps using the standard public CA list untouched.
const RUSSIAN_ROOT_CA = fs.readFileSync(
  path.join(process.cwd(), "certs", "russian-trusted-root-ca.pem"),
  "utf-8",
);
const agent = new https.Agent({ ca: [...tls.rootCertificates, RUSSIAN_ROOT_CA] });

function httpsRequest(
  url: string,
  options: https.RequestOptions,
  body?: string,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { ...options, agent }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode || 0, text: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - 30_000 > Date.now()) {
    return cachedToken.value;
  }

  const authKey = process.env.GIGACHAT_AUTH_KEY;
  if (!authKey) throw new Error("GIGACHAT_AUTH_KEY не задан");

  const body = new URLSearchParams({ scope: "GIGACHAT_API_PERS" }).toString();
  const res = await httpsRequest(
    "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        RqUID: crypto.randomUUID(),
        Authorization: "Basic " + authKey,
      },
    },
    body,
  );

  if (res.status !== 200) {
    throw new Error(`GigaChat OAuth ${res.status}: ${res.text.slice(0, 300)}`);
  }
  const json = JSON.parse(res.text) as { access_token: string; expires_at: number };
  cachedToken = { value: json.access_token, expiresAt: json.expires_at };
  return json.access_token;
}

export async function gigaChatComplete(params: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<string> {
  const token = await getAccessToken();

  const body = JSON.stringify({
    model: "GigaChat",
    temperature: params.temperature ?? 0.2,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
  });

  const res = await httpsRequest(
    "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer " + token,
      },
    },
    body,
  );

  if (res.status !== 200) {
    throw new Error(`GigaChat completion ${res.status}: ${res.text.slice(0, 300)}`);
  }
  const json = JSON.parse(res.text) as { choices: { message: { content: string } }[] };
  return json.choices[0]?.message?.content ?? "";
}
