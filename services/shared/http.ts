import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { z } from "zod";
import { AppError, errors } from "./errors";
import { formatZodError } from "./schemas";
import { log } from "./logger";

export type ApiEvent = APIGatewayProxyEventV2WithJWTAuthorizer;
export type ApiResult = APIGatewayProxyResultV2;

export interface Caller {
  doctorId: string;
  sub: string;
  name?: string;
}

// API Gateway has already verified signature, issuer, audience and expiry.
// We additionally require an ID token, because access tokens from the same
// app client pass the authorizer (client_id check) but carry no doctor_id.
export function callerFrom(event: ApiEvent): Caller {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const doctorId = claims["custom:doctor_id"];
  if (claims.token_use !== "id" || typeof doctorId !== "string" || !/^DR-[A-Z0-9]{1,8}$/.test(doctorId)) {
    throw errors.unauthorized();
  }
  return { doctorId, sub: String(claims.sub), name: typeof claims.name === "string" ? claims.name : undefined };
}

export function parseBody<T extends z.ZodType>(event: ApiEvent, schema: T): z.infer<T> {
  let raw: unknown = undefined;
  if (event.body) {
    try {
      raw = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);
    } catch {
      throw errors.validation("Body must be valid JSON.");
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw errors.validation(formatZodError(parsed.error));
  return parsed.data;
}

export function json(statusCode: number, body: unknown): ApiResult {
  return {
    statusCode,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(body, (_k, v) => (v instanceof Set ? [...v] : v)),
  };
}

// Consistent error JSON: { error: { code, message } }. Unknown errors are
// logged by name only and returned as a generic 500.
export async function handleApi(fn: string, event: ApiEvent, run: () => Promise<ApiResult>): Promise<ApiResult> {
  const started = Date.now();
  const route = event.routeKey;
  try {
    const result = await run();
    const status = typeof result === "object" && result && "statusCode" in result ? result.statusCode : 200;
    log.info("request", { fn, route, status, latencyMs: Date.now() - started, requestId: event.requestContext.requestId });
    return result;
  } catch (err) {
    if (err instanceof AppError) {
      log.warn("request_rejected", { fn, route, status: err.httpStatus, errorCode: err.code, requestId: event.requestContext.requestId });
      return json(err.httpStatus, { error: { code: err.code, message: err.safeMessage } });
    }
    log.error("request_failed", {
      fn,
      route,
      status: 500,
      errorCode: err instanceof Error ? err.name : "Unknown",
      requestId: event.requestContext.requestId,
    });
    return json(500, { error: { code: "INTERNAL", message: "Something went wrong. Try again." } });
  }
}
