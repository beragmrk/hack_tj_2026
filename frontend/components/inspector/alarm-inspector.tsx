"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  clinicianResponseLabel,
  confidenceLimitLabel,
  currentDecisionLabel,
  escalationTiming,
  getAlarmPlaybook,
  humanizeAlarmType,
  recommendedActionFromDecision,
  responsePriority,
  safeToDelayStatus
} from "@/lib/clinical-copy";
import { formatPatientDisplayName } from "@/lib/patient-display";
import { usePulseStore } from "@/stores/usePulseStore";

function toPath(values: number[], width: number, height: number) {
  if (values.length < 2) return "";
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;

  return values
    .map((value, idx) => {
      const x = (idx / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${idx === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function severityVariant(severity: string) {
  if (severity === "critical" || severity === "high") return "destructive" as const;
  if (severity === "medium") return "warning" as const;
  return "default" as const;
}

function severityLabel(severity: string): string {
  if (!severity) return "Unknown";
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

function priorityVariant(priority: string) {
  if (priority === "Immediate Escalation Required") return "destructive" as const;
  if (priority === "Urgent Bedside Response") return "warning" as const;
  if (priority === "Bedside Review Recommended") return "default" as const;
  return "muted" as const;
}

function currentStatusLabel(priority: string): string {
  if (priority === "Immediate Escalation Required") return "Escalated";
  if (priority === "Urgent Bedside Response") return "Active Alarm Under Urgent Review";
  if (priority === "Bedside Review Recommended") return "Under Bedside Review";
  return "Monitoring Only";
}

function timeSince(ts?: string): string {
  if (!ts) return "Just Now";
  const ms = new Date(ts).getTime();
  if (!Number.isFinite(ms)) return "Just Now";
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m`;
}

export function AlarmInspector() {
  const alarms = usePulseStore((s) => s.alarms);
  const alarmTimeline = usePulseStore((s) => s.alarmTimeline);
  const latestNumeric = usePulseStore((s) => s.latestNumeric);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(() => {
    if (!alarms.length) return null;
    if (!selectedId) return alarms[0];
    return alarms.find((alarm) => alarm.id === selectedId) ?? alarms[0];
  }, [alarms, selectedId]);

  const path = useMemo(() => toPath(selected?.waveform ?? [], 360, 88), [selected?.waveform]);

  const proofCommitment = useMemo(() => {
    const proof = selected?.explanation?.proof;
    if (!proof || typeof proof !== "object") return null;

    const commitment = (proof as { commitment?: unknown }).commitment;
    return typeof commitment === "string" ? commitment : null;
  }, [selected?.explanation]);

  const policyOverrides = useMemo(() => {
    const overrides = selected?.explanation?.policy_overrides;
    return Array.isArray(overrides) ? overrides.slice(0, 4) : [];
  }, [selected?.explanation]);

  const numericSnapshot = useMemo(() => {
    if (!selected) return {};
    return latestNumeric[selected.patientId] ?? {};
  }, [latestNumeric, selected]);

  const playbook = useMemo(() => getAlarmPlaybook(selected?.alarmType), [selected?.alarmType]);
  const likelihoodText = clinicianResponseLabel(selected?.pActionable);
  const confidenceLimits = confidenceLimitLabel(selected?.uncertainty);

  const priority = responsePriority(selected?.severity, selected?.decision, playbook.defaultPriority);
  const currentDecision = currentDecisionLabel(selected?.decision);
  const recommendedAction = recommendedActionFromDecision(selected?.decision, playbook.defaultAction);
  const timing = escalationTiming(priority);
  const safeDelay = safeToDelayStatus(priority, playbook, selected?.decision);
  const currentStatus = currentStatusLabel(priority);

  const dynamicSignals = Object.entries(numericSnapshot).map(
    ([key, value]) => `${key.toUpperCase()} ${Number(value).toFixed(1)}`
  );

  const responseChain = playbook.responseWorkflow;
  const activeDuration = timeSince(selected?.timestamp);
  const statusNoteFromContext = useMemo(() => {
    const statusNote = selected?.context?.status_note;
    if (typeof statusNote === "string" && statusNote.trim().length > 0) return statusNote;
    return `Still Active • Detected ${activeDuration} Ago`;
  }, [activeDuration, selected?.context]);

  return (
    <Card className="panel-sheen h-full border-[#99b8cd]/55">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Clinical Alarm Interpretation
          <span className="text-[11px] font-normal text-slate-500">Why This Recommendation Was Made</span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {!selected && (
          <div className="text-sm text-slate-500">
            No Active Alarms Yet. PulseMesh Is Continuously Reviewing Bedside Rooms.
          </div>
        )}

        {selected && (
          <>
            <div className="rounded-xl border border-[#b9cfde]/60 bg-white/75 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="muted">{playbook.label}</Badge>
                <Badge variant={severityVariant(selected.severity)}>{severityLabel(selected.severity)}</Badge>
                <Badge variant="default">{selected.roomId}</Badge>
                <Badge variant={priorityVariant(priority)}>{priority}</Badge>
              </div>

              <div className="mt-2 text-lg font-semibold text-slate-800">Alarm: {playbook.label}</div>
              <div className="text-sm text-slate-700">Meaning: {playbook.meaning}</div>

              <div className="mt-2 grid grid-cols-2 gap-2 text-xs lg:grid-cols-4">
                <div className="rounded-md bg-[#eef5fa] p-2">
                  <div className="text-slate-500">Room</div>
                  <div className="font-semibold text-slate-800">{selected.roomId}</div>
                </div>
                <div className="rounded-md bg-[#eef5fa] p-2">
                  <div className="text-slate-500">Patient</div>
                  <div className="font-semibold text-slate-800">{formatPatientDisplayName(selected.patientId)}</div>
                </div>
                <div className="rounded-md bg-[#eef5fa] p-2">
                  <div className="text-slate-500">Current Status</div>
                  <div className="font-semibold text-slate-800">{currentStatus}</div>
                </div>
                <div className="rounded-md bg-[#eef5fa] p-2">
                  <div className="text-slate-500">Who Responds First</div>
                  <div className="font-semibold text-slate-800">{responseChain[0]?.role ?? "Bedside Nurse"}</div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-3 text-sm">
              <div className="font-semibold text-slate-800">Clinical Summary</div>
              <div className="mt-1 text-slate-700">
                The patient in {selected.roomId} is showing {playbook.label.toLowerCase()} with {likelihoodText.toLowerCase()}.
                {" "}
                {playbook.clinicalSummaryTemplate}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 text-xs lg:grid-cols-2">
              <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5">
                <div className="font-semibold text-slate-800">Why PulseMesh Flagged This</div>
                <div className="mt-1 text-slate-600">{playbook.detectionRuleSummary}</div>
                <div className="mt-1 text-slate-500">Trend Window: {playbook.trendWindow}</div>
                <div className="text-slate-500">Threshold Logic: {playbook.thresholdLogic}</div>
                <div className="mt-1 text-slate-500">Detection Source: {playbook.detectionSource}</div>
              </div>

              <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5">
                <div className="font-semibold text-slate-800">Signals Used</div>
                <div className="mt-1 text-slate-600">{playbook.signalsUsed.join(" | ")}</div>
                {dynamicSignals.length > 0 && (
                  <div className="mt-1 text-slate-500">Current Room Vitals: {dynamicSignals.join(" | ")}</div>
                )}
              </div>

              <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5">
                <div className="font-semibold text-slate-800">How It Was Detected</div>
                <div className="mt-1 text-slate-600">Detection Basis: {playbook.detectionRuleSummary}</div>
                <div className="mt-1 text-slate-500">Confidence Basis: {playbook.confidenceBasis}</div>
                <div className="mt-1 text-slate-500">Model Contribution: {playbook.modelContribution}</div>
              </div>

              <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5">
                <div className="font-semibold text-slate-800">Likelihood And Confidence Limits</div>
                <div className="mt-1 text-slate-600">Likely Needs Clinician Response: {likelihoodText}</div>
                <div className="mt-1 text-slate-500">Confidence Limits: {confidenceLimits}</div>
                <div className="mt-1 text-slate-500">
                  Clinical confidence summary combines trend consistency, waveform quality, and policy guardrails.
                </div>
              </div>
            </div>

            <div
              className={`rounded-xl border p-3 text-sm ${
                priority === "Immediate Escalation Required"
                  ? "border-[#df8f77]/85 bg-[#ffe6de] text-[#6d2c1f]"
                  : priority === "Urgent Bedside Response"
                    ? "border-[#e6a97f]/85 bg-[#ffefe3] text-[#6d421a]"
                    : "border-[#e4b9ab]/75 bg-[#fff6f2]"
              }`}
            >
              <div className="font-semibold text-slate-800">Current Decision And Recommended Action</div>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-slate-700">
                <li><strong>{currentDecision}</strong></li>
                <li><strong>Recommended Action:</strong> {recommendedAction}</li>
                <li><strong>Response Priority:</strong> {priority}</li>
                <li><strong>Time Since Detected:</strong> {activeDuration}</li>
                <li><strong>Current Status Note:</strong> {statusNoteFromContext}</li>
                <li><strong>Safe-To-Delay Status:</strong> {safeDelay}</li>
                <li><strong>Suppression Status:</strong> {playbook.suppressionGuidance}</li>
              </ul>
            </div>

            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5 text-xs">
                <div className="font-semibold text-slate-800">Order Of Response</div>
                <ol className="mt-1 space-y-1.5">
                  {responseChain.map((step, idx) => (
                    <li key={`${step.role}-${idx}`} className="rounded-md bg-[#edf5fa] p-2">
                      <div className="font-semibold text-slate-700">{idx + 1}. {step.role}</div>
                      <div className="text-slate-600">{step.action}</div>
                      <div className="text-slate-500">Escalate: {step.escalationCondition}</div>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5 text-xs">
                <div className="font-semibold text-slate-800">Response Timing</div>
                <ul className="mt-1 space-y-1.5">
                  {timing.map((line, idx) => (
                    <li key={`${line}-${idx}`} className="rounded-md bg-[#edf5fa] p-2 text-slate-600">
                      {line}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 text-slate-600">
                  Bedside Confirmation Required: {priority === "Monitor Only" ? "Recommended" : "Required"}
                </div>
                <div className="text-slate-600">Continuous Room Watch: Yes</div>
              </div>
            </div>

            <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5 text-xs">
              <div className="font-semibold text-slate-800">Safety Rule And Override Status</div>
              <div className="mt-1 text-slate-600">{playbook.policyLayer}</div>
              {policyOverrides.length > 0 ? (
                <div className="mt-1 text-slate-600">Applied Override(s): {policyOverrides.join(" | ")}</div>
              ) : (
                <div className="mt-1 text-slate-500">No Additional Override Applied For This Event.</div>
              )}
            </div>

            <div className="waveform rounded-xl border border-[#b9cfde]/60 p-2.5">
              <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-slate-500">Waveform Preview</div>
              <svg viewBox="0 0 360 88" className="h-24 w-full rounded-md bg-[#edf5fa]/85">
                <path d={path} fill="none" stroke="#2f7a9d" strokeWidth="2" />
              </svg>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-700">Recent Related Events</div>
              <div className="clinical-scrollbar max-h-44 space-y-1 overflow-auto pr-1">
                {alarmTimeline
                  .filter((alarm) => alarm.patientId === selected.patientId || alarm.roomId === selected.roomId)
                  .slice(0, 8)
                  .map((alarm) => {
                    const active = `alarm:${alarm.patientId}` === selected.id;
                    return (
                      <button
                        key={`${alarm.id}-${alarm.timestamp}`}
                        className={`w-full rounded-lg border px-2.5 py-1.5 text-left text-xs transition ${
                          active
                            ? "border-[#7fa8bf]/85 bg-[#deecf6]"
                            : "border-[#bfd2df]/75 bg-white/70 hover:border-[#9ebed1]"
                        }`}
                        onClick={() => setSelectedId(`alarm:${alarm.patientId}`)}
                      >
                        <div className="font-medium text-slate-700">
                          {alarm.roomId} - {humanizeAlarmType(alarm.alarmType)}
                        </div>
                        <div className="text-slate-500">{new Date(alarm.timestamp).toLocaleTimeString()}</div>
                      </button>
                    );
                  })}
              </div>
            </div>

            <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5 text-xs text-slate-600">
              <div className="font-semibold text-slate-800">Audit And Justification Note</div>
              <div className="mt-1">
                PulseMesh stores this recommendation with policy context and evidence for later audit and clinical
                review.
              </div>
              {proofCommitment && (
                <div className="mt-1">Audit Status: Verified Evidence Attached.</div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
