export type AlarmDecision = "suppress" | "route_clinician" | "route_rapid_response" | undefined;

export type ResponsePriority =
  | "Monitor Only"
  | "Bedside Review Recommended"
  | "Urgent Bedside Response"
  | "Immediate Escalation Required";

export type AlarmPlaybook = {
  alarmType: string;
  label: string;
  meaning: string;
  clinicalSummaryTemplate: string;
  detectionRuleSummary: string;
  trendWindow: string;
  thresholdLogic: string;
  confidenceBasis: string;
  detectionSource: "Raw vitals" | "Waveform analysis" | "Combined inference";
  modelContribution: string;
  policyLayer: string;
  signalsUsed: string[];
  defaultAction: string;
  defaultPriority: ResponsePriority;
  safeToDelayDefault: string;
  suppressionGuidance: string;
  responseWorkflow: Array<{
    role: string;
    action: string;
    escalationCondition: string;
  }>;
};

const PLAYBOOKS: AlarmPlaybook[] = [
  {
    alarmType: "tachycardia",
    label: "Tachycardia",
    meaning:
      "Heart rate is elevated above the expected safe range for a sustained period.",
    clinicalSummaryTemplate:
      "Sustained elevated heart rate in this room is more likely to require bedside review than to represent a brief fluctuation.",
    detectionRuleSummary:
      "Detected from ECG-derived heart rate staying above threshold across a sustained review window.",
    trendWindow: "Sustained 60-120 second review window",
    thresholdLogic:
      "Heart rate remained above configured threshold long enough to exceed transient-noise tolerance.",
    confidenceBasis:
      "Signal quality and trend consistency checks were adequate for clinical interpretation.",
    detectionSource: "Combined inference",
    modelContribution:
      "Waveform and vital-sign features increased the likelihood this event needs clinician response.",
    policyLayer:
      "Safety policy requires bedside confirmation before any de-escalation for persistent high-rate trends.",
    signalsUsed: [
      "ECG heart rate",
      "Recent waveform segment",
      "SpO2 trend",
      "Severity score",
      "Signal quality"
    ],
    defaultAction: "Route to bedside nurse for immediate assessment.",
    defaultPriority: "Bedside Review Recommended",
    safeToDelayDefault: "Not safe to defer while elevated trend persists.",
    suppressionGuidance: "Suppression is not recommended for sustained elevated heart-rate patterns.",
    responseWorkflow: [
      {
        role: "Bedside nurse",
        action: "Assess patient and monitor placement now.",
        escalationCondition: "If elevated trend persists for 2 minutes"
      },
      {
        role: "Charge nurse",
        action: "Review trend persistence and bedside response.",
        escalationCondition: "If unresolved after bedside review"
      },
      {
        role: "Covering clinician",
        action: "Evaluate need for intervention and further testing.",
        escalationCondition: "If instability continues"
      },
      {
        role: "Rapid response team",
        action: "Activate if deterioration accelerates or multi-signal instability appears.",
        escalationCondition: "If worsening trend or hemodynamic decline"
      }
    ]
  },
  {
    alarmType: "bradycardia",
    label: "Bradycardia",
    meaning:
      "Heart rate has remained below the expected safe range for a sustained period.",
    clinicalSummaryTemplate:
      "Persistent low heart rate may represent clinically meaningful instability and should be confirmed at bedside.",
    detectionRuleSummary:
      "Detected when heart rate remains below threshold for a sustained window with acceptable signal confidence.",
    trendWindow: "Sustained 60-120 second review window",
    thresholdLogic:
      "Heart rate remained below configured threshold longer than brief physiologic fluctuation allowance.",
    confidenceBasis:
      "Signal confidence checks passed and trend remained internally consistent.",
    detectionSource: "Combined inference",
    modelContribution:
      "Model weighting increased urgency when low-rate trend and waveform features aligned.",
    policyLayer:
      "Policy blocks blind suppression when prolonged low-rate trends could reflect deterioration.",
    signalsUsed: ["ECG heart rate", "Waveform quality", "Perfusion trend", "Severity score"],
    defaultAction: "Route to bedside nurse now and notify charge nurse if unresolved.",
    defaultPriority: "Urgent Bedside Response",
    safeToDelayDefault: "Not safe to defer unless signal quality is clearly invalid.",
    suppressionGuidance: "Suppression is allowed only when confidence checks fail and bedside recheck confirms artifact.",
    responseWorkflow: [
      {
        role: "Bedside nurse",
        action: "Confirm patient status and lead placement immediately.",
        escalationCondition: "If low-rate trend persists over 1 minute"
      },
      {
        role: "Charge nurse",
        action: "Coordinate escalation and bedside intervention review.",
        escalationCondition: "If unresolved after initial bedside check"
      },
      {
        role: "Covering clinician",
        action: "Assess for intervention and reversible causes.",
        escalationCondition: "If persistent symptomatic or worsening brady trend"
      },
      {
        role: "Rapid response team",
        action: "Activate for acute instability or clinical deterioration.",
        escalationCondition: "If hemodynamic compromise is suspected"
      }
    ]
  },
  {
    alarmType: "spo2_drop",
    label: "SpO2 Drop",
    meaning:
      "Oxygen saturation has fallen below threshold, and the signal appears reliable enough to warrant attention.",
    clinicalSummaryTemplate:
      "This room shows sustained oxygen desaturation with waveform support, making bedside review a high priority.",
    detectionRuleSummary:
      "Detected from sustained SpO2 decline below threshold with adequate waveform quality.",
    trendWindow: "Sustained 30-90 second desaturation window",
    thresholdLogic:
      "SpO2 remained below configured threshold across repeated measurements rather than isolated dips.",
    confidenceBasis:
      "Pleth/waveform quality checks and trend consistency support alarm reliability.",
    detectionSource: "Combined inference",
    modelContribution:
      "Waveform-derived and numeric features increased probability of clinically actionable deterioration.",
    policyLayer:
      "Hard safety rule: sustained SpO2 drop with adequate signal quality cannot be auto-suppressed.",
    signalsUsed: [
      "SpO2 numeric",
      "Pleth/PPG waveform",
      "Drop duration",
      "Waveform quality",
      "Respiratory trend"
    ],
    defaultAction: "Send bedside nurse now and escalate if oxygen trend does not recover quickly.",
    defaultPriority: "Urgent Bedside Response",
    safeToDelayDefault: "Not safe to defer when desaturation and waveform quality remain consistent.",
    suppressionGuidance: "Suppression blocked while oxygen trend is unstable with reliable signal quality.",
    responseWorkflow: [
      {
        role: "Bedside nurse",
        action: "Assess airway, oxygen delivery, and sensor placement immediately.",
        escalationCondition: "If desaturation persists for 1 minute"
      },
      {
        role: "Charge nurse",
        action: "Coordinate escalated bedside support.",
        escalationCondition: "If no response after immediate bedside intervention"
      },
      {
        role: "Covering clinician",
        action: "Evaluate cause of hypoxemia and treatment next steps.",
        escalationCondition: "If oxygenation remains unstable"
      },
      {
        role: "Rapid response team",
        action: "Activate for escalating respiratory compromise.",
        escalationCondition: "If worsening desaturation or multi-signal decline"
      }
    ]
  },
  {
    alarmType: "arrhythmia",
    label: "Arrhythmia",
    meaning:
      "The ECG pattern shows irregularity consistent with abnormal rhythm behavior, supported by signal-quality checks.",
    clinicalSummaryTemplate:
      "Rhythm irregularity appears persistent enough to justify immediate clinical validation and potential escalation.",
    detectionRuleSummary:
      "Detected from ECG pattern irregularity plus confidence checks across rhythm features.",
    trendWindow: "Rolling 45-90 second rhythm morphology window",
    thresholdLogic:
      "Irregular beat pattern crossed rhythm-instability threshold and persisted beyond artifact tolerance.",
    confidenceBasis:
      "Signal quality and internal rhythm-consistency checks support meaningful arrhythmia suspicion.",
    detectionSource: "Waveform analysis",
    modelContribution:
      "Waveform morphology features strongly increased urgency for clinician review.",
    policyLayer:
      "Policy prioritizes rapid escalation when rhythm instability co-occurs with high severity.",
    signalsUsed: ["ECG morphology", "RR interval variability", "Signal confidence", "Severity score"],
    defaultAction: "Urgent bedside review with rapid escalation if instability continues.",
    defaultPriority: "Urgent Bedside Response",
    safeToDelayDefault: "Not safe to defer without bedside confirmation.",
    suppressionGuidance: "Suppression discouraged while rhythm irregularity remains sustained.",
    responseWorkflow: [
      {
        role: "Bedside nurse",
        action: "Confirm rhythm and patient condition immediately.",
        escalationCondition: "If irregular rhythm persists after immediate check"
      },
      {
        role: "Charge nurse",
        action: "Coordinate escalation pathway and additional support.",
        escalationCondition: "If unresolved within 1-2 minutes"
      },
      {
        role: "Covering clinician",
        action: "Perform urgent rhythm assessment and treatment planning.",
        escalationCondition: "If rhythm remains unstable"
      },
      {
        role: "Rapid response team",
        action: "Activate for acute deterioration or high-risk rhythm progression.",
        escalationCondition: "If severe instability or concurrent vital decline"
      }
    ]
  },
  {
    alarmType: "respiratory_concern",
    label: "Respiratory Concern",
    meaning:
      "Respiratory measurements or waveform patterns suggest possible breathing instability.",
    clinicalSummaryTemplate:
      "Breathing-related signals indicate a potentially unstable respiratory pattern requiring close bedside validation.",
    detectionRuleSummary:
      "Detected from respiratory trend deterioration combined with waveform-quality and consistency checks.",
    trendWindow: "Rolling 30-120 second respiratory trend window",
    thresholdLogic:
      "Respiratory indicators crossed configured concern threshold and remained unstable.",
    confidenceBasis:
      "Signal checks suggest trend is likely physiologic rather than artifact-only.",
    detectionSource: "Combined inference",
    modelContribution:
      "Combined waveform and vital features increased predicted need for clinician intervention.",
    policyLayer:
      "Safety rules keep continuous watch active until respiratory pattern stabilizes.",
    signalsUsed: [
      "Respiratory rate trend",
      "SpO2 trend",
      "Waveform quality",
      "Severity score",
      "Recent trend window"
    ],
    defaultAction: "Bedside respiratory reassessment now and rapid escalation if instability persists.",
    defaultPriority: "Bedside Review Recommended",
    safeToDelayDefault: "Can be rechecked briefly only if waveform quality is poor; otherwise review promptly.",
    suppressionGuidance: "Suppression should remain conservative until respiratory data quality and trends are stable.",
    responseWorkflow: [
      {
        role: "Bedside nurse",
        action: "Confirm respiratory status and sensor reliability now.",
        escalationCondition: "If instability persists for 2 minutes"
      },
      {
        role: "Charge nurse",
        action: "Review bedside findings and escalation need.",
        escalationCondition: "If unresolved after initial review"
      },
      {
        role: "Covering clinician",
        action: "Evaluate respiratory deterioration risk and intervention plan.",
        escalationCondition: "If respiratory trend worsens"
      },
      {
        role: "Rapid response team",
        action: "Activate for worsening respiratory compromise.",
        escalationCondition: "If multi-signal deterioration continues"
      }
    ]
  }
];

const PLAYBOOK_MAP = new Map(PLAYBOOKS.map((book) => [book.alarmType, book]));

const ALIASES: Record<string, string> = {
  tachy: "tachycardia",
  brady: "bradycardia",
  respiratory: "respiratory_concern",
  respiratory_instability: "respiratory_concern",
  resp_concern: "respiratory_concern"
};

const FALLBACK_PLAYBOOK: AlarmPlaybook = {
  alarmType: "clinical_alarm",
  label: "Clinical Alarm",
  meaning:
    "Physiologic signals have deviated enough to require clinical review.",
  clinicalSummaryTemplate:
    "PulseMesh detected a sustained concerning signal pattern that should be checked at bedside.",
  detectionRuleSummary:
    "Detected from sustained threshold deviation with waveform and trend consistency checks.",
  trendWindow: "Rolling clinical trend window",
  thresholdLogic:
    "Signal trends exceeded configured alert criteria for a sustained period.",
  confidenceBasis:
    "Signal confidence checks indicate this event may represent real patient change.",
  detectionSource: "Combined inference",
  modelContribution:
    "Combined vital and waveform features increased the likelihood of actionable clinical relevance.",
  policyLayer:
    "Safety policy keeps potentially unsafe suppressions blocked until confidence improves.",
  signalsUsed: ["Numeric vitals", "Waveform pattern", "Signal confidence"],
  defaultAction: "Route to bedside nurse for immediate verification.",
  defaultPriority: "Bedside Review Recommended",
  safeToDelayDefault: "Defer only briefly with active monitoring and rapid recheck.",
  suppressionGuidance: "Suppression is limited until signal reliability and trend stability are confirmed.",
  responseWorkflow: [
    {
      role: "Bedside nurse",
      action: "Confirm patient condition and monitor integrity now.",
      escalationCondition: "If concern persists after immediate review"
    },
    {
      role: "Charge nurse",
      action: "Review unresolved event and coordinate escalation.",
      escalationCondition: "If event remains unresolved"
    },
    {
      role: "Covering clinician",
      action: "Assess need for diagnostic or therapeutic action.",
      escalationCondition: "If persistent or worsening"
    },
    {
      role: "Rapid response team",
      action: "Activate when deterioration appears acute.",
      escalationCondition: "If multi-signal instability escalates"
    }
  ]
};

function normalizeAlarmType(alarmType: string | undefined): string {
  if (!alarmType) return FALLBACK_PLAYBOOK.alarmType;
  if (PLAYBOOK_MAP.has(alarmType)) return alarmType;
  if (ALIASES[alarmType]) return ALIASES[alarmType];
  return alarmType;
}

export function getAlarmPlaybook(alarmType: string | undefined): AlarmPlaybook {
  const normalized = normalizeAlarmType(alarmType);
  const playbook = PLAYBOOK_MAP.get(normalized);

  if (playbook) return playbook;
  return {
    ...FALLBACK_PLAYBOOK,
    alarmType: normalized,
    label: humanizeAlarmType(normalized)
  };
}

export function listAlarmPlaybooks(): AlarmPlaybook[] {
  return PLAYBOOKS;
}

export function humanizeAlarmType(alarmType: string): string {
  if (!alarmType) return "Clinical Alarm";
  return alarmType
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function clinicianResponseLabel(pActionable: number | undefined): string {
  if (pActionable === undefined) return "Model Assessment Pending";
  return `${(pActionable * 100).toFixed(1)}% likely to need clinician response`;
}

export function confidenceLimitLabel(uncertainty: number | undefined): string {
  if (uncertainty === undefined) return "Confidence Limits Pending";

  if (uncertainty >= 0.7) {
    return "Confidence limits are wide; maintain close bedside verification.";
  }

  if (uncertainty >= 0.4) {
    return "Confidence limits are moderate; continue active review with trend follow-up.";
  }

  return "Confidence limits are narrow; signal interpretation is relatively stable.";
}

export function recommendedActionFromDecision(
  decision: AlarmDecision,
  fallback: string
): string {
  if (decision === "route_rapid_response") {
    return "Immediate Escalation Required. Activate rapid response pathway while bedside team intervenes.";
  }

  if (decision === "route_clinician") {
    return "Bedside Review Now, with clinician notification if instability persists.";
  }

  if (decision === "suppress") {
    return "Continue Monitoring with bedside confirmation; no broad escalation alert is recommended right now.";
  }

  return fallback;
}

export function currentDecisionLabel(decision: AlarmDecision): string {
  if (decision === "route_rapid_response") return "Recommended Action: Escalate Now";
  if (decision === "route_clinician") return "Recommended Action: Bedside Review Now";
  if (decision === "suppress") return "Recommended Action: Continue Monitoring";
  return "Recommended Action: Awaiting Inference";
}

export function responsePriority(
  severity: "low" | "medium" | "high" | "critical" | undefined,
  decision: AlarmDecision,
  fallback: ResponsePriority
): ResponsePriority {
  if (decision === "route_rapid_response" || severity === "critical") {
    return "Immediate Escalation Required";
  }

  if (severity === "high") {
    return "Urgent Bedside Response";
  }

  if (decision === "route_clinician") {
    return "Bedside Review Recommended";
  }

  if (decision === "suppress") {
    return "Monitor Only";
  }

  if (severity === "medium") {
    return "Bedside Review Recommended";
  }

  if (severity === "low") {
    return "Monitor Only";
  }

  return fallback;
}

export function escalationTiming(
  priority: ResponsePriority
): string[] {
  if (priority === "Immediate Escalation Required") {
    return [
      "Initial review recommended immediately",
      "Escalate within 1 minute if instability persists",
      "Maintain continuous room watch until stabilized"
    ];
  }

  if (priority === "Urgent Bedside Response") {
    return [
      "Initial bedside review recommended within 1 minute",
      "Escalate within 2 minutes if unresolved",
      "Continue close observation during reassessment"
    ];
  }

  if (priority === "Bedside Review Recommended") {
    return [
      "Initial bedside review recommended within 2 minutes",
      "Escalate to charge nurse if trend persists",
      "Reassess trend window after intervention"
    ];
  }

  return [
    "Monitor and recheck in the next review window",
    "Escalate if signal confidence improves and instability persists",
    "Keep room under continuous watch"
  ];
}

export function safeToDelayStatus(
  priority: ResponsePriority,
  playbook: AlarmPlaybook,
  decision: AlarmDecision
): string {
  if (priority === "Immediate Escalation Required") {
    return "Not safe to defer.";
  }

  if (priority === "Urgent Bedside Response") {
    return "Not safe to defer unless bedside recheck confirms artifact.";
  }

  if (decision === "suppress") {
    return "Can be deferred briefly with continuous monitoring and rapid recheck.";
  }

  return playbook.safeToDelayDefault;
}

export function monitoringConfidenceLabel(
  availableSources: number,
  uncertainty: number | undefined
): string {
  if (availableSources >= 3 && (uncertainty === undefined || uncertainty < 0.4)) {
    return "High Confidence Data Coverage";
  }

  if (availableSources >= 2) {
    return "Moderate Confidence Data Coverage";
  }

  if (availableSources >= 1) {
    return "Limited Confidence Data Coverage";
  }

  return "Low Confidence Data Coverage";
}
