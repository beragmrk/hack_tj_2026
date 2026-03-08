"use client";

import { Activity, AlertTriangle, ShieldCheck } from "lucide-react";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePulseStore } from "@/stores/usePulseStore";
import { FederatedRound } from "@/types/pulse";

export function UnitOverview({
  socketState,
  messages,
  rounds
}: {
  socketState: string;
  messages: number;
  rounds: FederatedRound[];
}) {
  const alarms = usePulseStore((s) => s.alarms);
  const suppressionRate = usePulseStore((s) => s.suppressionRate);

  const topAlarms = useMemo(() => {
    const map = new Map<string, number>();
    alarms.forEach((alarm) => map.set(alarm.alarmType, (map.get(alarm.alarmType) ?? 0) + 1));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [alarms]);

  return (
    <Card className="border-primary/20 bg-card/75">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Unit Overview
          <Badge variant={socketState === "connected" ? "default" : "warning"}>{socketState}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-primary/20 bg-muted/25 p-2">
            <div className="mb-1 flex items-center gap-1 text-xs text-slate-300/70">
              <Activity size={12} />
              Stream packets
            </div>
            <div className="text-base font-semibold">{messages}</div>
          </div>
          <div className="rounded-lg border border-primary/20 bg-muted/25 p-2">
            <div className="mb-1 flex items-center gap-1 text-xs text-slate-300/70">
              <AlertTriangle size={12} />
              Alarms
            </div>
            <div className="text-base font-semibold">{alarms.length}</div>
          </div>
          <div className="rounded-lg border border-primary/20 bg-muted/25 p-2">
            <div className="mb-1 flex items-center gap-1 text-xs text-slate-300/70">
              <ShieldCheck size={12} />
              Suppression
            </div>
            <div className="text-base font-semibold">{suppressionRate.toFixed(1)}%</div>
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs font-semibold text-slate-200">Top alarm classes</div>
          <div className="space-y-1 text-xs">
            {topAlarms.length === 0 && <div className="text-slate-300/60">No alarm traffic yet</div>}
            {topAlarms.map(([name, count]) => (
              <div key={name} className="flex items-center justify-between rounded bg-muted/20 px-2 py-1">
                <span>{name}</span>
                <span className="text-slate-300/80">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs font-semibold text-slate-200">Federated rounds</div>
          <div className="space-y-1 text-xs">
            {rounds.map((round) => (
              <div key={round.id} className="rounded bg-muted/20 px-2 py-1">
                <div className="font-medium">{round.id.slice(-4)} | AUROC {Number(round.agg_metrics_json.auroc ?? 0).toFixed(3)}</div>
                <div className="text-slate-400">{new Date(round.started_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
