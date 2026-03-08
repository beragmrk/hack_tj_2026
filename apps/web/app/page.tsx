"use client";

import { useMemo } from "react";

import { AlarmInspector } from "@/components/inspector/alarm-inspector";
import { TimelineScrubber } from "@/components/layout/timeline-scrubber";
import { TopBar } from "@/components/layout/top-bar";
import { UnitOverview } from "@/components/layout/unit-overview";
import { PhysioNetGraph } from "@/components/three/physionet-graph";
import { useFederatedRounds } from "@/hooks/useFederatedRounds";
import { useFederatedReplay } from "@/hooks/useFederatedReplay";
import { useTelemetrySocket } from "@/hooks/useTelemetrySocket";
import { usePulseStore } from "@/stores/usePulseStore";

export default function DashboardPage() {
  const nodes = usePulseStore((s) => s.nodes);
  const edges = usePulseStore((s) => s.edges);
  const timelineCursor = usePulseStore((s) => s.timelineCursor);

  const { state: socketState, messages } = useTelemetrySocket();
  const { data: rounds = [] } = useFederatedRounds();
  const { data: replay = {} } = useFederatedReplay();

  const replayEvents = useMemo(
    () =>
      Object.values(replay)
        .flat()
        .sort((a, b) => (a.at > b.at ? -1 : 1)),
    [replay]
  );

  const slicedGraph = useMemo(() => {
    const count = Math.max(8, Math.floor((timelineCursor / 100) * nodes.length));
    const selectedNodes = nodes.slice(0, count);
    const nodeIds = new Set(selectedNodes.map((node) => node.id));
    const selectedEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));

    return {
      nodes: selectedNodes,
      edges: selectedEdges
    };
  }, [edges, nodes, timelineCursor]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1540px] flex-col gap-4 p-4 lg:p-6">
      <TopBar />

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.8fr_1fr]">
        <div className="space-y-4">
          <PhysioNetGraph nodes={slicedGraph.nodes} edges={slicedGraph.edges} />
          <TimelineScrubber federatedEvents={replayEvents} />
        </div>

        <div className="grid gap-4 lg:grid-rows-[auto_1fr]">
          <UnitOverview socketState={socketState} messages={messages} rounds={rounds.slice(0, 2)} />
          <AlarmInspector />
        </div>
      </section>
    </main>
  );
}
