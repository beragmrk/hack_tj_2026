-- Core facility metadata
CREATE TABLE IF NOT EXISTS facility (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  tz TEXT NOT NULL
);

-- Privacy-preserving patient entity (no direct identifiers)
CREATE TABLE IF NOT EXISTS patient (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility(id) ON DELETE CASCADE,
  pseudo_demographics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility(id) ON DELETE CASCADE,
  device_type TEXT NOT NULL,
  protocol TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS signal_stream (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,
  sample_hz DOUBLE PRECISION NOT NULL CHECK (sample_hz > 0),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS waveform_chunk (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id UUID NOT NULL REFERENCES signal_stream(id) ON DELETE CASCADE,
  t0 TIMESTAMPTZ NOT NULL,
  t1 TIMESTAMPTZ NOT NULL,
  object_uri TEXT NOT NULL,
  codec TEXT NOT NULL,
  checksum TEXT NOT NULL,
  CHECK (t1 >= t0)
);

-- High-frequency numeric observations are modeled as a Timescale hypertable.
CREATE TABLE IF NOT EXISTS numeric_obs (
  id BIGSERIAL,
  patient_id UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,
  t TIMESTAMPTZ NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  quality_flag TEXT NOT NULL,
  PRIMARY KEY (id, t)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('numeric_obs', 't', if_not_exists => TRUE);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS alarm_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  alarm_type TEXT NOT NULL,
  t TIMESTAMPTZ NOT NULL,
  severity TEXT NOT NULL,
  raw_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS inference_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alarm_id UUID NOT NULL REFERENCES alarm_event(id) ON DELETE CASCADE,
  model_version_id TEXT NOT NULL,
  p_actionable DOUBLE PRECISION NOT NULL CHECK (p_actionable >= 0 AND p_actionable <= 1),
  uncertainty DOUBLE PRECISION NOT NULL CHECK (uncertainty >= 0 AND uncertainty <= 1),
  explanation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_proof (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inference_event_id UUID NOT NULL REFERENCES inference_event(id) ON DELETE CASCADE,
  scheme TEXT NOT NULL,
  proof_blob BYTEA NOT NULL,
  verified_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS federated_round (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  participants_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  agg_metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_patient_facility ON patient(facility_id);
CREATE INDEX IF NOT EXISTS idx_device_facility ON device(facility_id);
CREATE INDEX IF NOT EXISTS idx_signal_stream_patient ON signal_stream(patient_id);
CREATE INDEX IF NOT EXISTS idx_signal_stream_device ON signal_stream(device_id);
CREATE INDEX IF NOT EXISTS idx_waveform_chunk_stream_t0 ON waveform_chunk(stream_id, t0 DESC);
CREATE INDEX IF NOT EXISTS idx_numeric_obs_patient_signal_t ON numeric_obs(patient_id, signal_type, t DESC);
CREATE INDEX IF NOT EXISTS idx_alarm_event_patient_t ON alarm_event(patient_id, t DESC);
CREATE INDEX IF NOT EXISTS idx_alarm_event_device_t ON alarm_event(device_id, t DESC);
CREATE INDEX IF NOT EXISTS idx_inference_event_alarm ON inference_event(alarm_id);
CREATE INDEX IF NOT EXISTS idx_audit_proof_inference ON audit_proof(inference_event_id);
CREATE INDEX IF NOT EXISTS idx_federated_round_started ON federated_round(started_at DESC);

-- Compression policy baseline for long-running deployments (optional in MVP)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    ALTER TABLE numeric_obs SET (
      timescaledb.compress,
      timescaledb.compress_segmentby = 'patient_id,signal_type'
    );
    PERFORM add_compression_policy('numeric_obs', INTERVAL '7 days', if_not_exists => TRUE);
  END IF;
END
$$;
