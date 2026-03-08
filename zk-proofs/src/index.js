import crypto from "node:crypto";
import Fastify from "fastify";

const app = Fastify({ logger: true });
const PORT = Number(process.env.PROOF_PORT || 7000);
const PROOF_SECRET = process.env.PROOF_SECRET || "pulsemesh-proof-secret";

const SUPPORTED_SCHEMES = ["zk-sim-groth16-v1", "sha256-commit-v1"];

app.addHook("onRequest", async (_req, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type");
});

app.options("/*", async (_req, reply) => {
  reply.code(204).send();
});

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function sign(payload) {
  return crypto.createHmac("sha256", PROOF_SECRET).update(payload).digest("hex");
}

function canonicalFeatures(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .map((v) => Number(v.toFixed(6)));
}

function toyRisk(features) {
  // Deterministic, published scoring circuit for demo:
  // score = sigmoid(0.2*f0 + 0.17*f1 + ... )
  const weights = [0.2, 0.17, 0.15, 0.13, 0.11, 0.1, 0.08, 0.06, 0.05, 0.04];
  let sum = -0.31;
  for (let i = 0; i < Math.min(weights.length, features.length); i += 1) {
    sum += weights[i] * features[i];
  }
  const p = 1 / (1 + Math.exp(-sum));
  return Number(p.toFixed(6));
}

app.get("/health", async () => ({ status: "ok", service: "zk-proofs" }));
app.get("/schemes", async () => ({ schemes: SUPPORTED_SCHEMES }));

app.post("/commit", async (request, reply) => {
  const { feature_vector = [], model_version_id = "gbt-sklearn-v1" } = request.body || {};
  const fv = canonicalFeatures(feature_vector);

  if (!fv.length) {
    return reply.code(400).send({ error: "feature_vector is required" });
  }

  const commitment = sha256(stableJson({ fv, model_version_id }));
  return { commitment, feature_count: fv.length, model_version_id };
});

app.post("/prove", async (request, reply) => {
  const {
    inference_event_id,
    scheme = "zk-sim-groth16-v1",
    committed_feature_vector = [],
    claimed_risk_score,
    model_version_id = "gbt-sklearn-v1",
  } = request.body || {};

  if (!inference_event_id) {
    return reply.code(400).send({ error: "inference_event_id is required" });
  }
  if (!SUPPORTED_SCHEMES.includes(scheme)) {
    return reply.code(400).send({ error: `unsupported scheme: ${scheme}` });
  }

  const fv = canonicalFeatures(committed_feature_vector);
  if (!fv.length) {
    return reply.code(400).send({ error: "committed_feature_vector is required" });
  }

  const commitment = sha256(stableJson({ fv, model_version_id }));
  const recomputed = toyRisk(fv);
  const claimed = Number(Number(claimed_risk_score || 0).toFixed(6));

  const payload = {
    version: 1,
    scheme,
    commitment,
    model_version_id,
    claimed_risk_score: claimed,
    recomputed_risk_score: recomputed,
    constraints_digest: sha256("risk_score == toyRisk(feature_vector)"),
    witness_digest: sha256(stableJson(fv)),
    score_match: Math.abs(recomputed - claimed) <= 0.025,
    generated_at: new Date().toISOString(),
  };

  const serialized = stableJson(payload);
  const signature = sign(serialized);
  const proof_blob = Buffer.from(stableJson({ payload, signature })).toString("base64");

  return {
    inference_event_id,
    scheme,
    commitment,
    proof_blob,
  };
});

app.post("/verify", async (request, reply) => {
  const { proof_blob } = request.body || {};
  if (!proof_blob) {
    return reply.code(400).send({ verified: false, reason: "proof_blob is required" });
  }

  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(proof_blob, "base64").toString("utf8"));
  } catch {
    return reply.code(400).send({ verified: false, reason: "malformed proof blob" });
  }

  const payload = decoded?.payload;
  const signature = decoded?.signature;
  if (!payload || !signature) {
    return reply.code(400).send({ verified: false, reason: "missing proof fields" });
  }

  const expected = sign(stableJson(payload));
  const validSig =
    Buffer.byteLength(String(signature)) === Buffer.byteLength(expected) &&
    crypto.timingSafeEqual(Buffer.from(String(signature)), Buffer.from(expected));

  const verified = Boolean(validSig && payload.score_match === true);

  return {
    verified,
    reason: verified ? "signature_valid_and_constraints_satisfied" : "verification_failed",
    scheme: payload.scheme,
    commitment: payload.commitment,
    generated_at: payload.generated_at,
  };
});

app.listen({ host: "0.0.0.0", port: PORT }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
