use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path,
        State,
    },
    http::{Method, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use futures::stream::StreamExt;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    env,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tower_http::cors::{Any, CorsLayer};
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
    demo: Arc<RwLock<DemoControlState>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Payload {
    Waveform {
        facility_id: String,
        patient_id: String,
        device_id: String,
        signal_type: String,
        sample_hz: f32,
        samples: Vec<f32>,
    },
    NumericObs {
        facility_id: String,
        patient_id: String,
        device_id: String,
        signal_type: String,
        value: f64,
        quality_flag: String,
    },
    Alarm {
        facility_id: String,
        patient_id: String,
        device_id: String,
        alarm_type: String,
        severity: String,
        raw_payload_json: serde_json::Value,
    },
    AlarmClear {
        facility_id: String,
        patient_id: String,
        device_id: String,
        reason: String,
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
    service: &'static str,
}

#[derive(Clone, Debug)]
struct DemoControlState {
    scenario_idx: usize,
    paused: bool,
    revision: u64,
    cleared_patients: HashSet<String>,
}

#[derive(Debug, Serialize)]
struct DemoStatusResponse {
    scenario_id: &'static str,
    scenario_label: &'static str,
    index: usize,
    total: usize,
    paused: bool,
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

    let (tx, _) = broadcast::channel::<GatewayEnvelope>(16_384);

    let state = AppState {
        tx,
        seq: Arc::new(AtomicU64::new(1)),
        counters: Arc::new(RwLock::new(HashMap::new())),
        demo: Arc::new(RwLock::new(DemoControlState {
            scenario_idx: 0,
            paused: false,
            revision: 1,
            cleared_patients: HashSet::new(),
        })),
    };

    if simulator_enabled {
        info!("simulator enabled");
        start_simulation_loop(state.clone());
    }

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/stats", get(stats))
        .route("/ws", get(ws_handler))
        .route("/ingest", post(ingest_event))
        .route("/demo/status", get(demo_status))
        .route("/demo/next", post(demo_next))
        .route("/demo/previous", post(demo_previous))
        .route("/demo/reset", post(demo_reset))
        .route("/demo/pause", post(demo_pause))
        .route("/demo/resume", post(demo_resume))
        .route("/demo/clear/:patient_id", post(demo_clear_alarm))
        .with_state(state)
        .layer(cors);

    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .expect("failed to bind gateway listener");
    info!("gateway listening on {}", bind_addr);

    axum::serve(listener, app)
        .await
        .expect("gateway server terminated unexpectedly");
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "gateway",
    })
}

async fn stats(State(state): State<AppState>) -> Json<HashMap<String, u64>> {
    Json(state.counters.read().await.clone())
}

fn scenario_from_control(control: &DemoControlState) -> DemoScenario {
    let idx = control.scenario_idx % DEMO_SCENARIOS.len();
    DEMO_SCENARIOS[idx]
}

fn demo_status_from_control(control: &DemoControlState) -> DemoStatusResponse {
    let scenario = scenario_from_control(control);
    DemoStatusResponse {
        scenario_id: scenario.id,
        scenario_label: scenario.label,
        index: control.scenario_idx % DEMO_SCENARIOS.len(),
        total: DEMO_SCENARIOS.len(),
        paused: control.paused,
    }
}

async fn demo_status(State(state): State<AppState>) -> Json<DemoStatusResponse> {
    let control = state.demo.read().await;
    Json(demo_status_from_control(&control))
}

async fn demo_next(State(state): State<AppState>) -> Json<DemoStatusResponse> {
    let mut control = state.demo.write().await;
    control.scenario_idx = (control.scenario_idx + 1) % DEMO_SCENARIOS.len();
    control.cleared_patients.clear();
    control.revision = control.revision.wrapping_add(1);
    Json(demo_status_from_control(&control))
}

async fn demo_previous(State(state): State<AppState>) -> Json<DemoStatusResponse> {
    let mut control = state.demo.write().await;
    if control.scenario_idx == 0 {
        control.scenario_idx = DEMO_SCENARIOS.len() - 1;
    } else {
        control.scenario_idx -= 1;
    }
    control.cleared_patients.clear();
    control.revision = control.revision.wrapping_add(1);
    Json(demo_status_from_control(&control))
}

async fn demo_reset(State(state): State<AppState>) -> Json<DemoStatusResponse> {
    let mut control = state.demo.write().await;
    control.scenario_idx = 0;
    control.paused = false;
    control.cleared_patients.clear();
    control.revision = control.revision.wrapping_add(1);
    Json(demo_status_from_control(&control))
}

async fn demo_pause(State(state): State<AppState>) -> Json<DemoStatusResponse> {
    let mut control = state.demo.write().await;
    control.paused = true;
    Json(demo_status_from_control(&control))
}

async fn demo_resume(State(state): State<AppState>) -> Json<DemoStatusResponse> {
    let mut control = state.demo.write().await;
    control.paused = false;
    Json(demo_status_from_control(&control))
}

async fn demo_clear_alarm(
    Path(patient_id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<DemoStatusResponse>, (StatusCode, String)> {
    let mut control = state.demo.write().await;
    let scenario = scenario_from_control(&control);

    let patient_has_alarm = scenario
        .active_alarms
        .iter()
        .any(|alarm| alarm.patient_id == patient_id.as_str());
    if !patient_has_alarm {
        return Err((
            StatusCode::NOT_FOUND,
            format!("no active scenario alarm for patient {}", patient_id),
        ));
    }

    control.cleared_patients.insert(patient_id);
    control.revision = control.revision.wrapping_add(1);
    Ok(Json(demo_status_from_control(&control)))
}

async fn ingest_event(
    State(state): State<AppState>,
    Json(payload): Json<Payload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let envelope = state.wrap(payload);
    state.record_counter("ingest_http").await;

    state
        .tx
        .send(envelope)
        .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, format!("broadcast failed: {e}")))?;

    Ok((StatusCode::ACCEPTED, "queued"))
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
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
        .send(Message::Text(
            serde_json::to_string(&hello).unwrap_or_else(|_| "{}".to_string()),
        ))
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
                                let _ = state.tx.send(state.wrap(payload));
                            }
                            Err(err) => warn!("ignored malformed ws payload: {}", err),
                        }
                    }
                    Some(Ok(Message::Binary(_))) => {}
                    Some(Ok(Message::Ping(v))) => {
                        if socket.send(Message::Pong(v)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) => break,
                    Some(Err(err)) => {
                        warn!("ws error: {}", err);
                        break;
                    }
                    None => break,
                    _ => {}
                }
            }
            outbound = rx.recv() => {
                match outbound {
                    Ok(msg) => {
                        let serialized = match serde_json::to_string(&msg) {
                            Ok(v) => v,
                            Err(err) => {
                                error!("serialization failure: {}", err);
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SimEventKind {
    Tachycardia,
    Spo2Drop,
    Arrhythmia,
    Bradycardia,
    RespiratoryConcern,
}

impl SimEventKind {
    fn alarm_type(self) -> &'static str {
        match self {
            Self::Tachycardia => "tachycardia",
            Self::Spo2Drop => "spo2_drop",
            Self::Arrhythmia => "arrhythmia",
            Self::Bradycardia => "bradycardia",
            Self::RespiratoryConcern => "respiratory_concern",
        }
    }

    fn base_duration_s(self, rng: &mut impl Rng) -> f32 {
        match self {
            Self::Tachycardia => rng.gen_range(30.0..110.0),
            Self::Spo2Drop => rng.gen_range(24.0..95.0),
            Self::Arrhythmia => rng.gen_range(20.0..75.0),
            Self::Bradycardia => rng.gen_range(20.0..85.0),
            Self::RespiratoryConcern => rng.gen_range(28.0..120.0),
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct ScenarioAlarm {
    patient_id: &'static str,
    event: SimEventKind,
    severity: &'static str,
    response_priority: &'static str,
    recommended_recheck_s: i32,
}

#[derive(Clone, Copy, Debug)]
struct ScenarioObservation {
    patient_id: &'static str,
    event: SimEventKind,
}

#[derive(Clone, Copy, Debug)]
struct DemoScenario {
    id: &'static str,
    label: &'static str,
    occupied_patients: &'static [&'static str],
    observation_events: &'static [ScenarioObservation],
    active_alarms: &'static [ScenarioAlarm],
}

const OCCUPIED_PATIENTS: &[&str] = &[
    "N01P0001",
    "N02P0002",
    "N03P0003",
    "N04P0004",
    "N05P0005",
    "N06P0006",
    "S01P0101",
    "S02P0102",
    "S03P0103",
    "S04P0104",
];

const BASELINE_OBSERVATION: &[ScenarioObservation] = &[
    ScenarioObservation {
        patient_id: "N03P0003",
        event: SimEventKind::RespiratoryConcern,
    },
    ScenarioObservation {
        patient_id: "S01P0101",
        event: SimEventKind::Tachycardia,
    },
];

const BASELINE_ALARMS: &[ScenarioAlarm] = &[
    ScenarioAlarm {
        patient_id: "N02P0002",
        event: SimEventKind::Tachycardia,
        severity: "medium",
        response_priority: "priority",
        recommended_recheck_s: 120,
    },
];

const NURSE_ATTENTION_ALARMS: &[ScenarioAlarm] = &[
    ScenarioAlarm {
        patient_id: "N02P0002",
        event: SimEventKind::Tachycardia,
        severity: "medium",
        response_priority: "priority",
        recommended_recheck_s: 120,
    },
    ScenarioAlarm {
        patient_id: "S02P0102",
        event: SimEventKind::Spo2Drop,
        severity: "high",
        response_priority: "urgent",
        recommended_recheck_s: 90,
    },
];

const ESCALATION_ALARMS: &[ScenarioAlarm] = &[
    ScenarioAlarm {
        patient_id: "S02P0102",
        event: SimEventKind::Spo2Drop,
        severity: "critical",
        response_priority: "immediate",
        recommended_recheck_s: 60,
    },
    ScenarioAlarm {
        patient_id: "N02P0002",
        event: SimEventKind::Tachycardia,
        severity: "medium",
        response_priority: "priority",
        recommended_recheck_s: 120,
    },
];

const MULTI_ACTIVE_ALARMS: &[ScenarioAlarm] = &[
    ScenarioAlarm {
        patient_id: "N02P0002",
        event: SimEventKind::Tachycardia,
        severity: "medium",
        response_priority: "priority",
        recommended_recheck_s: 120,
    },
    ScenarioAlarm {
        patient_id: "S02P0102",
        event: SimEventKind::Spo2Drop,
        severity: "critical",
        response_priority: "immediate",
        recommended_recheck_s: 60,
    },
    ScenarioAlarm {
        patient_id: "S03P0103",
        event: SimEventKind::Arrhythmia,
        severity: "medium",
        response_priority: "priority",
        recommended_recheck_s: 120,
    },
];

const RECOVERY_ALARMS: &[ScenarioAlarm] = &[ScenarioAlarm {
    patient_id: "N02P0002",
    event: SimEventKind::Tachycardia,
    severity: "medium",
    response_priority: "priority",
    recommended_recheck_s: 120,
}];

const DEMO_SCENARIOS: &[DemoScenario] = &[
    DemoScenario {
        id: "baseline_monitoring",
        label: "Baseline Monitoring State",
        occupied_patients: OCCUPIED_PATIENTS,
        observation_events: BASELINE_OBSERVATION,
        active_alarms: BASELINE_ALARMS,
    },
    DemoScenario {
        id: "nurse_attention_needed",
        label: "Nurse Attention Needed",
        occupied_patients: OCCUPIED_PATIENTS,
        observation_events: BASELINE_OBSERVATION,
        active_alarms: NURSE_ATTENTION_ALARMS,
    },
    DemoScenario {
        id: "escalation_in_progress",
        label: "Escalation In Progress",
        occupied_patients: OCCUPIED_PATIENTS,
        observation_events: BASELINE_OBSERVATION,
        active_alarms: ESCALATION_ALARMS,
    },
    DemoScenario {
        id: "multiple_active_alarms",
        label: "Multiple Active Alarms",
        occupied_patients: OCCUPIED_PATIENTS,
        observation_events: BASELINE_OBSERVATION,
        active_alarms: MULTI_ACTIVE_ALARMS,
    },
    DemoScenario {
        id: "recovery_resolved_event",
        label: "Recovery / Resolved Event",
        occupied_patients: OCCUPIED_PATIENTS,
        observation_events: BASELINE_OBSERVATION,
        active_alarms: RECOVERY_ALARMS,
    },
];

#[derive(Clone, Debug)]
struct SimPatient {
    facility_id: &'static str,
    patient_id: &'static str,
    device_id: &'static str,
    baseline_hr: f32,
    baseline_spo2: f32,
    baseline_rr: f32,
    hr: f32,
    spo2: f32,
    rr: f32,
    wave_phase_s: f32,
    hr_variability: f32,
    active_event: Option<SimEventKind>,
    event_remaining_s: f32,
    cooldown_s: f32,
    artifact_remaining_s: f32,
    low_spo2_s: f32,
    high_hr_s: f32,
    low_hr_s: f32,
    arrhythmia_s: f32,
    resp_s: f32,
}

impl SimPatient {
    fn new(
        facility_id: &'static str,
        patient_id: &'static str,
        device_id: &'static str,
        baseline_hr: f32,
        baseline_spo2: f32,
        baseline_rr: f32,
    ) -> Self {
        Self {
            facility_id,
            patient_id,
            device_id,
            baseline_hr,
            baseline_spo2,
            baseline_rr,
            hr: baseline_hr,
            spo2: baseline_spo2,
            rr: baseline_rr,
            wave_phase_s: 0.0,
            hr_variability: 0.0,
            active_event: None,
            event_remaining_s: 0.0,
            cooldown_s: 0.0,
            artifact_remaining_s: 0.0,
            low_spo2_s: 0.0,
            high_hr_s: 0.0,
            low_hr_s: 0.0,
            arrhythmia_s: 0.0,
            resp_s: 0.0,
        }
    }

    fn quality_score(&self, rng: &mut impl Rng) -> f32 {
        let mut score: f32 = if self.artifact_remaining_s > 0.0 {
            rng.gen_range(0.28..0.55)
        } else {
            rng.gen_range(0.82..0.97)
        };

        if matches!(self.active_event, Some(SimEventKind::Arrhythmia)) {
            score -= 0.06;
        }
        if matches!(self.active_event, Some(SimEventKind::RespiratoryConcern)) {
            score -= 0.03;
        }

        score.clamp(0.12, 0.99)
    }
}

fn clamp(value: f32, lo: f32, hi: f32) -> f32 {
    value.max(lo).min(hi)
}

fn gaussian(x: f32, mu: f32, sigma: f32) -> f32 {
    let v = (x - mu) / sigma.max(1e-4);
    (-0.5 * v * v).exp()
}

fn quality_flag(score: f32) -> &'static str {
    if score >= 0.78 {
        "high"
    } else if score >= 0.52 {
        "medium"
    } else {
        "low"
    }
}

fn round1(v: f32) -> f32 {
    (v * 10.0).round() / 10.0
}

fn decay_counter(counter: &mut f32, dt_s: f32) {
    *counter = (*counter - dt_s * 0.9).max(0.0);
}

fn init_sim_patients() -> Vec<SimPatient> {
    vec![
        SimPatient::new(
            "11111111-1111-1111-1111-111111111111",
            "N01P0001",
            "MONN0101",
            74.0,
            98.0,
            15.0,
        ),
        SimPatient::new(
            "11111111-1111-1111-1111-111111111111",
            "N02P0002",
            "MONN0202",
            82.0,
            97.0,
            16.0,
        ),
        SimPatient::new(
            "11111111-1111-1111-1111-111111111111",
            "N03P0003",
            "MONN0303",
            66.0,
            98.5,
            14.0,
        ),
        SimPatient::new(
            "11111111-1111-1111-1111-111111111111",
            "N04P0004",
            "MONN0404",
            79.0,
            96.8,
            17.0,
        ),
        SimPatient::new(
            "11111111-1111-1111-1111-111111111111",
            "N05P0005",
            "MONN0505",
            72.0,
            98.1,
            14.5,
        ),
        SimPatient::new(
            "11111111-1111-1111-1111-111111111111",
            "N06P0006",
            "MONN0606",
            86.0,
            96.2,
            18.2,
        ),
        SimPatient::new(
            "11111111-1111-1111-1111-111111111111",
            "N07P0007",
            "MONN0707",
            68.0,
            98.4,
            13.2,
        ),
        SimPatient::new(
            "11111111-1111-1111-1111-111111111111",
            "N08P0008",
            "MONN0808",
            91.0,
            95.9,
            19.1,
        ),
        SimPatient::new(
            "22222222-2222-2222-2222-222222222222",
            "S01P0101",
            "MONS0101",
            76.0,
            97.7,
            15.0,
        ),
        SimPatient::new(
            "22222222-2222-2222-2222-222222222222",
            "S02P0102",
            "MONS0202",
            88.0,
            96.4,
            18.0,
        ),
        SimPatient::new(
            "22222222-2222-2222-2222-222222222222",
            "S03P0103",
            "MONS0303",
            70.0,
            98.2,
            13.5,
        ),
        SimPatient::new(
            "22222222-2222-2222-2222-222222222222",
            "S04P0104",
            "MONS0404",
            84.0,
            97.1,
            17.0,
        ),
        SimPatient::new(
            "22222222-2222-2222-2222-222222222222",
            "S05P0105",
            "MONS0505",
            73.0,
            97.9,
            14.6,
        ),
        SimPatient::new(
            "22222222-2222-2222-2222-222222222222",
            "S06P0106",
            "MONS0606",
            87.0,
            96.3,
            18.4,
        ),
        SimPatient::new(
            "22222222-2222-2222-2222-222222222222",
            "S07P0107",
            "MONS0707",
            69.0,
            98.0,
            13.4,
        ),
        SimPatient::new(
            "22222222-2222-2222-2222-222222222222",
            "S08P0108",
            "MONS0808",
            90.0,
            95.8,
            19.0,
        ),
    ]
}

fn start_event(patient: &mut SimPatient, rng: &mut impl Rng) {
    let roll = rng.gen_range(0.0..1.0);
    let kind = if roll < 0.33 {
        SimEventKind::Tachycardia
    } else if roll < 0.56 {
        SimEventKind::Spo2Drop
    } else if roll < 0.72 {
        SimEventKind::RespiratoryConcern
    } else if roll < 0.88 {
        SimEventKind::Arrhythmia
    } else {
        SimEventKind::Bradycardia
    };

    patient.active_event = Some(kind);
    patient.event_remaining_s = kind.base_duration_s(rng);
}

fn update_patient_state(
    patient: &mut SimPatient,
    dt_s: f32,
    rng: &mut impl Rng,
    forced_event: Option<SimEventKind>,
    allow_random_changes: bool,
) {
    patient.cooldown_s = (patient.cooldown_s - dt_s).max(0.0);
    patient.event_remaining_s = (patient.event_remaining_s - dt_s).max(0.0);
    patient.artifact_remaining_s = (patient.artifact_remaining_s - dt_s).max(0.0);

    if let Some(event_kind) = forced_event {
        patient.active_event = Some(event_kind);
        patient.event_remaining_s = 6.0;
        patient.cooldown_s = 0.0;
    } else if allow_random_changes {
        if patient.active_event.is_none()
            && patient.cooldown_s <= 0.0
            && rng.gen_bool((0.0045_f64 * f64::from(dt_s)).clamp(0.0, 0.35))
        {
            start_event(patient, rng);
        }

        if patient.artifact_remaining_s <= 0.0
            && rng.gen_bool((0.0070_f64 * f64::from(dt_s)).clamp(0.0, 0.35))
        {
            patient.artifact_remaining_s = rng.gen_range(1.2..4.2);
        }
    } else {
        patient.active_event = None;
        patient.event_remaining_s = 0.0;
        patient.cooldown_s = 0.0;
        patient.artifact_remaining_s = 0.0;
    }

    let prev_hr = patient.hr;

    if let Some(kind) = patient.active_event {
        match kind {
            SimEventKind::Tachycardia => {
                let target_hr = patient.baseline_hr + 36.0 + 7.0 * (patient.wave_phase_s * 0.4).sin();
                let target_rr = patient.baseline_rr + 4.0;
                patient.hr += (target_hr - patient.hr) * 0.42 * dt_s;
                patient.rr += (target_rr - patient.rr) * 0.35 * dt_s;
                patient.spo2 += (patient.baseline_spo2 - 1.3 - patient.spo2) * 0.25 * dt_s;
            }
            SimEventKind::Spo2Drop => {
                let target_spo2 = 85.5 + 1.8 * (patient.wave_phase_s * 0.17).sin();
                let target_hr = patient.baseline_hr + 11.0;
                let target_rr = patient.baseline_rr + 5.0;
                patient.spo2 += (target_spo2 - patient.spo2) * 0.36 * dt_s;
                patient.hr += (target_hr - patient.hr) * 0.30 * dt_s;
                patient.rr += (target_rr - patient.rr) * 0.28 * dt_s;
            }
            SimEventKind::Arrhythmia => {
                let oscillation = 16.0 * (patient.wave_phase_s * 7.8).sin();
                let jitter = rng.gen_range(-7.0..7.0);
                let target_hr = patient.baseline_hr + oscillation + jitter;
                patient.hr += (target_hr - patient.hr) * 0.45 * dt_s;
                patient.rr += (patient.baseline_rr + 2.0 - patient.rr) * 0.20 * dt_s;
                patient.spo2 += (patient.baseline_spo2 - 1.0 - patient.spo2) * 0.20 * dt_s;
            }
            SimEventKind::Bradycardia => {
                let target_hr = (patient.baseline_hr - 26.0).max(39.0);
                patient.hr += (target_hr - patient.hr) * 0.40 * dt_s;
                patient.rr += (patient.baseline_rr - 2.0 - patient.rr) * 0.25 * dt_s;
                patient.spo2 += (patient.baseline_spo2 - 1.6 - patient.spo2) * 0.20 * dt_s;
            }
            SimEventKind::RespiratoryConcern => {
                let target_rr = patient.baseline_rr + 12.0 + 2.5 * (patient.wave_phase_s * 0.6).sin();
                let target_spo2 = patient.baseline_spo2 - 3.2;
                patient.rr += (target_rr - patient.rr) * 0.33 * dt_s;
                patient.spo2 += (target_spo2 - patient.spo2) * 0.22 * dt_s;
                patient.hr += (patient.baseline_hr + 6.0 - patient.hr) * 0.18 * dt_s;
            }
        }

        if patient.event_remaining_s <= 0.0 && allow_random_changes {
            patient.active_event = None;
            patient.cooldown_s = rng.gen_range(18.0..48.0);
        }
    } else {
        patient.hr += (patient.baseline_hr - patient.hr) * 0.24 * dt_s;
        patient.spo2 += (patient.baseline_spo2 - patient.spo2) * 0.18 * dt_s;
        patient.rr += (patient.baseline_rr - patient.rr) * 0.22 * dt_s;
    }

    let noise_scale = if patient.artifact_remaining_s > 0.0 {
        1.9
    } else {
        1.0
    };
    patient.hr += rng.gen_range(-1.0..1.0) * 2.6 * dt_s * noise_scale;
    patient.spo2 += rng.gen_range(-0.22..0.22) * 2.2 * dt_s * noise_scale;
    patient.rr += rng.gen_range(-0.35..0.35) * 2.0 * dt_s * noise_scale;

    patient.hr = clamp(patient.hr, 35.0, 172.0);
    patient.spo2 = clamp(patient.spo2, 78.0, 100.0);
    patient.rr = clamp(patient.rr, 6.0, 38.0);

    let delta_hr = (patient.hr - prev_hr).abs();
    patient.hr_variability = 0.88 * patient.hr_variability + 0.12 * delta_hr;

    let quality_for_rules = if patient.artifact_remaining_s > 0.0 {
        0.35
    } else if matches!(patient.active_event, Some(SimEventKind::Arrhythmia)) {
        0.74
    } else {
        0.88
    };

    if patient.spo2 < 90.0 && quality_for_rules >= 0.72 {
        patient.low_spo2_s += dt_s;
    } else {
        decay_counter(&mut patient.low_spo2_s, dt_s);
    }

    if patient.hr > 130.0 && quality_for_rules >= 0.70 {
        patient.high_hr_s += dt_s;
    } else {
        decay_counter(&mut patient.high_hr_s, dt_s);
    }

    if patient.hr < 48.0 && quality_for_rules >= 0.70 {
        patient.low_hr_s += dt_s;
    } else {
        decay_counter(&mut patient.low_hr_s, dt_s);
    }

    if patient.hr_variability > 5.8 && quality_for_rules >= 0.68 {
        patient.arrhythmia_s += dt_s;
    } else {
        decay_counter(&mut patient.arrhythmia_s, dt_s);
    }

    if (patient.rr > 28.0 || patient.rr < 9.0 || (patient.spo2 < 92.0 && patient.rr > 24.0))
        && quality_for_rules >= 0.66
    {
        patient.resp_s += dt_s;
    } else {
        decay_counter(&mut patient.resp_s, dt_s);
    }
}

fn waveform_ecg(patient: &mut SimPatient, sample_hz: f32, sample_count: usize, quality_score: f32, rng: &mut impl Rng) -> Vec<f32> {
    let mut samples = Vec::with_capacity(sample_count);
    let dt = 1.0 / sample_hz.max(1.0);
    let mut t = patient.wave_phase_s;
    let noise_amp = (1.0 - quality_score).mul_add(0.16, 0.006).clamp(0.006, 0.18);
    let arrhythmia = matches!(patient.active_event, Some(SimEventKind::Arrhythmia));

    for _ in 0..sample_count {
        let mut beat_period = 60.0 / patient.hr.max(35.0);
        if arrhythmia {
            beat_period *= 1.0 + 0.16 * (2.0 * std::f32::consts::PI * 0.8 * t).sin();
        }

        let phase = (t / beat_period).fract();
        let p = 0.11 * gaussian(phase, 0.17, 0.03);
        let q = -0.14 * gaussian(phase, 0.24, 0.013);
        let r = 1.12 * gaussian(phase, 0.27, 0.0095);
        let s = -0.24 * gaussian(phase, 0.30, 0.015);
        let tw = 0.30 * gaussian(phase, 0.53, 0.07);
        let baseline = 0.03 * (2.0 * std::f32::consts::PI * 0.33 * t).sin();
        let noise = rng.gen_range(-noise_amp..noise_amp);

        samples.push(p + q + r + s + tw + baseline + noise);
        t += dt;
    }

    patient.wave_phase_s = t;
    samples
}

fn waveform_ppg(patient: &mut SimPatient, sample_hz: f32, sample_count: usize, quality_score: f32, rng: &mut impl Rng) -> Vec<f32> {
    let mut samples = Vec::with_capacity(sample_count);
    let dt = 1.0 / sample_hz.max(1.0);
    let mut t = patient.wave_phase_s;
    let noise_amp = (1.0 - quality_score).mul_add(0.12, 0.004).clamp(0.004, 0.14);
    let amplitude_scale = clamp(patient.spo2 / 100.0, 0.78, 1.02);

    for _ in 0..sample_count {
        let beat_period = 60.0 / patient.hr.max(35.0);
        let phase = (t / beat_period).fract();
        let upstroke = if phase < 0.2 {
            phase / 0.2
        } else {
            (1.0 - (phase - 0.2) / 0.8).max(0.0).powf(2.2)
        };
        let notch = 0.18 * gaussian(phase, 0.43, 0.05);
        let baseline = 0.01 * (2.0 * std::f32::consts::PI * 0.2 * t).sin();
        let noise = rng.gen_range(-noise_amp..noise_amp);

        samples.push(0.12 + amplitude_scale * (upstroke - notch) + baseline + noise);
        t += dt;
    }

    patient.wave_phase_s = t;
    samples
}

fn build_waveform_payload(patient: &mut SimPatient, quality_score: f32, signal_type: &str, rng: &mut impl Rng) -> Payload {
    let (sample_hz, samples) = if signal_type == "ecg" {
        (125.0, waveform_ecg(patient, 125.0, 96, quality_score, rng))
    } else {
        (62.5, waveform_ppg(patient, 62.5, 64, quality_score, rng))
    };

    Payload::Waveform {
        facility_id: patient.facility_id.to_string(),
        patient_id: patient.patient_id.to_string(),
        device_id: patient.device_id.to_string(),
        signal_type: signal_type.to_string(),
        sample_hz,
        samples,
    }
}

fn scenario_has_patient(scenario: DemoScenario, patient_id: &str) -> bool {
    scenario.occupied_patients.iter().any(|candidate| *candidate == patient_id)
}

fn scenario_event_for_patient(
    scenario: DemoScenario,
    patient_id: &str,
    cleared_patients: &HashSet<String>,
) -> Option<SimEventKind> {
    if cleared_patients.contains(patient_id) {
        return None;
    }

    if let Some(alarm) = scenario
        .active_alarms
        .iter()
        .find(|alarm| alarm.patient_id == patient_id)
    {
        return Some(alarm.event);
    }

    scenario
        .observation_events
        .iter()
        .find(|event| event.patient_id == patient_id)
        .map(|event| event.event)
}

fn build_scenario_alarm_payload(
    patient: &SimPatient,
    assignment: ScenarioAlarm,
    quality_score: f32,
    quality: &str,
    scenario: DemoScenario,
    active_for_s: i64,
) -> Payload {
    let status_note = if active_for_s >= 60 {
        "still active; escalation threshold approaching"
    } else if active_for_s >= 40 {
        "awaiting bedside confirmation"
    } else if active_for_s >= 20 {
        "under review for 20 sec"
    } else {
        "new active issue"
    };

    let context = serde_json::json!({
        "window_s": 30,
        "signal_quality": quality,
        "drop_duration_s": if assignment.event == SimEventKind::Spo2Drop { 28 } else { 0 },
        "trend_hr_bpm": round1(patient.hr),
        "trend_spo2": round1(patient.spo2),
        "trend_rr": round1(patient.rr),
        "hr_variability": round1(patient.hr_variability),
        "detection_basis": format!("scenario_{}", assignment.event.alarm_type()),
        "confidence_hint": if quality_score >= 0.82 { "high" } else if quality_score >= 0.62 { "moderate" } else { "limited" },
        "response_priority": assignment.response_priority,
        "recommended_recheck_s": assignment.recommended_recheck_s,
        "active_for_s": active_for_s,
        "status_note": status_note,
        "scenario_id": scenario.id,
        "scenario_label": scenario.label,
        "source": "simulator_demo_controlled_v1"
    });

    Payload::Alarm {
        facility_id: patient.facility_id.to_string(),
        patient_id: patient.patient_id.to_string(),
        device_id: patient.device_id.to_string(),
        alarm_type: assignment.event.alarm_type().to_string(),
        severity: assignment.severity.to_string(),
        raw_payload_json: context,
    }
}

fn build_alarm_clear_payload(patient: &SimPatient, scenario: DemoScenario) -> Payload {
    Payload::AlarmClear {
        facility_id: patient.facility_id.to_string(),
        patient_id: patient.patient_id.to_string(),
        device_id: patient.device_id.to_string(),
        reason: format!("resolved_or_inactive_in_scenario:{}", scenario.id),
    }
}

fn start_simulation_loop(state: AppState) {
    tokio::spawn(async move {
        let mut patients = init_sim_patients();
        let mut waveform_tick = time::interval(Duration::from_millis(10_000));
        let mut numeric_tick = time::interval(Duration::from_millis(20_000));
        let mut alarm_tick = time::interval(Duration::from_millis(2_000));
        let mut waveform_cursor = 0usize;
        let mut numeric_cursor = 0usize;
        let mut use_ecg = true;
        let mut last_revision = 0u64;
        let mut previous_alarm_patients: HashSet<String> = HashSet::new();
        let mut last_alarm_emit: HashMap<String, DateTime<Utc>> = HashMap::new();
        let mut alarm_started_at: HashMap<String, DateTime<Utc>> = HashMap::new();
        let alarm_refresh = chrono::Duration::seconds(20);

        let patient_idx_by_id: HashMap<&'static str, usize> = patients
            .iter()
            .enumerate()
            .map(|(idx, patient)| (patient.patient_id, idx))
            .collect();

        loop {
            tokio::select! {
                _ = waveform_tick.tick() => {
                    let payload = {
                        let demo_control = state.demo.read().await.clone();
                        if demo_control.paused {
                            continue;
                        }
                        let scenario = scenario_from_control(&demo_control);

                        let occupied_indices: Vec<usize> = scenario
                            .occupied_patients
                            .iter()
                            .filter_map(|patient_id| patient_idx_by_id.get(patient_id).copied())
                            .collect();
                        if occupied_indices.is_empty() {
                            continue;
                        }

                        let mut rng = rand::thread_rng();
                        for patient in patients.iter_mut() {
                            if !scenario_has_patient(scenario, patient.patient_id) {
                                continue;
                            }
                            let forced_event = scenario_event_for_patient(
                                scenario,
                                patient.patient_id,
                                &demo_control.cleared_patients,
                            );
                            update_patient_state(patient, 10.0, &mut rng, forced_event, false);
                        }

                        let idx = occupied_indices[waveform_cursor % occupied_indices.len()];
                        waveform_cursor = waveform_cursor.wrapping_add(1);
                        let signal_type = if use_ecg { "ecg" } else { "ppg" };
                        use_ecg = !use_ecg;

                        let patient = &mut patients[idx];
                        let quality = patient.quality_score(&mut rng);
                        build_waveform_payload(patient, quality, signal_type, &mut rng)
                    };

                    let _ = state.tx.send(state.wrap(payload));
                    state.record_counter("sim_waveform").await;
                }
                _ = numeric_tick.tick() => {
                    let payloads = {
                        let demo_control = state.demo.read().await.clone();
                        if demo_control.paused {
                            continue;
                        }
                        let scenario = scenario_from_control(&demo_control);
                        let occupied_indices: Vec<usize> = scenario
                            .occupied_patients
                            .iter()
                            .filter_map(|patient_id| patient_idx_by_id.get(patient_id).copied())
                            .collect();
                        if occupied_indices.is_empty() {
                            continue;
                        }

                        let mut rng = rand::thread_rng();
                        let idx = occupied_indices[numeric_cursor % occupied_indices.len()];
                        numeric_cursor = numeric_cursor.wrapping_add(1);

                        let patient = &mut patients[idx];
                        let quality = patient.quality_score(&mut rng);
                        let quality_flag = quality_flag(quality).to_string();
                        vec![
                            Payload::NumericObs {
                                facility_id: patient.facility_id.to_string(),
                                patient_id: patient.patient_id.to_string(),
                                device_id: patient.device_id.to_string(),
                                signal_type: "hr".to_string(),
                                value: f64::from(round1(patient.hr)),
                                quality_flag: quality_flag.clone(),
                            },
                            Payload::NumericObs {
                                facility_id: patient.facility_id.to_string(),
                                patient_id: patient.patient_id.to_string(),
                                device_id: patient.device_id.to_string(),
                                signal_type: "spo2".to_string(),
                                value: f64::from(round1(patient.spo2)),
                                quality_flag: quality_flag.clone(),
                            },
                            Payload::NumericObs {
                                facility_id: patient.facility_id.to_string(),
                                patient_id: patient.patient_id.to_string(),
                                device_id: patient.device_id.to_string(),
                                signal_type: "rr".to_string(),
                                value: f64::from(round1(patient.rr)),
                                quality_flag,
                            },
                        ]
                    };

                    for payload in payloads {
                        let _ = state.tx.send(state.wrap(payload));
                    }
                    state.record_counter("sim_numeric").await;
                }
                _ = alarm_tick.tick() => {
                    let emitted = {
                        let demo_control = state.demo.read().await.clone();
                        if demo_control.paused {
                            continue;
                        }
                        let scenario = scenario_from_control(&demo_control);
                        let mut emitted = 0u64;
                        let now = Utc::now();
                        let revision_changed = demo_control.revision != last_revision;

                        let current_alarm_patients: HashSet<String> = scenario
                            .active_alarms
                            .iter()
                            .filter(|alarm| !demo_control.cleared_patients.contains(alarm.patient_id))
                            .map(|alarm| alarm.patient_id.to_string())
                            .collect();
                        if revision_changed {
                            for patient_id in previous_alarm_patients.difference(&current_alarm_patients) {
                                if let Some(idx) = patient_idx_by_id.get(patient_id.as_str()).copied() {
                                    let payload = build_alarm_clear_payload(&patients[idx], scenario);
                                    let _ = state.tx.send(state.wrap(payload));
                                    emitted += 1;
                                }
                                last_alarm_emit.remove(patient_id);
                                alarm_started_at.remove(patient_id);
                            }
                            last_revision = demo_control.revision;
                        }
                        previous_alarm_patients = current_alarm_patients;

                        let mut rng = rand::thread_rng();
                        for assignment in scenario.active_alarms {
                            if demo_control.cleared_patients.contains(assignment.patient_id) {
                                continue;
                            }
                            let Some(idx) = patient_idx_by_id.get(assignment.patient_id).copied() else {
                                continue;
                            };
                            let patient = &patients[idx];
                            let patient_key = assignment.patient_id.to_string();
                            let started_at = alarm_started_at
                                .entry(patient_key.clone())
                                .or_insert(now);
                            let active_for_s = (now - *started_at).num_seconds().max(0);
                            let should_emit = if revision_changed {
                                true
                            } else {
                                match last_alarm_emit.get(&patient_key) {
                                    Some(last_at) => (now - *last_at) >= alarm_refresh,
                                    None => true,
                                }
                            };

                            if !should_emit {
                                continue;
                            }

                            let quality_score = patient.quality_score(&mut rng);
                            let payload = build_scenario_alarm_payload(
                                patient,
                                *assignment,
                                quality_score,
                                quality_flag(quality_score),
                                scenario,
                                active_for_s,
                            );
                            let _ = state.tx.send(state.wrap(payload));
                            last_alarm_emit.insert(patient_key, now);
                            emitted += 1;
                        }

                        emitted
                    };

                    if emitted > 0 {
                        state.record_counter("sim_alarm").await;
                    }
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
