"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getAlarmPlaybook,
  humanizeAlarmType,
  monitoringConfidenceLabel,
  recommendedActionFromDecision,
  responsePriority,
  safeToDelayStatus
} from "@/lib/clinical-copy";
import { GraphNode } from "@/types/pulse";
import { usePulseStore } from "@/stores/usePulseStore";

const GATEWAY_HTTP_URL = process.env.NEXT_PUBLIC_GATEWAY_HTTP_URL ?? "http://localhost:8080";

function extractPatientId(nodeId: string): string | null {
  if (nodeId.startsWith("patient:")) return nodeId.replace("patient:", "");

  if (nodeId.startsWith("signal:")) {
    const parts = nodeId.split(":");
    return parts.length >= 3 ? parts[1] : null;
  }

  if (nodeId.startsWith("device:")) {
    const parts = nodeId.split(":");
    return parts.length >= 3 ? parts[1] : null;
  }

  if (nodeId.startsWith("alarm:")) {
    const parts = nodeId.split(":");
    return parts.length >= 2 ? parts[1] : null;
  }

  return null;
}

function parseRoomSelection(nodeId: string): { wingLabel: string; roomId: string } | null {
  if (!nodeId.startsWith("room:")) return null;

  const [, wing = "", roomNum = ""] = nodeId.split(":");
  return {
    wingLabel: wing === "north" ? "North ICU" : wing === "south" ? "South ICU" : "ICU",
    roomId: roomNum ? `ICU-${roomNum}` : "ICU"
  };
}

function nodeKindLabel(node: GraphNode): string {
  if (node.kind === "patient") return "Patient";
  if (node.kind === "device") return "Bedside Device";
  if (node.kind === "signal") return "Monitoring Source";
  return "Alarm";
}

function toWaveformPath(values: number[], width: number, height: number): string {
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

function timeSince(ts?: string): string {
  if (!ts) return "Just Now";
  const ms = new Date(ts).getTime();
  if (!Number.isFinite(ms)) return "Just Now";
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m`;
}

export function GraphNodeInspector() {
  const selectedNodeId = usePulseStore((s) => s.selectedNodeId);
  const nodes = usePulseStore((s) => s.nodes);
  const edges = usePulseStore((s) => s.edges);
  const alarms = usePulseStore((s) => s.alarms);
  const alarmTimeline = usePulseStore((s) => s.alarmTimeline);
  const latestNumeric = usePulseStore((s) => s.latestNumeric);
  const latestWaveforms = usePulseStore((s) => s.latestWaveforms);
  const clearAlarmForPatient = usePulseStore((s) => s.clearAlarmForPatient);
  const roomRecovery = usePulseStore((s) => s.roomRecovery);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearNotice, setClearNotice] = useState<string | null>(null);

  const selectedNode = useMemo(
    () =>
      selectedNodeId && !selectedNodeId.startsWith("room:")
        ? nodes.find((node) => node.id === selectedNodeId) ?? null
        : null,
    [nodes, selectedNodeId]
  );

  const selectedRoom = useMemo(() => (selectedNodeId ? parseRoomSelection(selectedNodeId) : null), [selectedNodeId]);

  const patientByRoom = useMemo(() => {
    const map = new Map<string, GraphNode>();
    nodes
      .filter((node) => node.kind === "patient" && node.roomId)
      .forEach((patient) => {
        if (patient.roomId) {
          map.set(patient.roomId, patient);
        }
      });
    return map;
  }, [nodes]);

  const deviceCoverageByRoom = useMemo(() => {
    const map = new Map<string, number>();
    nodes
      .filter((node) => node.kind === "device" && node.roomId)
      .forEach((node) => {
        if (!node.roomId) return;
        map.set(node.roomId, (map.get(node.roomId) ?? 0) + 1);
      });
    return map;
  }, [nodes]);

  const signalSourcesByRoom = useMemo(() => {
    const map = new Map<string, string[]>();
    nodes
      .filter((node) => node.kind === "signal" && node.roomId)
      .forEach((node) => {
        if (!node.roomId) return;
        const existing = map.get(node.roomId) ?? [];
        const signalLabel = node.label.toUpperCase();
        if (!existing.includes(signalLabel)) {
          existing.push(signalLabel);
        }
        map.set(node.roomId, existing);
      });
    return map;
  }, [nodes]);

  const alarmByRoom = useMemo(() => {
    const map = new Map<string, (typeof alarms)[number]>();
    alarms.forEach((alarm) => map.set(alarm.roomId, alarm));
    return map;
  }, [alarms]);

  const linkedRoomId = selectedNode?.roomId ?? selectedRoom?.roomId ?? null;
  const linkedPatient = linkedRoomId ? patientByRoom.get(linkedRoomId) ?? null : null;
  const linkedAlarm = linkedRoomId ? alarmByRoom.get(linkedRoomId) ?? null : null;
  const roomSignals = linkedRoomId ? signalSourcesByRoom.get(linkedRoomId) ?? [] : [];
  const roomDeviceCoverage = linkedRoomId ? deviceCoverageByRoom.get(linkedRoomId) ?? 0 : 0;
  const recovery = linkedRoomId ? roomRecovery[linkedRoomId] : undefined;

  const activePatientId = useMemo(() => {
    if (selectedNode) {
      return extractPatientId(selectedNode.id);
    }

    if (linkedPatient) {
      return linkedPatient.id.replace("patient:", "");
    }

    return null;
  }, [linkedPatient, selectedNode]);

  const numerics = activePatientId ? latestNumeric[activePatientId] ?? null : null;
  const waveform = activePatientId ? latestWaveforms[activePatientId] ?? [] : [];
  const waveformPath = useMemo(() => toWaveformPath(waveform.slice(-120), 300, 56), [waveform]);

  const connectionCount = useMemo(() => {
    if (!selectedNode) return 0;
    return edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id).length;
  }, [edges, selectedNode]);

  const lastSignificantEvent = useMemo(() => {
    if (!linkedRoomId) return null;
    return alarmTimeline.find((event) => event.roomId === linkedRoomId) ?? null;
  }, [alarmTimeline, linkedRoomId]);

  const playbook = useMemo(() => getAlarmPlaybook(linkedAlarm?.alarmType), [linkedAlarm?.alarmType]);
  const priority = responsePriority(linkedAlarm?.severity, linkedAlarm?.decision, playbook.defaultPriority);
  const recommendedAction = recommendedActionFromDecision(linkedAlarm?.decision, playbook.defaultAction);
  const safeDelay = safeToDelayStatus(priority, playbook, linkedAlarm?.decision);

  const hasEcg = roomSignals.some((signal) => signal.includes("ECG"));
  const hasSpo2 = roomSignals.some((signal) => signal.includes("SPO2") || signal.includes("PPG"));
  const hasResp = roomSignals.some((signal) => signal.includes("RESP") || signal.includes("RR"));

  const roomStatus = useMemo(() => {
    if (!linkedPatient) return "Stable";
    if (!linkedAlarm && recovery) return "Under Observation";
    if (!linkedAlarm) return "Stable";

    if (priority === "Immediate Escalation Required") return "Escalated";
    if (priority === "Urgent Bedside Response") return "Active Alarm";
    return "Under Review";
  }, [linkedAlarm, linkedPatient, priority, recovery]);

  const activeIssue = linkedAlarm
    ? `${humanizeAlarmType(linkedAlarm.alarmType)} Under ${roomStatus === "Escalated" ? "Escalation" : "Active Review"}`
    : recovery
      ? "Alert Cleared, Room Under Observation"
      : "No Active Issue";

  const roomMonitoringConfidence = monitoringConfidenceLabel(roomSignals.length, linkedAlarm?.uncertainty);

  const responseWorkflowPreview = playbook.responseWorkflow.slice(0, 3);
  const statusNoteFromContext = useMemo(() => {
    const statusNote = linkedAlarm?.context?.status_note;
    if (typeof statusNote === "string" && statusNote.trim().length > 0) return statusNote;
    return linkedAlarm ? `Still Active • Detected ${timeSince(linkedAlarm.timestamp)} Ago` : "No Active Issue";
  }, [linkedAlarm]);

  useEffect(() => {
    setClearNotice(null);
  }, [selectedNodeId, linkedAlarm?.id]);

  const handleClear = async () => {
    if (!linkedAlarm || clearBusy) return;
    setClearBusy(true);
    setClearNotice(null);
    const patientId = linkedAlarm.patientId;
    const roomId = linkedAlarm.roomId;
    clearAlarmForPatient(patientId, "Bedside Review Completed • Room Returned To Monitored Status");
    setClearNotice(`${roomId} Alert Cleared • Bedside Review Completed`);
    try {
      const response = await fetch(`${GATEWAY_HTTP_URL}/demo/clear/${patientId}`, {
        method: "POST",
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error("clear failed");
      }
    } catch {
      console.warn("PulseMesh demo: backend clear unavailable, kept local clear state for presentation.");
    } finally {
      setClearBusy(false);
    }
  };

  if (!selectedNode && !selectedRoom) {
    return (
      <Card className="panel-sheen border-[#99b8cd]/55">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Room / Monitor Details
            <span className="text-[11px] font-normal text-slate-500">Select A Room Or Bedside Node</span>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-3 text-sm text-slate-600">
          <div className="rounded-xl border border-[#b8cedd]/55 bg-white/70 p-3">
            Select any room marker or node to answer: what is happening, where, why it was flagged, and who should
            respond first.
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg border border-[#bad1df]/55 bg-white/60 p-2">
              <div className="text-slate-500">Stable Room</div>
              <div className="font-semibold text-slate-700">No Active Issue</div>
            </div>
            <div className="rounded-lg border border-[#bad1df]/55 bg-white/60 p-2">
              <div className="text-slate-500">Under Review</div>
              <div className="font-semibold text-slate-700">Bedside Team Evaluating</div>
            </div>
            <div className="rounded-lg border border-[#ecc2b2]/65 bg-[#fff7f4] p-2">
              <div className="text-slate-500">Escalated</div>
              <div className="font-semibold text-[#a64b30]">Immediate Intervention Priority</div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!selectedNode && selectedRoom) {
    const occupied = Boolean(linkedPatient);

    return (
      <Card className="panel-sheen border-[#99b8cd]/55">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Room / Monitor Details
            <span className="text-[11px] font-normal text-slate-500">Room Status Command Panel</span>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="muted">{selectedRoom.roomId}</Badge>
            <Badge variant="default">{selectedRoom.wingLabel}</Badge>
            <Badge variant={priorityVariant(priority)}>{priority}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5">
              <div className="text-slate-500">Occupancy</div>
              <div className="mt-1 font-semibold text-slate-800">{occupied ? "Occupied" : "Unassigned"}</div>
            </div>
            <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5">
              <div className="text-slate-500">Assigned Patient</div>
              <div className="mt-1 font-semibold text-slate-800">{linkedPatient ? linkedPatient.label : "No Patient Assigned"}</div>
            </div>
            <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5">
              <div className="text-slate-500">Current Room Status</div>
              <div className="mt-1 font-semibold text-slate-800">{roomStatus}</div>
            </div>
            <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5">
              <div className="text-slate-500">Device Coverage</div>
              <div className="mt-1 font-semibold text-slate-800">{roomDeviceCoverage} Bedside Devices Connected</div>
            </div>
          </div>

          <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5 text-xs">
            <div className="font-semibold text-slate-800">Monitoring Coverage</div>
            <div className="mt-1 text-slate-600">
              ECG: {hasEcg ? "Connected" : "Not Connected"} | SpO2: {hasSpo2 ? "Connected" : "Not Connected"} |
              Respiratory: {hasResp ? "Available" : "Not Available"}
            </div>
            <div className="mt-1 text-slate-500">Monitoring Confidence: {roomMonitoringConfidence}</div>
          </div>

          <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5 text-xs">
            <div className="font-semibold text-slate-800">Active Issue</div>
            <div className="mt-1 text-slate-600">{activeIssue}</div>
            <div className="mt-1 text-slate-500">{statusNoteFromContext}</div>
            {!linkedAlarm && recovery && (
              <div className="mt-1 text-slate-500">Room Returned To Monitored Status After Bedside Review.</div>
            )}
          </div>

          <div
            className={`rounded-lg border p-2.5 text-xs ${
              priority === "Immediate Escalation Required" || priority === "Urgent Bedside Response"
                ? "border-[#e0a08d]/85 bg-[#ffece6] text-[#6d2c1f]"
                : "border-[#e5b9ac]/70 bg-[#fff6f2] text-slate-700"
            }`}
          >
            <div className="font-semibold text-slate-800">Recommended Room Action</div>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              <li><strong>Action:</strong> {linkedAlarm ? recommendedAction : "Continue Routine Monitoring."}</li>
              <li><strong>Response Priority:</strong> {linkedAlarm ? priority : "Routine"}</li>
              <li><strong>Safe-To-Delay:</strong> {linkedAlarm ? safeDelay : "No Active Alarm"}</li>
              {linkedAlarm && <li><strong>Time Since Detected:</strong> {timeSince(linkedAlarm.timestamp)}</li>}
            </ul>
            {linkedAlarm && priority !== "Monitor Only" && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={clearBusy}
                  className="inline-flex items-center rounded-md border border-[#cf8a72]/85 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#803627] transition hover:bg-[#fff4ef] disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {clearBusy ? "Clearing..." : "Acknowledge And Clear"}
                </button>
              </div>
            )}
            {clearNotice && <div className="mt-2 text-xs font-medium text-[#7a3b2d]">{clearNotice}</div>}
          </div>

          <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5 text-xs">
            <div className="font-semibold text-slate-800">Last Significant Event</div>
            {lastSignificantEvent ? (
              <div className="mt-1 text-slate-600">
                {humanizeAlarmType(lastSignificantEvent.alarmType)} flagged at {new Date(lastSignificantEvent.timestamp).toLocaleTimeString()}.
              </div>
            ) : (
              <div className="mt-1 text-slate-500">No recent alarm events recorded for this room.</div>
            )}
          </div>

          <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5 text-xs text-slate-600">
            <div className="font-semibold text-slate-800">Notes</div>
            <div className="mt-1">{linkedAlarm ? playbook.policyLayer : "Room currently stable with no active safety overrides."}</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="panel-sheen border-[#99b8cd]/55">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Room / Monitor Details
          <span className="text-[11px] font-normal text-slate-500">Node-Level Context</span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3 text-sm">
        {selectedNode && (
          <>
            <div className="flex items-center gap-2">
              <Badge variant="muted">{nodeKindLabel(selectedNode)}</Badge>
              <Badge variant="default">{linkedRoomId ?? "No Linked Room"}</Badge>
              {linkedAlarm && <Badge variant={priorityVariant(priority)}>{priority}</Badge>}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5">
                <div className="text-slate-500">Linked Room</div>
                <div className="mt-1 font-semibold text-slate-800">{linkedRoomId ?? "Not Linked"}</div>
              </div>
              <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5">
                <div className="text-slate-500">Node Type</div>
                <div className="mt-1 font-semibold text-slate-800">{nodeKindLabel(selectedNode)}</div>
              </div>
              <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5">
                <div className="text-slate-500">Connections</div>
                <div className="mt-1 font-semibold text-slate-800">{connectionCount}</div>
              </div>
              <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5">
                <div className="text-slate-500">Monitoring Confidence</div>
                <div className="mt-1 font-semibold text-slate-800">{roomMonitoringConfidence}</div>
              </div>
            </div>

            <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5 text-xs">
              <div className="font-semibold text-slate-800">Monitoring Sources</div>
              <div className="mt-1 text-slate-600">
                {roomSignals.length > 0 ? roomSignals.join(" | ") : "No Monitoring Sources Linked"}
              </div>
            </div>

            {numerics && Object.keys(numerics).length > 0 && (
              <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5 text-xs">
                <div className="font-semibold text-slate-800">Latest Relevant Vitals</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {Object.entries(numerics).map(([key, value]) => (
                    <span key={key} className="rounded-md bg-[#e6f1f8] px-2 py-1 font-medium text-slate-700">
                      {key.toUpperCase()}: {Number(value).toFixed(1)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {linkedAlarm && (
              <div className="rounded-lg border border-[#e5b9ac]/70 bg-[#fff6f2] p-2.5 text-xs text-slate-700">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-semibold text-slate-800">Related Decision And Explanation</span>
                  <Badge variant={severityVariant(linkedAlarm.severity)}>{severityLabel(linkedAlarm.severity)}</Badge>
                </div>
                <ul className="list-disc space-y-1 pl-4">
                  <li><strong>Why Flagged:</strong> {playbook.detectionRuleSummary}</li>
                  <li><strong>Recommended Action:</strong> {recommendedAction}</li>
                  <li><strong>Response Order:</strong> {responseWorkflowPreview.map((step) => step.role).join(" -> ")}</li>
                </ul>
              </div>
            )}

            {waveform.length > 1 && (
              <div className="rounded-lg border border-[#b9cfde]/60 bg-white/70 p-2.5">
                <div className="mb-1 text-xs text-slate-500">Waveform Preview</div>
                <svg viewBox="0 0 300 56" className="h-16 w-full rounded-md bg-[#eef5fa]">
                  <path d={waveformPath} fill="none" stroke="#2f7b9e" strokeWidth="1.7" />
                </svg>
              </div>
            )}

          </>
        )}
      </CardContent>
    </Card>
  );
}
