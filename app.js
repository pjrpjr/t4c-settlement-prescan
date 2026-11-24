(function (root) {
  "use strict";

  var CSV = root.ZeroUploadCSV;
  var ENGINE = root.PRESCAN_ENGINE;
  var CONFIG = root.SITE_CONFIG || {};
  var SAMPLES = root.PRESCAN_SAMPLES || {};

  var state = {
    rawCsvText: "",
    sourceLabel: "",
    parsedCsv: null,
    lastResult: null,
    activeFilter: "ALL"
  };

  function escapeHtml(str) {
    return String(str === null || str === undefined ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function initStaticCopy() {
    var siteTitle = CONFIG.SITE_TITLE || "Zero-Upload Diagnostic Pre-Scan";
    var privacyText = CONFIG.PRIVACY_BAR_TEXT ||
      "100% Browser-Local Analysis \u2014 Your CSV file never leaves your browser; zero data uploaded to any server.";
    var gateMultiple = CONFIG.MIN_ROI_MULTIPLE !== undefined ? CONFIG.MIN_ROI_MULTIPLE : 10;
    var fixedFeeCents = CONFIG.FIXED_FEE_CENTS !== undefined ? CONFIG.FIXED_FEE_CENTS : 150000;
    var contactEmail = CONFIG.CONTACT_EMAIL || "intake@example.org";
    var samplesMeta = CONFIG.SAMPLES_META || {};

    document.title = siteTitle;
    var titleEl = byId("site-title");
    if (titleEl) {
      titleEl.textContent = siteTitle;
    }
    var badgeEl = byId("brand-badge");
    if (badgeEl) {
      badgeEl.textContent = CONFIG.BRAND_BADGE || "LOCAL-ONLY SCREENING";
    }
    var privacyEl = byId("privacy-bar-text");
    if (privacyEl) {
      privacyEl.textContent = privacyText;
    }
    var disclaimerEl = byId("legal-disclaimer-text");
    if (disclaimerEl) {
      disclaimerEl.textContent = CONFIG.LEGAL_DISCLAIMER_BANNER || "";
    }
    var printDisclaimerEl = byId("print-footer-disclaimer");
    if (printDisclaimerEl) {
      printDisclaimerEl.textContent = (CONFIG.LEGAL_DISCLAIMER_BANNER || "") +
        " | " + (CONFIG.SENDER_IDENTITY || "");
    }
    var printTitleEl = byId("print-header-title");
    if (printTitleEl) {
      printTitleEl.textContent = siteTitle + " \u2014 1-Page Executive Brief";
    }
    var printPrivacyEl = byId("print-privacy-text");
    if (printPrivacyEl) {
      printPrivacyEl.textContent = privacyText;
    }
    var qualBtn = byId("sample-qualified-btn");
    if (qualBtn) {
      qualBtn.textContent = (samplesMeta.qualified && samplesMeta.qualified.label) ||
        ("Load Qualified Sample (>= " + gateMultiple + "x Threshold)");
    }
    var belowBtn = byId("sample-below-btn");
    if (belowBtn) {
      belowBtn.textContent = (samplesMeta.below_threshold && samplesMeta.below_threshold.label) ||
        ("Load Below-Threshold Sample (< " + gateMultiple + "x Threshold)");
    }
    var kpiRoiLabel = byId("kpi-roi-label");
    if (kpiRoiLabel) {
      kpiRoiLabel.textContent = "ROI Multiple vs " + gateMultiple + "x Gate";
    }
    var kpiRoiSub = byId("kpi-roi-sub");
    if (kpiRoiSub) {
      kpiRoiSub.textContent = "Gate: " + gateMultiple + "x Threshold";
    }
    var kpiFeeSub = byId("kpi-fee-sub");
    if (kpiFeeSub) {
      kpiFeeSub.textContent = "Fixed Non-Contingent Fee: " + CSV.formatCents(fixedFeeCents);
    }
    var mailtoEl = byId("mailto-link");
    if (mailtoEl) {
      mailtoEl.setAttribute("href", "mailto:" + encodeURIComponent(contactEmail));
    }
  }

  function initModes() {
    var selectEl = byId("mode-select");
    var descEl = byId("mode-description");
    if (!selectEl) {
      return;
    }
    var modes = Array.isArray(CONFIG.MODES) ? CONFIG.MODES : [];
    selectEl.innerHTML = "";
    for (var i = 0; i < modes.length; i++) {
      var opt = document.createElement("option");
      opt.value = modes[i].id;
      opt.textContent = modes[i].label;
      selectEl.appendChild(opt);
    }
    function syncModeInfo() {
      var chosen = selectEl.value;
      for (var m = 0; m < modes.length; m++) {
        if (modes[m].id === chosen) {
          if (descEl) {
            descEl.textContent = modes[m].description || "";
          }
          var matInput = byId("param-materiality");
          if (matInput && modes[m].materiality_cents !== undefined) {
            matInput.value = String((modes[m].materiality_cents / 100).toFixed(0));
          }
          break;
        }
      }
    }
    selectEl.addEventListener("change", function () {
      syncModeInfo();
      if (state.parsedCsv) {
        runEvaluation();
      }
    });
    syncModeInfo();
  }

  function showPiiAlert(findings) {
    var alertEl = byId("pii-alert");
    var listEl = byId("pii-findings-list");
    if (!alertEl || !listEl) {
      return;
    }
    listEl.innerHTML = findings.map(function (f) {
      return "<li>" + escapeHtml(f.detail || (f.type + " at row " + f.row)) + "</li>";
    }).join("");
    alertEl.hidden = false;
  }

  function hidePiiAlert() {
    var alertEl = byId("pii-alert");
    var listEl = byId("pii-findings-list");
    if (alertEl) {
      alertEl.hidden = true;
    }
    if (listEl) {
      listEl.innerHTML = "";
    }
  }

  function getExtraBannedHeaders() {
    var input = byId("param-extra-pii");
    if (!input || !input.value) {
      return [];
    }
    return input.value.split(",").map(function (s) {
      return s.trim();
    }).filter(Boolean);
  }

  function readParams() {
    var modeEl = byId("mode-select");
    var matEl = byId("param-materiality");
    var upliftEl = byId("param-uplift-pct");

    var matDollars = matEl ? parseFloat(matEl.value) : 0;
    if (!isFinite(matDollars) || matDollars < 0) {
      matDollars = 0;
    }
    var upliftPct = upliftEl ? parseFloat(upliftEl.value) : 100;
    if (!isFinite(upliftPct)) {
      upliftPct = 100;
    }

    return {
      mode: modeEl ? modeEl.value : "standard_review",
      materiality_cents: Math.round(matDollars * 100),
      uplift_pct: Math.max(0, Math.min(100, Math.round(upliftPct))),
      extra_banned_headers: getExtraBannedHeaders()
    };
  }

  function ingestCsvText(text, sourceLabel) {
    state.rawCsvText = text;
    state.sourceLabel = sourceLabel || "local.csv";

    var parsed = CSV.parseCSV(text);
    var pii = CSV.scanForPii(parsed.headers, parsed.rows, getExtraBannedHeaders());
    if (pii.blocked) {
      state.parsedCsv = null;
      state.lastResult = null;
      showPiiAlert(pii.findings);
      var sec3 = byId("step-3");
      if (sec3) {
        sec3.hidden = true;
      }
      setFileStatus("Blocked by local PII/secret shield: " + state.sourceLabel, true);
      return;
    }

    hidePiiAlert();
    state.parsedCsv = parsed;
    setFileStatus("Loaded locally: " + state.sourceLabel + " (" + parsed.rows.length + " rows)", false);
    runEvaluation();
  }

  function setFileStatus(msg, isError) {
    var statusEl = byId("file-status");
    if (!statusEl) {
      return;
    }
    statusEl.textContent = msg;
    statusEl.className = isError ? "file-status is-error" : "file-status is-ok";
  }

  function runEvaluation() {
    if (!state.parsedCsv) {
      return;
    }
    var params = readParams();
    var result = ENGINE.evaluate(state.parsedCsv, params, CONFIG);
    if (result.blocked_by_pii) {
      state.lastResult = null;
      var step3 = byId("step-3");
      if (step3) {
        step3.hidden = true;
      }
      setFileStatus("Blocked by local PII/secret shield: " + state.sourceLabel, true);
      showPiiAlert(result.pii.findings || []);
      return;
    }
    state.lastResult = result;
    state.activeFilter = "ALL";
    renderResult(result);
  }

  function renderResult(result) {
    var step3 = byId("step-3");
    if (step3) {
      step3.hidden = false;
    }

    var verdictBadge = byId("verdict-badge");
    if (verdictBadge) {
      var isQualified = result.verdict === "QUALIFIED";
      verdictBadge.textContent = isQualified
        ? "QUALIFIED (>= " + result.min_roi_multiple + "x Threshold)"
        : "BELOW THRESHOLD (< " + result.min_roi_multiple + "x Threshold)";
      verdictBadge.className = "verdict-badge " + (isQualified ? "badge-qualified" : "badge-below");
    }

    var fpEl = byId("result-fingerprint");
    if (fpEl) {
      fpEl.textContent = result.input_fingerprint;
    }
    var srcEl = byId("result-source");
    if (srcEl) {
      srcEl.textContent = state.sourceLabel + " (" + result.mode_label + ")";
    }

    var kpiUplift = byId("kpi-uplift");
    if (kpiUplift) {
      kpiUplift.textContent = CSV.formatCents(result.potential_uplift_cents);
    }
    var kpiBaselineSub = byId("kpi-baseline-sub");
    if (kpiBaselineSub) {
      kpiBaselineSub.textContent = "Baseline screened: " + CSV.formatCents(result.baseline_total_cents);
    }

    var kpiNet = byId("kpi-net");
    if (kpiNet) {
      kpiNet.textContent = CSV.formatCents(result.net_after_fee_cents);
    }
    var kpiFeeSub = byId("kpi-fee-sub");
    if (kpiFeeSub) {
      kpiFeeSub.textContent = "Fixed Non-Contingent Fee: " + CSV.formatCents(result.fixed_fee_cents);
    }

    var kpiRoiLabel = byId("kpi-roi-label");
    if (kpiRoiLabel) {
      kpiRoiLabel.textContent = "ROI Multiple vs " + result.min_roi_multiple + "x Gate";
    }
    var kpiRoi = byId("kpi-roi");
    if (kpiRoi) {
      kpiRoi.textContent = result.roi_multiple + "x";
    }
    var kpiRoiSub = byId("kpi-roi-sub");
    if (kpiRoiSub) {
      kpiRoiSub.textContent = "Gate: " + result.min_roi_multiple + "x Threshold (" + result.verdict + ")";
    }

    var kpiElapsed = byId("kpi-elapsed");
    if (kpiElapsed) {
      kpiElapsed.textContent = result.elapsed_ms + " ms";
    }
    var kpiRowsSub = byId("kpi-rows-sub");
    if (kpiRowsSub) {
      kpiRowsSub.textContent = result.row_count + " rows classified locally";
    }

    renderFilterTabs(result);
    renderTraceTable(result);
    renderMailto(result);
  }

  function renderFilterTabs(result) {
    var tabsEl = byId("filter-tabs");
    if (!tabsEl) {
      return;
    }
    var counts = result.counts || {};
    var specs = [
      { key: "ALL", label: "All (" + result.row_count + ")" },
      { key: "ADJUSTMENT_FLAGGED", label: "Adjustment Flagged (" + (counts.ADJUSTMENT_FLAGGED || 0) + ")" },
      { key: "REVIEW_NEEDED", label: "Review Needed (" + (counts.REVIEW_NEEDED || 0) + ")" },
      { key: "QUALIFIED_BASELINE", label: "Qualified Baseline (" + (counts.QUALIFIED_BASELINE || 0) + ")" },
      { key: "EXCLUDED_OFFSET", label: "Excluded Offset (" + (counts.EXCLUDED_OFFSET || 0) + ")" }
    ];

    tabsEl.innerHTML = specs.map(function (sp) {
      var cls = "filter-tab" + (state.activeFilter === sp.key ? " is-active" : "");
      return "<button type=\"button\" class=\"" + cls + "\" data-filter=\"" + escapeHtml(sp.key) + "\">" + escapeHtml(sp.label) + "</button>";
    }).join("");

    var btns = tabsEl.querySelectorAll("button[data-filter]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function (ev) {
        state.activeFilter = ev.currentTarget.getAttribute("data-filter") || "ALL";
        renderFilterTabs(state.lastResult);
        renderTraceTable(state.lastResult);
      });
    }
  }

  function renderTraceTable(result) {
    var tbody = byId("trace-tbody");
    if (!tbody) {
      return;
    }
    var lines = Array.isArray(result.lines) ? result.lines : [];
    var filtered = state.activeFilter === "ALL"
      ? lines
      : lines.filter(function (ln) { return ln.status === state.activeFilter; });

    if (filtered.length === 0) {
      tbody.innerHTML = "<tr><td colspan=\"8\" class=\"empty-cell\">No lines match the selected filter.</td></tr>";
      return;
    }

    tbody.innerHTML = filtered.map(function (ln) {
      return (
        "<tr>" +
        "<td>" + escapeHtml(ln.source_row) + "</td>" +
        "<td><code>" + escapeHtml(ln.record_id) + "</code></td>" +
        "<td>" + escapeHtml(ln.category) + "</td>" +
        "<td>" + escapeHtml(ln.description) + "</td>" +
        "<td class=\"num\">" + escapeHtml(CSV.formatCents(ln.amount_cents)) + "</td>" +
        "<td><span class=\"status-pill status-" + escapeHtml(ln.status) + "\">" + escapeHtml(ln.status) + "</span></td>" +
        "<td><code>" + escapeHtml(ln.rule_id) + "</code></td>" +
        "<td>" + escapeHtml(ln.rationale) + "</td>" +
        "</tr>"
      );
    }).join("");
  }

  function buildMailtoPayload(result) {
    var email = CONFIG.CONTACT_EMAIL || "intake@example.org";
    var subject = "[Zero-Upload Pre-Scan] " + result.verdict + " | Fingerprint " + result.input_fingerprint;
    var bodyLines = [
      "Hello Screening Desk,",
      "",
      "I ran the browser-local pre-scan (zero CSV data uploaded). Summary below:",
      "- Mode: " + (result.mode_label || result.mode),
      "- Verdict: " + result.verdict + " (" + result.roi_multiple + "x vs " + result.min_roi_multiple + "x threshold)",
      "- Input Fingerprint: " + result.input_fingerprint,
      "- Rows Screened: " + result.row_count,
      "- Potential Uplift: " + CSV.formatCents(result.potential_uplift_cents),
      "- Fixed Non-Contingent Fee: " + CSV.formatCents(result.fixed_fee_cents),
      "- Net After Fee: " + CSV.formatCents(result.net_after_fee_cents),
      "",
      "Note: Raw CSV data remains strictly on my local machine."
    ];
    var body = bodyLines.join("\n");
    var href = "mailto:" + encodeURIComponent(email) +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body);
    return { email: email, subject: subject, body: body, href: href };
  }

  function renderMailto(result) {
    var payload = buildMailtoPayload(result);
    var linkEl = byId("mailto-link");
    if (linkEl) {
      linkEl.setAttribute("href", payload.href);
    }
    var previewEl = byId("mailto-preview");
    if (previewEl) {
      previewEl.textContent = "To: " + payload.email + "\nSubject: " + payload.subject + "\n\n" + payload.body;
    }
  }

  function triggerLocalDownload(filename, content, mimeType) {
    var blob = new Blob([content], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function handleLocalFile(file) {
    if (!file) {
      return;
    }
    var reader = new FileReader();
    reader.onload = function (ev) {
      var text = ev && ev.target ? ev.target.result : "";
      ingestCsvText(String(text || ""), file.name);
    };
    reader.onerror = function () {
      setFileStatus("Unable to read local file.", true);
    };
    reader.readAsText(file);
  }

  function bindEvents() {
    var qualBtn = byId("sample-qualified-btn");
    if (qualBtn) {
      qualBtn.addEventListener("click", function () {
        var sample = SAMPLES.qualified;
        if (sample) {
          var modeSelect = byId("mode-select");
          if (modeSelect && sample.mode) {
            modeSelect.value = sample.mode;
          }
          ingestCsvText(sample.csv, sample.filename || "sample_qualified_ledger.csv");
        }
      });
    }

    var belowBtn = byId("sample-below-btn");
    if (belowBtn) {
      belowBtn.addEventListener("click", function () {
        var sample = SAMPLES.below_threshold;
        if (sample) {
          var modeSelect = byId("mode-select");
          if (modeSelect && sample.mode) {
            modeSelect.value = sample.mode;
          }
          ingestCsvText(sample.csv, sample.filename || "sample_below_threshold_ledger.csv");
        }
      });
    }

    var fileInput = byId("csv-file-input");
    if (fileInput) {
      fileInput.addEventListener("change", function (ev) {
        var files = ev.target && ev.target.files;
        if (files && files.length > 0) {
          handleLocalFile(files[0]);
        }
      });
    }

    var dropzone = byId("dropzone");
    if (dropzone) {
      dropzone.addEventListener("dragover", function (ev) {
        ev.preventDefault();
        dropzone.classList.add("is-dragover");
      });
      dropzone.addEventListener("dragleave", function () {
        dropzone.classList.remove("is-dragover");
      });
      dropzone.addEventListener("drop", function (ev) {
        ev.preventDefault();
        dropzone.classList.remove("is-dragover");
        var dt = ev.dataTransfer;
        if (dt && dt.files && dt.files.length > 0) {
          handleLocalFile(dt.files[0]);
        }
      });
    }

    var runBtn = byId("run-scan-btn");
    if (runBtn) {
      runBtn.addEventListener("click", function () {
        if (state.rawCsvText) {
          ingestCsvText(state.rawCsvText, state.sourceLabel);
        } else {
          setFileStatus("Select a local CSV file or click a 1-click embedded sample first.", true);
        }
      });
    }

    var dlCsvBtn = byId("download-csv-btn");
    if (dlCsvBtn) {
      dlCsvBtn.addEventListener("click", function () {
        if (!state.lastResult) {
          return;
        }
        var csv = ENGINE.generateTraceabilityCsv(state.lastResult);
        triggerLocalDownload(
          "traceability_" + state.lastResult.input_fingerprint + ".csv",
          csv,
          "text/csv;charset=utf-8"
        );
      });
    }

    var dlBriefBtn = byId("download-brief-btn");
    if (dlBriefBtn) {
      dlBriefBtn.addEventListener("click", function () {
        if (!state.lastResult) {
          return;
        }
        var html = ENGINE.generatePrintableBriefHtml(state.lastResult, CONFIG);
        triggerLocalDownload(
          "executive_brief_" + state.lastResult.input_fingerprint + ".html",
          html,
          "text/html;charset=utf-8"
        );
      });
    }

    var printBtn = byId("print-brief-btn");
    if (printBtn) {
      printBtn.addEventListener("click", function () {
        if (typeof root.print === "function") {
          root.print();
        }
      });
    }

    function selectMailtoPreview() {
      var previewEl = byId("mailto-preview");
      if (previewEl && root.getSelection) {
        var range = document.createRange();
        range.selectNodeContents(previewEl);
        var sel = root.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }

    var copyBtn = byId("copy-mailto-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        if (!state.lastResult) {
          return;
        }
        var payload = buildMailtoPayload(state.lastResult);
        var textToCopy = "To: " + payload.email + "\nSubject: " + payload.subject + "\n\n" + payload.body;
        if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          navigator.clipboard.writeText(textToCopy).then(function () {
            copyBtn.textContent = "Copied Summary";
            setTimeout(function () {
              copyBtn.textContent = "Copy Summary & Email";
            }, 1800);
          }).catch(function () {
            selectMailtoPreview();
          });
        } else {
          selectMailtoPreview();
        }
      });
    }
  }

  function boot() {
    initStaticCopy();
    initModes();
    bindEvents();
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  }
}(typeof globalThis !== "undefined" ? globalThis : this));
