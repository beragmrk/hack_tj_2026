#!/usr/bin/env python3
"""Replay real PhysioNet MIT-BIH ECG into PulseMesh gateway.

This script sends:
- waveform packets (real ECG samples)
- alarm packets derived from real MIT-BIH annotations
"""

from __future__ import annotations

import time
from collections import Counter

import requests
import wfdb

GATEWAY_INGEST_URL = "http://localhost:8080/ingest"
FACILITY_ID = "physionet-facility"
PATIENT_ID = "real-mitdb-100"
DEVICE_ID = "real-ecg-device-100"
RECORD_ID = "100"
BEAT_SYMBOLS = {
    "N",
    "L",
    "R",
    "A",
    "a",
    "J",
    "S",
    "V",
    "F",
    "e",
    "j",
    "E",
    "/",
    "f",
    "Q",
    "?",
}


def post_payload(payload: dict) -> None:
    response = requests.post(GATEWAY_INGEST_URL, json=payload, timeout=10)
    response.raise_for_status()


def main() -> None:
    print("Loading real PhysioNet record...", flush=True)
    record = wfdb.rdrecord(RECORD_ID, pn_dir="mitdb")
    annotations = wfdb.rdann(RECORD_ID, "atr", pn_dir="mitdb")

    fs = float(record.fs)
    signal = record.p_signal[:, 0].astype(float)
    chunk_seconds = 2
    chunk_size = int(fs * chunk_seconds)

    ann_by_sample: dict[int, list[str]] = {}
    for sample_idx, symbol in zip(annotations.sample, annotations.symbol):
        ann_by_sample.setdefault(int(sample_idx), []).append(symbol)
    beat_samples = [
        int(sample_idx)
        for sample_idx, symbol in zip(annotations.sample, annotations.symbol)
        if symbol in BEAT_SYMBOLS
    ]

    serious_symbols = {"V", "A", "F", "E", "j", "L", "R"}

    print(f"Streaming {RECORD_ID} at {fs}Hz to {GATEWAY_INGEST_URL}", flush=True)
    for i in range(0, len(signal) - chunk_size + 1, chunk_size):
        samples = signal[i : i + chunk_size].tolist()
        wave_payload = {
            "kind": "waveform",
            "facility_id": FACILITY_ID,
            "patient_id": PATIENT_ID,
            "device_id": DEVICE_ID,
            "signal_type": "ecg",
            "sample_hz": fs,
            "samples": samples,
        }
        post_payload(wave_payload)

        chunk_start = i
        chunk_end = i + chunk_size
        chunk_beats = [s for s in beat_samples if chunk_start <= s < chunk_end]
        hr_value = None

        if len(chunk_beats) >= 2:
            rr_intervals = [
                (chunk_beats[j] - chunk_beats[j - 1]) / fs
                for j in range(1, len(chunk_beats))
                if chunk_beats[j] > chunk_beats[j - 1]
            ]
            if rr_intervals:
                mean_rr = sum(rr_intervals) / len(rr_intervals)
                if mean_rr > 0:
                    hr_value = 60.0 / mean_rr
        elif len(chunk_beats) == 1:
            hr_value = (60.0 / chunk_seconds) * len(chunk_beats)

        if hr_value is not None:
            hr_value = max(20.0, min(220.0, hr_value))
            numeric_payload = {
                "kind": "numeric_obs",
                "facility_id": FACILITY_ID,
                "patient_id": PATIENT_ID,
                "device_id": DEVICE_ID,
                "signal_type": "hr",
                "value": round(hr_value, 2),
                "quality_flag": "high" if len(chunk_beats) >= 2 else "medium",
            }
            post_payload(numeric_payload)

        symbols: list[str] = []
        for s in range(chunk_start, chunk_end):
            if s in ann_by_sample:
                symbols.extend(ann_by_sample[s])

        if symbols:
            counts = Counter(symbols)
            severity = "high" if any(sym in serious_symbols for sym in counts) else "medium"
            alarm_payload = {
                "kind": "alarm",
                "facility_id": FACILITY_ID,
                "patient_id": PATIENT_ID,
                "device_id": DEVICE_ID,
                "alarm_type": "ecg_annotation_event",
                "severity": severity,
                "raw_payload_json": {
                    "source": "physionet_mitdb",
                    "record": RECORD_ID,
                    "symbols": dict(counts),
                },
            }
            post_payload(alarm_payload)

        print(f"sent chunk={i // chunk_size}", flush=True)
        time.sleep(0.2)

    print("Replay complete.", flush=True)


if __name__ == "__main__":
    main()
