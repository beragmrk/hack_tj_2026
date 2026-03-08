"use client";

import { create } from "zustand";

import { escalationTiming, getAlarmPlaybook, responsePriority, type ResponsePriority } from "@/lib/clinical-copy";
import {
  AlarmRecord,
  GatewayEnvelope,
  GraphEdge,
  GraphNode,
  InferenceResult,
  NodeKind
} from "@/types/pulse";
import { formatPatientDisplayName } from "@/lib/patient-display";

type AttentionEvent = {
  id: string;
  roomId: string;
  alarmType: string;
  severity: "low" | "medium" | "high" | "critical";
  priority: ResponsePriority;
  firstResponder: string;
  responseTiming: string;
  title: string;
  message: string;
  createdAt: number;
};

type OperationalEventTone = "alert" | "success" | "info";

export type OperationalEvent = {
  id: string;
  roomId: string;
  message: string;
  detail: string;
  createdAt: number;
  tone: OperationalEventTone;
};

type RecoveryState = {
  patientId: string;
  clearedAt: number;
};

type PulseBaseline = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  alarms: AlarmRecord[];
  alarmTimeline: AlarmRecord[];
  latestWaveforms: Record<string, number[]>;
  latestNumeric: Record<string, Record<string, number>>;
  totalAlarms: number;
  suppressedAlarms: number;
  suppressionRate: number;
  recentEvents: OperationalEvent[];
  roomRecovery: Record<string, RecoveryState>;
  locallyClearedPatients: Record<string, number>;
};

type PulseState = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  alarms: AlarmRecord[];
  alarmTimeline: AlarmRecord[];
  selectedNodeId: string | null;
  latestWaveforms: Record<string, number[]>;
  latestNumeric: Record<string, Record<string, number>>;
  totalAlarms: number;
  suppressedAlarms: number;
  suppressionRate: number;
  lastSeq: number;
  timelineCursor: number;
  attentionEvent: AttentionEvent | null;
  recentEvents: OperationalEvent[];
  roomRecovery: Record<string, RecoveryState>;
  locallyClearedPatients: Record<string, number>;
  localLiveUpdatesPaused: boolean;
  baselineSnapshot: PulseBaseline | null;
  ingestEnvelope: (envelope: GatewayEnvelope) => string | null;
  applyInference: (alarmId: string, inference: InferenceResult, observedAt: string) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setTimelineCursor: (value: number) => void;
  setLocalLiveUpdatesPaused: (paused: boolean) => void;
  captureBaselineSnapshot: () => void;
  restoreBaselineSnapshot: () => boolean;
  clearAttentionEvent: () => void;
  clearAlarmForPatient: (patientId: string, reason?: string) => void;
  clearDemoHistory: () => void;
  clearLocalResolutions: () => void;
};

const MAX_GRAPH_NODES = 220;
const MAX_GRAPH_EDGES = 360;
const MAX_ALARMS = 160;
const MAX_ALARM_TIMELINE = 320;
const MAX_RECENT_EVENTS = 40;
const BED_COLUMNS = 4;
const ROOM_ROWS = 2;
const BED_X_SPACING = 12.2;
const BED_Z_SPACING = 8.9;
const BED_ORIGIN_X = -18.3;
const BED_ORIGIN_Z = -13.2;
const WING_Z_SPACING = 18.2;
const DEVICE_LANE_X_OFFSET = 2.45;
const SIGNAL_LANE_X_OFFSET = 3.95;
const ALARM_LANE_X_OFFSET = -2.65;

const patientFacilityById = new Map<string, string>();
const patientSlotById = new Map<string, number>();
const facilitySlotCursor = new Map<string, number>();
const facilityIndexById = new Map<string, number>();

function stableHash(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return ((hash % 1_000_000) + 1_000_000) % 1_000_000;
}

function jitter(input: string, spread = 1.0) {
  const unit = stableHash(input) / 1_000_000;
  return (unit * 2 - 1) * spread;
}

function registerPatientFacility(patientId: string, facilityId: string): void {
  if (!patientFacilityById.has(patientId)) {
    patientFacilityById.set(patientId, facilityId);
  }

  if (!facilityIndexById.has(facilityId)) {
    facilityIndexById.set(facilityId, facilityIndexById.size);
  }

  if (!patientSlotById.has(patientId)) {
    const cursor = facilitySlotCursor.get(facilityId) ?? 0;
    patientSlotById.set(patientId, cursor);
    facilitySlotCursor.set(facilityId, cursor + 1);
  }
}

function patientBedPosition(patientId: string) {
  const facilityId = patientFacilityById.get(patientId) ?? "default";
  const wingCapacity = BED_COLUMNS * ROOM_ROWS;
  const slot = (patientSlotById.get(patientId) ?? 0) % wingCapacity;
  const wing = facilityIndexById.get(facilityId) ?? 0;
  const col = slot % BED_COLUMNS;
  const row = Math.floor(slot / BED_COLUMNS);
  return {
    x: BED_ORIGIN_X + col * BED_X_SPACING,
    z: BED_ORIGIN_Z + row * BED_Z_SPACING + wing * WING_Z_SPACING
  };
}

function roomIdForPatient(patientId: string): string {
  const facilityId = patientFacilityById.get(patientId) ?? "default";
  const wingCapacity = BED_COLUMNS * ROOM_ROWS;
  const slot = (patientSlotById.get(patientId) ?? 0) % wingCapacity;
  const wing = facilityIndexById.get(facilityId) ?? 0;
  const roomNumber = wing * BED_COLUMNS * ROOM_ROWS + slot + 1;
  return `ICU-${String(roomNumber).padStart(2, "0")}`;
}

function fallbackPosition(id: string) {
  return {
    x: -16 + (stableHash(`${id}:x`) % 2600) / 100,
    y: -1.0 + (stableHash(`${id}:y`) % 1400) / 700,
    z: -10 + (stableHash(`${id}:z`) % 2400) / 100
  };
}

function mkNode(id: string, kind: NodeKind, label: string): GraphNode {
  if (kind === "patient") {
    const patientId = id.replace("patient:", "");
    const bed = patientBedPosition(patientId);
    const facilityId = patientFacilityById.get(patientId);
    return {
      id,
      kind,
      label,
      x: bed.x,
      y: -1.08,
      z: bed.z,
      roomId: roomIdForPatient(patientId),
      facilityId
    };
  }

  if (kind === "device") {
    const [, patientId = "", deviceId = ""] = id.split(":");
    if (patientId) {
      const bed = patientBedPosition(patientId);
      return {
        id,
        kind,
        label,
        x: bed.x + DEVICE_LANE_X_OFFSET,
        y: -0.82,
        z: bed.z + jitter(deviceId, 0.5),
        roomId: roomIdForPatient(patientId),
        facilityId: patientFacilityById.get(patientId)
      };
    }
  }

  if (kind === "signal") {
    const [, patientId = "", signalType = "signal"] = id.split(":");
    if (patientId) {
      const bed = patientBedPosition(patientId);
      const signalOffset = (stableHash(signalType) % 3) - 1;
      return {
        id,
        kind,
        label,
        x: bed.x + SIGNAL_LANE_X_OFFSET,
        y: -0.58,
        z: bed.z + signalOffset * 0.52,
        roomId: roomIdForPatient(patientId),
        facilityId: patientFacilityById.get(patientId)
      };
    }
  }

  if (kind === "alarm") {
    const [, patientId = "", alarmId = "alarm"] = id.split(":");
    if (patientId) {
      const bed = patientBedPosition(patientId);
      return {
        id,
        kind,
        label,
        x: bed.x + ALARM_LANE_X_OFFSET,
        y: -0.36,
        z: bed.z + jitter(alarmId, 0.36),
        roomId: roomIdForPatient(patientId),
        facilityId: patientFacilityById.get(patientId)
      };
    }
  }

  const fallback = fallbackPosition(id);
  return {
    id,
    kind,
    label,
    ...fallback
  };
}

function upsertNode(nodes: GraphNode[], candidate: GraphNode): GraphNode[] {
  const idx = nodes.findIndex((n) => n.id === candidate.id);
  if (idx >= 0) {
    const updated = [...nodes];
    updated[idx] = {
      ...updated[idx],
      ...candidate
    };
    return updated;
  }
  return [candidate, ...nodes].slice(0, MAX_GRAPH_NODES);
}

function upsertEdge(edges: GraphEdge[], candidate: GraphEdge): GraphEdge[] {
  const idx = edges.findIndex((e) => e.id === candidate.id);
  if (idx >= 0) {
    const updated = [...edges];
    updated[idx] = {
      ...updated[idx],
      throughput: Math.min(100, updated[idx].throughput + candidate.throughput)
    };
    return updated;
  }
  return [candidate, ...edges].slice(0, MAX_GRAPH_EDGES);
}

function qualityToSeverity(score: string): "low" | "medium" | "high" | "critical" {
  if (score === "critical") return "critical";
  if (score === "high") return "high";
  if (score === "medium") return "medium";
  return "low";
}

function toMs(ts: string): number {
  const ms = new Date(ts).getTime();
  if (Number.isFinite(ms)) {
    return ms;
  }
  return Date.now();
}

function pushRecentEvent(
  events: OperationalEvent[],
  event: Omit<OperationalEvent, "createdAt">
): OperationalEvent[] {
  const withTs: OperationalEvent = {
    ...event,
    createdAt: Date.now()
  };
  return [withTs, ...events].slice(0, MAX_RECENT_EVENTS);
}

function cloneNodes(nodes: GraphNode[]): GraphNode[] {
  return nodes.map((node) => ({ ...node }));
}

function cloneEdges(edges: GraphEdge[]): GraphEdge[] {
  return edges.map((edge) => ({ ...edge }));
}

function cloneAlarms(alarms: AlarmRecord[]): AlarmRecord[] {
  return alarms.map((alarm) => ({
    ...alarm,
    waveform: [...alarm.waveform]
  }));
}

function cloneWaveforms(source: Record<string, number[]>): Record<string, number[]> {
  const entries = Object.entries(source).map(([key, values]) => [key, [...values]]);
  return Object.fromEntries(entries);
}

function cloneNumerics(
  source: Record<string, Record<string, number>>
): Record<string, Record<string, number>> {
  const entries = Object.entries(source).map(([key, metrics]) => [key, { ...metrics }]);
  return Object.fromEntries(entries);
}

function cloneRecentEvents(events: OperationalEvent[]): OperationalEvent[] {
  return events.map((event) => ({ ...event }));
}

function cloneRoomRecovery(source: Record<string, RecoveryState>): Record<string, RecoveryState> {
  const entries = Object.entries(source).map(([roomId, state]) => [roomId, { ...state }]);
  return Object.fromEntries(entries);
}

function createBaselineSnapshot(source: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  alarms: AlarmRecord[];
  alarmTimeline: AlarmRecord[];
  latestWaveforms: Record<string, number[]>;
  latestNumeric: Record<string, Record<string, number>>;
  totalAlarms: number;
  suppressedAlarms: number;
  suppressionRate: number;
  recentEvents: OperationalEvent[];
  roomRecovery: Record<string, RecoveryState>;
  locallyClearedPatients: Record<string, number>;
}): PulseBaseline {
  return {
    nodes: cloneNodes(source.nodes),
    edges: cloneEdges(source.edges),
    alarms: cloneAlarms(source.alarms),
    alarmTimeline: cloneAlarms(source.alarmTimeline),
    latestWaveforms: cloneWaveforms(source.latestWaveforms),
    latestNumeric: cloneNumerics(source.latestNumeric),
    totalAlarms: source.totalAlarms,
    suppressedAlarms: source.suppressedAlarms,
    suppressionRate: source.suppressionRate,
    recentEvents: cloneRecentEvents(source.recentEvents),
    roomRecovery: cloneRoomRecovery(source.roomRecovery),
    locallyClearedPatients: { ...source.locallyClearedPatients }
  };
}

function responsePriorityRank(priority: ResponsePriority | string): number {
  if (priority === "Immediate Escalation Required") return 4;
  if (priority === "Urgent Bedside Response") return 3;
  if (priority === "Bedside Review Recommended") return 2;
  if (priority === "Monitor Only") return 1;
  return 0;
}

function priorityForAlarm(
  alarmType: string,
  severity: AlarmRecord["severity"],
  decision: AlarmRecord["decision"]
): ResponsePriority {
  const playbook = getAlarmPlaybook(alarmType);
  return responsePriority(severity, decision, playbook.defaultPriority);
}

export const usePulseStore = create<PulseState>((set) => ({
  nodes: [],
  edges: [],
  alarms: [],
  alarmTimeline: [],
  selectedNodeId: null,
  latestWaveforms: {},
  latestNumeric: {},
  totalAlarms: 0,
  suppressedAlarms: 0,
  suppressionRate: 0,
  lastSeq: 0,
  timelineCursor: 100,
  attentionEvent: null,
  recentEvents: [],
  roomRecovery: {},
  locallyClearedPatients: {},
  localLiveUpdatesPaused: false,
  baselineSnapshot: null,
  ingestEnvelope: (envelope) => {
    const payload = envelope.payload;
    let createdAlarmId: string | null = null;

    set((state) => {
      let nodes = state.nodes;
      let edges = state.edges;
      let alarms = state.alarms;
      let alarmTimeline = state.alarmTimeline;
      const latestWaveforms = { ...state.latestWaveforms };
      const latestNumeric = { ...state.latestNumeric };
      let totalAlarms = state.totalAlarms;
      let attentionEvent = state.attentionEvent;
      let recentEvents = state.recentEvents;
      let roomRecovery = state.roomRecovery;
      let locallyClearedPatients = state.locallyClearedPatients;
      let baselineSnapshot = state.baselineSnapshot;
      const nowMs = toMs(envelope.ts);

      if (payload.kind === "numeric_obs") {
        registerPatientFacility(payload.patient_id, payload.facility_id);
        const patientNodeId = `patient:${payload.patient_id}`;
        const deviceNodeId = `device:${payload.patient_id}:${payload.device_id}`;
        const signalNodeId = `signal:${payload.patient_id}:${payload.signal_type}`;

        nodes = upsertNode(nodes, mkNode(patientNodeId, "patient", formatPatientDisplayName(payload.patient_id)));
        nodes = upsertNode(nodes, mkNode(deviceNodeId, "device", payload.signal_type.toUpperCase()));
        nodes = upsertNode(nodes, mkNode(signalNodeId, "signal", payload.signal_type));
        latestNumeric[payload.patient_id] = {
          ...(latestNumeric[payload.patient_id] ?? {}),
          [payload.signal_type]: payload.value
        };

        edges = upsertEdge(edges, {
          id: `${patientNodeId}->${deviceNodeId}`,
          source: patientNodeId,
          target: deviceNodeId,
          throughput: 2
        });
        edges = upsertEdge(edges, {
          id: `${deviceNodeId}->${signalNodeId}`,
          source: deviceNodeId,
          target: signalNodeId,
          throughput: 3
        });
      }

      if (payload.kind === "waveform") {
        registerPatientFacility(payload.patient_id, payload.facility_id);
        latestWaveforms[payload.patient_id] = payload.samples;

        const patientNodeId = `patient:${payload.patient_id}`;
        const deviceNodeId = `device:${payload.patient_id}:${payload.device_id}`;
        const signalNodeId = `signal:${payload.patient_id}:${payload.signal_type}`;

        nodes = upsertNode(nodes, mkNode(patientNodeId, "patient", formatPatientDisplayName(payload.patient_id)));
        nodes = upsertNode(nodes, mkNode(deviceNodeId, "device", payload.signal_type.toUpperCase()));
        nodes = upsertNode(nodes, mkNode(signalNodeId, "signal", payload.signal_type));
        edges = upsertEdge(edges, {
          id: `${patientNodeId}->${deviceNodeId}`,
          source: patientNodeId,
          target: deviceNodeId,
          throughput: 2
        });
        edges = upsertEdge(edges, {
          id: `${deviceNodeId}->${signalNodeId}`,
          source: deviceNodeId,
          target: signalNodeId,
          throughput: 4
        });
      }

      if (payload.kind === "alarm") {
        if (!locallyClearedPatients[payload.patient_id]) {

          registerPatientFacility(payload.patient_id, payload.facility_id);
          const patientNodeId = `patient:${payload.patient_id}`;
          const deviceNodeId = `device:${payload.patient_id}:${payload.device_id}`;
          const alarmNodeId = `alarm:${payload.patient_id}`;
          const roomId = roomIdForPatient(payload.patient_id);
          const previousAlarm = alarms.find((alarm) => alarm.roomId === roomId) ?? null;

          const staleAlarmNodeIds = nodes
            .filter((node) => node.kind === "alarm" && node.roomId === roomId && node.id !== alarmNodeId)
            .map((node) => node.id);
          if (staleAlarmNodeIds.length > 0) {
            const stale = new Set(staleAlarmNodeIds);
            nodes = nodes.filter((node) => !stale.has(node.id));
            edges = edges.filter((edge) => !stale.has(edge.source) && !stale.has(edge.target));
          }

          createdAlarmId = alarmNodeId;

          const alarmNode = mkNode(alarmNodeId, "alarm", payload.alarm_type);
          alarmNode.severity = qualityToSeverity(payload.severity);

          nodes = upsertNode(nodes, mkNode(patientNodeId, "patient", formatPatientDisplayName(payload.patient_id)));
          nodes = upsertNode(nodes, mkNode(deviceNodeId, "device", payload.device_id.slice(0, 8)));
          nodes = upsertNode(nodes, alarmNode);

          edges = upsertEdge(edges, {
            id: `${patientNodeId}->${alarmNodeId}`,
            source: patientNodeId,
            target: alarmNodeId,
            throughput: 6
          });

          edges = upsertEdge(edges, {
            id: `${deviceNodeId}->${alarmNodeId}`,
            source: deviceNodeId,
            target: alarmNodeId,
            throughput: 5
          });

          const waveform = latestWaveforms[payload.patient_id] ?? [];

          const newAlarm: AlarmRecord = {
            id: alarmNodeId,
            patientId: payload.patient_id,
            deviceId: payload.device_id,
            roomId,
            alarmType: payload.alarm_type,
            severity: qualityToSeverity(payload.severity),
            timestamp: envelope.ts,
            waveform,
            context: payload.raw_payload_json
          };

          const activeIdx = alarms.findIndex((alarm) => alarm.roomId === roomId);
          let lifecycleChanged = activeIdx < 0;
          if (activeIdx >= 0) {
            const existing = alarms[activeIdx];
            lifecycleChanged =
              existing.alarmType !== newAlarm.alarmType ||
              existing.severity !== newAlarm.severity ||
              existing.patientId !== newAlarm.patientId;
            const updated = [...alarms];
            updated[activeIdx] = {
              ...existing,
              ...newAlarm,
              timestamp: existing.timestamp
            };
            alarms = updated;
          } else {
            alarms = [newAlarm, ...alarms].slice(0, MAX_ALARMS);
          }

          if (roomRecovery[roomId]) {
            const nextRecovery = { ...roomRecovery };
            delete nextRecovery[roomId];
            roomRecovery = nextRecovery;
          }
          if (locallyClearedPatients[payload.patient_id]) {
            const nextLocal = { ...locallyClearedPatients };
            delete nextLocal[payload.patient_id];
            locallyClearedPatients = nextLocal;
          }

          if (lifecycleChanged) {
            const timelineAlarm: AlarmRecord = {
              ...newAlarm,
              id: envelope.id
            };
            alarmTimeline = [timelineAlarm, ...alarmTimeline].slice(0, MAX_ALARM_TIMELINE);
            totalAlarms += 1;
          }

          const nextPriority = priorityForAlarm(newAlarm.alarmType, newAlarm.severity, newAlarm.decision);
          const nextRank = responsePriorityRank(nextPriority);
          const prevPriority = previousAlarm
            ? priorityForAlarm(previousAlarm.alarmType, previousAlarm.severity, previousAlarm.decision)
            : "Monitor Only";
          const prevRank = responsePriorityRank(prevPriority);
          const needsResponseNow = nextRank >= 2;
          const neededResponseBefore = prevRank >= 2;

          if (!neededResponseBefore && needsResponseNow) {
            const playbook = getAlarmPlaybook(newAlarm.alarmType);
            attentionEvent = {
              id: envelope.id,
              roomId: newAlarm.roomId,
              alarmType: newAlarm.alarmType,
              severity: newAlarm.severity,
              priority: nextPriority,
              firstResponder: playbook.responseWorkflow[0]?.role ?? "Bedside Nurse",
              responseTiming: escalationTiming(nextPriority)[0] ?? "Immediate Bedside Review",
              title: nextRank >= 3 ? `New Urgent Issue: ${newAlarm.roomId}` : `New Nurse Attention Needed: ${newAlarm.roomId}`,
              message: `${playbook.label} Detected`,
              createdAt: nowMs
            };
            recentEvents = pushRecentEvent(recentEvents, {
              id: envelope.id,
              roomId: newAlarm.roomId,
              message: attentionEvent.title,
              detail: `${playbook.label} • ${attentionEvent.firstResponder}`,
              tone: "alert"
            });
          } else if (neededResponseBefore && nextRank > prevRank && nextRank >= 3) {
            const playbook = getAlarmPlaybook(newAlarm.alarmType);
            attentionEvent = {
              id: envelope.id,
              roomId: newAlarm.roomId,
              alarmType: newAlarm.alarmType,
              severity: newAlarm.severity,
              priority: nextPriority,
              firstResponder: playbook.responseWorkflow[0]?.role ?? "Bedside Nurse",
              responseTiming: escalationTiming(nextPriority)[0] ?? "Escalate Immediately",
              title: `Escalation Triggered: ${newAlarm.roomId}`,
              message: `${playbook.label} Severity Increased`,
              createdAt: nowMs
            };
            recentEvents = pushRecentEvent(recentEvents, {
              id: envelope.id,
              roomId: newAlarm.roomId,
              message: attentionEvent.title,
              detail: `${playbook.label} • ${attentionEvent.responseTiming}`,
              tone: "alert"
            });
          }
        }
      }

      if (payload.kind === "alarm_clear") {
        const roomId = roomIdForPatient(payload.patient_id);
        const alarmNodeId = `alarm:${payload.patient_id}`;
        const clearedAlarm = alarms.find((alarm) => alarm.patientId === payload.patient_id && alarm.roomId === roomId) ?? null;
        alarms = alarms.filter((alarm) => alarm.patientId !== payload.patient_id && alarm.roomId !== roomId);
        nodes = nodes.filter((node) => node.id !== alarmNodeId);
        edges = edges.filter((edge) => edge.source !== alarmNodeId && edge.target !== alarmNodeId);
        roomRecovery = {
          ...roomRecovery,
          [roomId]: {
            patientId: payload.patient_id,
            clearedAt: nowMs
          }
        };
        attentionEvent =
          attentionEvent && attentionEvent.roomId === roomId
            ? null
            : attentionEvent;
        if (clearedAlarm) {
          recentEvents = pushRecentEvent(recentEvents, {
            id: envelope.id,
            roomId,
            message: `${roomId} Alert Cleared`,
            detail: "Bedside Review Completed • Room Returned To Monitored Status",
            tone: "success"
          });
        }
      }

      const suppressedAlarms = alarms.filter((alarm) => alarm.decision === "suppress").length;
      const suppressionRate = alarms.length === 0 ? 0 : (suppressedAlarms / alarms.length) * 100;

      if (!baselineSnapshot && nodes.length > 0) {
        baselineSnapshot = createBaselineSnapshot({
          nodes,
          edges,
          alarms,
          alarmTimeline,
          latestWaveforms,
          latestNumeric,
          totalAlarms,
          suppressedAlarms,
          suppressionRate,
          recentEvents,
          roomRecovery,
          locallyClearedPatients
        });
      }
      const nodeIds = new Set(nodes.map((node) => node.id));
      const selectedNodeId =
        state.selectedNodeId && (state.selectedNodeId.startsWith("room:") || nodeIds.has(state.selectedNodeId))
          ? state.selectedNodeId
          : null;

      return {
        nodes,
        edges,
        alarms,
        alarmTimeline,
        latestWaveforms,
        latestNumeric,
        totalAlarms,
        suppressedAlarms,
        suppressionRate,
        selectedNodeId,
        lastSeq: envelope.seq,
        attentionEvent,
        recentEvents,
        roomRecovery,
        locallyClearedPatients,
        baselineSnapshot
      };
    });

    return createdAlarmId;
  },
  applyInference: (alarmId, inference, observedAt) => {
    set((state) => {
      const activeAlarm = state.alarms.find((alarm) => alarm.id === alarmId);
      if (!activeAlarm || activeAlarm.timestamp !== observedAt) {
        return {};
      }

      const alarms = state.alarms.map((alarm) =>
        alarm.id === alarmId && alarm.timestamp === observedAt
          ? {
              ...alarm,
              pActionable: inference.p_actionable,
              uncertainty: inference.uncertainty,
              decision: inference.decision,
              explanation: inference.explanation_json
            }
          : alarm
      );

      const alarmTimeline = state.alarmTimeline.map((event) =>
        event.patientId === activeAlarm.patientId && event.timestamp === observedAt
          ? {
              ...event,
              pActionable: inference.p_actionable,
              uncertainty: inference.uncertainty,
              decision: inference.decision,
              explanation: inference.explanation_json
            }
          : event
      );

      const suppressedAlarms = alarms.filter((a) => a.decision === "suppress").length;
      const suppressionRate = alarms.length === 0 ? 0 : (suppressedAlarms / alarms.length) * 100;

      return {
        alarms,
        alarmTimeline,
        suppressedAlarms,
        suppressionRate
      };
    });
  },
  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),
  setTimelineCursor: (value) => set({ timelineCursor: value }),
  setLocalLiveUpdatesPaused: (paused) => set({ localLiveUpdatesPaused: paused }),
  captureBaselineSnapshot: () =>
    set((state) => {
      if (state.baselineSnapshot || state.nodes.length === 0) {
        return {};
      }

      return {
        baselineSnapshot: createBaselineSnapshot(state)
      };
    }),
  restoreBaselineSnapshot: () => {
    let restored = false;
    set((state) => {
      if (!state.baselineSnapshot) {
        return {};
      }

      const baseline = state.baselineSnapshot;
      restored = true;
      return {
        nodes: cloneNodes(baseline.nodes),
        edges: cloneEdges(baseline.edges),
        alarms: cloneAlarms(baseline.alarms),
        alarmTimeline: cloneAlarms(baseline.alarmTimeline),
        latestWaveforms: cloneWaveforms(baseline.latestWaveforms),
        latestNumeric: cloneNumerics(baseline.latestNumeric),
        totalAlarms: baseline.totalAlarms,
        suppressedAlarms: baseline.suppressedAlarms,
        suppressionRate: baseline.suppressionRate,
        selectedNodeId: null,
        attentionEvent: null,
        recentEvents: [],
        roomRecovery: cloneRoomRecovery(baseline.roomRecovery),
        locallyClearedPatients: {},
        timelineCursor: 100
      };
    });
    return restored;
  },
  clearAttentionEvent: () => set({ attentionEvent: null }),
  clearAlarmForPatient: (patientId, reason) =>
    set((state) => {
      const roomId = roomIdForPatient(patientId);
      const alarmNodeId = `alarm:${patientId}`;
      const hadAlarm = state.alarms.some((alarm) => alarm.patientId === patientId || alarm.roomId === roomId);
      if (!hadAlarm) {
        return {};
      }

      return {
        alarms: state.alarms.filter((alarm) => alarm.patientId !== patientId && alarm.roomId !== roomId),
        nodes: state.nodes.filter((node) => node.id !== alarmNodeId),
        edges: state.edges.filter((edge) => edge.source !== alarmNodeId && edge.target !== alarmNodeId),
        attentionEvent:
          state.attentionEvent && state.attentionEvent.roomId === roomId
            ? null
            : state.attentionEvent,
        roomRecovery: {
          ...state.roomRecovery,
          [roomId]: {
            patientId,
            clearedAt: Date.now()
          }
        },
        locallyClearedPatients: {
          ...state.locallyClearedPatients,
          [patientId]: Date.now()
        },
        recentEvents: pushRecentEvent(state.recentEvents, {
          id: `manual-clear:${patientId}:${Date.now()}`,
          roomId,
          message: `${roomId} Alert Cleared`,
          detail: reason ?? "Bedside Review Completed • Room Returned To Monitored Status",
          tone: "success"
        })
      };
    }),
  clearDemoHistory: () =>
    set({
      attentionEvent: null,
      recentEvents: [],
      alarmTimeline: []
    }),
  clearLocalResolutions: () =>
    set({
      roomRecovery: {},
      locallyClearedPatients: {}
    })
}));
