"use client";

import { Network, Shield, Waves } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export function TopBar() {
  return (
    <header className="grid-bg rounded-xl border border-primary/20 bg-[#0b1723]/60 px-4 py-3 shadow-glow">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-primary/90">Invisible Infrastructure</div>
          <h1 className="text-2xl font-bold">PulseMesh Control Plane</h1>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <Badge variant="default" className="gap-1">
            <Network size={11} />
            PhysioNet Graph
          </Badge>
          <Badge variant="warning" className="gap-1">
            <Waves size={11} />
            Real-time telemetry
          </Badge>
          <Badge variant="muted" className="gap-1">
            <Shield size={11} />
            ZK audit traces
          </Badge>
        </div>
      </div>
    </header>
  );
}
