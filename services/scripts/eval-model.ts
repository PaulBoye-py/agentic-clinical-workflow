// Model screen for scenario C: replays a REAL stored scenario-C conversation up
// to the clinician's answer ("No current meds. Also pull up PT-003's record...")
// and asks each candidate model for its next turn, N times. Counts how often it
// requests PT-003's record (what the demo needs) vs ignores/defers it.
//
//   npx tsx scripts/eval-model.ts <encounterId> [trials] [modelId ...]
import "./lib";
import { readFileSync } from "node:fs";
import { BedrockRuntimeClient, ConverseCommand, type Message } from "@aws-sdk/client-bedrock-runtime";
import { getEncounter } from "../shared/repo";
import { toolSpecs } from "../agent-worker/tools";

const [encounterId, trialsArg, ...modelArgs] = process.argv.slice(2);
if (!encounterId) throw new Error("usage: eval-model.ts <encounterId> [trials] [modelId ...]");
const trials = Number(trialsArg ?? 5);
const models = modelArgs.length ? modelArgs : ["us.anthropic.claude-haiku-4-5-20251001-v1:0"];

const system = readFileSync(new URL("../agent-worker/system-prompt.md", import.meta.url), "utf8");
const encounter = (await getEncounter(encounterId)) as { conversation?: Message[] } | undefined;
const conversation = encounter?.conversation ?? [];

// Cut right after the user message that carries the clinician's answer.
const answerIdx = conversation.findIndex((m) =>
  (m.content ?? []).some((c) => JSON.stringify(c.toolResult?.content ?? "").includes("clinicianAnswer")),
);
if (answerIdx < 0) throw new Error("No clinician answer found in that encounter's conversation");
const history = conversation.slice(0, answerIdx + 1);

const bedrock = new BedrockRuntimeClient({});

for (const modelId of models) {
  let fetched = 0;
  let mentioned = 0;
  let errors = 0;
  const latencies: number[] = [];
  for (let i = 0; i < trials; i++) {
    const started = Date.now();
    try {
      const res = await bedrock.send(
        new ConverseCommand({ modelId, system: [{ text: system }], messages: history, toolConfig: { tools: toolSpecs }, inferenceConfig: { maxTokens: 4000 } }),
      );
      latencies.push(Date.now() - started);
      const content = res.output?.message?.content ?? [];
      const calls = content.flatMap((c) => (c.toolUse ? [c.toolUse] : []));
      const text = content.map((c) => c.text ?? "").join(" ");
      if (calls.some((t) => t.name === "get_patient_record" && JSON.stringify(t.input).includes("PT-003"))) fetched++;
      else if (/PT-003/.test(text)) mentioned++;
    } catch (err) {
      errors++;
      if (errors === 1) console.log(`  ${modelId}: ${err instanceof Error ? `${err.name}: ${err.message.slice(0, 120)}` : err}`);
    }
  }
  const avg = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  console.log(`${modelId.padEnd(45)} requests PT-003: ${fetched}/${trials}   only mentions it: ${mentioned}   errors: ${errors}   avg ${avg} ms`);
}
