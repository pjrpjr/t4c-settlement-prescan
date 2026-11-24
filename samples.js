(function (root) {
  "use strict";

  var PRESCAN_SAMPLES = {
    qualified: {
      id: "qualified",
      mode: "auto_dual_track",
      filename: "gsa_hhs_civilian_t4c_qualified.csv",
      csv: [
        "Record ID,Termination Date,As Of Date,Termination Scope,Track,Category,Description,Status,Contract Price,Percent Performed,Amount",
        "T4C-101,2026-06-15,2026-11-24,Full,FAR 52.249-2,Direct Labor,GSA MAS engineering and technical labor incurred prior to termination,Allowable,,,\"$48,500.00\"",
        "T4C-102,2026-06-15,2026-11-24,Full,FAR 52.249-2,Direct Material,HHS lab filtration inventory and WIP raw materials (SF 1435),Allowable,,,\"$22,400.00\"",
        "T4C-103,2026-06-15,2026-11-24,Full,FAR 52.249-2,Subcontractor Settlement,Tier-2 specialty fabricator termination settlement proposal,Documented,,,\"$12,800.00\"",
        "T4C-104,2026-06-15,2026-11-24,Full,FAR 52.249-2,Unamortized Initial Cost,Unamortized initial tooling and pre-production setup (FAR 31.205-42(c)),Documented,,,\"$9,600.00\"",
        "T4C-105,2026-06-15,2026-11-24,Full,FAR 52.249-2,Settlement Prep 31.205-42(g),Post-termination accounting storage and settlement prep (31.205-42(g)),Documented,,,\"$4,250.00\"",
        "T4C-106,2026-06-15,2026-11-24,Full,FAR 52.212-4(l),Commercial Performed Work,HHS commercial SaaS onboarding performed work prior to notice,Allowable,\"$65,000.00\",40%,\"$26,000.00\"",
        "T4C-107,2026-06-15,2026-11-24,Full,FAR 52.212-4(l),Termination Charge,Documented reasonable termination charge for vendor restocking and wind-down,Documented,,,\"$3,800.00\"",
        "T4C-108,2026-06-15,2026-11-24,Full,FAR 52.249-2,Entertainment,Client hospitality and golf outing (FAR 31.205-14),Flagged,,,\"$1,450.00\"",
        "T4C-109,2026-06-15,2026-11-24,Full,FAR 52.249-2,Lobbying,Legislative liaison and lobbying retainer (FAR 31.205-22),Flagged,,,\"$2,200.00\"",
        "T4C-110,2026-06-15,2026-11-24,Full,FAR 52.212-4(l),Termination Charge,Demobilization shipping charge awaiting carrier invoice,Missing Backup,,,\"$1,950.00\"",
        "T4C-111,2026-06-15,2026-11-24,Full,FAR 52.249-2,Progress Payment Offset,Prior interim progress payment liquidation,Excluded,,,-$15000.00"
      ].join("\n")
    },
    below_threshold: {
      id: "below_threshold",
      mode: "auto_dual_track",
      filename: "civilian_small_t4c_below_threshold.csv",
      csv: [
        "Record ID,Termination Date,As Of Date,Termination Scope,Track,Category,Description,Status,Contract Price,Percent Performed,Amount",
        "T4C-201,2026-10-01,2026-11-24,Partial,FAR 52.249-2,Direct Labor,USDA regional administrative support labor (partial scope baseline),Allowable,,,\"$14,200.00\"",
        "T4C-202,2026-10-01,2026-11-24,Partial,FAR 52.249-2,Direct Material,Standard office consumables delivered prior to partial stop-work,Allowable,,,\"$3,800.00\"",
        "T4C-203,2026-10-01,2026-11-24,Partial,FAR 52.249-2,Unamortized Initial Cost,Minor regional onboarding setup amortization,Documented,,,\"$2,900.00\"",
        "T4C-204,2026-10-01,2026-11-24,Partial,FAR 52.249-2,Settlement Prep 31.205-42(g),Internal clerical closeout hours (31.205-42(g)),Documented,,,\"$1,850.00\"",
        "T4C-205,2026-10-01,2026-11-24,Partial,FAR 52.212-4(l),Termination Charge,Small vendor restocking fee on commercial task order,Documented,,,\"$1,100.00\"",
        "T4C-206,2026-10-01,2026-11-24,Partial,FAR 52.249-2,Fines,Late municipal parking fine (FAR 31.205-15),Flagged,,,\"$250.00\"",
        "T4C-207,2026-10-01,2026-11-24,Partial,FAR 52.212-4(l),Termination Charge,Unverified courier estimate without receipt,No Receipt,,,\"$600.00\""
      ].join("\n")
    }
  };

  root.PRESCAN_SAMPLES = PRESCAN_SAMPLES;
  if (typeof module === "object" && module.exports) {
    module.exports = PRESCAN_SAMPLES;
  }
}(typeof globalThis !== "undefined" ? globalThis : this));
