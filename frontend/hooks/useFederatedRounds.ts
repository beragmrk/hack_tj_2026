"use client";

import { useQuery } from "@tanstack/react-query";

import { FederatedRound } from "@/types/pulse";

const INFERENCE_URL = process.env.NEXT_PUBLIC_INFERENCE_URL ?? "http://localhost:8000";

async function fetchRounds(): Promise<FederatedRound[]> {
  const response = await fetch(`${INFERENCE_URL}/federated/rounds`);
  if (!response.ok) {
    throw new Error("failed to fetch federated rounds");
  }
  return (await response.json()) as FederatedRound[];
}

export function useFederatedRounds() {
  return useQuery({
    queryKey: ["federated-rounds"],
    queryFn: fetchRounds,
    retry: 1,
    refetchInterval: 60_000
  });
}
