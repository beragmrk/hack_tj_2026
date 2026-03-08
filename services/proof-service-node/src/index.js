import crypto from "node:crypto";
import Fastify from "fastify";

const app = Fastify({ logger: true });
const PORT = Number(process.env.PROOF_PORT || 7000);
const PROOF_SECRET = process.env.PROOF_SECRET || "pulsemesh-demo-secret";

const SCHEMES = ["sha256-commit-v1", "zk-sim-groth16-v0"];

app.addHook("onRequest", async (_request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type");
});

app.options("/*", async (_request, reply) => {
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

function signProofBlob(blob) {
  return crypto.createHmac("sha256", PROOF_SECRET).update(blob).digest("hex");
}

function canonicalizeFeatures(features) {
  if (!Array.isArray(features) || features.length === 0) {
    return [];
  }
  return features
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .map((v) => Number(v.toFixed(6)));
}

app.get("/health", async () => ({ status: "ok", service: "proof" }));

app.get("/schemes", async () => ({ schemes: SCHEMES }));

app.post("/prove", async (request, reply) => {
  const body = request.body || {};
  const {
    inference_event_id,
    scheme = "zk-sim-groth16-v0",
    committed_feature_vector = [],
    claimed_risk_score,
    model_version_id = "gbt-v0.1",
  } = body;

  if (!inference_event_id) {
    return reply.code(400).send({ error: "inference_event_id is required" });
  }
  if (!SCHEMES.includes(scheme)) {
    return reply.code(400).send({ error: `unsupported scheme: ${scheme}` });
  }

  const fv = canonicalizeFeatures(committed_feature_vector);
  const commitment = sha256(stableJson({ fv, model_version_id }));
  const roundedScore = Number(Number(claimed_risk_score || 0).toFixed(6));

  const proofPayload = {
    version: 1,
    scheme,
    commitment,
    rounded_score: roundedScore,
    model_version_id,
    constraints_digest: sha256("risk_score = gbt(fv)"),
    generated_at: new Date().toISOString(),
  };

  const serialized = stableJson(proofPayload);
  const signature = signProofBlob(serialized);
  const proofBlob = Buffer.from(stableJson({ proofPayload, signature })).toString("base64");

  return {
    inference_event_id,
    scheme,
    commitment,
    proof_blob: proofBlob,
  };
});

app.post("/verify", async (request, reply) => {
  const body = request.body || {};
  const { proof_blob } = body;

  if (!proof_blob) {
    return reply.code(400).send({ error: "proof_blob is required" });
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(proof_blob, "base64").toString("utf8"));
  } catch {
    return reply.code(400).send({ verified: false, reason: "malformed proof blob" });
  }

  const { proofPayload, signature } = parsed || {};
  if (!proofPayload || !signature) {
    return reply.code(400).send({ verified: false, reason: "missing proof fields" });
  }

  const serialized = stableJson(proofPayload);
  const expectedSig = signProofBlob(serialized);
  const sigBuf = Buffer.from(String(signature));
  const expectedBuf = Buffer.from(expectedSig);
  const verified =
    sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);

  return {
    verified,
    scheme: proofPayload.scheme,
    commitment: proofPayload.commitment,
    generated_at: proofPayload.generated_at,
    reason: verified ? "signature_valid" : "signature_mismatch",
  };
});

app.listen({ host: "0.0.0.0", port: PORT }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
