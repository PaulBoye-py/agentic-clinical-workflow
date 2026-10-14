import { fetchAuthSession } from "aws-amplify/auth";
import { config } from "./config";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Sends the Cognito ID token: it carries custom:doctor_id, which the API
// reads from the verified claims. The browser never sends a doctor ID itself.
export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const session = await fetchAuthSession();
  const idToken = session.tokens?.idToken?.toString();
  if (!idToken) throw new ApiError(401, "UNAUTHORIZED", "Your session has expired. Sign in again.");

  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${idToken}`,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Could not reach the API. Check your connection.");
  }

  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? `Request failed (${res.status}).`);
  }
  return data as T;
}

export interface PatientSummary {
  patientId: string;
  displayName: string;
  synthetic: boolean;
  dateOfBirth: string;
  sex: string;
  lastCheckup?: string;
}
