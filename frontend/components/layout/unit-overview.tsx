"use client";

import { AlertTriangle, BellRing, ClipboardList, Stethoscope } from "lucide-react";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  escalationTiming,
  getAlarmPlaybook,
  humanizeAlarmType,
  recommendedActionFromDecision,
  responsePriority
} from "@/lib/clinical-copy";
import { usePulseStore } from "@/stores/usePulseStore";
import { AlarmRecord, GraphNode } from "@/types/pulse";

type BoardTone = "empty" | "stable" | "review" | "urgent";

type BoardRow = {
  roomId: string;
  selectionToken: string;
  occupied: boolean;
  patientName: string | null;
  alarm: AlarmRecord | null;
  priority: string | null;
  alarmLabel: string | null;
  firstResponder: string | null;
  responseTiming: string | null;
  recommendedAction: string | null;
  tone: BoardTone;
  statusLine: string;
};

const ROOM_IDS = Array.from({ length: 16 }, (_, idx) => `ICU-${String(idx + 1).padStart(2, "0")}`);

function toRoomSelectionToken(roomId: string): string {
  const roomNumber = Number(roomId.replace("ICU-", ""));
  const safeNumber = Number.isFinite(roomNumber) ? roomNumber : 1;
  const wing = safeNumber <= 8 ? "north" : "south";
  return `room:${wing}:${String(safeNumber).padStart(2, "0")}`;
}

function priorityRank(priority: string | null): number {
  if (priority === "Immediate Escalation Required") return 4;
  if (priority === "Urgent Bedside Response") return 3;
  if (priority === "Bedside Review Recommended") return 2;
  if (priority === "Monitor Only") return 1;
  return 0;
}

function toneForPriority(priority: string | null): BoardTone {
  if (priority === "Immediate Escalation Required") return "urgent";
  if (priority === "Urgent Bedside Response" || priority === "Bedside Review Recommended") return "review";
  if (priority === "Monitor Only") return "stable";
  return "stable";
}

function priorityBadgeVariant(priority: string | null) {
  if (priority === "Immediate Escalation Required") return "destructive" as const;
  if (priority === "Urgent Bedside Response") return "warning" as const;
  if (priority === "Bedside Review Recommended") return "default" as const;
  return "muted" as const;
}

function roomRowClasses(tone: BoardTone, isAttention: boolean): string {
  if (isAttention) {
    return "border-[#de8f79]/90 bg-[#fff0e9] ring-1 ring-[#de8f79]/55";
  }
  if (tone === "urgent") return "border-[#e0a08d]/80 bg-[#fff0ea] hover:border-[#d98c74]";
  if (tone === "review") return "border-[#dec49f]/80 bg-[#fff7ea] hover:border-[#d6b487]";
  if (tone === "stable") return "border-[#b8cfdd]/75 bg-[#f2f8fc] hover:border-[#9dbad0]";
  return "border-[#ccd8e0]/80 bg-[#f7fafc] hover:border-[#b7c8d5]";
}

function attentionTitle(priority: string | null): string {
  if (priority === "Immediate Escalation Required") return "Escalation Required";
  if (priority === "Urgent Bedside Response" || priority === "Bedside Review Recommended") {
    return "Nurse Attention Needed";
  }
  return "Monitor Closely";
}

function secondsSince(timestamp: string | null | undefined): string {
  if (!timestamp) return "Just Detected";
  const ms = new Date(timestamp).getTime();
  if (!Number.isFinite(ms)) return "Just Detected";
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec}s Active`;
  const min = Math.floor(sec / 60);
  return `${min}m Active`;
}

function compactRoomList(roomIds: string[], limit = 3): string {
  if (roomIds.length <= limit) return roomIds.join(", ") || "None";
  const visible = roomIds.slice(0, limit).join(", ");
  return `${visible} +${roomIds.length - limit} More`;
}

function severityLabel(severity: string | undefined): string {
  if (!severity) return "Unknown";
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

export function UnitOverview({
  socketState,
  onRoomSelected
}: {
  socketState: string;
  onRoomSelected?: () => void;
}) {
  const alarms = usePulseStore((s) => s.alarms);
  const nodes = usePulseStore((s) => s.nodes);
  const setSelectedNode = usePulseStore((s) => s.setSelectedNode);
  const attentionEvent = usePulseStore((s) => s.attentionEvent);
  const recentEvents = usePulseStore((s) => s.recentEvents);
  const roomRecovery = usePulseStore((s) => s.roomRecovery);

  const patientByRoom = useMemo(() => {
    const map = new Map<string, GraphNode>();
    nodes
      .filter((node) => node.kind === "patient" && node.roomId)
      .forEach((node) => {
        if (node.roomId) map.set(node.roomId, node);
      });
    return map;
  }, [nodes]);

  const alarmByRoom = useMemo(() => {
    const map = new Map<string, AlarmRecord>();
    alarms.forEach((alarm) => map.set(alarm.roomId, alarm));
    return map;
  }, [alarms]);

  const boardRows = useMemo<BoardRow[]>(() => {
    return ROOM_IDS.map((roomId) => {
      const patient = patientByRoom.get(roomId) ?? null;
      const alarm = alarmByRoom.get(roomId) ?? null;
      const occupied = Boolean(patient);

      if (!occupied && !alarm) {
        return {
          roomId,
          selectionToken: toRoomSelectionToken(roomId),
          occupied: false,
          patientName: null,
          alarm: null,
          priority: null,
          alarmLabel: null,
          firstResponder: null,
          responseTiming: null,
          recommendedAction: null,
          tone: "empty",
          statusLine: "Empty"
        };
      }

      if (!alarm) {
        const recovery = roomRecovery[roomId];
        const inObservation = Boolean(recovery && Date.now() - recovery.clearedAt < 180_000);
        return {
          roomId,
          selectionToken: toRoomSelectionToken(roomId),
          occupied,
          patientName: patient?.label ?? null,
          alarm: null,
          priority: "Monitor Only",
          alarmLabel: null,
          firstResponder: null,
          responseTiming: null,
          recommendedAction: null,
          tone: "stable",
          statusLine: inObservation ? "Occupied • Under Observation" : "Occupied • Stable"
        };
      }

      const playbook = getAlarmPlaybook(alarm.alarmType);
      const priority = responsePriority(alarm.severity, alarm.decision, playbook.defaultPriority);
      const alarmLabel = humanizeAlarmType(alarm.alarmType);
      const firstResponder = playbook.responseWorkflow[0]?.role ?? "Bedside Nurse";
      const responseTiming = escalationTiming(priority)[0] ?? "Immediate Bedside Review Recommended";
      const recommendedAction = recommendedActionFromDecision(alarm.decision, playbook.defaultAction);
      const tone = toneForPriority(priority);

      return {
        roomId,
        selectionToken: toRoomSelectionToken(roomId),
        occupied,
        patientName: patient?.label ?? null,
        alarm,
        priority,
        alarmLabel,
        firstResponder,
        responseTiming,
        recommendedAction,
        tone,
        statusLine:
          priority === "Immediate Escalation Required"
            ? `${alarmLabel} • Escalation Required`
            : priority === "Urgent Bedside Response"
              ? `${alarmLabel} • Nurse Attention Needed`
              : priority === "Bedside Review Recommended"
                ? `${alarmLabel} • Bedside Review Recommended`
                : `${alarmLabel} • Monitor Closely`
      };
    });
  }, [alarmByRoom, patientByRoom, roomRecovery]);

  const roomsNeedingResponse = useMemo(
    () => boardRows.filter((row) => row.alarm && row.priority && row.priority !== "Monitor Only"),
    [boardRows]
  );

  const occupiedRows = useMemo(() => boardRows.filter((row) => row.occupied), [boardRows]);
  const activeAlarmRows = useMemo(() => boardRows.filter((row) => Boolean(row.alarm)), [boardRows]);
  const stableMonitoredRows = useMemo(
    () => boardRows.filter((row) => row.occupied && !row.alarm),
    [boardRows]
  );

  const responseQueue = useMemo(() => {
    return [...activeAlarmRows].sort((a, b) => {
      const priorityDiff = priorityRank(b.priority) - priorityRank(a.priority);
      if (priorityDiff !== 0) return priorityDiff;
      return a.roomId.localeCompare(b.roomId);
    });
  }, [activeAlarmRows]);

  const topAttention = useMemo(() => {
    const urgent = responseQueue.find((row) => row.priority && row.priority !== "Monitor Only");
    return urgent ?? responseQueue[0] ?? null;
  }, [responseQueue]);

  const focusRoom = (room: BoardRow) => {
    setSelectedNode(room.selectionToken);
    onRoomSelected?.();
  };

  return (
    <Card className="panel-sheen border-[#99b8cd]/55">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          Live Unit Status
          <Badge variant={socketState === "connected" ? "default" : "warning"}>
            {socketState === "connected" ? "Live Monitoring" : "Reconnecting"}
          </Badge>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3 text-sm">
        {topAttention ? (
          <div
            className={`rounded-xl border p-3 ${
              topAttention.tone === "urgent"
                ? "border-[#de9480]/85 bg-[#ffe9e2]"
                : "border-[#dcbf96]/80 bg-[#fff6e8]"
            }`}
          >
            <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              <BellRing size={14} />
              {attentionTitle(topAttention.priority)}
            </div>
            <div className="mt-0.5 text-sm text-slate-700">
              {topAttention.roomId} • {topAttention.alarmLabel} • {severityLabel(topAttention.alarm?.severity)} Severity
            </div>
            <div className="text-xs text-slate-600">
              {topAttention.firstResponder} • {topAttention.responseTiming}
            </div>
            <div className="mt-1 text-xs font-medium text-slate-700">{topAttention.recommendedAction}</div>
          </div>
        ) : (
          <div className="rounded-xl border border-[#b8cfde]/70 bg-white/75 p-3 text-sm text-slate-700">
            No Active Alarms Right Now. Monitored Rooms Are Stable.
          </div>
        )}

        <div className="grid grid-cols-1 gap-2.5">
          <div className="rounded-xl border border-[#b9cfde]/65 bg-white/72 p-2.5">
            <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-600">
              <AlertTriangle size={12} />
              Rooms Needing Response
            </div>
            <div className="space-y-1 text-xs">
              {roomsNeedingResponse.length === 0 && <div className="text-slate-500">No Rooms Currently Need Bedside Response.</div>}
              {roomsNeedingResponse.slice(0, 3).map((room) => (
                <button
                  key={`response-${room.roomId}`}
                  type="button"
                  onClick={() => focusRoom(room)}
                  className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${roomRowClasses(
                    room.tone,
                    attentionEvent?.roomId === room.roomId
                  )}`}
                >
                  <div className="font-semibold text-slate-800">{room.roomId} — {room.alarmLabel}</div>
                  <div className="text-slate-600">{room.priority} • {room.firstResponder}</div>
                  <div className="text-slate-500">{secondsSince(room.alarm?.timestamp)}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[#b9cfde]/65 bg-white/72 p-2.5">
            <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-600">
              <ClipboardList size={12} />
              Response Queue
            </div>
            <ol className="space-y-1 text-xs">
              {responseQueue.length === 0 && <li className="text-slate-500">No Active Response Queue.</li>}
              {responseQueue.slice(0, 3).map((room, idx) => (
                <li key={`queue-${room.roomId}`}>
                  <button
                    type="button"
                    onClick={() => focusRoom(room)}
                    className={`w-full rounded-lg border px-2.5 py-1.5 text-left transition ${roomRowClasses(
                      room.tone,
                      attentionEvent?.roomId === room.roomId
                    )}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800">{idx + 1}. {room.roomId}</span>
                      <Badge variant={priorityBadgeVariant(room.priority)}>{room.priority}</Badge>
                    </div>
                    <div className="text-slate-600">{room.alarmLabel} • {secondsSince(room.alarm?.timestamp)}</div>
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-xl border border-[#b9cfde]/65 bg-white/72 p-2.5">
            <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-600">
              <Stethoscope size={12} />
              Occupied Now
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {occupiedRows.map((room) => (
                <button
                  key={`occupied-${room.roomId}`}
                  type="button"
                  onClick={() => focusRoom(room)}
                  className={`rounded-md border px-2 py-1 font-semibold text-slate-700 transition ${roomRowClasses(
                    room.tone,
                    attentionEvent?.roomId === room.roomId
                  )}`}
                >
                  {room.roomId}
                </button>
              ))}
            </div>
            <div className="mt-2 text-xs text-slate-600">
              Active Alarms: {compactRoomList(activeAlarmRows.map((room) => room.roomId))}
            </div>
            <div className="text-xs text-slate-500">
              Stable Monitored Rooms: {compactRoomList(stableMonitoredRows.map((room) => room.roomId), 4)}
            </div>
          </div>

          <div className="rounded-xl border border-[#b9cfde]/65 bg-white/72 p-2.5">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-600">
              Recent Handled Events
            </div>
            <div className="space-y-1 text-xs">
              {recentEvents.length === 0 && <div className="text-slate-500">No Recent Event Updates.</div>}
              {recentEvents.slice(0, 5).map((event) => (
                <div
                  key={event.id}
                  className={`rounded-md border px-2.5 py-1.5 ${
                    event.tone === "success"
                      ? "border-[#9bc9b4]/80 bg-[#edf9f2]"
                      : event.tone === "alert"
                        ? "border-[#e2b29d]/80 bg-[#fff3ee]"
                        : "border-[#b8cfdd]/75 bg-[#f2f8fc]"
                  }`}
                >
                  <div className="font-semibold text-slate-800">{event.message}</div>
                  <div className="text-slate-600">{event.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <details className="rounded-xl border border-[#b9cfde]/65 bg-white/72 p-2.5">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-600">
              All Rooms And Status
            </summary>
            <div className="mt-2 grid grid-cols-1 gap-1 text-xs">
              {boardRows.map((room) => (
                <button
                  key={`room-row-${room.roomId}`}
                  type="button"
                  onClick={() => focusRoom(room)}
                  className={`w-full rounded-lg border px-2.5 py-1.5 text-left transition ${roomRowClasses(
                    room.tone,
                    attentionEvent?.roomId === room.roomId
                  )}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800">{room.roomId}</span>
                    <Badge variant={priorityBadgeVariant(room.priority)}>{room.priority ?? "Empty"}</Badge>
                  </div>
                  <div className="text-slate-600">{room.statusLine}</div>
                </button>
              ))}
            </div>
          </details>
        </div>
      </CardContent>
    </Card>
  );
}
