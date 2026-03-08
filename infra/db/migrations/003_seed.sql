-- Optional demo seed data (idempotent upsert-style inserts)
INSERT INTO facility (id, name, unit_type, tz)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Starlight Medical Center', 'ICU', 'America/New_York'),
  ('22222222-2222-2222-2222-222222222222', 'Bayline General', 'Cardiac ICU', 'America/Chicago')
ON CONFLICT (id) DO NOTHING;

INSERT INTO patient (id, facility_id, pseudo_demographics_json, created_at)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '{"age_band":"65-74","sex":"F"}'::jsonb, now() - interval '1 day'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', '{"age_band":"45-54","sex":"M"}'::jsonb, now() - interval '12 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO device (id, facility_id, device_type, protocol, metadata_json)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'bedside_monitor', 'hl7v2', '{"vendor":"AcmeMon","fw":"2.1.0"}'::jsonb),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '22222222-2222-2222-2222-222222222222', 'pulse_oximeter', 'fhir-subscription', '{"vendor":"PulseCo","fw":"1.7.3"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO federated_round (id, started_at, ended_at, participants_json, agg_metrics_json)
VALUES
  (
    'f0000000-0000-0000-0000-000000000001',
    now() - interval '48 hours',
    now() - interval '47 hours',
    '[{"site":"Starlight Medical Center"},{"site":"Bayline General"}]'::jsonb,
    '{"round":1,"auroc":0.84,"auprc":0.62,"brier":0.15,"n":18234}'::jsonb
  ),
  (
    'f0000000-0000-0000-0000-000000000002',
    now() - interval '24 hours',
    now() - interval '23 hours',
    '[{"site":"Starlight Medical Center"},{"site":"Bayline General"}]'::jsonb,
    '{"round":2,"auroc":0.87,"auprc":0.66,"brier":0.13,"n":24119}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;
