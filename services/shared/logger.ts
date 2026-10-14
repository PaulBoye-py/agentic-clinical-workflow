// Structured JSON logs. The field list is closed on purpose: there is no
// field that can carry clinical text, so it cannot be logged by accident.
export interface LogFields {
  fn?: string;
  requestId?: string;
  route?: string;
  encounterId?: string;
  patientId?: string;
  doctorId?: string;
  actionId?: string;
  toolName?: string;
  decision?: string;
  status?: string | number;
  errorCode?: string;
  latencyMs?: number;
  model?: string;
  iteration?: number;
}

type Level = "info" | "warn" | "error";

function write(level: Level, event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};
