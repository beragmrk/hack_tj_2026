"use client";

import { useMemo } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FederatedReplayEvent } from "@/hooks/useFederatedReplay";
import { humanizeAlarmType } from "@/lib/clinical-copy";
import { usePulseStore } from "@/stores/usePulseStore";

export function TimelineScrubber({
  federatedEvents
}: {
  federatedEvents: FederatedReplayEvent[];
}) {
  const alarmTimeline = usePulseStore((s) => s.alarmTimeline);
  const timelineCursor = usePulseStore((s) => s.timelineCursor);
  const setTimelineCursor = usePulseStore((s) => s.setTimelineCursor);

  const timelineWindow = useMemo(() => {
    const eventTimes = federatedEvents
      .map((event) => new Date(event.at).getTime())
      .filter((value) => Number.isFinite(value));

    if (eventTimes.length === 0) {
      const now = Date.now();
      return { minTs: now - 60_000, maxTs: now };
    }

    return {
      minTs: Math.min(...eventTimes),
      maxTs: Math.max(...eventTimes)
    };
  }, [federatedEvents]);

  const cursorTs = useMemo(() => {
    const span = Math.max(1, timelineWindow.maxTs - timelineWindow.minTs);
    return timelineWindow.minTs + (timelineCursor / 100) * span;
  }, [timelineCursor, timelineWindow.maxTs, timelineWindow.minTs]);

  const visibleAlarms = useMemo(() => {
    if (alarmTimeline.length === 0) return [];
    return alarmTimeline.filter((alarm) => new Date(alarm.timestamp).getTime() <= cursorTs).slice(0, 20);
  }, [alarmTimeline, cursorTs]);

  const visibleReplayEvents = useMemo(
    () => federatedEvents.filter((event) => new Date(event.at).getTime() <= cursorTs).slice(-8),
    [cursorTs, federatedEvents]
  );

  const stageLabel = (stage: string): string =>
    stage
      .replaceAll("_", " ")
      .split(" ")
      .filter((part) => part.length > 0)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");

  return (
    <Card className="panel-sheen border-[#99b8cd]/55">
      <CardHeader>
        <CardTitle>Clinical Timeline</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3.5">
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
            <span>Time Replay Slider</span>
            <span className="font-semibold text-slate-600">{timelineCursor.toFixed(0)}%</span>
          </div>

          <input
            type="range"
            min={5}
            max={100}
            value={timelineCursor}
            onChange={(event) => setTimelineCursor(Number(event.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[#d2e1eb]"
          />

          <div className="mt-1.5 text-xs text-slate-500">Selected Time: {new Date(cursorTs).toLocaleString()}</div>
        </div>

        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-slate-600">Alarm Events At This Time</div>
            <div className="clinical-scrollbar max-h-28 space-y-1 overflow-auto pr-1 text-xs">
              {visibleAlarms.map((alarm) => (
                <div key={`${alarm.id}-${alarm.timestamp}`} className="rounded-lg border border-[#bfd3e0]/65 bg-white/70 px-2.5 py-1.5">
                  <div className="font-medium text-slate-700">{alarm.roomId} - {humanizeAlarmType(alarm.alarmType)}</div>
                  <div className="text-slate-500">{new Date(alarm.timestamp).toLocaleTimeString()}</div>
                </div>
              ))}
              {visibleAlarms.length === 0 && <div className="text-slate-500">No Alarms At Selected Time</div>}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-slate-600">Learning And Audit Events</div>
            <div className="clinical-scrollbar max-h-28 space-y-1 overflow-auto pr-1 text-xs">
              {visibleReplayEvents.map((event, idx) => (
                <div key={`${event.round_id}-${event.stage}-${idx}`} className="rounded-lg border border-[#bfd3e0]/65 bg-white/70 px-2.5 py-1.5">
                  <div className="font-medium text-slate-700">{stageLabel(event.stage)}</div>
                  <div className="text-slate-500">{new Date(event.at).toLocaleTimeString()}</div>
                </div>
              ))}
              {visibleReplayEvents.length === 0 && <div className="text-slate-500">No Learning Events At Selected Time</div>}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
