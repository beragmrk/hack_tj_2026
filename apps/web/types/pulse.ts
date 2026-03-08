export type NodeKind = "patient" | "device" | "signal" | "alarm";

export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
  z: number;
  severity?: "low" | "medium" | "high" | "critical";
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  throughput: number;
}

export interface AlarmRecord {
  id: string;
  patientId: string;
  deviceId: string;
  alarmType: string;
  severity: "low" | "medium" | "high" | "critical";
  timestamp: string;
  waveform: number[];
  pActionable?: number;
  uncertainty?: number;
  decision?: "suppress" | "route_clinician" | "route_rapid_response";
  explanation?: Record<string, unknown>;
}

export type GatewayPayload =
  | {
      kind: "numeric_obs";
      facility_id: string;
      patient_id: string;
      device_id: string;
      signal_type: string;
      value: number;
      quality_flag: string;
    }
  | {
      kind: "waveform";
      facility_id: string;
      patient_id: string;
      device_id: string;
      signal_type: string;
      sample_hz: number;
      samples: number[];
    }
  | {
      kind: "alarm";
      facility_id: string;
      patient_id: string;
      device_id: string;
      alarm_type: string;
      severity: "low" | "medium" | "high" | "critical";
      raw_payload_json: Record<string, unknown>;
    }
  | {
      kind: "system";
      message: string;
      source: string;
    };

export interface GatewayEnvelope {
  id: string;
  seq: number;
  ts: string;
  payload: GatewayPayload;
}

export interface InferenceResult {
  alarm_id: string;
  patient_id: string;
  model_version_id: string;
  p_actionable: number;
  uncertainty: number;
  decision: "suppress" | "route_clinician" | "route_rapid_response";
  explanation_json: Record<string, unknown>;
}

export interface FederatedRound {
  id: string;
  started_at: string;
  ended_at: string;
  participants_json: Array<Record<string, unknown>>;
  agg_metrics_json: Record<string, unknown>;
}
