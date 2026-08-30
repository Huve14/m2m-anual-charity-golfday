import { createClient } from "@supabase/supabase-js";
import { isSameOrigin, requireAdmin, sendJson } from "./_admin-auth.js";
import { parseImportFile } from "./_host-import.js";
import { serviceKey, serviceRest, supabaseUrl } from "./_host-store.js";

function parseBody(req) {
  return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
}

function pathAllowed(path, adminId) {
  return (
    typeof path === "string" &&
    path.startsWith(`admin-${adminId}/`) &&
    !path.includes("..") &&
    path.length <= 260
  );
}

function query(parameters) {
  return new URLSearchParams(parameters).toString();
}

async function existingState() {
  const [companyResult, allocationResult] = await Promise.all([
    serviceRest(
      "host_companies",
      query({
        select: "id,company_reference,company_name,contact_email,host_accounts(login_email,auth_user_id,account_status),host_bookings(booking_allocations(allocation_type,status))",
        order: "created_at.asc",
      }),
    ),
    serviceRest(
      "booking_allocations",
      query({
        select: "id,hole_number,host_bookings(company_id,host_companies(company_name))",
        allocation_type: "eq.hole_sponsorship",
        status: "eq.active",
        hole_number: "not.is.null",
      }),
    ),
  ]);
  return {
    companies: Array.isArray(companyResult.payload) ? companyResult.payload : [],
    holes: Array.isArray(allocationResult.payload) ? allocationResult.payload : [],
  };
}

function classifyRows(parsedRows, state) {
  const referenceMap = new Map();
  const emailMap = new Map();
  const assignedHoles = new Map();
  const fileReferences = new Set();
  const fileEmails = new Set();
  const fileHoles = new Set();

  for (const company of state.companies) {
    if (company.company_reference) referenceMap.set(company.company_reference.toLowerCase(), company);
    emailMap.set(company.contact_email.toLowerCase(), company);
  }
  for (const allocation of state.holes) {
    assignedHoles.set(Number(allocation.hole_number), {
      allocationId: allocation.id,
      companyId: allocation.host_bookings?.company_id || null,
      companyName: allocation.host_bookings?.host_companies?.company_name || "Another company",
    });
  }

  return parsedRows.map((row) => {
    const errors = [...row.errors];
    const warnings = [];
    const reference = row.parsed.companyReference.toLowerCase();
    const email = row.parsed.contactEmail.toLowerCase();
    const referenceMatch = reference ? referenceMap.get(reference) : null;
    const emailMatch = emailMap.get(email) || null;
    let match = referenceMatch || emailMatch || null;
    let action = match ? "update" : "add";

    if (referenceMatch && emailMatch && referenceMatch.id !== emailMatch.id) {
      errors.push("Company reference and contact email match different existing companies.");
      action = "conflict";
      match = null;
    }
    if ((reference && fileReferences.has(reference)) || fileEmails.has(email)) {
      errors.push("This company reference or contact email is duplicated in the upload.");
      action = "duplicate";
    }
    if (reference) fileReferences.add(reference);
    fileEmails.add(email);

    const hole = row.parsed.holeNumber;
    if (hole !== null) {
      const existing = assignedHoles.get(hole);
      if ((existing && existing.companyId !== match?.id) || fileHoles.has(hole)) {
        errors.push(
          existing
            ? `Hole ${hole} is already assigned to ${existing.companyName}.`
            : `Hole ${hole} appears more than once in this upload.`,
        );
        action = "conflict";
      }
      fileHoles.add(hole);
    }
    if (match && match.company_name !== row.parsed.companyName) {
      warnings.push(`Existing company name will change from “${match.company_name}”.`);
    }
    if (match) {
      const account = Array.isArray(match.host_accounts)
        ? match.host_accounts[0]
        : match.host_accounts;
      if (
        account?.auth_user_id &&
        String(account.login_email || "").toLowerCase() !== email
      ) {
        errors.push(
          "Portal access has already been released. Change the login email from Host companies before importing this update.",
        );
        action = "conflict";
      }
      const currentAllocations = (match.host_bookings || []).flatMap((booking) => booking.booking_allocations || []);
      const currentFourballs = currentAllocations.filter((item) => item.allocation_type === "fourball" && item.status === "active").length;
      const hasSponsorship = currentAllocations.some((item) => item.allocation_type === "hole_sponsorship" && item.status === "active");
      if (row.parsed.fourballQuantity < currentFourballs) {
        errors.push(`This update would remove ${currentFourballs - row.parsed.fourballQuantity} existing fourball allocation(s). Make that change manually instead.`);
        action = "conflict";
      }
      if (hasSponsorship && row.parsed.sponsorshipType === "none") {
        errors.push("This update would remove an existing sponsorship. Make that change manually instead.");
        action = "conflict";
      }
    }
    if (errors.length && !["duplicate", "conflict"].includes(action)) action = "invalid";
    return {
      ...row,
      action,
      errors,
      warnings,
      matchedCompanyId: match?.id || null,
      isValid: errors.length === 0 && ["add", "update"].includes(action),
    };
  });
}

function summary(rows) {
  const count = (action) => rows.filter((row) => row.action === action).length;
  return {
    totalRows: rows.length,
    validRows: rows.filter((row) => row.isValid).length,
    invalidRows: rows.filter((row) => !row.isValid).length,
    additions: count("add"),
    updates: count("update"),
    duplicates: count("duplicate"),
    holeConflicts: count("conflict"),
  };
}

async function savePreview(file, rows, counts, admin) {
  const batchResult = await serviceRest(
    "host_import_batches",
    "select=id,file_name,status,created_at",
    {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify([
        {
          file_name: file.fileName,
          file_sha256: file.fileSha256,
          status: "previewed",
          uploaded_by_admin_id: admin.id,
          uploaded_by_admin_email: admin.email,
          total_rows: counts.totalRows,
          valid_rows: counts.validRows,
          invalid_rows: counts.invalidRows,
          additions: counts.additions,
          updates: counts.updates,
          duplicates: counts.duplicates,
          hole_conflicts: counts.holeConflicts,
        },
      ]),
    },
  );
  const batch = batchResult.payload?.[0];
  if (!batch?.id) throw new Error("import_batch_not_created");
  await serviceRest("host_import_rows", "", {
    method: "POST",
    prefer: "return=minimal",
    body: JSON.stringify(
      rows.map((row) => ({
        batch_id: batch.id,
        row_number: row.rowNumber,
        action: row.action,
        is_valid: row.isValid,
        raw_data: row.raw,
        parsed_data: row.parsed,
        errors: row.errors,
        warnings: row.warnings,
        matched_company_id: row.matchedCompanyId,
      })),
    ),
  });
  return batch;
}

function friendlyError(error) {
  const messages = {
    unsupported_import_file: "Choose an .xlsx or .csv file.",
    import_file_size: "The import must be between 1 byte and 5 MB.",
    empty_import_file: "The spreadsheet has no host-company rows.",
    too_many_import_rows: "The spreadsheet can contain no more than 500 host-company rows.",
    spreadsheet_formula_not_allowed: "Formula-containing spreadsheets are not accepted. Paste values only and upload again.",
    spreadsheet_macro_not_allowed: "Macros and external workbook links are not accepted.",
    invalid_xlsx: "This .xlsx file could not be read safely.",
    missing_required_headers: `Required columns are missing: ${(error.missingHeaders || []).join(", ")}.`,
  };
  return messages[error?.message] || "The spreadsheet could not be previewed right now.";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!isSameOrigin(req)) {
    sendJson(res, 403, { ok: false, message: "Request not allowed." });
    return;
  }

  const body = parseBody(req);
  const path = body?.path;
  const fileName = String(body?.fileName || "").trim();
  if (!pathAllowed(path, admin.id) || !fileName) {
    sendJson(res, 400, { ok: false, message: "A valid secure upload is required." });
    return;
  }

  const client = createClient(supabaseUrl(), serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { data, error } = await client.storage.from("host-import-staging").download(path);
    if (error || !data) throw error || new Error("import_download_failed");
    const buffer = Buffer.from(await data.arrayBuffer());
    const file = await parseImportFile(fileName, buffer);
    const state = await existingState();
    const rows = classifyRows(file.rows, state);
    const counts = summary(rows);
    const batch = await savePreview(file, rows, counts, admin);
    sendJson(res, 200, {
      ok: true,
      batch: { id: batch.id, fileName: file.fileName, createdAt: batch.created_at },
      summary: counts,
      canCommit: counts.invalidRows === 0 && counts.validRows > 0,
      rows: rows.map((row) => ({
        rowNumber: row.rowNumber,
        action: row.action,
        isValid: row.isValid,
        companyName: row.parsed.companyName,
        contactEmail: row.parsed.contactEmail,
        fourballQuantity: row.parsed.fourballQuantity,
        sponsorshipType: row.parsed.sponsorshipType,
        holeNumber: row.parsed.holeNumber,
        errors: row.errors,
        warnings: row.warnings,
      })),
    });
  } catch (error) {
    console.error("[M2M Invitational] import preview failed", {
      admin: admin.email,
      code: error?.code || error?.message || "import_preview_failed",
    });
    sendJson(res, error?.message?.startsWith("spreadsheet_") || error?.missingHeaders ? 400 : 503, {
      ok: false,
      message: friendlyError(error),
    });
  } finally {
    await client.storage.from("host-import-staging").remove([path]).catch(() => {});
  }
}

export const config = { maxDuration: 45 };
