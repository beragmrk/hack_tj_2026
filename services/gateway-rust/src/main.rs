use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use futures::{sink::SinkExt, stream::StreamExt};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    sync::{atomic::{AtomicU64, Ordering}, Arc},
    time::Duration,
};
use tokio::{
    sync::{broadcast, RwLock},
    time,
};
use tracing::{error, info, warn};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    tx: broadcast::Sender<GatewayEnvelope>,
    seq: Arc<AtomicU64>,
    counters: Arc<RwLock<HashMap<String, u64>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Payload {
    NumericObs {
        facility_id: String,
        patient_id: String,
        device_id: String,
        signal_type: String,
        value: f64,
        quality_flag: String,
    },
    Waveform {
        facility_id: String,
        patient_id: String,
        device_id: String,
        signal_type: String,
        sample_hz: f32,
        samples: Vec<f32>,
    },
    Alarm {
        facility_id: String,
        patient_id: String,
        device_id: String,
        alarm_type: String,
        severity: String,
        raw_payload_json: serde_json::Value,
    },
    System {
        message: String,
        source: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GatewayEnvelope {
    id: String,
    seq: u64,
    ts: DateTime<Utc>,
    payload: Payload,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    uptime_hint: &'static str,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,pulsemesh_gateway=debug".into()),
        )
        .init();

    let bind_addr = env::var("GATEWAY_BIND").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let simulator_enabled = env::var("SIMULATOR_ENABLED")
        .map(|v| {
            let lower = v.to_ascii_lowercase();
            lower == "1" || lower == "true" || lower == "yes" || lower == "on"
        })
        .unwrap_or(true);
    let (tx, _) = broadcast::channel::<GatewayEnvelope>(8192);

    let state = AppState {
        tx,
        seq: Arc::new(AtomicU64::new(0)),
        counters: Arc::new(RwLock::new(HashMap::new())),
    };

    if simulator_enabled {
        info!("simulator enabled");
        start_simulation_loop(state.clone());
    } else {
        info!("simulator disabled; waiting for external telemetry ingest");
    }

    let app = Router::new()
        .route("/health", get(health))
        .route("/stats", get(stats))
        .route("/ws", get(ws_handler))
        .route("/ingest", post(ingest_event))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .expect("failed to bind gateway");
    info!("gateway listening on {}", bind_addr);

    axum::serve(listener, app)
        .await
        .expect("gateway server failed");
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        uptime_hint: "simulator-online",
    })
}

async fn stats(State(state): State<AppState>) -> Json<HashMap<String, u64>> {
    let counters = state.counters.read().await.clone();
    Json(counters)
}

async fn ingest_event(
    State(state): State<AppState>,
    Json(payload): Json<Payload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let envelope = state.wrap(payload);
    state
        .record_counter("ingest_http")
        .await;

    state
        .tx
        .send(envelope)
        .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, format!("broadcast failed: {e}")))?;

    Ok((StatusCode::ACCEPTED, "queued"))
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_ws(socket, state))
}

async fn handle_ws(mut socket: WebSocket, state: AppState) {
    let mut rx = state.tx.subscribe();

    state.record_counter("ws_connected").await;

    let hello = GatewayEnvelope {
        id: Uuid::new_v4().to_string(),
        seq: state.seq.fetch_add(1, Ordering::Relaxed),
        ts: Utc::now(),
        payload: Payload::System {
            message: "gateway_connected".to_string(),
            source: "pulsemesh-gateway".to_string(),
        },
    };

    if socket
        .send(Message::Text(serde_json::to_string(&hello).unwrap_or_else(|_| "{}".to_string())))
        .await
        .is_err()
    {
        return;
    }

    loop {
        tokio::select! {
            incoming = socket.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str::<Payload>(&text) {
                            Ok(payload) => {
                                state.record_counter("ingest_ws").await;
                                let envelope = state.wrap(payload);
                                let _ = state.tx.send(envelope);
                            }
                            Err(e) => {
                                warn!("ignored malformed ws payload: {}", e);
                            }
                        }
                    }
                    Some(Ok(Message::Binary(_))) => {}
                    Some(Ok(Message::Ping(v))) => {
                        if socket.send(Message::Pong(v)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) => break,
                    Some(Ok(_)) => {}
                    Some(Err(e)) => {
                        warn!("ws error: {}", e);
                        break;
                    }
                    None => break,
                }
            }
            outbound = rx.recv() => {
                match outbound {
                    Ok(msg) => {
                        let serialized = match serde_json::to_string(&msg) {
                            Ok(v) => v,
                            Err(e) => {
                                error!("serialization failed: {}", e);
                                continue;
                            }
                        };

                        if socket.send(Message::Text(serialized)).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(dropped)) => {
                        warn!("ws lagged; dropped {} events", dropped);
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    state.record_counter("ws_disconnected").await;
}

fn start_simulation_loop(state: AppState) {
    tokio::spawn(async move {
        let facility_ids = [
            "11111111-1111-1111-1111-111111111111",
            "22222222-2222-2222-2222-222222222222",
        ];
        let patient_ids = [
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        ];
        let device_ids = [
            "cccccccc-cccc-cccc-cccc-cccccccccccc",
            "dddddddd-dddd-dddd-dddd-dddddddddddd",
        ];

        let mut waveform_tick = time::interval(Duration::from_millis(75));
        let mut numeric_tick = time::interval(Duration::from_millis(250));
        let mut alarm_tick = time::interval(Duration::from_millis(1400));

        loop {
            tokio::select! {
                _ = waveform_tick.tick() => {
                    let payload = {
                        let mut rng = rand::thread_rng();
                        let idx = rng.gen_range(0..patient_ids.len());
                        let hz = if rng.gen_bool(0.5) { 125.0 } else { 62.5 };
                        let signal = if rng.gen_bool(0.5) { "ecg" } else { "ppg" };

                        let samples = (0..64)
                            .map(|i| {
                                let baseline = ((i as f32 / 64.0) * std::f32::consts::PI * 2.0).sin();
                                let noise = rng.gen_range(-0.08f32..0.08f32);
                                baseline + noise + if signal == "ecg" { 0.2 } else { 0.4 }
                            })
                            .collect::<Vec<f32>>();

                        Payload::Waveform {
                            facility_id: facility_ids[idx].to_string(),
                            patient_id: patient_ids[idx].to_string(),
                            device_id: device_ids[idx].to_string(),
                            signal_type: signal.to_string(),
                            sample_hz: hz,
                            samples,
                        }
                    };

                    let envelope = state.wrap(payload);
                    let _ = state.tx.send(envelope);
                    state.record_counter("sim_waveform").await;
                }
                _ = numeric_tick.tick() => {
                    let payload = {
                        let mut rng = rand::thread_rng();
                        let idx = rng.gen_range(0..patient_ids.len());
                        let signal = if rng.gen_bool(0.55) { "spo2" } else { "hr" };

                        let value = if signal == "spo2" {
                            rng.gen_range(88.0..100.0)
                        } else {
                            rng.gen_range(55.0..140.0)
                        };

                        let quality_flag = if rng.gen_bool(0.9) { "high" } else { "low" };

                        Payload::NumericObs {
                            facility_id: facility_ids[idx].to_string(),
                            patient_id: patient_ids[idx].to_string(),
                            device_id: device_ids[idx].to_string(),
                            signal_type: signal.to_string(),
                            value,
                            quality_flag: quality_flag.to_string(),
                        }
                    };

                    let envelope = state.wrap(payload);
                    let _ = state.tx.send(envelope);
                    state.record_counter("sim_numeric").await;
                }
                _ = alarm_tick.tick() => {
                    let maybe_payload = {
                        let mut rng = rand::thread_rng();
                        if rng.gen_bool(0.65) {
                            let idx = rng.gen_range(0..patient_ids.len());
                            let sustained_drop = rng.gen_bool(0.4);
                            let alarm_type = if sustained_drop { "spo2_drop" } else { "tachycardia" };
                            let severity = if sustained_drop { "high" } else { "medium" };

                            let raw_payload_json = serde_json::json!({
                                "window_s": 30,
                                "signal_quality": if rng.gen_bool(0.85) { "high" } else { "low" },
                                "drop_duration_s": if sustained_drop { rng.gen_range(20..90) } else { 0 },
                                "source": "simulator"
                            });

                            Some(Payload::Alarm {
                                facility_id: facility_ids[idx].to_string(),
                                patient_id: patient_ids[idx].to_string(),
                                device_id: device_ids[idx].to_string(),
                                alarm_type: alarm_type.to_string(),
                                severity: severity.to_string(),
                                raw_payload_json,
                            })
                        } else {
                            None
                        }
                    };

                    if let Some(payload) = maybe_payload {
                        let envelope = state.wrap(payload);
                        let _ = state.tx.send(envelope);
                        state.record_counter("sim_alarm").await;
                    };
                }
            }
        }
    });
}

impl AppState {
    fn wrap(&self, payload: Payload) -> GatewayEnvelope {
        GatewayEnvelope {
            id: Uuid::new_v4().to_string(),
            seq: self.seq.fetch_add(1, Ordering::Relaxed),
            ts: Utc::now(),
            payload,
        }
    }

    async fn record_counter(&self, key: &str) {
        let mut counters = self.counters.write().await;
        *counters.entry(key.to_string()).or_insert(0) += 1;
    }
}
