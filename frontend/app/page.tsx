"use client";

import { useEffect } from "react";

import { DemoControls } from "@/components/layout/demo-controls";
import { RightWorkspaceTabs } from "@/components/layout/right-workspace-tabs";
import { TopBar } from "@/components/layout/top-bar";
import { PhysioNetGraph } from "@/components/three/physionet-graph";
import { useTelemetrySocket } from "@/hooks/useTelemetrySocket";
import { usePulseStore } from "@/stores/usePulseStore";

export default function DashboardPage() {
  const nodes = usePulseStore((s) => s.nodes);
  const edges = usePulseStore((s) => s.edges);
  const selectedNodeId = usePulseStore((s) => s.selectedNodeId);
  const setSelectedNode = usePulseStore((s) => s.setSelectedNode);
  const attentionEvent = usePulseStore((s) => s.attentionEvent);
  const recentEvents = usePulseStore((s) => s.recentEvents);
  const clearAttentionEvent = usePulseStore((s) => s.clearAttentionEvent);

  const { state: socketState } = useTelemetrySocket();

  useEffect(() => {
    if (!attentionEvent) return;
    const timeout = setTimeout(() => {
      clearAttentionEvent();
    }, 6500);
    return () => clearTimeout(timeout);
  }, [attentionEvent, clearAttentionEvent]);

  const latestEvent = recentEvents[0] ?? null;
  const showLatestEventToast =
    latestEvent && Date.now() - latestEvent.createdAt < 6500 && latestEvent.tone === "success";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1640px] flex-col gap-5 p-4 lg:p-6">
      <TopBar />

      <section className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1.55fr_1fr]">
        <div className="flex flex-col gap-3.5">
          <PhysioNetGraph
            nodes={nodes}
            edges={edges}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNode}
          />
          <DemoControls socketState={socketState} />
        </div>
        <RightWorkspaceTabs socketState={socketState} />
      </section>

      {attentionEvent && (
        <div className="pointer-events-none fixed right-5 top-5 z-50 w-[min(92vw,380px)] animate-pulse">
          <div className="rounded-xl border border-[#de8f76]/85 bg-[#fff0e9]/95 p-3 shadow-[0_16px_34px_rgba(131,61,41,0.24)] backdrop-blur-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#8d3a27]">{attentionEvent.title}</div>
            <div className="mt-0.5 text-sm font-semibold text-[#6f2f20]">
              {attentionEvent.roomId} • {attentionEvent.message}
            </div>
            <div className="mt-1 text-xs text-[#814032]">
              {attentionEvent.firstResponder} • {attentionEvent.responseTiming}
            </div>
          </div>
        </div>
      )}

      {showLatestEventToast && (
        <div className="pointer-events-none fixed right-5 top-24 z-50 w-[min(92vw,380px)]">
          <div className="rounded-xl border border-[#92c5ab]/85 bg-[#eef9f3]/95 p-3 shadow-[0_14px_30px_rgba(46,105,77,0.2)] backdrop-blur-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#2f7451]">Alert Cleared</div>
            <div className="mt-0.5 text-sm font-semibold text-[#285941]">{latestEvent.message}</div>
            <div className="mt-1 text-xs text-[#39654f]">{latestEvent.detail}</div>
          </div>
        </div>
      )}
    </main>
  );
}
