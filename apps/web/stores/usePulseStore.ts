"use client";

import { create } from "zustand";

import {
  AlarmRecord,
  GatewayEnvelope,
  GraphEdge,
  GraphNode,
  InferenceResult,
  NodeKind
} from "@/types/pulse";

type PulseState = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  alarms: AlarmRecord[];
  latestWaveforms: Record<string, number[]>;
  latestNumeric: Record<string, Record<string, number>>;
  totalAlarms: number;
  suppressedAlarms: number;
  suppressionRate: number;
  lastSeq: number;
  timelineCursor: number;
  ingestEnvelope: (envelope: GatewayEnvelope) => string | null;
  applyInference: (alarmId: string, inference: InferenceResult) => void;
  setTimelineCursor: (value: number) => void;
};

const MAX_GRAPH_NODES = 220;
const MAX_GRAPH_EDGES = 360;
const MAX_ALARMS = 160;

function hashCoord(input: string, axis: "x" | "y" | "z") {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i) + axis.charCodeAt(0);
    hash |= 0;
  }
  const normalized = ((hash % 1000) + 1000) % 1000;

  if (axis === "x") return normalized / 25 - 20;
  if (axis === "y") return normalized / 80 - 6;
  return normalized / 30 - 16;
}

function mkNode(id: string, kind: NodeKind, label: string): GraphNode {
  return {
    id,
    kind,
    label,
    x: hashCoord(id, "x"),
    y: hashCoord(id, "y"),
    z: hashCoord(id, "z")
  };
}

function upsertNode(nodes: GraphNode[], candidate: GraphNode): GraphNode[] {
  if (nodes.some((n) => n.id === candidate.id)) {
    return nodes;
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

export const usePulseStore = create<PulseState>((set, get) => ({
  nodes: [],
  edges: [],
  alarms: [],
  latestWaveforms: {},
  latestNumeric: {},
  totalAlarms: 0,
  suppressedAlarms: 0,
  suppressionRate: 0,
  lastSeq: 0,
  timelineCursor: 100,
  ingestEnvelope: (envelope) => {
    const payload = envelope.payload;
    let createdAlarmId: string | null = null;

    set((state) => {
      let nodes = state.nodes;
      let edges = state.edges;
      let alarms = state.alarms;
      const latestWaveforms = { ...state.latestWaveforms };
      const latestNumeric = { ...state.latestNumeric };
      let totalAlarms = state.totalAlarms;

      if (payload.kind === "numeric_obs") {
        const patientNodeId = `patient:${payload.patient_id}`;
        const deviceNodeId = `device:${payload.device_id}`;
        const signalNodeId = `signal:${payload.patient_id}:${payload.signal_type}`;

        nodes = upsertNode(nodes, mkNode(patientNodeId, "patient", payload.patient_id.slice(0, 8)));
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
        latestWaveforms[payload.patient_id] = payload.samples;

        const patientNodeId = `patient:${payload.patient_id}`;
        const signalNodeId = `signal:${payload.patient_id}:${payload.signal_type}`;

        nodes = upsertNode(nodes, mkNode(patientNodeId, "patient", payload.patient_id.slice(0, 8)));
        nodes = upsertNode(nodes, mkNode(signalNodeId, "signal", payload.signal_type));
        edges = upsertEdge(edges, {
          id: `${patientNodeId}->${signalNodeId}`,
          source: patientNodeId,
          target: signalNodeId,
          throughput: 4
        });
      }

      if (payload.kind === "alarm") {
        const patientNodeId = `patient:${payload.patient_id}`;
        const deviceNodeId = `device:${payload.device_id}`;
        const alarmNodeId = `alarm:${envelope.id}`;

        createdAlarmId = envelope.id;

        const alarmNode = mkNode(alarmNodeId, "alarm", payload.alarm_type);
        alarmNode.severity = qualityToSeverity(payload.severity);

        nodes = upsertNode(nodes, mkNode(patientNodeId, "patient", payload.patient_id.slice(0, 8)));
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
          id: envelope.id,
          patientId: payload.patient_id,
          deviceId: payload.device_id,
          alarmType: payload.alarm_type,
          severity: qualityToSeverity(payload.severity),
          timestamp: envelope.ts,
          waveform
        };

        alarms = [newAlarm, ...alarms].slice(0, MAX_ALARMS);
        totalAlarms += 1;
      }

      return {
        nodes,
        edges,
        alarms,
        latestWaveforms,
        latestNumeric,
        totalAlarms,
        lastSeq: envelope.seq
      };
    });

    return createdAlarmId;
  },
  applyInference: (alarmId, inference) => {
    set((state) => {
      const alarms = state.alarms.map((alarm) =>
        alarm.id === alarmId
          ? {
              ...alarm,
              pActionable: inference.p_actionable,
              uncertainty: inference.uncertainty,
              decision: inference.decision,
              explanation: inference.explanation_json
            }
          : alarm
      );

      const totalAlarms = Math.max(state.totalAlarms, alarms.length);
      const suppressedAlarms = alarms.filter((a) => a.decision === "suppress").length;
      const suppressionRate = totalAlarms === 0 ? 0 : (suppressedAlarms / totalAlarms) * 100;

      return {
        alarms,
        totalAlarms,
        suppressedAlarms,
        suppressionRate
      };
    });
  },
  setTimelineCursor: (value) => set({ timelineCursor: value })
}));
