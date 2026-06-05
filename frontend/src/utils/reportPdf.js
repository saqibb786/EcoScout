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

function fmtDate(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

function fmtPlate(record) {
  return record?.plate_text_raw || record?.plate_text || "Not detected";
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
  };
}

function getRecordImageUrl(record, caseData) {
  return asSourceUrl(
    record?.frame_image_url || caseData?.annotated_image_url || null,
  );
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

function drawHero(doc, caseData, stats) {
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

  const metricY = 112;
  const startX = PAGE.marginX;
  const cardW = 120;
  const cardH = 28;
  const gap = 8;

  const cards = [
    [`Violations`, String(caseData.violations_found)],
    [`High Confidence`, String(stats.highConfidence)],
    [`Plates Read`, String(stats.plateDetected)],
    [`OCR Success`, String(stats.ocrSuccess)],
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

function drawExecutiveSummary(doc, state, caseData) {
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
  const summaryText = `${caseData.violations_found} potential violation(s) were detected in ${caseData.source_type} evidence. This report presents confidence metrics, OCR-read plate outputs, annotated full-frame evidence, and zoomed forensic crops for rapid review.`;
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

export async function exportCaseReportPdf(inputCase) {
  const caseData = normalizeCase(inputCase);
  const records = caseData.records;

  const stats = {
    highConfidence: records.filter((r) => (r.violation_confidence || 0) >= 0.8)
      .length,
    vehicleMatched: records.filter((r) => Boolean(r.vehicle_bbox)).length,
    plateDetected: records.filter((r) => Boolean(r.plate_bbox)).length,
    ocrSuccess: records.filter((r) => Boolean(r.plate_text_raw)).length,
    avgViolationConfidence: records.length
      ? records.reduce((acc, r) => acc + (r.violation_confidence || 0), 0) /
        records.length
      : 0,
    avgVehicleConfidence: records.filter((r) => r.vehicle_confidence).length
      ? records
          .filter((r) => r.vehicle_confidence)
          .reduce((acc, r) => acc + (r.vehicle_confidence || 0), 0) /
        records.filter((r) => r.vehicle_confidence).length
      : 0,
    avgPlateConfidence: records.filter((r) => r.plate_confidence).length
      ? records
          .filter((r) => r.plate_confidence)
          .reduce((acc, r) => acc + (r.plate_confidence || 0), 0) /
        records.filter((r) => r.plate_confidence).length
      : 0,
  };

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const state = { y: 164 };

  drawHero(doc, caseData, stats);
  drawExecutiveSummary(doc, state, caseData);

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
      ["Detected Violations", String(caseData.violations_found)],
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

  drawSectionHeader(
    doc,
    state,
    "2. Detection Performance",
    "Non-redundant confidence and association metrics",
  );
  autoTable(doc, {
    startY: state.y,
    theme: "grid",
    head: [["Metric", "Value"]],
    body: [
      ["High-Confidence Violations (>=80%)", String(stats.highConfidence)],
      ["Vehicle Association Success", String(stats.vehicleMatched)],
      ["Plate Detection Success", String(stats.plateDetected)],
      ["OCR Read Success", String(stats.ocrSuccess)],
      [
        "Average Violation Confidence",
        fmtPercent(stats.avgViolationConfidence),
      ],
      ["Average Vehicle Confidence", fmtPercent(stats.avgVehicleConfidence)],
      ["Average Plate Confidence", fmtPercent(stats.avgPlateConfidence)],
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
      0: { cellWidth: 260, fontStyle: "bold", fillColor: THEME.chipSurface },
      1: { cellWidth: 240 },
    },
    margin: { left: PAGE.marginX, right: PAGE.marginX },
  });
  state.y = doc.lastAutoTable.finalY + 16;

  drawSectionHeader(
    doc,
    state,
    "3. Detection Register",
    "Record-level outcomes for violation, plate read, and strategy",
  );

  if (records.length === 0) {
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
        ["#", "Violation", "V-Conf", "Plate Read", "OCR", "Strategy", "Time"],
      ],
      body: records.map((r, index) => [
        String(index + 1),
        r.violation || "-",
        fmtPercent(r.violation_confidence),
        fmtPlate(r),
        fmtPercent(r.ocr_confidence),
        r.match_strategy || "-",
        typeof r.video_time_sec === 'number'
          ? `${r.video_time_sec.toFixed(2)}s`
          : "Image",
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
        0: { cellWidth: 18, halign: "center" },
        1: { cellWidth: 78 },
        2: { cellWidth: 56, halign: "right" },
        3: { cellWidth: 115 },
        4: { cellWidth: 48, halign: "right" },
        5: { cellWidth: 120 },
        6: { cellWidth: 64, halign: "right" },
      },
      margin: { left: PAGE.marginX, right: PAGE.marginX },
    });
    state.y = doc.lastAutoTable.finalY + 16;
  }

  drawSectionHeader(
    doc,
    state,
    "4. Visual Evidence Board",
    "Complete frame with annotation overlays and labelled bounding boxes",
  );

  const evidenceRecords = records
    .map((record, idx) => ({
      idx,
      record,
      imageUrl: getRecordImageUrl(record, caseData),
    }))
    .slice(0, 6);

  if (evidenceRecords.length === 0) {
    ensureSpace(doc, state, 24);
    doc.setTextColor(...THEME.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(
      "No evidence frames available to render for this case.",
      PAGE.marginX,
      state.y,
    );
    state.y += 16;
  } else {
    for (const item of evidenceRecords) {
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
        `Record ${item.idx + 1} · ${item.record.violation || "-"}`,
        cardX + 10,
        cardY + 14,
      );

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...THEME.muted);
      doc.text(
        `Plate: ${fmtPlate(item.record)} · OCR ${fmtPercent(item.record.ocr_confidence)}`,
        cardX + 10,
        cardY + 27,
      );

      const baseDataUrl = item.imageUrl
        ? await fetchImageAsDataUrl(item.imageUrl)
        : null;
      const boxedDataUrl = await drawRecordBoundingBoxes(
        baseDataUrl,
        item.record,
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
        `Violation Conf: ${fmtPercent(item.record.violation_confidence)}`,
        `Vehicle Conf: ${fmtPercent(item.record.vehicle_confidence)}`,
        `Plate Conf: ${fmtPercent(item.record.plate_confidence)}`,
        `Strategy: ${item.record.match_strategy || "-"}`,
        `Time: ${typeof item.record.video_time_sec === 'number' ? `${item.record.video_time_sec.toFixed(2)}s` : "Image"}`,
      ];
      notes.forEach((line, i) => {
        doc.text(line, cardX + 378, cardY + 66 + i * 14);
      });

      state.y += 248;
    }
  }

  drawSectionHeader(
    doc,
    state,
    "5. Zoomed Forensic Crops",
    "Vehicle and number-plate close-ups extracted from evidence frames",
  );

  const cropRecords = records
    .map((record, idx) => ({
      idx,
      record,
      imageUrl: getRecordImageUrl(record, caseData),
    }))
    .slice(0, 6);

  if (cropRecords.length === 0) {
    ensureSpace(doc, state, 24);
    doc.setTextColor(...THEME.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(
      "No crop-ready records available for this case.",
      PAGE.marginX,
      state.y,
    );
    state.y += 16;
  } else {
    for (const item of cropRecords) {
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
        `Record ${item.idx + 1} · ${item.record.violation || "-"}`,
        cardX + 10,
        cardY + 14,
      );

      // Prefer backend-provided crop images when available; otherwise crop client-side.
      const baseDataUrl = item.imageUrl
        ? await fetchImageAsDataUrl(item.imageUrl)
        : null;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...THEME.muted);
      doc.text("Vehicle Crop", cardX + 10, cardY + 30);
      doc.text("Plate Crop", cardX + 202, cardY + 30);

      let vehicleCrop = null;
      if (item.record.vehicle_crop_url) {
        const url = asSourceUrl(item.record.vehicle_crop_url);
        vehicleCrop = await fetchImageAsDataUrl(url);
      } else if (baseDataUrl && item.record.vehicle_bbox) {
        vehicleCrop = await cropImageRegion(
          baseDataUrl,
          item.record.vehicle_bbox,
        );
      }

      let plateCrop = null;
      if (item.record.plate_crop_url) {
        const url = asSourceUrl(item.record.plate_crop_url);
        plateCrop = await fetchImageAsDataUrl(url);
      } else if (baseDataUrl && item.record.plate_bbox) {
        plateCrop = await cropImageRegion(baseDataUrl, item.record.plate_bbox);
      }

      if (vehicleCrop) {
        try {
          doc.addImage(
            vehicleCrop,
            "JPEG",
            cardX + 10,
            cardY + 36,
            178,
            108,
            undefined,
            "FAST",
          );
        } catch {
          doc.text("Vehicle crop unavailable", cardX + 10, cardY + 52);
        }
      } else {
        doc.text("Vehicle crop unavailable", cardX + 10, cardY + 52);
      }

      if (plateCrop) {
        try {
          doc.addImage(
            plateCrop,
            "JPEG",
            cardX + 202,
            cardY + 36,
            120,
            88,
            undefined,
            "FAST",
          );
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
      const plateTextWrapped = doc.splitTextToSize(fmtPlate(item.record), 150);
      doc.text(plateTextWrapped, cardX + 338, cardY + 58);

      state.y += 168;
    }
  }

  drawSectionHeader(
    doc,
    state,
    "6. Report Note",
    "Methodological note and interpretation guidance",
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
    "Detections and OCR outputs are model-assisted findings and should be reviewed by an authorized operator before enforcement action. Confidence values indicate model certainty, not legal finality.";
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
