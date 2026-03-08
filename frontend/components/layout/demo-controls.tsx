"use client";

import { PauseCircle, PlayCircle, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { usePulseStore } from "@/stores/usePulseStore";

type DemoStatus = {
  scenario_id: string;
  scenario_label: string;
  index: number;
  total: number;
  paused: boolean;
};

type LocalScenario = {
  id: string;
  label: string;
  stateLabel: string;
};

const GATEWAY_HTTP_URL = process.env.NEXT_PUBLIC_GATEWAY_HTTP_URL ?? "http://localhost:8080";

const LOCAL_SCENARIOS: LocalScenario[] = [
  {
    id: "baseline_monitoring",
    label: "Baseline Monitoring",
    stateLabel: "Baseline Monitoring State"
  },
  {
    id: "nurse_attention_needed",
    label: "Nurse Attention Needed",
    stateLabel: "Nurse Attention Needed State"
  },
  {
    id: "escalation_in_progress",
    label: "Escalation In Progress",
    stateLabel: "Escalation In Progress State"
  },
  {
    id: "recovery_observation",
    label: "Recovery / Observation",
    stateLabel: "Recovery / Observation State"
  }
];

async function fetchDemoStatus(): Promise<DemoStatus> {
  const response = await fetch(`${GATEWAY_HTTP_URL}/demo/status`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("failed to fetch demo status");
  }
  return (await response.json()) as DemoStatus;
}

async function fetchDemoStatusWithRetry(retries = 1): Promise<DemoStatus> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchDemoStatus();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  }
  throw lastError ?? new Error("failed to fetch demo status");
}

async function postDemoAction(path: string): Promise<void> {
  const response = await fetch(`${GATEWAY_HTTP_URL}${path}`, {
    method: "POST",
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error("failed to update demo scenario");
  }
}

function scenarioIndexFromRemote(status: DemoStatus): number {
  const byIndex = Number.isFinite(status.index) ? status.index : 0;
  const normalizedIndex = ((byIndex % LOCAL_SCENARIOS.length) + LOCAL_SCENARIOS.length) % LOCAL_SCENARIOS.length;
  const label = status.scenario_label.toLowerCase();

  if (label.includes("baseline")) return 0;
  if (label.includes("nurse") || label.includes("attention")) return 1;
  if (label.includes("escalat")) return 2;
  if (label.includes("recover") || label.includes("observ")) return 3;

  return normalizedIndex;
}

function cycleIndex(current: number, delta: number): number {
  const total = LOCAL_SCENARIOS.length;
  return ((current + delta) % total + total) % total;
}

export function DemoControls({ socketState }: { socketState: string }) {
  const clearDemoHistory = usePulseStore((s) => s.clearDemoHistory);
  const clearLocalResolutions = usePulseStore((s) => s.clearLocalResolutions);
  const captureBaselineSnapshot = usePulseStore((s) => s.captureBaselineSnapshot);
  const restoreBaselineSnapshot = usePulseStore((s) => s.restoreBaselineSnapshot);
  const setLocalLiveUpdatesPaused = usePulseStore((s) => s.setLocalLiveUpdatesPaused);
  const nodeCount = usePulseStore((s) => s.nodes.length);
  const alarmCount = usePulseStore((s) => s.alarms.length);

  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const warnedStatusRef = useRef(false);
  const warnedActionRef = useRef(false);
  const actionSeqRef = useRef(0);

  const scenario = LOCAL_SCENARIOS[scenarioIndex] ?? LOCAL_SCENARIOS[0];

  useEffect(() => {
    if (nodeCount > 0 || alarmCount > 0) {
      captureBaselineSnapshot();
    }
  }, [alarmCount, captureBaselineSnapshot, nodeCount]);

  useEffect(() => {
    let mounted = true;

    const syncStatus = async () => {
      try {
        const status = await fetchDemoStatusWithRetry(1);
        if (!mounted) return;
        setScenarioIndex(scenarioIndexFromRemote(status));
        setPaused(status.paused);
        setLocalLiveUpdatesPaused(status.paused);
        warnedStatusRef.current = false;
      } catch {
        if (!warnedStatusRef.current) {
          console.warn("PulseMesh demo: scenario controls API unavailable; continuing in local control mode.");
          warnedStatusRef.current = true;
        }
      }
    };

    void syncStatus();
    const interval = setInterval(() => {
      void syncStatus();
    }, 45_000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [setLocalLiveUpdatesPaused]);

  const syncControlToGateway = async (path: string) => {
    const requestId = actionSeqRef.current + 1;
    actionSeqRef.current = requestId;

    try {
      await postDemoAction(path);
      const status = await fetchDemoStatusWithRetry(1);
      if (requestId !== actionSeqRef.current) return;
      setScenarioIndex(scenarioIndexFromRemote(status));
      setPaused(status.paused);
      setLocalLiveUpdatesPaused(status.paused);
      warnedActionRef.current = false;
    } catch {
      if (!warnedActionRef.current) {
        console.warn("PulseMesh demo: action sync unavailable; retained local scenario state.");
        warnedActionRef.current = true;
      }
    }
  };

  const handlePreviousScenario = () => {
    setScenarioIndex((current) => cycleIndex(current, -1));
    clearLocalResolutions();
    void syncControlToGateway("/demo/previous");
  };

  const handleNextScenario = () => {
    setScenarioIndex((current) => cycleIndex(current, 1));
    clearLocalResolutions();
    void syncControlToGateway("/demo/next");
  };

  const handlePause = () => {
    setPaused(true);
    setLocalLiveUpdatesPaused(true);
    void syncControlToGateway("/demo/pause");
  };

  const handleResume = () => {
    setPaused(false);
    setLocalLiveUpdatesPaused(false);
    void syncControlToGateway("/demo/resume");
  };

  const handleReset = () => {
    setScenarioIndex(0);
    setPaused(true);
    setLocalLiveUpdatesPaused(true);
    restoreBaselineSnapshot();
    clearLocalResolutions();
    clearDemoHistory();
    void syncControlToGateway("/demo/reset");
  };

  const statusMessage = useMemo(() => {
    if (paused && scenarioIndex === 0) {
      return "Status: Unit Is Stable • Baseline Monitoring State";
    }

    if (paused) {
      return `Status: Live Updates Paused • ${scenario.stateLabel}`;
    }

    return `Status: Scenario ${scenarioIndex + 1} Active • ${scenario.stateLabel}`;
  }, [paused, scenario.stateLabel, scenarioIndex]);

  return (
    <section className="rounded-2xl border border-[#99b8cd]/55 bg-white/86 p-3.5 shadow-[0_10px_24px_rgba(57,98,126,0.1)]">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600">Demo Controls</div>
          <div className="text-sm font-semibold text-slate-800">{scenario.label}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="muted">{scenarioIndex + 1}/{LOCAL_SCENARIOS.length}</Badge>
          <Badge variant={paused ? "warning" : "default"}>
            {paused ? "Paused" : socketState === "connected" ? "Live" : "Local"}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
        <button
          type="button"
          onClick={handlePreviousScenario}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#b8cddc]/80 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-[#eef5fa]"
        >
          <SkipBack size={13} />
          Previous Scenario
        </button>

        <button
          type="button"
          onClick={handleNextScenario}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#b8cddc]/80 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-[#eef5fa]"
        >
          <SkipForward size={13} />
          Next Scenario
        </button>

        <button
          type="button"
          onClick={handlePause}
          disabled={paused}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#b8cddc]/80 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-[#eef5fa] disabled:cursor-not-allowed disabled:opacity-55"
        >
          <PauseCircle size={13} />
          Pause Live Updates
        </button>

        <button
          type="button"
          onClick={handleResume}
          disabled={!paused}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#b8cddc]/80 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-[#eef5fa] disabled:cursor-not-allowed disabled:opacity-55"
        >
          <PlayCircle size={13} />
          Resume Live Updates
        </button>

        <button
          type="button"
          onClick={handleReset}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#b8cddc]/80 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-[#eef5fa]"
        >
          <RotateCcw size={13} />
          Reset Demo
        </button>
      </div>

      <div className="mt-2 text-xs text-slate-500">{statusMessage}</div>
    </section>
  );
}
