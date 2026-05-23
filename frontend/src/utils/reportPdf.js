import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

const PAGE = {
  marginX: 42,
  marginTop: 52,
  marginBottom: 36,
};

const THEME = {
  heroBg: [8, 47, 41],
  heroAccent: [53, 196, 166],
  text: [26, 38, 34],
  muted: [90, 110, 104],
  border: [204, 221, 214],
  surface: [242, 248, 246],
  chipSurface: [229, 240, 236],
};

function fmtPercent(v) {
  if (v === null || v === undefined) return "-";
  return `${(Number(v) * 100).toFixed(1)}%`;
}

function fmtPercentRound(v) {
  if (v === null || v === undefined) return "-";
  return `${Math.round(Number(v) * 100)}%`;
}

function fmtDate(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

function fmtPlate(record) {
  return record?.plate_text_raw || record?.plate_text || record?.number_plate || "Not detected";
}

function asSourceUrl(pathOrUrl) {
  if (!pathOrUrl) return null;
  if (
    pathOrUrl.startsWith("http://") ||
    pathOrUrl.startsWith("https://") ||
    pathOrUrl.startsWith("blob:") ||
    pathOrUrl.startsWith("data:")
  ) {
    return pathOrUrl;
  }
  return `${API_BASE}${pathOrUrl}`;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function fetchImageAsDataUrl(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

async function cropImageRegion(imageDataUrl, bbox) {
  if (!imageDataUrl || !bbox || bbox.length < 4) return null;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const [x1, y1, x2, y2] = bbox;
      const width = Math.max(1, x2 - x1);
      const height = Math.max(1, y2 - y1);

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }

      ctx.drawImage(img, x1, y1, width, height, 0, 0, width, height);

      canvas.toBlob(
        async (blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          resolve(await blobToDataUrl(blob));
        },
        "image/jpeg",
        0.9,
      );
    };
    img.onerror = () => resolve(null);
    img.src = imageDataUrl;
  });
}

/* ── Normalize case from any shape ──────────────────────────────── */
function normalizeCase(inputCase) {
  const base = inputCase?.raw ? inputCase.raw : inputCase;
  return {
    id: base?.id || inputCase?.id || `case-${Date.now()}`,
    source_type: base?.source_type || inputCase?.source_type || "-",
    source_name: base?.source_name || inputCase?.source_name || "-",
    total_frames: base?.total_frames ?? inputCase?.total_frames,
    frame_stride: base?.frame_stride ?? inputCase?.frame_stride,
    annotated_image_url:
      base?.annotated_image_url ||
      base?.annotated_image ||
      inputCase?.annotated_image_url ||
      inputCase?.annotated_image ||
      null,
    annotated_video_url:
      base?.annotated_video_url ||
      base?.annotated_video ||
      inputCase?.annotated_video_url ||
      inputCase?.annotated_video ||
      null,
    violations_found:
      base?.violations_found ?? inputCase?.violations_found ?? 0,
    records: Array.isArray(base?.records)
      ? base.records
      : Array.isArray(inputCase?.records)
        ? inputCase.records
        : [],
    groq_analysis:
      base?.groq_analysis ||
      inputCase?.groq_analysis ||
      base?.detection_summary?.groq_analysis ||
      inputCase?.detection_summary?.groq_analysis ||
      null,
  };
}

/* ── Map violation type to clean label ──────────────────────────── */
function mapViolationLabel(type) {
  if (!type) return "Unknown Violation";
  const t = type.toLowerCase();
  if (t === "smoke_emission" || t.includes("smoke")) return "Smoke Detection";
  if (t === "littering" || t.includes("litter")) return "Vehicle Littering Detection";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/* ── Resolve which data to use (same logic as Results.jsx) ──────── */
function resolveReportData(caseData) {
  const visionData = caseData.groq_analysis;
  const violations = Array.isArray(visionData?.violations) ? visionData.violations : [];

  const findViolation = (kind) => violations.find(
    (v) => String(v?.violation_type || "").toLowerCase().includes(kind),
  );

  const toRecord = (index, title, kind) => {
    const violation = findViolation(kind);
    return {
      index,
      violation: title,
      confidence: violation?.confidence || 0,
      number_plate: violation?.number_plate || "Not detected",
      vehicle_confidence: violation?.confidence || null,
      plate_confidence: violation?.number_plate ? violation.confidence : null,
      ocr_confidence: violation?.number_plate ? violation.confidence : null,
      source: "vision",
      ai_message:
        violation?.description ||
        (visionData ? "No AI violation detected" : "GROQ analysis unavailable"),
      ai_detected: Boolean(violation?.violation_detected),
    };
  };

  return {
    source: "vision",
    records: [
      toRecord(1, "Vehicle Littering Detection", "litter"),
      toRecord(2, "Smoke Detection", "smoke"),
    ],
  };
}

function getRecordImageUrl(record, caseData) {
  return asSourceUrl(
    record?.frame_image_url || caseData?.annotated_image_url || null,
  );
}

function getAnnotatedEvidenceUrl(caseData) {
  const firstRecord = Array.isArray(caseData?.records) ? caseData.records.find((record) => record?.frame_image_url || record?.frame_image_url_abs) : null;
  const candidate = firstRecord?.frame_image_url_abs || firstRecord?.frame_image_url || caseData?.annotated_image_url || null;
  if (!candidate) return null;
  if (String(candidate).toLowerCase().endsWith('.mp4')) return null;
  return asSourceUrl(candidate);
}

function fitImageToBox(doc, imageDataUrl, boxX, boxY, boxW, boxH) {
  const props = doc.getImageProperties(imageDataUrl);
  const imageWidth = props?.width || boxW;
  const imageHeight = props?.height || boxH;
  const scale = Math.min(boxW / imageWidth, boxH / imageHeight);
  const renderW = imageWidth * scale;
  const renderH = imageHeight * scale;
  const offsetX = boxX + (boxW - renderW) / 2;
  const offsetY = boxY + (boxH - renderH) / 2;

  return {
    x: offsetX,
    y: offsetY,
    width: renderW,
    height: renderH,
  };
}

async function drawRecordBoundingBoxes(imageDataUrl, record) {
  if (!imageDataUrl) return null;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(imageDataUrl);
        return;
      }

      ctx.drawImage(img, 0, 0);

      const drawBox = (bbox, color, label) => {
        if (!Array.isArray(bbox) || bbox.length < 4) return;
        const [x1, y1, x2, y2] = bbox.map((v) => Number(v));
        const w = Math.max(1, x2 - x1);
        const h = Math.max(1, y2 - y1);

        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.strokeRect(x1, y1, w, h);

        ctx.font = "bold 15px Arial";
        const textW = ctx.measureText(label).width + 12;
        const textY = Math.max(20, y1 - 6);
        ctx.fillStyle = color;
        ctx.fillRect(x1, textY - 17, textW, 20);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, x1 + 5, textY - 2);
      };

      drawBox(
        record?.violation_bbox,
        "#e45151",
        `${record?.violation || "violation"} ${fmtPercent(record?.violation_confidence)}`,
      );
      drawBox(
        record?.vehicle_bbox,
        "#20b779",
        `${record?.vehicle_class || "vehicle"} ${fmtPercent(record?.vehicle_confidence)}`,
      );
      drawBox(record?.plate_bbox, "#d6a800", `plate ${fmtPlate(record)}`);

      canvas.toBlob(
        async (blob) => {
          if (!blob) {
            resolve(imageDataUrl);
            return;
          }
          resolve(await blobToDataUrl(blob));
        },
        "image/jpeg",
        0.92,
      );
    };
    img.onerror = () => resolve(imageDataUrl);
    img.src = imageDataUrl;
  });
}

function ensureSpace(doc, state, neededHeight) {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (state.y + neededHeight <= pageHeight - PAGE.marginBottom) return;
  doc.addPage();
  state.y = PAGE.marginTop;
}

function drawSectionHeader(doc, state, title, subtitle = "") {
  ensureSpace(doc, state, 42);

  doc.setTextColor(...THEME.text);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(title, PAGE.marginX, state.y);

  if (subtitle) {
    doc.setTextColor(...THEME.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(subtitle, PAGE.marginX, state.y + 13);
  }

  doc.setDrawColor(...THEME.border);
  doc.setLineWidth(0.8);
  doc.line(
    PAGE.marginX,
    state.y + 20,
    doc.internal.pageSize.getWidth() - PAGE.marginX,
    state.y + 20,
  );

  state.y += 30;
}

function drawHero(doc, caseData, reportRecords) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(...THEME.heroBg);
  doc.rect(0, 0, pageWidth, 148, "F");

  doc.setTextColor(240, 255, 250);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.text("EcoScout Investigation Report", PAGE.marginX, 48);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Case ID: ${caseData.id}`, PAGE.marginX, 68);
  doc.text(`Generated: ${fmtDate(new Date().toISOString())}`, PAGE.marginX, 82);
  doc.text(`Evidence: ${caseData.source_name}`, PAGE.marginX, 96);

  const totalViolations = reportRecords.length;
  const highConf = reportRecords.filter((r) => r.confidence >= 0.8).length;
  const platesRead = reportRecords.filter((r) => r.number_plate && r.number_plate !== "Not detected").length;

  const metricY = 112;
  const startX = PAGE.marginX;
  const cardW = 120;
  const cardH = 28;
  const gap = 8;

  const cards = [
    ["Violations", String(totalViolations)],
    ["High Confidence", String(highConf)],
    ["Plates Read", String(platesRead)],
  ];

  cards.forEach((card, i) => {
    const x = startX + i * (cardW + gap);
    doc.setFillColor(...THEME.heroAccent);
    doc.roundedRect(x, metricY, cardW, cardH, 5, 5, "F");
    doc.setTextColor(7, 38, 33);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(card[0], x + 8, metricY + 11);
    doc.setFontSize(10);
    doc.text(card[1], x + 8, metricY + 22);
  });
}

function drawExecutiveSummary(doc, state, caseData, reportRecords) {
  const pageWidth = doc.internal.pageSize.getWidth();
  ensureSpace(doc, state, 56);
  doc.setFillColor(...THEME.surface);
  doc.roundedRect(
    PAGE.marginX,
    state.y,
    pageWidth - PAGE.marginX * 2,
    44,
    6,
    6,
    "F",
  );

  doc.setTextColor(...THEME.text);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const violationCount = reportRecords.length;
  const summaryText = `${violationCount} potential violation(s) were detected in ${caseData.source_type} evidence. This report presents detection results with confidence metrics, number plate identification, and annotated evidence for review.`;
  const wrapped = doc.splitTextToSize(
    summaryText,
    pageWidth - PAGE.marginX * 2 - 14,
  );
  doc.text(wrapped, PAGE.marginX + 8, state.y + 15);
  state.y += 56;
}

function drawFooterOnAllPages(doc) {
  const totalPages = doc.internal.pages.length - 1;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...THEME.border);
    doc.setLineWidth(0.6);
    doc.line(
      PAGE.marginX,
      pageHeight - 26,
      pageWidth - PAGE.marginX,
      pageHeight - 26,
    );

    doc.setTextColor(...THEME.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text("EcoScout", PAGE.marginX, pageHeight - 13);
    doc.text(
      `Page ${i} / ${totalPages}`,
      pageWidth - PAGE.marginX - 48,
      pageHeight - 13,
    );
  }
}

/* ── Draw a single violation record card in the PDF ─────────────── */
function drawRecordCard(doc, state, record) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const cardX = PAGE.marginX;
  const cardW = pageWidth - PAGE.marginX * 2;
  const cardH = 120;

  ensureSpace(doc, state, cardH + 12);

  // Card background
  doc.setFillColor(...THEME.surface);
  doc.setDrawColor(...THEME.border);
  doc.roundedRect(cardX, state.y, cardW, cardH, 6, 6, "FD");

  const innerX = cardX + 12;
  let lineY = state.y + 18;

  // Record # and violation type
  doc.setTextColor(...THEME.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(`Record #${record.index}`, innerX, lineY);

  lineY += 14;
  doc.setTextColor(...THEME.text);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(record.violation, innerX, lineY);

  // Confidence badge on the right
  const confText = `${Math.round(record.confidence * 100)}% confidence`;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const confWidth = doc.getTextWidth(confText) + 16;
  const badgeX = cardX + cardW - confWidth - 12;
  const badgeY = state.y + 14;
  doc.setFillColor(...THEME.heroAccent);
  doc.roundedRect(badgeX, badgeY, confWidth, 20, 4, 4, "F");
  doc.setTextColor(7, 38, 33);
  doc.text(confText, badgeX + 8, badgeY + 14);

  lineY += 20;

  // Number plate
  doc.setTextColor(...THEME.text);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Number Plate", innerX, lineY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(record.number_plate, innerX + 90, lineY);

  lineY += 18;

  if (record.ai_message) {
    doc.setTextColor(...THEME.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.6);
    doc.text(record.ai_message, innerX, lineY);
    lineY += 14;
  }

  // Confidence metrics in a row
  const metrics = [
    ["Vehicle Confidence", fmtPercentRound(record.vehicle_confidence)],
    ["Plate Confidence", fmtPercentRound(record.plate_confidence)],
    ["OCR Confidence", fmtPercentRound(record.ocr_confidence)],
  ];

  const metricColW = (cardW - 24) / 3;
  metrics.forEach((m, i) => {
    const mx = innerX + i * metricColW;
    doc.setTextColor(...THEME.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(m[0], mx, lineY);

    doc.setTextColor(...THEME.text);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(m[1], mx, lineY + 12);
  });

  state.y += cardH + 10;
}

/* ── Main export function ───────────────────────────────────────── */
export async function exportCaseReportPdf(inputCase) {
  const caseData = normalizeCase(inputCase);
  const resolved = resolveReportData(caseData);
  const reportRecords = resolved.records;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const state = { y: 164 };

  // ─── Page 1: Hero + Summary ───────────────────────────────────
  drawHero(doc, caseData, reportRecords);
  drawExecutiveSummary(doc, state, caseData, reportRecords);

  // ─── Section 1: Case Profile ──────────────────────────────────
  drawSectionHeader(
    doc,
    state,
    "1. Case Profile",
    "Core case metadata and processing parameters",
  );
  autoTable(doc, {
    startY: state.y,
    theme: "grid",
    head: [["Field", "Value"]],
    body: [
      ["Case Identifier", String(caseData.id)],
      ["Evidence File", String(caseData.source_name)],
      ["Evidence Type", String(caseData.source_type)],
      ["Detected Violations", String(reportRecords.length)],
      [
        "Processed Frames",
        caseData.total_frames === undefined
          ? "-"
          : String(caseData.total_frames),
      ],
      [
        "Sampling Stride",
        caseData.frame_stride === undefined
          ? "-"
          : String(caseData.frame_stride),
      ],
      ["Report Timestamp", fmtDate(new Date().toISOString())],
    ],
    styles: {
      font: "helvetica",
      fontSize: 9,
      cellPadding: 6,
      textColor: THEME.text,
      lineColor: THEME.border,
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: THEME.heroBg,
      textColor: [240, 255, 250],
      fontStyle: "bold",
      halign: "left",
    },
    columnStyles: {
      0: { cellWidth: 170, fontStyle: "bold", fillColor: THEME.chipSurface },
      1: { cellWidth: 330 },
    },
    margin: { left: PAGE.marginX, right: PAGE.marginX },
  });
  state.y = doc.lastAutoTable.finalY + 16;

  // ─── Section 2: Detection Results (record cards) ──────────────
  drawSectionHeader(
    doc,
    state,
    "2. Detection Results",
    "Violation records with confidence metrics and plate identification",
  );

  const annotatedEvidenceUrl = getAnnotatedEvidenceUrl(caseData);
  const annotatedEvidenceDataUrl = annotatedEvidenceUrl
    ? await fetchImageAsDataUrl(annotatedEvidenceUrl)
    : null;

  ensureSpace(doc, state, 220);
  const evidenceCardX = PAGE.marginX;
  const evidenceCardW = doc.internal.pageSize.getWidth() - PAGE.marginX * 2;
  const evidenceCardY = state.y;
  const evidenceCardH = 206;

  doc.setFillColor(...THEME.surface);
  doc.setDrawColor(...THEME.border);
  doc.roundedRect(evidenceCardX, evidenceCardY, evidenceCardW, evidenceCardH, 6, 6, "FD");

  doc.setTextColor(...THEME.text);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Annotated Evidence", evidenceCardX + 12, evidenceCardY + 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.8);
  doc.setTextColor(...THEME.muted);
  doc.text("Annotated frame/image used for report review", evidenceCardX + 12, evidenceCardY + 30);

  if (annotatedEvidenceDataUrl) {
    try {
      const fitted = fitImageToBox(
        doc,
        annotatedEvidenceDataUrl,
        evidenceCardX + 12,
        evidenceCardY + 40,
        evidenceCardW - 24,
        150,
      );
      doc.addImage(
        annotatedEvidenceDataUrl,
        "JPEG",
        fitted.x,
        fitted.y,
        fitted.width,
        fitted.height,
        undefined,
        "FAST",
      );
    } catch {
      doc.setTextColor(...THEME.muted);
      doc.text("Annotated evidence could not be rendered.", evidenceCardX + 12, evidenceCardY + 72);
    }
  } else {
    doc.setTextColor(...THEME.muted);
    doc.text("Annotated evidence unavailable for this case.", evidenceCardX + 12, evidenceCardY + 72);
  }

  state.y += evidenceCardH + 12;

  if (reportRecords.length === 0) {
    ensureSpace(doc, state, 24);
    doc.setTextColor(...THEME.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(
      "No violations were detected in this analysis.",
      PAGE.marginX,
      state.y,
    );
    state.y += 16;
  } else {
    for (const record of reportRecords) {
      drawRecordCard(doc, state, record);
    }
  }

  // ─── Section 3: Detection Register (summary table) ────────────
  drawSectionHeader(
    doc,
    state,
    "3. Detection Register",
    "Tabular summary of all detected violations",
  );

  if (reportRecords.length === 0) {
    ensureSpace(doc, state, 24);
    doc.setTextColor(...THEME.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(
      "No detection records available for this case.",
      PAGE.marginX,
      state.y,
    );
    state.y += 16;
  } else {
    autoTable(doc, {
      startY: state.y,
      theme: "grid",
      head: [
        ["#", "Violation Type", "Confidence", "Number Plate", "Vehicle Conf", "Plate Conf", "OCR Conf"],
      ],
      body: reportRecords.map((r) => [
        String(r.index),
        r.violation,
        fmtPercentRound(r.confidence),
        r.number_plate,
        fmtPercentRound(r.vehicle_confidence),
        fmtPercentRound(r.plate_confidence),
        fmtPercentRound(r.ocr_confidence),
      ]),
      styles: {
        font: "helvetica",
        fontSize: 8.6,
        cellPadding: 4,
        textColor: THEME.text,
        lineColor: THEME.border,
        lineWidth: 0.5,
      },
      headStyles: {
        fillColor: THEME.heroBg,
        textColor: [240, 255, 250],
        fontStyle: "bold",
      },
      columnStyles: {
        0: { cellWidth: 22, halign: "center" },
        1: { cellWidth: 130 },
        2: { cellWidth: 60, halign: "center" },
        3: { cellWidth: 100 },
        4: { cellWidth: 60, halign: "center" },
        5: { cellWidth: 60, halign: "center" },
        6: { cellWidth: 60, halign: "center" },
      },
      margin: { left: PAGE.marginX, right: PAGE.marginX },
    });
    state.y = doc.lastAutoTable.finalY + 16;
  }

  // ─── Section 4: Visual Evidence (only for pipeline records with bboxes) ──
  const pipelineRecords = reportRecords
    .filter((r) => r.source === "pipeline" && r._raw)
    .slice(0, 6);

  if (pipelineRecords.length > 0) {
    drawSectionHeader(
      doc,
      state,
      "4. Visual Evidence Board",
      "Annotated frames with detection bounding boxes",
    );

    for (const item of pipelineRecords) {
      ensureSpace(doc, state, 250);

      const cardX = PAGE.marginX;
      const cardW = doc.internal.pageSize.getWidth() - PAGE.marginX * 2;
      const cardY = state.y;
      const cardH = 236;

      doc.setFillColor(...THEME.surface);
      doc.setDrawColor(...THEME.border);
      doc.roundedRect(cardX, cardY, cardW, cardH, 6, 6, "FD");

      doc.setTextColor(...THEME.text);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.8);
      doc.text(
        `Record ${item.index} · ${item.violation}`,
        cardX + 10,
        cardY + 14,
      );

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...THEME.muted);
      doc.text(
        `Plate: ${item.number_plate} · Confidence: ${fmtPercentRound(item.confidence)}`,
        cardX + 10,
        cardY + 27,
      );

      const rawRecord = item._raw;
      const imageUrl = getRecordImageUrl(rawRecord, caseData);
      const baseDataUrl = imageUrl
        ? await fetchImageAsDataUrl(imageUrl)
        : null;
      const boxedDataUrl = await drawRecordBoundingBoxes(
        baseDataUrl,
        rawRecord,
      );

      if (boxedDataUrl) {
        try {
          doc.addImage(
            boxedDataUrl,
            "JPEG",
            cardX + 10,
            cardY + 34,
            356,
            192,
            undefined,
            "FAST",
          );
        } catch {
          doc.setTextColor(...THEME.muted);
          doc.text(
            "Unable to render annotated frame for this record.",
            cardX + 10,
            cardY + 56,
          );
        }
      } else {
        doc.setTextColor(...THEME.muted);
        doc.text("Annotated frame unavailable.", cardX + 10, cardY + 56);
      }

      doc.setTextColor(...THEME.text);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.text("Evidence Notes", cardX + 378, cardY + 48);

      doc.setFont("helvetica", "normal");
      doc.setTextColor(...THEME.muted);
      const notes = [
        `Violation Conf: ${fmtPercent(rawRecord.violation_confidence)}`,
        `Vehicle Conf: ${fmtPercent(rawRecord.vehicle_confidence)}`,
        `Plate Conf: ${fmtPercent(rawRecord.plate_confidence)}`,
        `OCR Conf: ${fmtPercent(rawRecord.ocr_confidence)}`,
      ];
      notes.forEach((line, i) => {
        doc.text(line, cardX + 378, cardY + 66 + i * 14);
      });

      state.y += 248;
    }

    // ─── Section 5: Zoomed Forensic Crops ──────────────────────────
    drawSectionHeader(
      doc,
      state,
      "5. Zoomed Forensic Crops",
      "Vehicle and number-plate close-ups extracted from evidence frames",
    );

    for (const item of pipelineRecords) {
      ensureSpace(doc, state, 170);

      const cardX = PAGE.marginX;
      const cardW = doc.internal.pageSize.getWidth() - PAGE.marginX * 2;
      const cardY = state.y;
      const cardH = 156;

      doc.setFillColor(...THEME.surface);
      doc.setDrawColor(...THEME.border);
      doc.roundedRect(cardX, cardY, cardW, cardH, 6, 6, "FD");

      doc.setTextColor(...THEME.text);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.text(
        `Record ${item.index} · ${item.violation}`,
        cardX + 10,
        cardY + 14,
      );

      const rawRecord = item._raw;
      const imageUrl = getRecordImageUrl(rawRecord, caseData);
      const baseDataUrl = imageUrl
        ? await fetchImageAsDataUrl(imageUrl)
        : null;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...THEME.muted);
      doc.text("Vehicle Crop", cardX + 10, cardY + 30);
      doc.text("Plate Crop", cardX + 202, cardY + 30);

      let vehicleCrop = null;
      if (rawRecord.vehicle_crop_url) {
        const url = rawRecord.vehicle_crop_url_abs || rawRecord.vehicle_crop_url;
        vehicleCrop = await fetchImageAsDataUrl(url);
      } else if (baseDataUrl && rawRecord.vehicle_bbox) {
        vehicleCrop = await cropImageRegion(baseDataUrl, rawRecord.vehicle_bbox);
      }

      let plateCrop = null;
      if (rawRecord.plate_crop_url) {
        const url = rawRecord.plate_crop_url_abs || rawRecord.plate_crop_url;
        plateCrop = await fetchImageAsDataUrl(url);
      } else if (baseDataUrl && rawRecord.plate_bbox) {
        plateCrop = await cropImageRegion(baseDataUrl, rawRecord.plate_bbox);
      }

      if (vehicleCrop) {
        try {
          doc.addImage(vehicleCrop, "JPEG", cardX + 10, cardY + 36, 178, 108, undefined, "FAST");
        } catch {
          doc.text("Vehicle crop unavailable", cardX + 10, cardY + 52);
        }
      } else {
        doc.text("Vehicle crop unavailable", cardX + 10, cardY + 52);
      }

      if (plateCrop) {
        try {
          doc.addImage(plateCrop, "JPEG", cardX + 202, cardY + 36, 120, 88, undefined, "FAST");
        } catch {
          doc.text("Plate crop unavailable", cardX + 202, cardY + 52);
        }
      } else {
        doc.text("Plate crop unavailable", cardX + 202, cardY + 52);
      }

      doc.setTextColor(...THEME.text);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.4);
      doc.text("Plate Read", cardX + 338, cardY + 44);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...THEME.muted);
      const plateTextWrapped = doc.splitTextToSize(item.number_plate, 150);
      doc.text(plateTextWrapped, cardX + 338, cardY + 58);

      state.y += 168;
    }
  }

  // ─── Report Note ─────────────────────────────────────────────────
  const noteSection = pipelineRecords.length > 0 ? "6" : "4";
  drawSectionHeader(
    doc,
    state,
    `${noteSection}. Report Note`,
    "Interpretation guidance",
  );
  ensureSpace(doc, state, 54);
  doc.setFillColor(...THEME.surface);
  doc.roundedRect(
    PAGE.marginX,
    state.y,
    doc.internal.pageSize.getWidth() - PAGE.marginX * 2,
    42,
    6,
    6,
    "F",
  );
  doc.setTextColor(...THEME.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const note =
    "Detection results and OCR outputs are system-assisted findings and should be reviewed by an authorized operator before enforcement action. Confidence values indicate detection certainty, not legal finality.";
  doc.text(
    doc.splitTextToSize(
      note,
      doc.internal.pageSize.getWidth() - PAGE.marginX * 2 - 14,
    ),
    PAGE.marginX + 8,
    state.y + 14,
  );

  drawFooterOnAllPages(doc);

  const safeName = String(caseData.source_name || "report").replace(
    /[^a-z0-9-_]+/gi,
    "_",
  );
  const pdfFileName = `ecoscout_report_${safeName}_${Date.now()}.pdf`;

  // Save locally for the user
  doc.save(pdfFileName);

  // Upload to Supabase Storage for persistent access
  const analysisId = caseData.id || inputCase?.id || inputCase?.analysis_id;
  if (analysisId && !String(analysisId).startsWith('case-')) {
    try {
      const pdfBlob = doc.output('blob');
      const formData = new FormData();
      formData.append('file', pdfBlob, pdfFileName);
      const resp = await fetch(`${API_BASE}/analyses/${analysisId}/report`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (resp.ok) {
        const result = await resp.json();
        return result.report_url || null;
      }
    } catch (err) {
      console.warn('Could not upload report to Supabase:', err);
    }
  }
  return null;
}
