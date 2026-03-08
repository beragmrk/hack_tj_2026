/**
 * Google Apps Script
 * Creates a Google Slides investor deck layout for PulseMesh.
 *
 * Usage:
 * 1) Go to script.new in your browser.
 * 2) Paste this file.
 * 3) Run createPulseMeshGoogleSlidesLayout().
 * 4) Open the URL in Logs.
 */
function createPulseMeshGoogleSlidesLayout() {
  const presentation = SlidesApp.create("PulseMesh - Investor Pitch Deck");
  const initialSlides = presentation.getSlides();
  if (initialSlides.length > 0) {
    presentation.removeSlide(initialSlides[0]);
  }

  const page = {
    width: presentation.getPageWidth(),
    height: presentation.getPageHeight()
  };

  const slides = [
    {
      title: "PulseMesh",
      subtitle: "Invisible Infrastructure for ICU Alarm Intelligence",
      bullets: [
        "Privacy-preserving real-time alarm triage",
        "Safer, faster clinical response",
        "Auditable decision intelligence"
      ],
      note:
        "Open with urgency: we help clinicians respond to the right alarms first without exposing raw data.",
      layout: "title"
    },
    {
      title: "Problem",
      subtitle: "ICU alarm overload is unsafe and expensive",
      leftHeading: "Clinical Pain",
      leftBullets: [
        "Alarm noise drives alert fatigue",
        "Low-value alerts interrupt care",
        "Critical events can be delayed"
      ],
      rightHeading: "Business Pain",
      rightBullets: [
        "Operational inefficiency in high-cost units",
        "Quality and legal exposure from missed escalations",
        "Burnout and retention pressure on staff"
      ],
      note: "Keep this slide clinical and operational, not technical.",
      layout: "twoCard"
    },
    {
      title: "Why Existing Tools Fail",
      subtitle: "Current systems are noisy, opaque, or hard to trust",
      bullets: [
        "Rule-only systems miss context",
        "Black-box AI is difficult to adopt in clinical workflows",
        "Most platforms are weak on auditable privacy controls"
      ],
      note: "Frame a clear market gap before introducing solution.",
      layout: "oneColumn"
    },
    {
      title: "Solution",
      subtitle: "PulseMesh prioritizes alarm actionability in real time",
      leftHeading: "What It Does",
      leftBullets: [
        "Ingests continuous telemetry streams",
        "Computes actionability score (p_actionable)",
        "Routes suppress / clinician / rapid response"
      ],
      rightHeading: "Why It Matters",
      rightBullets: [
        "Fewer low-value interruptions",
        "Faster escalation for true positives",
        "Clear decision trail for quality review"
      ],
      note: "Reinforce that PulseMesh augments clinical judgment.",
      layout: "twoCard"
    },
    {
      title: "Product Today (MVP)",
      subtitle: "Working full-stack product",
      bullets: [
        "Web app for real-time ICU graph + alarm inspector",
        "Rust gateway for ingest and WebSocket fan-out",
        "FastAPI inference with feature extraction + policy router",
        "Node proof service for verifiable commitments",
        "Timescale + pgvector data layer"
      ],
      note: "Show this is already built, not a concept.",
      layout: "oneColumn"
    },
    {
      title: "Technical Moat",
      subtitle: "Three defensible layers",
      leftHeading: "Clinical Safety",
      leftBullets: [
        "Neuro-symbolic policy routing",
        "Conservative safety overrides",
        "Escalation-first uncertain cases"
      ],
      rightHeading: "Privacy + Trust",
      rightBullets: [
        "Federated-ready workflows",
        "Proof commitments for auditability",
        "Compliance-aligned architecture"
      ],
      note: "This is the moat slide. Keep language crisp.",
      layout: "twoCard"
    },
    {
      title: "ROI for Hospitals",
      subtitle: "Outcomes buyers care about",
      bullets: [
        "[Insert] reduction in non-actionable alarm burden",
        "[Insert] faster response time for high-risk events",
        "[Insert] improvement in escalation precision",
        "Audit-ready decision records for quality teams"
      ],
      note: "Replace placeholders with pilot metrics before meetings.",
      layout: "oneColumn"
    },
    {
      title: "Business Model",
      subtitle: "B2B SaaS with enterprise deployment",
      leftHeading: "Revenue",
      leftBullets: [
        "Annual platform license",
        "Priced by monitored beds/units",
        "Implementation and integration services"
      ],
      rightHeading: "Expansion",
      rightBullets: [
        "Land in one ICU pilot",
        "Expand across units and campuses",
        "Upsell analytics and reporting modules"
      ],
      note: "Seed deck should keep pricing model simple.",
      layout: "twoCard"
    },
    {
      title: "Go-To-Market",
      subtitle: "Land-and-expand in health systems",
      bullets: [
        "Start with 1-2 design-partner ICU pilots",
        "Integrate into existing telemetry workflows",
        "Demonstrate gains over a 90-day evaluation",
        "Convert pilot to multi-unit paid rollout"
      ],
      note: "Investors want a concrete first 12-month motion.",
      layout: "oneColumn"
    },
    {
      title: "Competition",
      subtitle: "Positioning: actionable + auditable + privacy-aware",
      leftHeading: "Incumbents",
      leftBullets: [
        "Strong distribution",
        "Limited real-time intelligence layer",
        "Weak explainability posture"
      ],
      rightHeading: "PulseMesh",
      rightBullets: [
        "Actionability scoring + safety routing",
        "Proof-based auditability",
        "Privacy-preserving architecture"
      ],
      note: "Do not overclaim; compare on capabilities you can defend.",
      layout: "twoCard"
    },
    {
      title: "Traction + Milestones",
      subtitle: "Execution progress and next 2 quarters",
      leftHeading: "Now",
      leftBullets: [
        "End-to-end MVP with live telemetry loop",
        "Inference and policy routing operational",
        "Proof generation and verification implemented"
      ],
      rightHeading: "Next",
      rightBullets: [
        "Pilot-ready integrations",
        "Measured clinical workflow outcomes",
        "Security and compliance hardening"
      ],
      note: "Add dates, pipeline counts, and logos where available.",
      layout: "twoCard"
    },
    {
      title: "Team",
      subtitle: "Why this team can win",
      bullets: [
        "Full-stack execution across Rust, Python, Node, and Next.js",
        "Strength in real-time systems and AI inference",
        "Ability to ship integrated products quickly",
        "[Insert founder bios, advisors, and clinical credibility]"
      ],
      note: "Add headshots and one-line founder proof points.",
      layout: "oneColumn"
    },
    {
      title: "The Ask",
      subtitle: "Raising [Insert Amount] to reach pilot-to-paid conversion",
      leftHeading: "Use of Funds",
      leftBullets: [
        "40% product + integrations",
        "30% pilot operations",
        "20% security/compliance",
        "10% GTM"
      ],
      rightHeading: "Milestones",
      rightBullets: [
        "[Insert] pilots launched",
        "[Insert] paid conversions",
        "[Insert] expansion pipeline"
      ],
      note: "Keep ask and milestones specific and measurable.",
      layout: "twoCard"
    },
    {
      title: "Closing",
      subtitle: "PulseMesh makes ICU alarms more actionable, trustworthy, and privacy-safe",
      bullets: [
        "Better bedside prioritization",
        "Verifiable decision infrastructure",
        "Built for modern hospital operations",
        "Join us in building the trust layer for clinical AI operations"
      ],
      note: "End with conviction and a direct CTA for follow-up.",
      layout: "oneColumn"
    }
  ];

  slides.forEach((config) => {
    const slide = presentation.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    paintBase(slide, page);

    if (config.layout === "title") {
      drawTitleSlide(slide, page, config);
    } else if (config.layout === "twoCard") {
      drawHeader(slide, page, config.title, config.subtitle);
      drawTwoCards(slide, page, config);
    } else {
      drawHeader(slide, page, config.title, config.subtitle);
      drawOneColumn(slide, page, config);
    }

    addSpeakerNotes(slide, config.note);
  });

  Logger.log("Deck URL: " + presentation.getUrl());
}

function paintBase(slide, page) {
  slide.getBackground().setSolidFill("#F8FAFC");

  const topBar = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 0, 0, page.width, 8);
  topBar.getFill().setSolidFill("#0EA5A4");
  topBar.getBorder().getLineFill().setSolidFill("#0EA5A4");
}

function drawHeader(slide, page, title, subtitle) {
  const titleBox = slide.insertTextBox(title, 44, 22, page.width - 88, 54);
  styleTitle(titleBox, 36);

  const subtitleBox = slide.insertTextBox(subtitle, 44, 72, page.width - 88, 36);
  styleSubtitle(subtitleBox, 17);
}

function drawTitleSlide(slide, page, config) {
  const heroTitle = slide.insertTextBox(config.title, 44, 118, page.width - 88, 90);
  styleTitle(heroTitle, 58);

  const subtitle = slide.insertTextBox(config.subtitle, 44, 206, page.width - 88, 52);
  styleSubtitle(subtitle, 24);

  const bullets = slide.insertTextBox(
    toBullets(config.bullets),
    44,
    292,
    page.width - 88,
    172
  );
  styleBody(bullets, 22);

  addPill(slide, 44, 464, 212, 34, "Privacy First");
  addPill(slide, 268, 464, 248, 34, "Realtime Intelligence");
  addPill(slide, 528, 464, 240, 34, "Auditability Built-In");
}

function drawTwoCards(slide, page, config) {
  const gap = 24;
  const leftX = 44;
  const topY = 118;
  const cardHeight = page.height - 160;
  const cardWidth = (page.width - leftX * 2 - gap) / 2;
  const rightX = leftX + cardWidth + gap;

  drawCard(slide, leftX, topY, cardWidth, cardHeight, config.leftHeading, config.leftBullets);
  drawCard(slide, rightX, topY, cardWidth, cardHeight, config.rightHeading, config.rightBullets);
}

function drawOneColumn(slide, page, config) {
  const card = drawCard(slide, 44, 118, page.width - 88, page.height - 160, null, config.bullets);

  if (config.highlight) {
    const callout = slide.insertTextBox(config.highlight, 64, page.height - 92, page.width - 128, 34);
    callout.getText().getTextStyle().setFontFamily("Arial").setFontSize(14).setForegroundColor("#0F172A");
    callout.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
    callout.getText().getTextStyle().setBold(true);
  }

  return card;
}

function drawCard(slide, x, y, width, height, heading, bullets) {
  const card = slide.insertShape(SlidesApp.ShapeType.ROUNDED_RECTANGLE, x, y, width, height);
  card.getFill().setSolidFill("#FFFFFF");
  card.getBorder().getLineFill().setSolidFill("#CBD5E1");
  card.getBorder().setWeight(1);

  if (heading) {
    const headingBox = slide.insertTextBox(heading, x + 20, y + 18, width - 40, 34);
    headingBox.getText().getTextStyle().setFontFamily("Arial").setFontSize(21).setBold(true);
    headingBox.getText().getTextStyle().setForegroundColor("#0F172A");
  }

  const bodyTop = heading ? y + 62 : y + 20;
  const body = slide.insertTextBox(toBullets(bullets), x + 20, bodyTop, width - 40, height - (bodyTop - y) - 20);
  styleBody(body, 18);
  return card;
}

function addPill(slide, x, y, w, h, text) {
  const pill = slide.insertShape(SlidesApp.ShapeType.ROUNDED_RECTANGLE, x, y, w, h);
  pill.getFill().setSolidFill("#E2F7F6");
  pill.getBorder().getLineFill().setSolidFill("#7DD3CF");
  pill.getBorder().setWeight(1);

  const label = slide.insertTextBox(text, x, y + 6, w, 22);
  label.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
  label.getText().getTextStyle().setFontFamily("Arial").setFontSize(12).setBold(true);
  label.getText().getTextStyle().setForegroundColor("#0F172A");
}

function styleTitle(shape, size) {
  shape.getText().getTextStyle().setFontFamily("Arial").setFontSize(size).setBold(true);
  shape.getText().getTextStyle().setForegroundColor("#0F172A");
}

function styleSubtitle(shape, size) {
  shape.getText().getTextStyle().setFontFamily("Arial").setFontSize(size);
  shape.getText().getTextStyle().setForegroundColor("#334155");
}

function styleBody(shape, size) {
  shape.getText().getTextStyle().setFontFamily("Arial").setFontSize(size);
  shape.getText().getTextStyle().setForegroundColor("#0F172A");
}

function addSpeakerNotes(slide, note) {
  if (!note) return;
  const notesShape = slide.getNotesPage().getSpeakerNotesShape();
  if (notesShape) {
    notesShape.getText().setText(note);
  }
}

function toBullets(lines) {
  return (lines || []).map((line) => "• " + line).join("\n");
}
