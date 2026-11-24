(function (root) {
  "use strict";

  /* SITE_CONFIG_JSON_START */
  var SITE_CONFIG = {
    "SITE_TITLE": "Federal Civilian T4C Settlement Pre-Scan (FAR 52.249-2 & 52.212-4(l))",
    "BRAND_BADGE": "CIVILIAN T4C LOCAL SCREENING",
    "PRIVACY_BAR_TEXT": "100% Browser-Local Analysis — Your CSV file never leaves your browser; zero server upload. Strictly Federal Civilian (No DoD/DFARS/CUI/ITAR).",
    "LEGAL_DISCLAIMER_BANNER": "IMPORTANT DISCLOSURE — Independent Non-Audit, Non-Legal & Fixed Non-Contingent Fee ($1,495.00): This browser-local pre-scan is an informational diagnostic tool only. It is not an audit report, is not a CPA attestation, and does not provide legal advice or legal representation. Under the FAR 31.205-33 allowability framework, there is NO guarantee of government reimbursement of preparation costs. We do NOT sign SF 1436, SF 1435, or SF 1439 forms and do NOT negotiate with the Termination Contracting Officer (TCO). Strictly civilian awards (zero DoD, DFARS, CUI, FOUO, or ITAR). Deadline guide: 90-day partial-termination equitable adjustment window (FAR 52.249-2(l)) vs 1-year full-termination proposal window (FAR 49.104 / 52.249-2(e); proposed FAR Case 2026-007 90-day change is NOT yet final).",
    "FIXED_FEE_CENTS": 149500,
    "MIN_ROI_MULTIPLE": 10,
    "CONTACT_EMAIL": "intake@scan.far31prescan.com",
    "SENDER_IDENTITY": "Federal Civilian T4C Pre-Scan Desk | Independent Non-Audit Screening | intake@scan.far31prescan.com",
    "MODES": [
      {
        "id": "auto_dual_track",
        "label": "Dual-Track Auto-Detect (FAR 52.249-2 & 52.212-4(l))",
        "description": "Routes each line to Track 1 (FAR 52.249-2 SF 1435/1436) or Track 2 (FAR 52.212-4(l) Commercial), excludes FAR Part 31 unallowable costs, and checks 1-year full vs 90-day partial termination windows (FAR Case 2026-007 not yet final).",
        "materiality_cents": 0
      },
      {
        "id": "track1_52_249_2",
        "label": "Track 1: FAR 52.249-2 Non-Commercial (SF 1435 / SF 1436)",
        "description": "Classifies lines into DIRECT_LABOR, DIRECT_MATERIAL, SUBCONTRACTOR_SETTLEMENT, UNAMORTIZED_INITIAL, and SETTLEMENT_PREP_31_205_42G while removing FAR Part 31 unallowables.",
        "materiality_cents": 0
      },
      {
        "id": "track2_52_212_4l",
        "label": "Track 2: FAR 52.212-4(l) Commercial Products/Services",
        "description": "Calculates performed-work portion of contract price plus documented reasonable termination charges, flagging missing accounting documentation.",
        "materiality_cents": 0
      }
    ],
    "COLUMN_ALIASES": {
      "record_id": [
        "record_id",
        "line_id",
        "id",
        "entry_id",
        "ref",
        "reference",
        "cost_id",
        "clin"
      ],
      "category": [
        "category",
        "cost_bucket",
        "bucket",
        "sf_bucket",
        "cost_element",
        "type",
        "class",
        "account"
      ],
      "description": [
        "description",
        "memo",
        "details",
        "item",
        "narrative",
        "notes",
        "cost_description"
      ],
      "amount": [
        "amount",
        "amount_usd",
        "claimed_amount",
        "cost_usd",
        "value",
        "total",
        "net_amount",
        "gross_amount"
      ],
      "status": [
        "status",
        "allowability",
        "documentation_status",
        "doc_status",
        "flag",
        "disposition",
        "review_status"
      ],
      "date": [
        "date",
        "entry_date",
        "posted_date",
        "period"
      ],
      "track": [
        "track",
        "far_clause",
        "clause",
        "termination_track",
        "contract_type"
      ],
      "termination_date": [
        "termination_date",
        "t4c_date",
        "notice_date",
        "date",
        "effective_date"
      ],
      "termination_scope": [
        "termination_scope",
        "scope",
        "termination_type",
        "partial_or_full"
      ],
      "contract_price": [
        "contract_price",
        "total_contract_price",
        "award_amount",
        "ceiling_price"
      ],
      "pct_performed": [
        "pct_performed",
        "percent_performed",
        "work_performed_pct",
        "completion_pct"
      ],
      "as_of_date": [
        "as_of_date",
        "eval_date",
        "scan_date"
      ]
    },
    "SAMPLES_META": {
      "qualified": {
        "id": "qualified",
        "label": "Load GSA / HHS Qualified Sample (>= 10x Gate)",
        "description": "11-row federal civilian GSA/HHS dual-track T4C ledger showing $30,450.00 recoverable adjustment candidates above the $14,950.00 (10x) threshold."
      },
      "below_threshold": {
        "id": "below_threshold",
        "label": "Load Small Civilian Below-Threshold Sample (< 10x Gate)",
        "description": "7-row partial-termination civilian ledger showing $5,850.00 below the $14,950.00 (10x) threshold and 90-day FAR 52.249-2(l) window."
      }
    }
  };
  /* SITE_CONFIG_JSON_END */

  root.SITE_CONFIG = SITE_CONFIG;
  if (typeof module === "object" && module.exports) {
    module.exports = SITE_CONFIG;
  }
}(typeof globalThis !== "undefined" ? globalThis : this));
