// Helpers for scripts that exercise the DEPLOYED stack with real AWS calls.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CognitoIdentityProviderClient, InitiateAuthCommand } from "@aws-sdk/client-cognito-identity-provider";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

// Clients read these when constructed (below), so set them first. Scripts must
// import this module before any shared/ module that creates a client.
process.env.AWS_PROFILE ??= "paul-padarhealth";
process.env.AWS_REGION ??= "us-east-1";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// ---- Terraform outputs ----

interface Outputs {
  api_url: string;
  user_pool_client_id: string;
  media_bucket: string;
  tables: { patients: string; encounters: string; encounter_step: string; actions: string; audit: string };
  lambda_role_arns: Record<string, string>;
}

export const outputs: Outputs = (() => {
  const raw = JSON.parse(
    execFileSync("terraform", [`-chdir=${resolve(repoRoot, "infra")}`, "output", "-json"], { encoding: "utf8" }),
  ) as Record<string, { value: unknown }>;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.value])) as unknown as Outputs;
})();

// Table env for importing shared/ modules from scripts.
process.env.PATIENTS_TABLE = outputs.tables.patients;
process.env.ENCOUNTERS_TABLE = outputs.tables.encounters;
process.env.STEPS_TABLE = outputs.tables.encounter_step;
process.env.ACTIONS_TABLE = outputs.tables.actions;
process.env.AUDIT_TABLE = outputs.tables.audit;

// ---- Demo user credentials (local, gitignored) ----

function loadDemoUsers(): Record<string, string> {
  const file = resolve(repoRoot, ".env.demo-users");
  const vars: Record<string, string> = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) vars[m[1]!] = m[2]!;
    }
  }
  return { ...vars, ...process.env } as Record<string, string>;
}

const demoEnv = loadDemoUsers();
export const doctors = {
  A: { username: "dr.a@demo.local", password: demoEnv.DR_A_PASSWORD },
  B: { username: "dr.b@demo.local", password: demoEnv.DR_B_PASSWORD },
};

export interface Tokens {
  idToken: string;
  accessToken: string;
}

const cognito = new CognitoIdentityProviderClient({});

export async function login(doctor: keyof typeof doctors): Promise<Tokens> {
  const { username, password } = doctors[doctor];
  if (!password) throw new Error(`Missing password for ${username} (.env.demo-users)`);
  const res = await cognito.send(
    new InitiateAuthCommand({
      ClientId: outputs.user_pool_client_id,
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: username, PASSWORD: password },
    }),
  );
  const r = res.AuthenticationResult;
  if (!r?.IdToken || !r.AccessToken) throw new Error(`Login failed for ${username}`);
  return { idToken: r.IdToken, accessToken: r.AccessToken };
}

// ---- HTTP API ----

export interface HttpResult<T = any> {
  status: number;
  body: T;
}

export async function api<T = any>(method: string, path: string, token?: string, body?: unknown): Promise<HttpResult<T>> {
  const res = await fetch(`${outputs.api_url}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    /* keep raw text */
  }
  return { status: res.status, body: parsed as T };
}

// ---- Direct Lambda invoke ----

const lambda = new LambdaClient({});

export async function invoke<T = any>(fn: string, payload: unknown): Promise<T> {
  const res = await lambda.send(
    new InvokeCommand({
      FunctionName: `clinical-agent-demo-${fn}`,
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  );
  const text = Buffer.from(res.Payload ?? new Uint8Array()).toString("utf8");
  if (res.FunctionError) throw new Error(`${fn} failed: ${text}`);
  return JSON.parse(text) as T;
}

// ---- Tiny assertion reporter ----

let failures = 0;
let passes = 0;

export function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail !== undefined ? `\n        got: ${JSON.stringify(detail)}` : ""}`);
  }
}

export function section(title: string): void {
  console.log(`\n== ${title}`);
}

export function finish(): never {
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

export const randomId = () => Math.random().toString(36).slice(2, 10);
