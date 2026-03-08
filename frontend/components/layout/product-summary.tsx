"use client";

import { ChevronDown, ShieldCheck, Stethoscope } from "lucide-react";

import { listAlarmPlaybooks } from "@/lib/clinical-copy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ProductSummary() {
  const playbooks = listAlarmPlaybooks();

  return (
    <Card className="panel-sheen border-[#99b8cd]/55">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          What PulseMesh Is
          <span className="text-[11px] font-normal text-slate-500">Clinical decision-support command layer</span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3.5 text-sm text-slate-700">
        <div className="rounded-xl border border-[#b9cfde]/60 bg-white/75 p-3.5 leading-relaxed">
          PulseMesh turns hidden ICU monitor data into a real-time clinical command layer. It continuously reviews
          waveform signals, bedside vitals, and alarm patterns to identify which alerts are likely to need real
          clinician response. It reduces alarm fatigue by prioritizing meaningful events, recommending who should
          respond first, and applying safety rules so dangerous alarms are never blindly suppressed. All decisions stay
          privacy-conscious and audit-ready.
        </div>

        <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
          <div className="rounded-lg border border-[#b9cfde]/60 bg-white/75 p-3 text-xs">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-800">
              <Stethoscope size={13} />
              What Problem It Solves
            </div>
            <div className="text-slate-600">
              ICU teams are overwhelmed by non-actionable alarms. PulseMesh helps teams focus on alarms most likely to
              require immediate clinical response.
            </div>
          </div>

          <div className="rounded-lg border border-[#b9cfde]/60 bg-white/75 p-3 text-xs">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-800">How Alarms Are Analyzed</div>
            <div className="text-slate-600">
              Numeric thresholds, waveform patterns, trend windows, and model inference are combined with bedside-safe
              policy logic before a recommendation is issued.
            </div>
          </div>

          <div className="rounded-lg border border-[#b9cfde]/60 bg-white/75 p-3 text-xs">
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-800">
                <ShieldCheck size={13} />
                Safety, Privacy, Auditability
              </div>
            <div className="text-slate-600">
              Safety rules block unsafe suppression, sensitive feature data stays protected, and every recommendation is
              retained with a verifiable audit record.
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#b9cfde]/60 bg-white/75 p-3">
          <div className="mb-1 text-sm font-semibold text-slate-800">How PulseMesh Decides</div>
          <ol className="space-y-1.5 text-xs text-slate-600">
            <li>1. Bedside monitors and waveform feeds stream patient signals.</li>
            <li>2. PulseMesh checks numeric thresholds and waveform patterns.</li>
            <li>3. The inference layer estimates whether the event likely needs clinician action.</li>
            <li>4. Safety rules block unsafe suppression.</li>
            <li>5. The platform recommends the next best response and escalation order.</li>
            <li>6. Every decision is retained for audit and review.</li>
          </ol>
        </div>

        <details className="group rounded-xl border border-[#b9cfde]/60 bg-white/75 p-3">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-800">
            Standard Alarm Meaning Reference
            <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" />
          </summary>

          <div className="mt-2.5 space-y-2 text-xs text-slate-600">
            {playbooks.map((book) => (
              <div key={book.alarmType} className="rounded-lg border border-[#c5d7e3]/65 bg-[#f6fafc] p-2.5">
                <div className="font-semibold text-slate-700">{book.label}</div>
                <div>{book.meaning}</div>
              </div>
            ))}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
