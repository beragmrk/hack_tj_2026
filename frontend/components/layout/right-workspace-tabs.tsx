"use client";

import { BarChart3, BedDouble, BellRing, Siren } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AlarmInspector } from "@/components/inspector/alarm-inspector";
import { GraphNodeInspector } from "@/components/inspector/graph-node-inspector";
import { UnitOverview } from "@/components/layout/unit-overview";
import { usePulseStore } from "@/stores/usePulseStore";

type WorkspaceTab = "overview" | "room" | "alarm";

export function RightWorkspaceTabs({ socketState }: { socketState: string }) {
  const alarms = usePulseStore((s) => s.alarms);
  const selectedNodeId = usePulseStore((s) => s.selectedNodeId);
  const attentionEvent = usePulseStore((s) => s.attentionEvent);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");

  useEffect(() => {
    if (!selectedNodeId) return;
    if (selectedNodeId.startsWith("room:") || selectedNodeId.startsWith("alarm:") || selectedNodeId.startsWith("patient:")) {
      setActiveTab("room");
    }
  }, [selectedNodeId]);

  const roomLabel = useMemo(() => {
    if (!selectedNodeId) return "No Selection";
    if (selectedNodeId.startsWith("room:")) return "Room Selected";
    return "Node Selected";
  }, [selectedNodeId]);

  return (
    <div className="flex h-full min-h-[430px] flex-col gap-3">
      <div className="rounded-2xl border border-[#99b8cd]/55 bg-white/85 p-2.5 shadow-[0_12px_28px_rgba(57,98,126,0.12)] backdrop-blur-sm">
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold transition-all ${
              activeTab === "overview"
                ? "bg-[#d9e9f5] text-[#18435f] shadow-sm"
                : "bg-white/85 text-slate-600 hover:bg-[#edf5fb]"
            }`}
          >
            <BarChart3 size={13} />
            Live Status
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("room")}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold transition-all ${
              activeTab === "room"
                ? "bg-[#d9e9f5] text-[#18435f] shadow-sm"
                : "bg-white/85 text-slate-600 hover:bg-[#edf5fb]"
            }`}
          >
            <BedDouble size={13} />
            Room / Monitor
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("alarm")}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold transition-all ${
              activeTab === "alarm"
                ? "bg-[#ffe8de] text-[#7a341d] shadow-sm"
                : "bg-white/85 text-slate-600 hover:bg-[#fff2eb]"
            }`}
          >
            <BellRing size={13} />
            Alarm Story
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-slate-500">
          <span>Active Alarms: {alarms.length}</span>
          <span>{roomLabel}</span>
        </div>
      </div>

      {attentionEvent && (
        <div className="rounded-xl border border-[#e1a390]/85 bg-[#fff1ec] p-3 text-sm shadow-[0_8px_20px_rgba(133,64,42,0.12)]">
          <div className="flex items-center gap-1.5 font-semibold text-[#7c3422]">
            <Siren size={14} />
            {attentionEvent.title}
          </div>
          <div className="mt-1 text-[#6d3224]">
            {attentionEvent.roomId} • {attentionEvent.message}
          </div>
          <div className="text-xs text-[#7b3f31]">
            {attentionEvent.firstResponder} • {attentionEvent.responseTiming}
          </div>
        </div>
      )}

      <div className="clinical-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
        {activeTab === "overview" && (
          <UnitOverview socketState={socketState} onRoomSelected={() => setActiveTab("room")} />
        )}
        {activeTab === "room" && <GraphNodeInspector />}
        {activeTab === "alarm" && <AlarmInspector />}
      </div>
    </div>
  );
}
