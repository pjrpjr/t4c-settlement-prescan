(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./csv_parser.js"));
  } else {
    root.PRESCAN_ENGINE = factory(root.ZeroUploadCSV);
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function (CSV) {
  "use strict";

  var DEFAULT_FIXED_FEE_CENTS = 149500;
  var DEFAULT_MIN_ROI_MULTIPLE = 10;

  var SF_BUCKETS = [
    "DIRECT_LABOR",
    "DIRECT_MATERIAL",
    "SUBCONTRACTOR_SETTLEMENT",
    "UNAMORTIZED_INITIAL",
    "SETTLEMENT_PREP_31_205_42G"
  ];

  var UNALLOWABLE_TYPES = [
    "entertainment",
    "alcohol",
    "lobbying",
    "fines",
    "interest",
    "contingent_fee",
    "unmitigated_idle_capacity"
  ];

  var DEFAULT_ALIASES = {
    record_id: ["record_id", "line_id", "id", "entry_id", "ref", "reference", "cost_id", "clin"],
    track: ["track", "far_clause", "clause", "termination_track", "contract_type"],
    category: ["category", "cost_bucket", "bucket", "sf_bucket", "cost_element", "type", "class", "account"],
    description: ["description", "memo", "details", "item", "narrative", "notes", "cost_description"],
    amount: ["amount", "amount_usd", "claimed_amount", "cost_usd", "value", "total", "net_amount", "gross_amount"],
    status: ["status", "allowability", "documentation_status", "doc_status", "flag", "disposition", "review_status"],
    termination_date: ["termination_date", "t4c_date", "notice_date", "date", "effective_date"],
    termination_scope: ["termination_scope", "scope", "termination_type", "partial_or_full"],
    contract_price: ["contract_price", "total_contract_price", "award_amount", "ceiling_price"],
    pct_performed: ["pct_performed", "percent_performed", "work_performed_pct", "completion_pct"],
    as_of_date: ["as_of_date", "eval_date", "scan_date"]
  };

  var EXTRA_SECURITY_BANNED_HEADERS = [
    "dod",
    "dfars",
    "cui",
    "fouo",
    "itar",
    "dd254",
    "secret"
  ];

  var SECURITY_SHIELD_PATTERNS = [
    { tag: "dod", re: /\b(?:DOD|DEPARTMENT\s+OF\s+DEFENSE)\b/i },
    { tag: "dfars", re: /\bDFARS\b/i },
    { tag: "cui", re: /\bCUI\b/i },
    { tag: "fouo", re: /\bFOUO\b/i },
    { tag: "itar", re: /\bITAR\b/i },
    { tag: "dd254", re: /\bDD[\s\-]?254\b/i },
    { tag: "secret", re: /\bSECRET\b/i },
    { tag: "ssn_token", re: /\bSSN\b/i },
    { tag: "password_token", re: /\b(?:PASSWORD|PASSWD)\b/i }
  ];

  var FAR_CASE_2026_007_NOTICE =
    "Current rule: 1-year full-termination settlement proposal deadline under " +
    "FAR 49.104 / 52.249-2(e) (proposed FAR Case 2026-007 90-day window is NOT " +
    "yet final); 90-day partial-termination equitable adjustment deadline applies " +
    "under FAR 52.249-2(l).";

  function nowMs() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }

  function escapeHtml(str) {
    return String(str === null || str === undefined ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeCsvField(val) {
    var s = String(val === null || val === undefined ? "" : val);
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function containsAny(text, keywords) {
    if (!text) {
      return false;
    }
    var lower = String(text).toLowerCase();
    for (var i = 0; i < keywords.length; i++) {
      if (lower.indexOf(keywords[i]) !== -1) {
        return true;
      }
    }
    return false;
  }

  function getCell(row, colName) {
    if (!row || !colName || row[colName] === undefined || row[colName] === null) {
      return "";
    }
    return String(row[colName]).trim();
  }

  function parsePctBps(raw) {
    if (raw === null || raw === undefined || typeof raw === "boolean") {
      return null;
    }
    var s = String(raw).trim();
    if (!s) {
      return null;
    }
    var hasPct = s.indexOf("%") !== -1;
    var clean = s.replace(/%/g, "").replace(/,/g, "").trim();
    var m = /^(\d+)(?:\.(\d*))?$|^\.(\d+)$/.exec(clean);
    if (!m) {
      return null;
    }
    var wholeStr = m[1] || "0";
    var fracStr = m[2] !== undefined ? m[2] : (m[3] || "");
    var padded = (fracStr + "000000").slice(0, 6);
    var valMillionths = parseInt(wholeStr, 10) * 1000000 + parseInt(padded, 10);
    var bps;
    if (!hasPct && valMillionths > 0 && valMillionths < 1000000) {
      bps = Math.floor((valMillionths + 50) / 100);
    } else {
      bps = Math.floor((valMillionths + 5000) / 10000);
    }
    if (bps < 0) {
      return 0;
    }
    if (bps > 10000) {
      return 10000;
    }
    return bps;
  }

  function scanSecurityAndPii(headers, rows, extraBannedHeaders) {
    var mergedBanned = EXTRA_SECURITY_BANNED_HEADERS.slice();
    if (Array.isArray(extraBannedHeaders)) {
      for (var i = 0; i < extraBannedHeaders.length; i++) {
        mergedBanned.push(extraBannedHeaders[i]);
      }
    }
    var baseScan = CSV.scanForPii(headers, rows, mergedBanned);
    var findings = Array.isArray(baseScan.findings) ? baseScan.findings.slice() : [];
    var maxFindings = 50;

    var headerList = Array.isArray(headers) ? headers : [];
    for (var h = 0; h < headerList.length && findings.length < maxFindings; h++) {
      var hdr = String(headerList[h] || "");
      for (var p = 0; p < SECURITY_SHIELD_PATTERNS.length; p++) {
        if (SECURITY_SHIELD_PATTERNS[p].re.test(hdr)) {
          var alreadyBanned = findings.some(function (f) {
            return f.row === 1 && f.header === hdr;
          });
          if (!alreadyBanned) {
            findings.push({
              type: "restricted_" + SECURITY_SHIELD_PATTERNS[p].tag,
              header: hdr,
              row: 1,
              detail: "Restricted defense/security or credential header token (" +
                SECURITY_SHIELD_PATTERNS[p].tag.toUpperCase() + ") detected in '" + hdr + "'."
            });
          }
          break;
        }
      }
    }

    var rowList = Array.isArray(rows) ? rows : [];
    for (var r = 0; r < rowList.length && findings.length < maxFindings; r++) {
      var row = rowList[r];
      var sourceRow = row && row.__sourceRow ? row.__sourceRow : (r + 2);
      for (var c = 0; c < headerList.length && findings.length < maxFindings; c++) {
        var col = headerList[c];
        var val = row && row[col] !== undefined && row[col] !== null ? String(row[col]) : "";
        if (!val) {
          continue;
        }
        for (var k = 0; k < SECURITY_SHIELD_PATTERNS.length; k++) {
          if (SECURITY_SHIELD_PATTERNS[k].re.test(val)) {
            findings.push({
              type: "restricted_" + SECURITY_SHIELD_PATTERNS[k].tag,
              header: col,
              row: sourceRow,
              detail: "Blocked security/defense token (" +
                SECURITY_SHIELD_PATTERNS[k].tag.toUpperCase() +
                ") detected in column '" + col + "' at CSV row " + sourceRow + "."
            });
            break;
          }
        }
      }
    }

    return {
      blocked: findings.length > 0,
      findings: findings
    };
  }

  function detectUnallowableFar31(text) {
    var lower = String(text || "").toLowerCase();
    if (/\b(?:entertainment|golf|tickets|sporting\s+event|social\s+club|hospitality)\b/.test(lower) || lower.indexOf("31.205-14") !== -1) {
      return {
        type: "entertainment",
        ruleId: "R-FAR31-ENT",
        rationale: "Unallowable entertainment expense under FAR 31.205-14; excluded prior to settlement proposal."
      };
    }
    if (/\b(?:alcohol|alcoholic|liquor|wine|beer|bar\s+tab|spirits)\b/.test(lower) || lower.indexOf("31.205-51") !== -1) {
      return {
        type: "alcohol",
        ruleId: "R-FAR31-ALC",
        rationale: "Unallowable alcoholic beverages cost under FAR 31.205-51; excluded from settlement."
      };
    }
    if (/\b(?:lobbying|political\s+contribution|legislative\s+liaison|pac\s+expense)\b/.test(lower) || lower.indexOf("31.205-22") !== -1) {
      return {
        type: "lobbying",
        ruleId: "R-FAR31-LOB",
        rationale: "Unallowable lobbying or political activity cost under FAR 31.205-22; excluded."
      };
    }
    if (/\b(?:fine|fines|penalty|penalties|civil\s+violation)\b/.test(lower) || lower.indexOf("31.205-15") !== -1) {
      return {
        type: "fines",
        ruleId: "R-FAR31-FIN",
        rationale: "Unallowable fines or penalties under FAR 31.205-15; excluded from claim."
      };
    }
    if (
      (/\binterest\b/.test(lower) && !/\b(?:public\s+interest|best\s+interest|interest\s+of)\b/.test(lower)) ||
      /\bfinancing\s+cost\b/.test(lower) ||
      lower.indexOf("31.205-20") !== -1
    ) {
      return {
        type: "interest",
        ruleId: "R-FAR31-INT",
        rationale: "Unallowable interest and financing cost under FAR 31.205-20; excluded."
      };
    }
    if (/\b(?:contingent[\s_]+fee|contingency[\s_]+fee|success[\s_]+fee)\b/.test(lower) || lower.indexOf("52.203-5") !== -1) {
      return {
        type: "contingent_fee",
        ruleId: "R-FAR31-CNT",
        rationale: "Unallowable arrangement under FAR 52.203-5 / FAR 31.205-33 (prohibits contingent fee reimbursement; non-contingent costs only)."
      };
    }
    if (/\b(?:unmitigated[\s_]+idle[\s_]+capacity|idle[\s_]+capacity|idle[\s_]+facilities)\b/.test(lower) || lower.indexOf("31.205-17") !== -1) {
      return {
        type: "unmitigated_idle_capacity",
        ruleId: "R-FAR31-IDL",
        rationale: "Unallowable unmitigated idle capacity or idle facilities cost under FAR 31.205-17; excluded without documented mitigation."
      };
    }
    return null;
  }

  function parseIsoDateUtc(raw) {
    var s = String(raw || "").trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) {
      return null;
    }
    var y = parseInt(m[1], 10);
    var mo = parseInt(m[2], 10);
    var d = parseInt(m[3], 10);
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== (mo - 1) || dt.getUTCDate() !== d) {
      return null;
    }
    return { y: y, m: mo, d: d, ms: dt.getTime() };
  }

  function formatUtcDate(ms) {
    var dt = new Date(ms);
    var y = dt.getUTCFullYear();
    var m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    var d = String(dt.getUTCDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function todayUtcStr() {
    var now = new Date();
    return formatUtcDate(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  function addOneYearUtc(parsed) {
    var nextY = parsed.y + 1;
    var dt = new Date(Date.UTC(nextY, parsed.m - 1, parsed.d));
    if (dt.getUTCMonth() !== (parsed.m - 1)) {
      dt = new Date(Date.UTC(nextY, 1, 28));
    }
    return dt.getTime();
  }

  function computeWindowSummary(termDateStr, asOfDateStr, scopeStr) {
    var term = parseIsoDateUtc(termDateStr);
    var asOf = parseIsoDateUtc(asOfDateStr) || parseIsoDateUtc(todayUtcStr());
    var scopeNorm = String(scopeStr || "").toLowerCase().indexOf("partial") !== -1 ? "partial" : "full";
    var activeRule = scopeNorm === "partial"
      ? "FAR 52.249-2(l) (90-day partial)"
      : "FAR 49.104 / 52.249-2(e) (1-year full)";

    if (!term) {
      return {
        termination_date: null,
        as_of_date: formatUtcDate(asOf.ms),
        termination_scope: scopeNorm,
        full_termination_deadline: null,
        days_remaining_full_1yr: null,
        partial_termination_deadline: null,
        days_remaining_partial_90d: null,
        active_window_rule: activeRule,
        active_days_remaining: null,
        far_case_2026_007_notice: FAR_CASE_2026_007_NOTICE
      };
    }

    var msPerDay = 86400000;
    var fullDlMs = addOneYearUtc(term);
    var partialDlMs = term.ms + (90 * msPerDay);
    var remFull = Math.round((fullDlMs - asOf.ms) / msPerDay);
    var remPartial = Math.round((partialDlMs - asOf.ms) / msPerDay);

    return {
      termination_date: formatUtcDate(term.ms),
      as_of_date: formatUtcDate(asOf.ms),
      termination_scope: scopeNorm,
      full_termination_deadline: formatUtcDate(fullDlMs),
      days_remaining_full_1yr: remFull,
      partial_termination_deadline: formatUtcDate(partialDlMs),
      days_remaining_partial_90d: remPartial,
      active_window_rule: activeRule,
      active_days_remaining: scopeNorm === "partial" ? remPartial : remFull,
      far_case_2026_007_notice: FAR_CASE_2026_007_NOTICE
    };
  }

  function resolveMode(params, config) {
    var modes = (config && Array.isArray(config.MODES)) ? config.MODES : [];
    var requested = params && params.mode ? String(params.mode) : "auto_dual_track";
    if (requested === "standard_review") {
      requested = "auto_dual_track";
    }
    for (var i = 0; i < modes.length; i++) {
      if (modes[i].id === requested) {
        return modes[i];
      }
    }
    if (modes.length > 0) {
      return modes[0];
    }
    return {
      id: requested || "auto_dual_track",
      label: "Dual-Track Auto-Detect (FAR 52.249-2 & 52.212-4(l))",
      materiality_cents: 0
    };
  }

  function resolveRowTrack(modeId, rowTrackStr, hasT2Fields, combinedText) {
    if (modeId === "track1_52_249_2") {
      return "TRACK_1";
    }
    if (modeId === "track2_52_212_4l") {
      return "TRACK_2";
    }
    var rt = String(rowTrackStr || "").toLowerCase();
    if (containsAny(rt, ["52.212", "212-4", "commercial", "track 2", "track2", "t2"])) {
      return "TRACK_2";
    }
    if (containsAny(rt, ["52.249", "249-2", "1435", "1436", "non-commercial", "noncommercial", "track 1", "track1", "t1"])) {
      return "TRACK_1";
    }
    if (hasT2Fields || containsAny(combinedText, ["52.212-4", "commercial product", "commercial service", "reasonable termination charge"])) {
      return "TRACK_2";
    }
    return "TRACK_1";
  }

  function initBucketsMap() {
    var out = {};
    for (var i = 0; i < SF_BUCKETS.length; i++) {
      out[SF_BUCKETS[i]] = 0;
    }
    return out;
  }

  function initUnallowableMap() {
    var out = {};
    for (var i = 0; i < UNALLOWABLE_TYPES.length; i++) {
      out[UNALLOWABLE_TYPES[i]] = 0;
    }
    return out;
  }

  function evaluate(parsedCsv, params, config) {
    var startMs = nowMs();
    var cfg = config || (typeof globalThis !== "undefined" && globalThis.SITE_CONFIG) || {};
    var opts = params || {};
    var headers = (parsedCsv && Array.isArray(parsedCsv.headers)) ? parsedCsv.headers : [];
    var rows = (parsedCsv && Array.isArray(parsedCsv.rows)) ? parsedCsv.rows : [];

    var extraBanned = Array.isArray(opts.extra_banned_headers) ? opts.extra_banned_headers : [];
    var piiScan = scanSecurityAndPii(headers, rows, extraBanned);
    var fingerprintSource = JSON.stringify({ headers: headers, rows: rows });
    var fingerprint = "fnv1a-" + CSV.fnv1aHex(fingerprintSource);

    var fixedFeeCents = Number.isInteger(cfg.FIXED_FEE_CENTS) ? cfg.FIXED_FEE_CENTS : DEFAULT_FIXED_FEE_CENTS;
    var minRoiMultiple = Number(cfg.MIN_ROI_MULTIPLE) > 0 ? Number(cfg.MIN_ROI_MULTIPLE) : DEFAULT_MIN_ROI_MULTIPLE;
    var modeObj = resolveMode(opts, cfg);

    if (piiScan.blocked) {
      return {
        blocked_by_pii: true,
        pii: piiScan,
        mode: modeObj.id,
        mode_label: modeObj.label,
        verdict: "BLOCKED_PII",
        elapsed_ms: Number((nowMs() - startMs).toFixed(2)),
        input_fingerprint: fingerprint,
        row_count: rows.length,
        counts: {
          ADJUSTMENT_FLAGGED: 0,
          REVIEW_NEEDED: 0,
          QUALIFIED_BASELINE: 0,
          EXCLUDED_OFFSET: 0
        },
        baseline_total_cents: 0,
        qualified_baseline_cents: 0,
        potential_uplift_cents: 0,
        review_needed_cents: 0,
        excluded_offset_cents: 0,
        unallowable_total_cents: 0,
        fixed_fee_cents: fixedFeeCents,
        net_after_fee_cents: -fixedFeeCents,
        min_roi_multiple: minRoiMultiple,
        roi_multiple: 0,
        column_map: {},
        sf_buckets_cents: initBucketsMap(),
        sf_basis_cents: { SF_1435: 0, SF_1436: 0 },
        unallowable_counts: initUnallowableMap(),
        track2_summary: {
          performed_work_cents: 0,
          reasonable_charges_cents: 0,
          undocumented_charges_cents: 0,
          total_entitlement_cents: 0
        },
        window_summary: computeWindowSummary("", opts.as_of_date || "", "full"),
        lines: []
      };
    }

    var aliases = cfg.COLUMN_ALIASES || DEFAULT_ALIASES;
    var colMap = CSV.buildColumnMap(headers, aliases);

    var materialityCents = 0;
    if (opts.materiality_cents !== undefined && opts.materiality_cents !== null && isFinite(opts.materiality_cents)) {
      materialityCents = Math.max(0, Math.round(Number(opts.materiality_cents)));
    } else if (Number.isInteger(modeObj.materiality_cents)) {
      materialityCents = modeObj.materiality_cents;
    }

    var upliftPct = 100;
    if (opts.uplift_pct !== undefined && opts.uplift_pct !== null && isFinite(opts.uplift_pct)) {
      upliftPct = Math.max(0, Math.min(100, Math.round(Number(opts.uplift_pct))));
    }

    var counts = {
      ADJUSTMENT_FLAGGED: 0,
      REVIEW_NEEDED: 0,
      QUALIFIED_BASELINE: 0,
      EXCLUDED_OFFSET: 0
    };
    var sfBucketsCents = initBucketsMap();
    var sfBasisCents = { SF_1435: 0, SF_1436: 0 };
    var unallowableCounts = initUnallowableMap();

    var qualifiedBaselineCents = 0;
    var flaggedRawCents = 0;
    var reviewNeededCents = 0;
    var excludedOffsetCents = 0;
    var unallowableTotalCents = 0;

    var track2PerformedWorkCents = 0;
    var track2ReasonableChargesCents = 0;
    var track2UndocumentedChargesCents = 0;

    var foundTermDate = String(opts.termination_date || "").trim();
    var foundAsOfDate = String(opts.as_of_date || "").trim();
    var foundScope = String(opts.termination_scope || "").trim();

    var lines = [];

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var sourceRow = row && row.__sourceRow ? row.__sourceRow : (i + 2);
      var recordId = getCell(row, colMap.record_id) || ("ROW-" + sourceRow);
      var rowTrackRaw = getCell(row, colMap.track);
      var category = getCell(row, colMap.category);
      var description = getCell(row, colMap.description);
      var rowStatus = getCell(row, colMap.status);
      var rawAmount = colMap.amount ? row[colMap.amount] : "";
      var rowTermDate = getCell(row, colMap.termination_date);
      var rowAsOfDate = getCell(row, colMap.as_of_date);
      var rowScope = getCell(row, colMap.termination_scope);
      var contractPriceRaw = getCell(row, colMap.contract_price);
      var pctPerformedRaw = getCell(row, colMap.pct_performed);

      if (!foundTermDate && parseIsoDateUtc(rowTermDate) !== null) {
        foundTermDate = rowTermDate;
      }
      if (!foundAsOfDate && parseIsoDateUtc(rowAsOfDate) !== null) {
        foundAsOfDate = rowAsOfDate;
      }
      if (rowScope.toLowerCase().indexOf("partial") !== -1 || description.toLowerCase().indexOf("partial") !== -1) {
        foundScope = "partial";
      }

      var contractPriceCents = CSV.parseCents(contractPriceRaw);
      var pctBps = parsePctBps(pctPerformedRaw);
      var hasT2Fields = (contractPriceCents !== null && contractPriceCents > 0 && pctBps !== null);
      var combined = (category + " " + description + " " + rowStatus).trim();
      var track = resolveRowTrack(modeObj.id, rowTrackRaw, hasT2Fields, combined);

      var parsedAmount = CSV.parseCents(rawAmount);
      if (parsedAmount === null && track === "TRACK_2" && hasT2Fields) {
        parsedAmount = Math.floor((contractPriceCents * pctBps + 5000) / 10000);
      }

      var costBucket = "";
      var sfForm = "";
      var unallowableType = "";
      var amountCents;
      var status;
      var ruleId;
      var rationale;

      if (parsedAmount === null) {
        amountCents = 0;
        status = "REVIEW_NEEDED";
        ruleId = "R-PARSE-01";
        rationale = "Amount value could not be parsed into exact cents; manual check required.";
      } else {
        amountCents = parsedAmount;
        var unallowableHit = detectUnallowableFar31(combined);

        if (amountCents <= 0) {
          status = "EXCLUDED_OFFSET";
          ruleId = "R-EXCL-01";
          rationale = "Non-positive or credit offset entry excluded from recoverable settlement claim.";
        } else if (
          containsAny(category, ["excluded", "offset", "void", "credit", "reversal", "progress payment", "liquidation"]) ||
          containsAny(rowStatus, ["excluded", "offset", "void", "credit", "reversal"])
        ) {
          status = "EXCLUDED_OFFSET";
          ruleId = "R-EXCL-02";
          rationale = "Credit offset, liquidation, or prior progress payment excluded from settlement balance.";
        } else if (unallowableHit !== null) {
          unallowableType = unallowableHit.type;
          ruleId = unallowableHit.ruleId;
          rationale = unallowableHit.rationale;
          status = "EXCLUDED_OFFSET";
          unallowableCounts[unallowableType] += 1;
          unallowableTotalCents += amountCents;
        } else if (track === "TRACK_2") {
          var missingDocT2 = (
            containsAny(rowStatus, ["missing", "undocumented", "no_doc", "no doc", "no backup", "no receipt", "unverified", "pending", "incomplete", "estimate"]) ||
            containsAny(description, ["missing accounting", "undocumented", "no receipt", "no backup", "estimate only"])
          );
          if (missingDocT2) {
            status = "REVIEW_NEEDED";
            ruleId = "R-52212-DOC";
            rationale = "Track 2 (FAR 52.212-4(l)): Missing accounting documentation required to substantiate charge.";
            track2UndocumentedChargesCents += amountCents;
          } else if (containsAny(combined, ["termination charge", "reasonable charge", "wind-down", "winding down", "demobilization", "restocking", "cancellation fee", "settlement charge", "unbilled", "adjustment", "flagged"])) {
            if (amountCents < materialityCents) {
              status = "REVIEW_NEEDED";
              ruleId = "R-REV-02";
              rationale = "Track 2 (FAR 52.212-4(l)): Documented termination charge below materiality cutoff (" + CSV.formatCents(materialityCents) + ").";
            } else {
              status = "ADJUSTMENT_FLAGGED";
              ruleId = "R-52212-CHG";
              rationale = "Track 2 (FAR 52.212-4(l)): Documented reasonable termination charge candidate.";
              track2ReasonableChargesCents += amountCents;
            }
          } else {
            var basisNote = hasT2Fields
              ? (" (" + (pctBps / 100).toFixed(2) + "% of " + CSV.formatCents(contractPriceCents) + " contract price)")
              : "";
            track2PerformedWorkCents += amountCents;
            if (containsAny(rowStatus, ["unbilled", "adjustment", "flagged"])) {
              if (amountCents < materialityCents) {
                status = "REVIEW_NEEDED";
                ruleId = "R-REV-02";
                rationale = "Track 2 (FAR 52.212-4(l)): Performed-work entitlement" + basisNote + " below materiality cutoff.";
              } else {
                status = "ADJUSTMENT_FLAGGED";
                ruleId = "R-52212-WRK";
                rationale = "Track 2 (FAR 52.212-4(l)): Performed-work portion of contract price" + basisNote + ".";
              }
            } else {
              status = "QUALIFIED_BASELINE";
              ruleId = "R-52212-WRK";
              rationale = "Track 2 (FAR 52.212-4(l)): Documented performed work" + basisNote + ".";
            }
          }
        } else {
          var missingDocT1 = (
            containsAny(rowStatus, ["missing", "undocumented", "no_doc", "no doc", "no backup", "no receipt", "unverified", "pending", "manual", "unclear", "unclassified", "incomplete"]) ||
            containsAny(category, ["review", "pending", "unclassified", "unknown"])
          );
          sfForm = containsAny(combined, ["1435", "inventory basis", "wip", "raw material", "work in process"]) ? "SF_1435" : "SF_1436";

          if (containsAny(combined, ["31.205-42(g)", "31.205-42g", "settlement prep", "settlement expense", "claim prep", "proposal prep", "accounting prep", "clerical settlement", "termination inventory", "storage", "preservation", "disposal", "post-termination"])) {
            costBucket = "SETTLEMENT_PREP_31_205_42G";
          } else if (containsAny(combined, ["subcontract", "subcontractor", "vendor settlement", "supplier settlement", "purchase order cancellation", "tier-2"])) {
            costBucket = "SUBCONTRACTOR_SETTLEMENT";
          } else if (containsAny(combined, ["unamortized", "initial cost", "preparatory", "startup", "tooling amortization", "pre-production", "learning curve", "initial expense", "31.205-42(c)"])) {
            costBucket = "UNAMORTIZED_INITIAL";
          } else if (containsAny(combined, ["direct material", "raw material", "inventory", "purchased parts", "work in process", "wip", "components", "special tooling", "materials"])) {
            costBucket = "DIRECT_MATERIAL";
          } else if (containsAny(combined, ["direct labor", "engineering labor", "manufacturing labor", "labor", "payroll", "wages", "fringe", "technician", "hours"])) {
            costBucket = "DIRECT_LABOR";
          } else if (category === "") {
            costBucket = "";
          } else {
            costBucket = "DIRECT_LABOR";
          }

          if (missingDocT1 || costBucket === "") {
            status = "REVIEW_NEEDED";
            ruleId = "R-REV-01";
            rationale = "Track 1 (" + sfForm.replace("_", " ") + "): Missing supporting documentation or incomplete cost bucket classification.";
          } else {
            sfBucketsCents[costBucket] += amountCents;
            sfBasisCents[sfForm] += amountCents;
            var isSettlementClaimBucket = (
              costBucket === "SUBCONTRACTOR_SETTLEMENT" ||
              costBucket === "UNAMORTIZED_INITIAL" ||
              costBucket === "SETTLEMENT_PREP_31_205_42G"
            );
            var isFlaggedLine = containsAny(
              rowStatus + " " + description,
              ["unbilled", "omitted", "adjustment", "flagged", "reclassify", "discrepancy", "termination claim"]
            );
            if (isSettlementClaimBucket || isFlaggedLine) {
              if (amountCents < materialityCents) {
                status = "REVIEW_NEEDED";
                ruleId = "R-REV-02";
                rationale = "Track 1 (" + sfForm.replace("_", " ") + " / " + costBucket + "): Below materiality cutoff (" + CSV.formatCents(materialityCents) + ").";
              } else {
                status = "ADJUSTMENT_FLAGGED";
                var ruleMap = {
                  SETTLEMENT_PREP_31_205_42G: "R-T1-3120542G",
                  SUBCONTRACTOR_SETTLEMENT: "R-T1-SUB",
                  UNAMORTIZED_INITIAL: "R-T1-INIT"
                };
                ruleId = ruleMap[costBucket] || "R-T1-ADJ";
                rationale = "Track 1 (" + sfForm.replace("_", " ") + "): Recoverable " + costBucket + " settlement candidate under FAR 52.249-2.";
              }
            } else {
              status = "QUALIFIED_BASELINE";
              ruleId = costBucket === "DIRECT_MATERIAL" ? "R-T1-MAT" : "R-T1-LAB";
              rationale = "Track 1 (" + sfForm.replace("_", " ") + "): Documented " + costBucket + " incurred baseline.";
            }
          }
        }
      }

      counts[status] += 1;
      if (status === "QUALIFIED_BASELINE") {
        qualifiedBaselineCents += amountCents;
      } else if (status === "ADJUSTMENT_FLAGGED") {
        flaggedRawCents += amountCents;
      } else if (status === "REVIEW_NEEDED") {
        reviewNeededCents += amountCents;
      } else {
        excludedOffsetCents += amountCents;
      }

      lines.push({
        source_row: sourceRow,
        record_id: recordId,
        track: track,
        sf_form: sfForm,
        cost_bucket: costBucket,
        unallowable_type: unallowableType,
        category: category || (costBucket || "Unassigned"),
        description: description || "-",
        amount_cents: amountCents,
        status: status,
        rule_id: ruleId,
        rationale: rationale
      });
    }

    var potentialUpliftCents = Math.floor((flaggedRawCents * upliftPct + 50) / 100);
    var baselineTotalCents = qualifiedBaselineCents + flaggedRawCents + reviewNeededCents;
    var netAfterFeeCents = potentialUpliftCents - fixedFeeCents;
    var roiMultiple = fixedFeeCents > 0
      ? (Math.floor((potentialUpliftCents * 100 + Math.floor(fixedFeeCents / 2)) / fixedFeeCents) / 100)
      : 0;
    var qualifiedGate = potentialUpliftCents >= (fixedFeeCents * minRoiMultiple);
    var verdict = qualifiedGate ? "QUALIFIED" : "BELOW_THRESHOLD";
    var windowSummary = computeWindowSummary(foundTermDate, foundAsOfDate, foundScope);
    var elapsedMs = Number(Math.max(0.01, nowMs() - startMs).toFixed(2));

    return {
      blocked_by_pii: false,
      pii: piiScan,
      mode: modeObj.id,
      mode_label: modeObj.label,
      materiality_cents: materialityCents,
      uplift_pct: upliftPct,
      verdict: verdict,
      elapsed_ms: elapsedMs,
      input_fingerprint: fingerprint,
      row_count: rows.length,
      counts: counts,
      baseline_total_cents: baselineTotalCents,
      qualified_baseline_cents: qualifiedBaselineCents,
      potential_uplift_cents: potentialUpliftCents,
      review_needed_cents: reviewNeededCents,
      excluded_offset_cents: excludedOffsetCents,
      unallowable_total_cents: unallowableTotalCents,
      fixed_fee_cents: fixedFeeCents,
      net_after_fee_cents: netAfterFeeCents,
      min_roi_multiple: minRoiMultiple,
      roi_multiple: roiMultiple,
      column_map: colMap,
      sf_buckets_cents: sfBucketsCents,
      sf_basis_cents: sfBasisCents,
      unallowable_counts: unallowableCounts,
      track2_summary: {
        performed_work_cents: track2PerformedWorkCents,
        reasonable_charges_cents: track2ReasonableChargesCents,
        undocumented_charges_cents: track2UndocumentedChargesCents,
        total_entitlement_cents: track2PerformedWorkCents + track2ReasonableChargesCents
      },
      window_summary: windowSummary,
      lines: lines
    };
  }

  function generateTraceabilityCsv(result) {
    var headers = [
      "source_row",
      "record_id",
      "track",
      "sf_form",
      "cost_bucket",
      "category",
      "description",
      "amount_usd",
      "amount_cents",
      "status",
      "rule_id",
      "rationale"
    ];
    var out = [headers.join(",")];
    var lines = (result && Array.isArray(result.lines)) ? result.lines : [];

    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var row = [
        ln.source_row,
        ln.record_id,
        ln.track || "",
        ln.sf_form || "",
        ln.cost_bucket || "",
        ln.category,
        ln.description,
        CSV.formatCents(ln.amount_cents),
        ln.amount_cents,
        ln.status,
        ln.rule_id,
        ln.rationale
      ].map(escapeCsvField);
      out.push(row.join(","));
    }
    return out.join("\r\n");
  }

  function generatePrintableBriefHtml(result, config) {
    var cfg = config || (typeof globalThis !== "undefined" && globalThis.SITE_CONFIG) || {};
    var res = result || {};
    var title = cfg.SITE_TITLE || "Federal Civilian T4C Settlement Pre-Scan";
    var privacyText = cfg.PRIVACY_BAR_TEXT || "100% Browser-Local Analysis \u2014 Your CSV file never leaves your browser; zero server upload.";
    var disclaimer = cfg.LEGAL_DISCLAIMER_BANNER || "Independent Non-Audit, Non-Legal & Fixed Non-Contingent Fee ($1,495.00): Not an audit report, not a CPA attestation, does not provide legal advice or legal representation; no guarantee of government reimbursement under FAR 31.205-33.";
    var senderIdentity = cfg.SENDER_IDENTITY || "Federal Civilian T4C Pre-Scan Desk | intake@scan.far31prescan.com";
    var win = res.window_summary || {};
    var buckets = res.sf_buckets_cents || {};
    var t2 = res.track2_summary || {};

    var lines = Array.isArray(res.lines) ? res.lines.slice() : [];
    var priorityOrder = {
      ADJUSTMENT_FLAGGED: 0,
      REVIEW_NEEDED: 1,
      QUALIFIED_BASELINE: 2,
      EXCLUDED_OFFSET: 3
    };
    lines.sort(function (a, b) {
      var pa = priorityOrder[a.status] !== undefined ? priorityOrder[a.status] : 9;
      var pb = priorityOrder[b.status] !== undefined ? priorityOrder[b.status] : 9;
      if (pa !== pb) {
        return pa - pb;
      }
      return Math.abs(b.amount_cents) - Math.abs(a.amount_cents);
    });
    var topLines = lines.slice(0, 15);

    var rowsHtml = topLines.map(function (ln) {
      return (
        "<tr>" +
        "<td>" + escapeHtml(ln.source_row) + "</td>" +
        "<td>" + escapeHtml(ln.record_id) + "</td>" +
        "<td>" + escapeHtml(ln.track || "") + "</td>" +
        "<td>" + escapeHtml(ln.cost_bucket || ln.category) + "</td>" +
        "<td>" + escapeHtml(ln.status) + "</td>" +
        "<td>" + escapeHtml(ln.rule_id) + "</td>" +
        "<td style=\"text-align:right;\">" + escapeHtml(CSV.formatCents(ln.amount_cents)) + "</td>" +
        "<td>" + escapeHtml(ln.rationale) + "</td>" +
        "</tr>"
      );
    }).join("");

    var windowNote = "Active Rule: " + (win.active_window_rule || "FAR 49.104 / 52.249-2(e)") +
      (win.days_remaining_full_1yr !== null && win.days_remaining_full_1yr !== undefined
        ? (" | Full 1-Yr Remaining: " + win.days_remaining_full_1yr + "d | Partial 90-Day Remaining: " + win.days_remaining_partial_90d + "d")
        : "");

    return (
      "<!DOCTYPE html>\n" +
      "<html lang=\"en\">\n" +
      "<head>\n" +
      "  <meta charset=\"utf-8\">\n" +
      "  <title>" + escapeHtml(title) + " - 1-Page Executive Brief</title>\n" +
      "  <style>\n" +
      "    @page { size: letter; margin: 0.45in; }\n" +
      "    * { box-sizing: border-box; }\n" +
      "    body { font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif; color: #111827; margin: 0; padding: 18px; font-size: 10.5px; line-height: 1.35; }\n" +
      "    .header { border-bottom: 2px solid #0f172a; padding-bottom: 6px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: flex-end; }\n" +
      "    .header h1 { font-size: 15px; margin: 0 0 2px 0; }\n" +
      "    .meta { font-size: 9.5px; color: #374151; }\n" +
      "    .banner { background: #fef3c7; border: 1px solid #d97706; padding: 6px 8px; font-weight: 700; margin-bottom: 8px; font-size: 9.5px; }\n" +
      "    .privacy { background: #ecfdf5; border: 1px solid #059669; padding: 5px 8px; margin-bottom: 8px; font-size: 9.5px; }\n" +
      "    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 8px; }\n" +
      "    .kpi { border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px; background: #f8fafc; }\n" +
      "    .kpi-label { font-size: 8.5px; text-transform: uppercase; color: #475569; font-weight: 700; }\n" +
      "    .kpi-val { font-size: 13px; font-weight: 700; margin-top: 2px; }\n" +
      "    .subgrid { border: 1px solid #cbd5e1; padding: 6px 8px; margin-bottom: 8px; background: #f8fafc; font-size: 9.5px; }\n" +
      "    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 9.5px; }\n" +
      "    th, td { border: 1px solid #cbd5e1; padding: 3px 5px; text-align: left; vertical-align: top; }\n" +
      "    th { background: #f1f5f9; font-weight: 700; }\n" +
      "    .footer { border-top: 1px solid #94a3b8; padding-top: 6px; font-size: 8.5px; color: #334155; }\n" +
      "  </style>\n" +
      "</head>\n" +
      "<body>\n" +
      "  <div class=\"header\">\n" +
      "    <div>\n" +
      "      <h1>" + escapeHtml(title) + " \u2014 1-Page Executive Brief</h1>\n" +
      "      <div class=\"meta\">Mode: " + escapeHtml(res.mode_label || res.mode || "auto_dual_track") + " | Verdict: <strong>" + escapeHtml(res.verdict || "UNKNOWN") + "</strong></div>\n" +
      "    </div>\n" +
      "    <div class=\"meta\" style=\"text-align:right;\">\n" +
      "      <div>Fingerprint: <code>" + escapeHtml(res.input_fingerprint || "n/a") + "</code></div>\n" +
      "      <div>Rows: " + escapeHtml(res.row_count || 0) + " | Elapsed: " + escapeHtml(res.elapsed_ms || 0) + " ms</div>\n" +
      "    </div>\n" +
      "  </div>\n" +
      "  <div class=\"privacy\">" + escapeHtml(privacyText) + "</div>\n" +
      "  <div class=\"banner\">" + escapeHtml(disclaimer) + "</div>\n" +
      "  <div class=\"kpis\">\n" +
      "    <div class=\"kpi\"><div class=\"kpi-label\">Recoverable Settlement Uplift</div><div class=\"kpi-val\">" + escapeHtml(CSV.formatCents(res.potential_uplift_cents || 0)) + "</div><div>Baseline: " + escapeHtml(CSV.formatCents(res.baseline_total_cents || 0)) + "</div></div>\n" +
      "    <div class=\"kpi\"><div class=\"kpi-label\">Net After Fixed Fee</div><div class=\"kpi-val\">" + escapeHtml(CSV.formatCents(res.net_after_fee_cents || 0)) + "</div><div>Fee: " + escapeHtml(CSV.formatCents(res.fixed_fee_cents || DEFAULT_FIXED_FEE_CENTS)) + "</div></div>\n" +
      "    <div class=\"kpi\"><div class=\"kpi-label\">ROI vs " + escapeHtml(res.min_roi_multiple || DEFAULT_MIN_ROI_MULTIPLE) + "x Gate</div><div class=\"kpi-val\">" + escapeHtml(res.roi_multiple || 0) + "x</div><div>Status: " + escapeHtml(res.verdict || "") + "</div></div>\n" +
      "    <div class=\"kpi\"><div class=\"kpi-label\">FAR Part 31 Unallowables Stripped</div><div class=\"kpi-val\">" + escapeHtml(CSV.formatCents(res.unallowable_total_cents || 0)) + "</div><div>Review Needed: " + escapeHtml(CSV.formatCents(res.review_needed_cents || 0)) + "</div></div>\n" +
      "  </div>\n" +
      "  <div class=\"subgrid\">\n" +
      "    <strong>SF 1435/1436 Buckets:</strong> Labor " + escapeHtml(CSV.formatCents(buckets.DIRECT_LABOR || 0)) +
      " | Material " + escapeHtml(CSV.formatCents(buckets.DIRECT_MATERIAL || 0)) +
      " | Subcontractor " + escapeHtml(CSV.formatCents(buckets.SUBCONTRACTOR_SETTLEMENT || 0)) +
      " | Unamortized Initial " + escapeHtml(CSV.formatCents(buckets.UNAMORTIZED_INITIAL || 0)) +
      " | 31.205-42(g) Prep " + escapeHtml(CSV.formatCents(buckets.SETTLEMENT_PREP_31_205_42G || 0)) + "<br>\n" +
      "    <strong>Track 2 (FAR 52.212-4(l)):</strong> Performed Work " + escapeHtml(CSV.formatCents(t2.performed_work_cents || 0)) +
      " | Reasonable Charges " + escapeHtml(CSV.formatCents(t2.reasonable_charges_cents || 0)) +
      " | Undocumented " + escapeHtml(CSV.formatCents(t2.undocumented_charges_cents || 0)) + "<br>\n" +
      "    <strong>Filing Window:</strong> " + escapeHtml(windowNote) + " \u2014 " + escapeHtml(win.far_case_2026_007_notice || FAR_CASE_2026_007_NOTICE) + "\n" +
      "  </div>\n" +
      "  <table>\n" +
      "    <thead><tr><th>Row</th><th>ID</th><th>Track</th><th>Bucket</th><th>Status</th><th>Rule</th><th style=\"text-align:right;\">Amount</th><th>Rationale</th></tr></thead>\n" +
      "    <tbody>" + rowsHtml + "</tbody>\n" +
      "  </table>\n" +
      "  <div class=\"footer\">\n" +
      "    <strong>Non-Audit / Fixed Non-Contingent Fee Notice:</strong> " + escapeHtml(disclaimer) + "<br>\n" +
      "    <span>Prepared locally in browser | " + escapeHtml(senderIdentity) + "</span>\n" +
      "  </div>\n" +
      "</body>\n" +
      "</html>\n"
    );
  }

  return {
    evaluate: evaluate,
    generateTraceabilityCsv: generateTraceabilityCsv,
    generatePrintableBriefHtml: generatePrintableBriefHtml,
    parsePctBps: parsePctBps,
    computeWindowSummary: computeWindowSummary
  };
}));
