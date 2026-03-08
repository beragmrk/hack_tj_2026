"use client";

import { HelpCircle, Network, Shield, Waves, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { listAlarmPlaybooks } from "@/lib/clinical-copy";

export function TopBar() {
  const [showHelp, setShowHelp] = useState(false);
  const playbooks = useMemo(() => listAlarmPlaybooks(), []);

  return (
    <>
      <header className="grid-bg rounded-2xl border border-[#97b6cb]/60 bg-[#f3f8fc]/95 px-6 py-5 shadow-[0_14px_30px_rgba(62,101,126,0.14)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[#4b7793]">Hospital Command Center</div>
            <h1 className="text-3xl font-semibold leading-none text-[#17364a] sm:text-[34px] lg:text-[38px]">
              PulseMesh Clinical Command
            </h1>
            <p className="text-sm text-[#44677f]">Real-time ICU monitoring, alarm interpretation, and response guidance</p>
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            <Badge variant="default" className="gap-1.5">
              <Network size={11} />
              Bedside Coverage Map
            </Badge>
            <Badge variant="warning" className="gap-1.5">
              <Waves size={11} />
              Alarm Triage In Real Time
            </Badge>
            <Badge variant="muted" className="gap-1.5">
              <Shield size={11} />
              Privacy-Safe Audit Trail
            </Badge>
            <button
              type="button"
              onClick={() => setShowHelp(true)}
              className="inline-flex items-center gap-1 rounded-full border border-[#9eb9cb] bg-white/92 px-3 py-1 text-xs font-semibold text-[#28536d] shadow-sm hover:bg-white"
            >
              <HelpCircle size={12} />
              About PulseMesh
            </button>
          </div>
        </div>
      </header>

      {showHelp && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="max-h-[85vh] w-full max-w-4xl overflow-auto rounded-2xl border border-[#9fb9cb]/70 bg-[#f5f9fc] p-5 shadow-[0_20px_48px_rgba(24,54,73,0.28)]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-[#17364a]">About PulseMesh</h2>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="rounded-full border border-[#9eb9cb] bg-white px-2 py-1 text-slate-600 hover:bg-slate-50"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-3 text-sm text-slate-700">
              <div className="rounded-xl bg-white/80 p-3">
                PulseMesh turns hidden ICU monitor data into a real-time clinical command layer. It continuously reviews
                waveform signals, bedside vitals, and alarm patterns to identify which alerts are likely to need real
                clinician response.
              </div>

              <div className="rounded-xl bg-white/80 p-3">
                <div className="mb-1 font-semibold text-slate-800">How PulseMesh Decides</div>
                <ol className="space-y-1 text-xs text-slate-600">
                  <li>1. Bedside monitor and waveform feeds stream room-level patient signals.</li>
                  <li>2. PulseMesh checks threshold crossings and trend windows.</li>
                  <li>3. Inference estimates whether the event likely needs clinician action.</li>
                  <li>4. Safety rules block unsafe suppression.</li>
                  <li>5. PulseMesh recommends who should respond first and what to do next.</li>
                  <li>6. Every decision is retained for clinical audit and review.</li>
                </ol>
              </div>

              <details className="rounded-xl bg-white/80 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-800">Alarm Meaning Reference</summary>
                <div className="mt-2 space-y-1.5 text-xs text-slate-600">
                  {playbooks.map((book) => (
                    <div key={book.alarmType} className="rounded-lg bg-[#edf5fa] p-2">
                      <div className="font-semibold text-slate-700">{book.label}</div>
                      <div>{book.meaning}</div>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
