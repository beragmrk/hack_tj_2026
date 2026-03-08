const NAMED_PATIENTS: Record<string, string> = {
  N01P0001: "Avery M.",
  N02P0002: "Benjamin R.",
  N03P0003: "Charlotte P.",
  N04P0004: "Daniel K.",
  N05P0005: "Eleanor S.",
  N06P0006: "Gabriel T.",
  N07P0007: "Hannah L.",
  N08P0008: "Isaac J.",
  S01P0101: "Julia C.",
  S02P0102: "Liam W.",
  S03P0103: "Maya N.",
  S04P0104: "Noah B.",
  S05P0105: "Olivia D.",
  S06P0106: "Parker F.",
  S07P0107: "Riley G.",
  S08P0108: "Sophia H."
};

const FIRST_NAMES = [
  "Avery",
  "Benjamin",
  "Charlotte",
  "Daniel",
  "Eleanor",
  "Gabriel",
  "Hannah",
  "Isaac",
  "Julia",
  "Liam",
  "Maya",
  "Noah",
  "Olivia",
  "Parker",
  "Riley",
  "Sophia",
  "Theodore",
  "Victoria",
  "William",
  "Zoe"
];

const LAST_INITIALS = ["B", "C", "D", "F", "G", "H", "J", "K", "L", "M", "N", "P", "R", "S", "T", "W"];

function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function formatPatientDisplayName(patientId: string): string {
  if (!patientId) return "Unassigned Patient";
  if (NAMED_PATIENTS[patientId]) {
    return NAMED_PATIENTS[patientId];
  }

  const hash = stableHash(patientId);
  const firstName = FIRST_NAMES[hash % FIRST_NAMES.length];
  const lastInitial = LAST_INITIALS[Math.floor(hash / FIRST_NAMES.length) % LAST_INITIALS.length];
  return `${firstName} ${lastInitial}.`;
}
