"use client";

import { useQuery } from "@tanstack/react-query";

const INFERENCE_URL = process.env.NEXT_PUBLIC_INFERENCE_URL ?? "http://localhost:8000";

export interface FederatedReplayEvent {
  round_id: string;
  stage: string;
  at: string;
  payload: Record<string, unknown>;
}

async function fetchReplayAll(): Promise<Record<string, FederatedReplayEvent[]>> {
  const response = await fetch(`${INFERENCE_URL}/federated/replay-all`);
  if (!response.ok) {
    throw new Error("failed to fetch federated replay events");
  }
  return (await response.json()) as Record<string, FederatedReplayEvent[]>;
}

export function useFederatedReplay() {
  return useQuery({
    queryKey: ["federated-replay"],
    queryFn: fetchReplayAll,
    retry: 1,
    refetchInterval: 60_000
  });
}
