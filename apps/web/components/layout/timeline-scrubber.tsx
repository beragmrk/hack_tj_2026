"use client";

import { useMemo } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePulseStore } from "@/stores/usePulseStore";
import { FederatedReplayEvent } from "@/hooks/useFederatedReplay";

export function TimelineScrubber({
  federatedEvents
}: {
  federatedEvents: FederatedReplayEvent[];
}) {
  const alarms = usePulseStore((s) => s.alarms);
  const timelineCursor = usePulseStore((s) => s.timelineCursor);
  const setTimelineCursor = usePulseStore((s) => s.setTimelineCursor);

  const visible = useMemo(() => {
    if (alarms.length === 0) return [];
    const cutoffIndex = Math.max(1, Math.floor((timelineCursor / 100) * alarms.length));
    return alarms.slice(0, cutoffIndex);
  }, [alarms, timelineCursor]);

  return (
    <Card className="border-primary/20 bg-card/75">
      <CardHeader>
        <CardTitle className="text-sm">Unit Timeline</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-slate-300/70">
            <span>Replay cursor</span>
            <span>{timelineCursor.toFixed(0)}%</span>
          </div>
          <input
            type="range"
            min={5}
            max={100}
            value={timelineCursor}
            onChange={(event) => setTimelineCursor(Number(event.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-muted"
          />
        </div>

        <div className="max-h-24 space-y-1 overflow-auto text-xs">
          {visible.map((alarm) => (
            <div key={alarm.id} className="flex items-center justify-between rounded bg-muted/20 px-2 py-1">
              <span>{alarm.alarmType}</span>
              <span className="text-slate-400">{new Date(alarm.timestamp).toLocaleTimeString()}</span>
            </div>
          ))}
          {visible.length === 0 && <div className="text-slate-300/60">No alarms recorded</div>}
        </div>

        <div className="space-y-1 text-xs">
          <div className="font-semibold text-slate-200">Federated replay</div>
          <div className="max-h-24 space-y-1 overflow-auto">
            {federatedEvents.slice(0, 8).map((event, idx) => (
              <div key={`${event.round_id}-${event.stage}-${idx}`} className="rounded bg-muted/20 px-2 py-1">
                <div>{event.stage.replaceAll("_", " ")}</div>
                <div className="text-slate-400">{new Date(event.at).toLocaleTimeString()}</div>
              </div>
            ))}
            {federatedEvents.length === 0 && (
              <div className="text-slate-300/60">Replay cache unavailable</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
