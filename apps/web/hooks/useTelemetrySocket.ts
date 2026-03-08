"use client";

import { useEffect, useMemo, useState } from "react";

import { usePulseStore } from "@/stores/usePulseStore";
import { GatewayEnvelope, InferenceResult } from "@/types/pulse";

const WS_URL = process.env.NEXT_PUBLIC_GATEWAY_WS_URL ?? "ws://localhost:8080/ws";
const INFERENCE_URL = process.env.NEXT_PUBLIC_INFERENCE_URL ?? "http://localhost:8000";
const PROOF_URL = process.env.NEXT_PUBLIC_PROOF_URL ?? "http://localhost:7000";

type SocketState = "connecting" | "connected" | "disconnected";

async function enrichWithProof(inference: InferenceResult): Promise<InferenceResult> {
  try {
    const topFactors = (inference.explanation_json?.top_factors as Array<{ feature_value?: number }>) ?? [];
    const featureVector = topFactors
      .map((item) => Number(item.feature_value ?? 0))
      .filter((v) => Number.isFinite(v));

    const proveRes = await fetch(`${PROOF_URL}/prove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inference_event_id: inference.alarm_id,
        committed_feature_vector: featureVector,
        claimed_risk_score: inference.p_actionable,
        model_version_id: inference.model_version_id
      })
    });

    if (!proveRes.ok) {
      return inference;
    }

    const proof = (await proveRes.json()) as { commitment: string; proof_blob: string; scheme: string };

    return {
      ...inference,
      explanation_json: {
        ...inference.explanation_json,
        proof
      }
    };
  } catch {
    return inference;
  }
}

async function inferAlarm(alarmId: string, envelope: GatewayEnvelope): Promise<InferenceResult | null> {
  if (envelope.payload.kind !== "alarm") {
    return null;
  }

  const state = usePulseStore.getState();
  const waveform = state.latestWaveforms[envelope.payload.patient_id] ?? [];
  const numeric = state.latestNumeric[envelope.payload.patient_id] ?? {};

  try {
    const resp = await fetch(`${INFERENCE_URL}/inference`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        alarm_id: alarmId,
        patient_id: envelope.payload.patient_id,
        device_id: envelope.payload.device_id,
        alarm_type: envelope.payload.alarm_type,
        severity: envelope.payload.severity,
        observed_at: envelope.ts,
        signal_quality: String(envelope.payload.raw_payload_json?.signal_quality ?? "high"),
        numeric_snapshot: numeric,
        waveforms: waveform.length
          ? [
              {
                signal_type: "ecg",
                sample_hz: 125,
                samples: waveform.slice(-128)
              }
            ]
          : [],
        context: envelope.payload.raw_payload_json
      })
    });

    if (!resp.ok) {
      return null;
    }

    const inference = (await resp.json()) as InferenceResult;
    return enrichWithProof(inference);
  } catch {
    return null;
  }
}

export function useTelemetrySocket() {
  const ingestEnvelope = usePulseStore((s) => s.ingestEnvelope);
  const applyInference = usePulseStore((s) => s.applyInference);
  const [state, setState] = useState<SocketState>("connecting");
  const [messages, setMessages] = useState(0);

  const wsUrl = useMemo(() => WS_URL, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let alive = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      setState("connecting");
      socket = new WebSocket(wsUrl);

      socket.onopen = () => setState("connected");

      socket.onclose = () => {
        setState("disconnected");
        if (alive) {
          reconnectTimer = setTimeout(connect, 1500);
        }
      };

      socket.onerror = () => setState("disconnected");

      socket.onmessage = (event) => {
        try {
          const envelope = JSON.parse(event.data) as GatewayEnvelope;
          setMessages((prev) => prev + 1);
          const alarmId = ingestEnvelope(envelope);

          if (alarmId && envelope.payload.kind === "alarm") {
            inferAlarm(alarmId, envelope).then((inference) => {
              if (inference) {
                applyInference(alarmId, inference);
              }
            });
          }
        } catch {
          // Ignore malformed telemetry packets.
        }
      };
    };

    connect();

    return () => {
      alive = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [applyInference, ingestEnvelope, wsUrl]);

  return { state, messages };
}
