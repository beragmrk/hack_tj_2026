"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function AlarmInspector() {
  const alarms = usePulseStore((s) => s.alarms);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(() => {
    if (!alarms.length) return null;
    if (!selectedId) return alarms[0];
    return alarms.find((a) => a.id === selectedId) ?? alarms[0];
  }, [alarms, selectedId]);

  const path = useMemo(() => toPath(selected?.waveform ?? [], 360, 92), [selected?.waveform]);
  const proofCommitment = useMemo(() => {
    const proof = selected?.explanation?.proof;
    if (!proof || typeof proof !== "object") return null;
    const commitment = (proof as { commitment?: unknown }).commitment;
    return typeof commitment === "string" ? commitment : null;
  }, [selected?.explanation]);

  return (
    <Card className="h-full border-primary/20 bg-card/75">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Alarm Inspector
          <span className="text-[11px] font-normal text-slate-300/80">Provenance + decision trace</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!selected && <div className="text-sm text-slate-300/70">No alarms yet. Waiting for stream.</div>}

        {selected && (
          <>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-muted/40 p-2">
                <div className="mb-1 text-slate-300/70">Alarm Type</div>
                <div className="font-semibold">{selected.alarmType}</div>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <div className="mb-1 text-slate-300/70">Severity</div>
                <Badge variant={severityVariant(selected.severity)}>{selected.severity}</Badge>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <div className="mb-1 text-slate-300/70">Actionability</div>
                <div className="font-semibold">
                  {selected.pActionable !== undefined ? `${(selected.pActionable * 100).toFixed(1)}%` : "pending"}
                </div>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <div className="mb-1 text-slate-300/70">Uncertainty</div>
                <div className="font-semibold">
                  {selected.uncertainty !== undefined ? `${(selected.uncertainty * 100).toFixed(1)}%` : "pending"}
                </div>
              </div>
            </div>

            <div className="waveform rounded-lg border border-primary/15 p-2">
              <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-300/70">Raw Waveform Window</div>
              <svg viewBox="0 0 360 92" className="h-24 w-full">
                <path d={path} fill="none" stroke="#7ff0d0" strokeWidth="2" />
              </svg>
            </div>

            <div className="space-y-2 rounded-lg border border-primary/20 bg-[#0c151f]/80 p-3 text-[11px]">
              <div className="font-semibold text-primary">Decision</div>
              <div className="text-slate-200">{selected.decision ?? "pending inference"}</div>
              <div className="text-slate-400">Patient: {selected.patientId.slice(0, 8)}...</div>
              {proofCommitment && (
                <div className="text-slate-300">
                  Proof: {proofCommitment.slice(0, 14)}...
                </div>
              )}
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-200">Recent alarms</div>
              <div className="max-h-44 space-y-1 overflow-auto pr-1">
                {alarms.slice(0, 8).map((alarm) => (
                  <button
                    key={alarm.id}
                    className={`w-full rounded-md border px-2 py-1 text-left text-xs transition ${
                      alarm.id === selected.id
                        ? "border-primary/50 bg-primary/10"
                        : "border-muted/60 bg-muted/20 hover:border-primary/25"
                    }`}
                    onClick={() => setSelectedId(alarm.id)}
                  >
                    <div className="font-medium">{alarm.alarmType}</div>
                    <div className="text-slate-400">{new Date(alarm.timestamp).toLocaleTimeString()}</div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
