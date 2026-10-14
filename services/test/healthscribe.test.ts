import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseClinicalDocument, parseTranscript, s3KeyFromUri } from "../shared/healthscribe";
import { canTransition } from "../shared/encounters";

// Real HealthScribe output for the SYNTHETIC PT-001 consultation (stereo, channel identification).
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

describe("parseTranscript (real output)", () => {
  const segments = parseTranscript(fixture("pt001-transcript.json"));
  it("keeps every segment with an ID", () => {
    expect(segments.length).toBe(43);
    expect(segments.every((s) => s.segmentId.length > 0)).toBe(true);
  });
  it("maps channel roles to clinician and patient", () => {
    expect(segments[0]!.role).toBe("CLINICIAN");
    expect(segments.some((s) => s.role === "PATIENT")).toBe(true);
    expect(segments.some((s) => s.role === "UNKNOWN")).toBe(false);
  });
});

describe("parseClinicalDocument (real output)", () => {
  const sections = parseClinicalDocument(fixture("pt001-summary-hp.json"));
  const segmentIds = new Set(parseTranscript(fixture("pt001-transcript.json")).map((s) => s.segmentId));

  it("returns HISTORY_AND_PHYSICAL sections", () => {
    const names = sections.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["CHIEF_COMPLAINT", "PHYSICAL_EXAMINATION", "ASSESSMENT", "PLAN"]));
  });
  it("strips list markers and whitespace", () => {
    const all = sections.flatMap((s) => s.sentences.map((x) => x.text));
    expect(all.every((t) => t === t.trim() && !t.startsWith("- "))).toBe(true);
  });
  it("every evidence link points at a real transcript segment", () => {
    const links = sections.flatMap((s) => s.sentences.flatMap((x) => x.evidence));
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((id) => segmentIds.has(id))).toBe(true);
  });
  it("captures the plan to refer to oral surgery", () => {
    const plan = sections.find((s) => s.name === "PLAN")!.sentences.map((x) => x.text).join(" ");
    expect(plan).toMatch(/oral surgery/i);
  });
});

describe("s3KeyFromUri", () => {
  const bucket = "clinical-agent-demo-media-123";
  it("parses the path-style URL HealthScribe returns", () =>
    expect(s3KeyFromUri(`https://s3.us-east-1.amazonaws.com/${bucket}/clinical-agent-demo-ENC-x/summary.json`, bucket)).toBe(
      "clinical-agent-demo-ENC-x/summary.json",
    ));
  it("parses virtual-hosted and s3:// forms", () => {
    expect(s3KeyFromUri(`https://${bucket}.s3.amazonaws.com/a/b.json`, bucket)).toBe("a/b.json");
    expect(s3KeyFromUri(`s3://${bucket}/a/b.json`, bucket)).toBe("a/b.json");
  });
  it("rejects other buckets", () => expect(() => s3KeyFromUri("s3://other/a.json", bucket)).toThrow());
});

describe("encounter status machine", () => {
  it("allows the happy path", () => {
    expect(canTransition("CREATED", "AUDIO_UPLOADED")).toBe(true);
    expect(canTransition("TRANSCRIBING", "NOTE_READY")).toBe(true);
    expect(canTransition("NEEDS_INPUT", "AGENT_RUNNING")).toBe(true);
    expect(canTransition("AWAITING_APPROVAL", "COMPLETED")).toBe(true);
  });
  it("blocks skips and leaving terminal states", () => {
    expect(canTransition("CREATED", "NOTE_READY")).toBe(false);
    expect(canTransition("NOTE_READY", "AGENT_RUNNING")).toBe(false);
    expect(canTransition("COMPLETED", "AGENT_RUNNING")).toBe(false);
    expect(canTransition("AGENT_RUNNING", "COMPLETED")).toBe(false);
  });
});
