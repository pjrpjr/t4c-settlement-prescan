(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ZeroUploadCSV = factory();
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DEFAULT_BANNED_HEADERS = [
    "ssn",
    "social_security",
    "social_security_number",
    "ein",
    "tax_id",
    "employee_name",
    "full_name",
    "first_name",
    "last_name",
    "email",
    "email_address",
    "phone",
    "phone_number",
    "mobile",
    "dob",
    "date_of_birth",
    "birth_date",
    "password",
    "passwd",
    "api_key",
    "apikey",
    "secret_key",
    "access_token"
  ];

  var SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
  var EIN_RE = /\b\d{2}-\d{7}\b/;
  var EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
  var PHONE_RE = /(?:^|[^\dA-Za-z])((?:\+?1[-.\s]?)?(?:\(\d{3}\)[-.\s]?|\d{3}[-.\s])\d{3}[-.\s]\d{4})(?!\d)/;

  /**
   * Normalize a header or column alias to lowercase snake_case.
   * @param {string} name
   * @returns {string}
   */
  function normCol(name) {
    if (name === null || name === undefined) {
      return "";
    }
    return String(name)
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  /**
   * Parse RFC-4180 CSV text into { headers, rows }.
   * Strips UTF-8 BOM, supports quoted fields, escaped "", CRLF/LF/CR,
   * skips trailing empty lines, and attaches 1-based __sourceRow on each row.
   * @param {string} text
   * @returns {{ headers: string[], rows: Object[] }}
   */
  function parseCSV(text) {
    if (text === null || text === undefined) {
      return { headers: [], rows: [] };
    }
    var src = String(text);
    if (src.charCodeAt(0) === 0xFEFF) {
      src = src.slice(1);
    }
    if (src.trim() === "") {
      return { headers: [], rows: [] };
    }

    var records = [];
    var currentRow = [];
    var currentField = "";
    var inQuotes = false;
    var rowStartLine = 1;
    var currentLine = 1;
    var i = 0;
    var len = src.length;

    while (i < len) {
      var ch = src.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < len && src.charAt(i + 1) === '"') {
            currentField += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        if (ch === "\r") {
          currentLine += 1;
          if (i + 1 < len && src.charAt(i + 1) === "\n") {
            currentField += "\n";
            i += 2;
            continue;
          }
          currentField += "\n";
          i += 1;
          continue;
        }
        if (ch === "\n") {
          currentLine += 1;
        }
        currentField += ch;
        i += 1;
      } else {
        if (ch === '"' && currentField === "") {
          inQuotes = true;
          i += 1;
        } else if (ch === ",") {
          currentRow.push(currentField);
          currentField = "";
          i += 1;
        } else if (ch === "\r" || ch === "\n") {
          currentRow.push(currentField);
          records.push({ fields: currentRow, sourceRow: rowStartLine });
          currentRow = [];
          currentField = "";
          if (ch === "\r" && i + 1 < len && src.charAt(i + 1) === "\n") {
            i += 2;
          } else {
            i += 1;
          }
          currentLine += 1;
          rowStartLine = currentLine;
        } else {
          currentField += ch;
          i += 1;
        }
      }
    }

    if (inQuotes || currentField !== "" || currentRow.length > 0) {
      currentRow.push(currentField);
      records.push({ fields: currentRow, sourceRow: rowStartLine });
    }

    while (records.length > 0) {
      var tail = records[records.length - 1].fields;
      var isEmptyTail = tail.every(function (cell) {
        return cell.trim() === "";
      });
      if (isEmptyTail) {
        records.pop();
      } else {
        break;
      }
    }

    if (records.length === 0) {
      return { headers: [], rows: [] };
    }

    var rawHeaders = records[0].fields;
    var headers = [];
    var seenHeaders = Object.create(null);
    for (var h = 0; h < rawHeaders.length; h++) {
      var headerName = rawHeaders[h].trim();
      if (!headerName) {
        headerName = "column_" + (h + 1);
      }
      if (headerName === "__proto__" || headerName === "constructor" || headerName === "prototype") {
        headerName = "col_" + headerName;
      }
      if (seenHeaders[headerName]) {
        seenHeaders[headerName] += 1;
        headerName = headerName + "_" + seenHeaders[headerName];
      } else {
        seenHeaders[headerName] = 1;
      }
      headers.push(headerName);
    }

    var rows = [];
    for (var r = 1; r < records.length; r++) {
      var rec = records[r];
      var isBlankRow = rec.fields.every(function (cell) {
        return cell.trim() === "";
      });
      if (isBlankRow) {
        continue;
      }
      var rowObj = {};
      for (var c = 0; c < headers.length; c++) {
        rowObj[headers[c]] = c < rec.fields.length ? rec.fields[c] : "";
      }
      rowObj.__sourceRow = rec.sourceRow;
      rows.push(rowObj);
    }

    return { headers: headers, rows: rows };
  }

  /**
   * Map canonical field names to actual CSV header names using aliasSpec.
   * @param {string[]} headers
   * @param {Object<string, string[]>} aliasSpec
   * @returns {Object<string, string|null>}
   */
  function buildColumnMap(headers, aliasSpec) {
    var result = {};
    var normToHeader = Object.create(null);
    var headerList = Array.isArray(headers) ? headers : [];

    for (var i = 0; i < headerList.length; i++) {
      var key = normCol(headerList[i]);
      if (key && !(key in normToHeader)) {
        normToHeader[key] = headerList[i];
      }
    }

    var spec = aliasSpec || {};
    var canonicalKeys = Object.keys(spec);
    for (var k = 0; k < canonicalKeys.length; k++) {
      var canonical = canonicalKeys[k];
      var aliases = Array.isArray(spec[canonical]) ? spec[canonical] : [canonical];
      var matched = null;

      var normCanon = normCol(canonical);
      if (normCanon && (normCanon in normToHeader)) {
        matched = normToHeader[normCanon];
      } else {
        for (var a = 0; a < aliases.length; a++) {
          var normAlias = normCol(aliases[a]);
          if (normAlias && (normAlias in normToHeader)) {
            matched = normToHeader[normAlias];
            break;
          }
        }
      }
      result[canonical] = matched;
    }

    return result;
  }

  /**
   * Parse currency/numeric string into exact integer cents (no float drift).
   * Supports "$1,234.56" -> 123456, "(450.00)" -> -45000, "-$12.34" -> -1234.
   * Returns null if input is empty or non-numeric.
   * @param {string|number|null|undefined} raw
   * @returns {number|null}
   */
  function parseCents(raw) {
    if (raw === null || raw === undefined) {
      return null;
    }
    if (typeof raw === "number") {
      if (!isFinite(raw)) {
        return null;
      }
      return parseCents(raw.toFixed(2));
    }

    var s = String(raw).trim();
    if (!s) {
      return null;
    }

    var negative = false;
    if (s.charAt(0) === "(" && s.charAt(s.length - 1) === ")") {
      negative = true;
      s = s.slice(1, -1).trim();
    }

    s = s.replace(/[\$\u20AC\u00A3\u00A5,\s]/g, "");
    if (!s) {
      return null;
    }

    if (s.charAt(0) === "-") {
      negative = !negative;
      s = s.slice(1);
    } else if (s.charAt(0) === "+") {
      s = s.slice(1);
    }

    if (!s) {
      return null;
    }

    var match = /^(?:(\d+)(?:\.(\d*))?|\.(\d+))$/.exec(s);
    if (!match) {
      return null;
    }

    var wholeStr = match[1] || "0";
    var fracStr = match[2] !== undefined ? match[2] : (match[3] || "");

    var wholeDollars = parseInt(wholeStr, 10);
    var paddedFrac = (fracStr + "000").slice(0, 3);
    var centsPart = parseInt(paddedFrac.slice(0, 2), 10);
    var thirdDigit = parseInt(paddedFrac.charAt(2), 10);

    var totalCents = wholeDollars * 100 + centsPart;
    if (thirdDigit >= 5) {
      totalCents += 1;
    }

    if (totalCents === 0) {
      return 0;
    }
    return negative ? -totalCents : totalCents;
  }

  /**
   * Format integer cents into USD currency string.
   * @param {number} cents
   * @returns {string}
   */
  function formatCents(cents) {
    if (cents === null || cents === undefined || !isFinite(cents)) {
      return "$0.00";
    }
    var n = Math.round(Number(cents));
    var negative = n < 0;
    var abs = Math.abs(n);
    var dollars = Math.floor(abs / 100);
    var rem = abs % 100;
    var dollarStr = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var remStr = rem < 10 ? "0" + rem : String(rem);
    return (negative ? "-$" : "$") + dollarStr + "." + remStr;
  }

  /**
   * Scan CSV headers and rows for PII or secret patterns.
   * Blocks SSN, EIN, emails, phone numbers, and prohibited PII header columns.
   * @param {string[]} headers
   * @param {Object[]} rows
   * @param {string[]} [extraBannedHeaders]
   * @returns {{ blocked: boolean, findings: Object[] }}
   */
  function scanForPii(headers, rows, extraBannedHeaders) {
    var findings = [];
    var maxFindings = 50;
    var bannedSet = Object.create(null);

    for (var i = 0; i < DEFAULT_BANNED_HEADERS.length; i++) {
      bannedSet[normCol(DEFAULT_BANNED_HEADERS[i])] = true;
    }
    if (Array.isArray(extraBannedHeaders)) {
      for (var e = 0; e < extraBannedHeaders.length; e++) {
        var normExtra = normCol(extraBannedHeaders[e]);
        if (normExtra) {
          bannedSet[normExtra] = true;
        }
      }
    }

    var headerList = Array.isArray(headers) ? headers : [];
    for (var h = 0; h < headerList.length; h++) {
      var hdr = headerList[h];
      var normHdr = normCol(hdr);
      if (normHdr && bannedSet[normHdr]) {
        findings.push({
          type: "banned_header",
          header: hdr,
          row: 1,
          detail: "Prohibited PII or credential column header detected (" + hdr + ")."
        });
      }
    }

    var rowList = Array.isArray(rows) ? rows : [];
    for (var r = 0; r < rowList.length && findings.length < maxFindings; r++) {
      var row = rowList[r];
      var sourceRow = row && row.__sourceRow ? row.__sourceRow : (r + 2);
      for (var c = 0; c < headerList.length && findings.length < maxFindings; c++) {
        var colName = headerList[c];
        var val = row && row[colName] !== undefined && row[colName] !== null ? String(row[colName]) : "";
        if (!val) {
          continue;
        }
        if (SSN_RE.test(val)) {
          findings.push({
            type: "ssn",
            header: colName,
            row: sourceRow,
            detail: "SSN-like pattern detected in column '" + colName + "' at CSV row " + sourceRow + "."
          });
        } else if (EIN_RE.test(val)) {
          findings.push({
            type: "ein",
            header: colName,
            row: sourceRow,
            detail: "EIN-like pattern detected in column '" + colName + "' at CSV row " + sourceRow + "."
          });
        } else if (EMAIL_RE.test(val)) {
          findings.push({
            type: "email",
            header: colName,
            row: sourceRow,
            detail: "Email address detected in column '" + colName + "' at CSV row " + sourceRow + "."
          });
        } else if (PHONE_RE.test(val)) {
          findings.push({
            type: "phone",
            header: colName,
            row: sourceRow,
            detail: "Phone number detected in column '" + colName + "' at CSV row " + sourceRow + "."
          });
        }
      }
    }

    return {
      blocked: findings.length > 0,
      findings: findings
    };
  }

  /**
   * Deterministic synchronous 32-bit FNV-1a hex digest.
   * @param {string} str
   * @returns {string}
   */
  function fnv1aHex(str) {
    var input = str === null || str === undefined ? "" : String(str);
    var hash = 0x811c9dc5;
    for (var i = 0; i < input.length; i++) {
      var code = input.charCodeAt(i);
      if (code < 0x80) {
        hash ^= code;
        hash = Math.imul(hash, 0x01000193);
      } else if (code < 0x800) {
        hash ^= (0xc0 | (code >> 6));
        hash = Math.imul(hash, 0x01000193);
        hash ^= (0x80 | (code & 0x3f));
        hash = Math.imul(hash, 0x01000193);
      } else {
        hash ^= (0xe0 | (code >> 12));
        hash = Math.imul(hash, 0x01000193);
        hash ^= (0x80 | ((code >> 6) & 0x3f));
        hash = Math.imul(hash, 0x01000193);
        hash ^= (0x80 | (code & 0x3f));
        hash = Math.imul(hash, 0x01000193);
      }
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  return {
    DEFAULT_BANNED_HEADERS: DEFAULT_BANNED_HEADERS.slice(),
    parseCSV: parseCSV,
    normCol: normCol,
    buildColumnMap: buildColumnMap,
    parseCents: parseCents,
    formatCents: formatCents,
    scanForPii: scanForPii,
    fnv1aHex: fnv1aHex
  };
}));
