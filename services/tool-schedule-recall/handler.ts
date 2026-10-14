import { log } from "../shared/logger";
import { proposeAction } from "../shared/propose";
import { formatZodError, scheduleRecallInput, toolInvocation } from "../shared/schemas";
import type { ToolResult } from "../shared/types";

const FN = "tool-schedule-recall";
const TOOL = "schedule_recall";
const invocation = toolInvocation(scheduleRecallInput);

export async function handler(event: unknown): Promise<ToolResult> {
  const parsed = invocation.safeParse(event);
  if (!parsed.success) {
    log.warn("tool_invalid_input", { fn: FN, toolName: TOOL, errorCode: "INVALID_INPUT" });
    return { status: "INVALID_INPUT", message: formatZodError(parsed.error) };
  }
  const { encounterId, doctorId, input } = parsed.data;
  const { patientId, ...payload } = input;
  return proposeAction({ fn: FN, toolName: TOOL, type: "RECALL", encounterId, doctorId, patientId, payload });
}
