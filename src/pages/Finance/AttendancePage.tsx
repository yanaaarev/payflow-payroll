// src/pages/AttendancePage.tsx
// Attendance → Payroll Draft wiring:
// - Publish writes an attendance snapshot (legacy compatibility) AND creates a payrollDrafts/{draftId}
// - Draft contains metadata + per-employee "lines" subcollection with approved OT/OB/Leave merged
// - You can open /payroll-drafts page later to finalize & request approvals

import { useRef, useState, useEffect } from "react";

import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  doc,
  orderBy,
  setDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

type AttendanceRecord = {
  id: string; // key: normalizedName + date
  name: string; // shown as-is
  date: string; // MM/DD/YYYY
  timeIn: Date | null;
  timeOut: Date | null;
  hoursWorked: number;
  daysWorked: number;
};

type EditState = {
  id: string;
  timeInHHMM: string;
  timeOutHHMM: string;
};

type Punch = { name: string; dateOnly: string; dt: Date };

type CutoffOption = {
  label: string;
  start: Date;
  end: Date;
};

declare global {
  interface Window {
    payrollGenerator?: { ingest: (payload: any) => Promise<void> | void };
  }
}

const db = getFirestore();
const auth = getAuth();

const AttendancePage = () => {
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [editing, setEditing] = useState<EditState | null>(null);
  const [allPunches, setAllPunches] = useState<Punch[]>([]);
  const [cutoffOptions, setCutoffOptions] = useState<CutoffOption[]>([]);
  const [selectedCutoffIdx, setSelectedCutoffIdx] = useState<number>(-1);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Default shift (kept for UI text)
  const workHours = { in: "07:00", out: "17:30" };
  const breakMinutes = 30;

// ───────── intern aliases / role helpers ─────────
  const INTERN_ALIASES = new Set([
    "bianca",
    "biancamae",
    "daniel",
    "daniella",
    "daryl",
    "jane",
    "janec",
    "kenneth",
    "sophia",
    "mara",
    "rhen",
    "raiven",
  ]);
  const isIntern = (nameOrAlias: string) =>
    INTERN_ALIASES.has(nameOrAlias.trim().toLowerCase());
  const sameDay = (d: Date, hh: number, mm: number) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0);
  const minutesOverlap = (
    aStart: Date,
    aEnd: Date,
    bStart: Date,
    bEnd: Date
  ) => {
    const start = Math.max(aStart.getTime(), bStart.getTime());
    const end = Math.min(aEnd.getTime(), bEnd.getTime());
    return Math.max(0, Math.floor((end - start) / 60000));
  };

  // ───────── helpers tuned to biometric export ─────────
  const pad2 = (n: number) => n.toString().padStart(2, "0");
  const monthName = (m: number) =>
    [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ][m];

  function parseDateOnly_MMDDYYYY(
    s: string
  ): { y: number; m: number; d: number } | null {
    const m = s.trim().match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;
    const mm = parseInt(m[1], 10),
      dd = parseInt(m[2], 10),
      yyyy = parseInt(m[3], 10);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return { y: yyyy, m: mm, d: dd };
  }

  function parseTime_HHMM_SS_AMPM(
    s: string
  ): { h: number; min: number; sec: number } | null {
    const str = s.trim();
    // 12h with AM/PM
    let m = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
    if (m) {
      let h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      const sec = m[3] ? parseInt(m[3], 10) : 0;
      const mod = m[4].toUpperCase();
      if (mod === "PM" && h !== 12) h += 12;
      if (mod === "AM" && h === 12) h = 0;
      if (h >= 0 && h < 24 && min >= 0 && min < 60 && sec >= 0 && sec < 60)
        return { h, min, sec };
      return null;
    }
    // 24h (seconds optional)
    m = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
      const h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      const sec = m[3] ? parseInt(m[3], 10) : 0;
      if (h >= 0 && h < 24 && min >= 0 && min < 60 && sec >= 0 && sec < 60)
        return { h, min, sec };
    }
    return null;
  }

  function useMyRoles() {
    const [roles, setRoles] = useState<string[] | null>(null);
    useEffect(() => {
      const auth = getAuth();
      const unsub = auth.onIdTokenChanged(async (u) => {
        if (!u) return setRoles([]);
        const token = await u.getIdTokenResult(true);
        setRoles(((token.claims.roles as string[]) || []).map(String));
      });
      return unsub;
    }, []);
    return roles; // e.g. ['admin','finance']
  }

  const roles = useMyRoles();
  const canPublish = !!roles?.some(
    (r) => r === "admin" || r === "finance"
  );

  // Prefer time embedded in the Date cell; fall back to Time cell only if it looks like a real time
  function makeLocalDateFromCells(
    dateCell: string,
    timeCell?: string
  ): Date | null {
    const dateRaw = (dateCell || "").trim();
    const timeRaw = (timeCell || "").trim();

    // Case A: combined "MM/DD/YYYY     HH:MM[:SS] [AM/PM]"
    const combo = dateRaw.match(
      /(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM))?)/i
    );
    if (combo) {
      const d = parseDateOnly_MMDDYYYY(combo[1]);
      const t = parseTime_HHMM_SS_AMPM(combo[2]);
      if (d && t) return new Date(d.y, d.m - 1, d.d, t.h, t.min, t.sec, 0);
    }

    // Case B: separate cells, use time cell only if valid
    const dOnly = parseDateOnly_MMDDYYYY(dateRaw);
    const tOnly = parseTime_HHMM_SS_AMPM(timeRaw);
    if (dOnly && tOnly)
      return new Date(
        dOnly.y,
        dOnly.m - 1,
        dOnly.d,
        tOnly.h,
        tOnly.min,
        tOnly.sec,
        0
      );

    // Case C: date only
    if (dOnly) return new Date(dOnly.y, dOnly.m - 1, dOnly.d, 0, 0, 0, 0);

    return null;
  }

  function toHHMM(d: Date | null) {
    if (!d || isNaN(d.getTime())) return "";
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function toHumanTime(d: Date | null) {
    if (!d || isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  // ───────── NEW: role-aware clipping + hour computation ─────────
  function clipToShiftByRole(name: string, timeIn: Date | null, timeOut: Date | null, fixedOut?: string) {
  if (!timeIn || !timeOut) return { start: null, end: null };

  const shiftStart = sameDay(timeIn, 7, 0);

  let shiftEnd = sameDay(timeIn, 17, 30); // default
  if (fixedOut) {
    const [hh, mm] = fixedOut.split(":").map(Number);
    shiftEnd = sameDay(timeIn, hh, mm);
  } else if (isIntern(name)) {
    shiftEnd = sameDay(timeIn, 16, 0); // fallback for interns
  }

  const start = timeIn > shiftStart ? timeIn : shiftStart;
  const end = timeOut < shiftEnd ? timeOut : shiftEnd;
  if (end <= start) return { start: null, end: null };
  return { start, end };
}


  // Effective hours within shift:
  // - Deduct ONLY lunch 12:00–13:00 overlap
  // - Morning 8:45–9:00 and afternoon 15:00–15:15 are paid (no deduction)
  // - Cap at 8 hours (OT not counted)
  function computeHoursWorked(name: string, timeIn: Date | null, timeOut: Date | null): number {
    const { start, end } = clipToShiftByRole(name, timeIn, timeOut);
    if (!start || !end) return 0;

    let minutes = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));

    // Deduct lunch overlap on that same day
    const lunchStart = sameDay(start, 12, 0);
    const lunchEnd   = sameDay(start, 13, 0);
    minutes -= minutesOverlap(start, end, lunchStart, lunchEnd);

    // Cap at 8 hours
    minutes = Math.min(minutes, 8 * 60);

    return parseFloat((minutes / 60).toFixed(3));
  }

    // ───────── NEW: compute tardiness (no grace period) ─────────
  function computeTardinessMinutes(timeIn: Date | null): number {
    if (!timeIn) return 0;
    const shiftStart = sameDay(timeIn, 7, 0); // 07:00 sharp
    if (timeIn <= shiftStart) return 0;
    return Math.max(0, Math.floor((timeIn.getTime() - shiftStart.getTime()) / 60000));
  }


  function detectDelimiter(text: string): "," | "\t" {
    const head = text.split(/\r?\n/)[0] ?? "";
    const tabs = (head.match(/\t/g) || []).length;
    const commas = (head.match(/,/g) || []).length;
    return tabs > commas ? "\t" : ",";
  }

  // ── build selectable cutoff options from the file content ──
  function monthAdd(d: Date, delta: number) {
    return new Date(d.getFullYear(), d.getMonth() + delta, 1);
  }

  function buildCutoffOptionsFromPunches(punches: Punch[]): CutoffOption[] {
    if (!punches.length) return [];
    const ymSet = new Set<string>();
    punches.forEach((p) => {
      ymSet.add(`${p.dt.getFullYear()}-${p.dt.getMonth()}`);
      ymSet.add(`${monthAdd(p.dt, -1).getFullYear()}-${monthAdd(p.dt, -1).getMonth()}`);
      ymSet.add(`${monthAdd(p.dt, 1).getFullYear()}-${monthAdd(p.dt, 1).getMonth()}`);
    });

    const opts: CutoffOption[] = [];
    for (const ym of ymSet) {
      const [yStr, mStr] = ym.split("-");
      const y = parseInt(yStr, 10);
      const m = parseInt(mStr, 10);

      const startA = new Date(y, m, 11);
      const endA = new Date(y, m, 25);
      const labelA = `${monthName(m)} 11–25, ${y}`;
      opts.push({ label: labelA, start: startA, end: endA });

      const next = monthAdd(new Date(y, m, 1), 1);
      const startB = new Date(y, m, 26);
      const endB = new Date(next.getFullYear(), next.getMonth(), 10);
      const labelB = `${monthName(m)} 26–${monthName(endB.getMonth())} 10, ${endB.getFullYear()}`;
      opts.push({ label: labelB, start: startB, end: endB });
    }

    const dedup = new Map<string, CutoffOption>();
    opts.forEach((o) => dedup.set(o.label, o));
    const list = Array.from(dedup.values()).sort((a, b) => a.start.getTime() - b.start.getTime());
    return list;
  }

  // ───────── parsing (no processing yet) ─────────
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError("");
    setSuccess("");
    setAttendance([]);
    setAllPunches([]);
    setCutoffOptions([]);
    setSelectedCutoffIdx(-1);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result;
        if (typeof text !== "string") throw new Error("Invalid file content.");

        const delim = detectDelimiter(text);
        const lines = text.split(/\r?\n/).filter((r) => r.trim().length > 0);
        if (lines.length < 2) throw new Error("File is empty or invalid.");

        const headers = lines[0].split(delim).map((h) => h.trim().toLowerCase());
        const idxName = headers.findIndex((h) =>
          ["name", "employee name", "fullname", "employee"].includes(h)
        );
        const idxDate = headers.findIndex((h) =>
          ["date", "date only"].includes(h)
        );
        const idxTime = headers.findIndex((h) =>
          ["time", "timestamp", "punch time", "datetime", "date/time", "date time"].includes(h)
        );
        const idxDept = headers.findIndex((h) => h === "department");
        const idxId = headers.findIndex((h) => h === "id");
        const idxDev = headers.findIndex((h) => h === "device id");

        // Allow files that have either a Date column OR a DateTime/Time column
        if (idxName === -1 || (idxDate === -1 && idxTime === -1)) {
          throw new Error("Missing required columns: Name + (Date OR Date/Time).");
        }

        const punches: Punch[] = [];

        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(delim);

          const needMax = Math.max(idxName, Math.max(idxDate, idxTime));
          if (cols.length <= needMax) continue;

          const rawName = (cols[idxName] || "").trim();
          const rawDateCell =
            idxDate !== -1 && idxDate < cols.length ? (cols[idxDate] || "").trim() : "";
          const rawTimeCell =
            idxTime !== -1 && idxTime < cols.length ? (cols[idxTime] || "").trim() : "";

          // Skip repeats/junk like mid-file headers or ID/Department/Device ID echoes
          const looksLikeHeader =
            !rawName ||
            rawName.toLowerCase() === "name" ||
            rawDateCell.toLowerCase() === "date" ||
            rawTimeCell.toLowerCase() === "time" ||
            (idxDept !== -1 &&
              idxDept < cols.length &&
              (cols[idxDept] || "").trim().toLowerCase() === "department") ||
            (idxId !== -1 &&
              idxId < cols.length &&
              (cols[idxId] || "").trim().toLowerCase() === "id") ||
            (idxDev !== -1 &&
              idxDev < cols.length &&
              (cols[idxDev] || "").trim().toLowerCase() === "device id");
          if (looksLikeHeader) continue;

          // If there's no Date column, rely on the Time/DateTime column alone
          const dateCellForParsing =
            idxDate !== -1 ? rawDateCell : rawTimeCell;
          const timeCellForParsing =
            idxDate !== -1 ? rawTimeCell : "";

          const dt = makeLocalDateFromCells(
            dateCellForParsing,
            timeCellForParsing
          );
          if (!dt) continue;

          const dateOnly =
            dateCellForParsing.match(/(\d{1,2}\/\d{1,2}\/\d{4})/)?.[1] ||
            `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()}`;

          punches.push({ name: rawName.trim(), dateOnly, dt });
        }

        setAllPunches(punches);

        const options = buildCutoffOptionsFromPunches(punches);
        setCutoffOptions(options);

        // Auto-select the most recent window that contains data
        let autoIdx = -1;
        for (let i = options.length - 1; i >= 0; i--) {
          const { start, end } = options[i];
          if (punches.some((p) => p.dt >= start && p.dt <= end)) {
            autoIdx = i;
            break;
          }
        }
        setSelectedCutoffIdx(autoIdx);

        setSuccess(
          `✅ File read. Choose a cutoff window then click Process. Found ${punches.length} punches total.`
        );
      } catch (err: any) {
        setError("Upload failed: " + (err?.message || "Unknown error."));
      } finally {
        setLoading(false);
      }
    };
    reader.onerror = () => {
      setError("Failed to read file. Please try again.");
      setLoading(false);
    };
    reader.readAsText(file);
  };

  // ───────── PROCESS (apply selected cutoff + IN/OUT rules) ─────────
  function processWithSelectedCutoff() {
  try {
    setError("");
    setSuccess("");
    setAttendance([]);

    if (selectedCutoffIdx < 0 || selectedCutoffIdx >= cutoffOptions.length) {
      throw new Error("Please select a cutoff window first.");
    }
    const { start, end, label } = cutoffOptions[selectedCutoffIdx];
    const inclusiveEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
    const inWindow = allPunches.filter((p) => p.dt >= start && p.dt <= inclusiveEnd);

    // Group by name + date
    type Acc = { id: string; name: string; dateOnly: string; times: Date[] };
    const grouped = new Map<string, Acc>();
    for (const p of inWindow) {
      const key = `${p.name.toLowerCase()}__${p.dateOnly}`;
      if (!grouped.has(key)) {
        grouped.set(key, { id: key, name: p.name, dateOnly: p.dateOnly, times: [p.dt] });
      } else {
        grouped.get(key)!.times.push(p.dt);
      }
    }

    const IN_START = 6 * 60;
    const IN_END = 13 * 60 + 59;
    const OUT_START = 16 * 60;

    const isInWindow = (d: Date) => {
      const m = d.getHours() * 60 + d.getMinutes();
      return m >= IN_START && m <= IN_END;
    };
    const isOutWindow = (d: Date) => {
      const m = d.getHours() * 60 + d.getMinutes();
      return m >= OUT_START;
    };

    const records: AttendanceRecord[] = [];
    for (const acc of grouped.values()) {
      const times = acc.times.sort((a, b) => a.getTime() - b.getTime());
      const inCandidates = times.filter(isInWindow);
      const outCandidates = times.filter(isOutWindow);

      const timeIn = inCandidates.length ? inCandidates[0] : null;
      const timeOut = outCandidates.length ? outCandidates[outCandidates.length - 1] : null;

      let hoursWorked = computeHoursWorked(acc.name, timeIn, timeOut);

      // Half-day rule for single punch
      if ((timeIn && !timeOut) || (!timeIn && timeOut)) {
        hoursWorked = 4.0;
      }

      // --- Compute days ---
      let daysWorked = hoursWorked / 8;

      // Snap to 0 / 0.5 / 1 / 1.5 ...
      if (daysWorked >= 0.75 && daysWorked < 1.25) daysWorked = 1;
      else if (daysWorked >= 0.25 && daysWorked < 0.75) daysWorked = 0.5;
      else if (daysWorked < 0.25) daysWorked = 0;
      else daysWorked = Math.round(daysWorked * 2) / 2;

      // --- INTERN RULE ---
      if (isIntern(acc.name) && timeOut) {
        if (timeOut.getHours() > 16 || (timeOut.getHours() === 16 && timeOut.getMinutes() >= 0)) {
          daysWorked = 1;
        }
      }

      daysWorked = Math.round(daysWorked * 1000) / 1000;

      records.push({
        id: acc.id,
        name: acc.name,
        date: acc.dateOnly,
        timeIn,
        timeOut,
        hoursWorked,
        daysWorked,
      });
    }

    records.sort((a, b) => {
      const ad = new Date(a.date).getTime();
      const bd = new Date(b.date).getTime();
      if (ad !== bd) return ad - bd;
      return a.name.localeCompare(b.name);
    });

    setAttendance(records);
    setSuccess(
      `✅ Processed ${records.length} record${records.length === 1 ? "" : "s"} for cutoff ${label} (${start.toLocaleDateString()}–${end.toLocaleDateString()}).`
    );
  } catch (err: any) {
    setError("Process failed: " + (err?.message || "Unknown error."));
  }
}


  // ───────── editing ─────────
  const startEdit = (r: AttendanceRecord) => {
    setEditing({
      id: r.id,
      timeInHHMM: toHHMM(r.timeIn),
      timeOutHHMM: toHHMM(r.timeOut),
    });
  };

  const saveEdit = () => {
  if (!editing) return;
  setAttendance((prev) =>
    prev.map((r) => {
      if (r.id !== editing.id) return r;

      const newIn = editing.timeInHHMM ? makeLocalDateFromCells(r.date, editing.timeInHHMM) : null;
      const newOut = editing.timeOutHHMM ? makeLocalDateFromCells(r.date, editing.timeOutHHMM) : null;

      const IN_START = 6 * 60, IN_END = 13 * 60 + 59, OUT_START = 16 * 60;
      const inOK = newIn ? newIn.getHours() * 60 + newIn.getMinutes() >= IN_START &&
        newIn.getHours() * 60 + newIn.getMinutes() <= IN_END : false;
      const outOK = newOut ? newOut.getHours() * 60 + newOut.getMinutes() >= OUT_START : false;

      const finalIn = inOK ? newIn : null;
      const finalOut = outOK ? newOut : null;

      let hoursWorked = computeHoursWorked(r.name, finalIn, finalOut);

      if ((finalIn && !finalOut) || (!finalIn && finalOut)) {
        hoursWorked = 4.0;
      }

      let daysWorked = hoursWorked / 8;
      if (daysWorked >= 0.75 && daysWorked < 1.25) daysWorked = 1;
      else if (daysWorked >= 0.25 && daysWorked < 0.75) daysWorked = 0.5;
      else if (daysWorked < 0.25) daysWorked = 0;
      else daysWorked = Math.round(daysWorked * 2) / 2;

      // --- INTERN RULE ---
      if (isIntern(r.name) && finalOut) {
        if (finalOut.getHours() > 16 || (finalOut.getHours() === 16 && finalOut.getMinutes() >= 0)) {
          daysWorked = 1;
        }
      }

      daysWorked = Math.round(daysWorked * 1000) / 1000;

      return { ...r, timeIn: finalIn, timeOut: finalOut, hoursWorked, daysWorked };
    })
  );
  setEditing(null);
};

  const cancelEdit = () => setEditing(null);

  // ───────── data fetcher for approved adjustments (OT/OB/LEAVES) ─────────
  async function fetchApprovedAdjustments(employeeName: string, start: Date, end: Date) {
    const requestsRef = collection(db, "requests");
    const startISO = start.toISOString();
    const endISO = new Date(end.getTime() + 24 * 60 * 60 * 1000 - 1).toISOString();

    const parse = (snap: any) => {
      const OT: any[] = [], OB: any[] = [], LEAVES: any[] = [];
      snap.forEach((d: any) => {
        const r: any = d.data();
        if (r.employeeName !== employeeName || r.status !== "approved") return;
        if (r.type === "OT") {
          OT.push({
            date: r.dateISO,
            hours: r.hours || 0,
            rate: r.rate || 1.0,
            approvedBy: r.approvedBy || null,
            approvedAt: r.approvedAt || null,
          });
        } else if (r.type === "OB") {
          OB.push({
            date: r.dateISO,
            hours: r.hours || 0,
            note: r.note || "",
            approvedBy: r.approvedBy || null,
            approvedAt: r.approvedAt || null,
          });
        } else if (r.type === "LEAVE") {
          LEAVES.push({
            date: r.dateISO,
            type: r.leaveType || "Leave",
            hoursOrDays: r.hours ?? r.days ?? 1,
            approvedBy: r.approvedBy || null,
            approvedAt: r.approvedAt || null,
          });
        }
      });
      return { OT, OB, LEAVES };
    };

    try {
      const qPrimary = query(
        requestsRef,
        where("employeeName", "==", employeeName),
        where("status", "==", "approved"),
        where("dateISO", ">=", startISO),
        where("dateISO", "<=", endISO),
        orderBy("dateISO", "asc")
      );
      const snap = await getDocs(qPrimary);
      return parse(snap);
    } catch (e: any) {
      if (e.code === "failed-precondition") {
        const qFallback = query(
          requestsRef,
          where("dateISO", ">=", startISO),
          where("dateISO", "<=", endISO),
          orderBy("dateISO", "asc")
        );
        const snap = await getDocs(qFallback);
        return parse(snap);
      }
      throw e;
    }
  }

  // ───────── alias → employee resolution (case-insensitive, trim) ─────────
  async function findEmployeeByAlias(aliasRaw: string) {
    const aliasLower = aliasRaw.trim().toLowerCase();
    try {
      const ref = collection(db, "employees");

      // Search aliases[] (case-insensitive)
      const q1 = query(ref, where("aliases", "array-contains", aliasLower));
      const s1 = await getDocs(q1);
      if (!s1.empty) {
        const d = s1.docs[0];
        return { id: d.id, ...(d.data() as any) };
      }

      // Search alias field
      const q2 = query(ref, where("alias", "==", aliasLower));
      const s2 = await getDocs(q2);
      if (!s2.empty) {
        const d = s2.docs[0];
        return { id: d.id, ...(d.data() as any) };
      }

      // Fallback: brute-force scan and normalize
      const all = await getDocs(ref);
      for (const d of all.docs) {
        const data = d.data() as any;
        const normalizedAlias = (data.alias || "")
          .toString()
          .trim()
          .toLowerCase();
        const normalizedAliases = (data.aliases || []).map((a: string) =>
          a.toString().trim().toLowerCase()
        );
        if (
          normalizedAlias === aliasLower ||
          normalizedAliases.includes(aliasLower)
        ) {
          return { id: d.id, ...data };
        }
      }
    } catch (err) {
      console.error("findEmployeeByAlias error", err);
    }
    return null;
  }

  async function resolveIdentity(displayName: string) {
    const aliasLower = displayName.trim().toLowerCase();
    const emp = await findEmployeeByAlias(aliasLower);
    if (emp) {
      return {
        employeeId: emp.id,
        canonicalName: emp.name || emp.fullName || displayName,
        email: emp.email || null,
      };
    }
    return { employeeId: aliasLower, canonicalName: displayName, email: null };
  }

  // ───────── actions: Publish (attendance + payroll draft) & Delete ─────────
  async function handlePublish() {
    try {
      setError("");
      setSuccess("");

      if (!attendance.length) throw new Error("No records to publish. Process a cutoff first.");
      if (selectedCutoffIdx < 0 || selectedCutoffIdx >= cutoffOptions.length) {
        throw new Error("Please select a cutoff window first.");
      }
      setPublishing(true);

      const me = auth.currentUser;
      if (!me) throw new Error("You must be signed in to publish.");
      await me.getIdToken(true); // ensure latest custom-claims (admin/finance)

      const selected = cutoffOptions[selectedCutoffIdx];
      const cutoffLabel = selected.label;
      const cutoffStart = new Date(
        selected.start.getFullYear(), selected.start.getMonth(), selected.start.getDate(), 0, 0, 0, 0
      ).toISOString();
      const cutoffEnd = new Date(
        selected.end.getFullYear(), selected.end.getMonth(), selected.end.getDate(), 23, 59, 59, 999
      ).toISOString();
      const periodKey = `${cutoffStart.slice(0,10)}_to_${cutoffEnd.slice(0,10)}`;

      const items = attendance.map((r) => ({
        id: r.id,
        name: r.name,
        date: r.date, // MM/DD/YYYY
        timeIn:  r.timeIn  ? r.timeIn.toISOString()  : null,
        timeOut: r.timeOut ? r.timeOut.toISOString() : null,
        hoursWorked: r.hoursWorked,
        daysWorked: r.daysWorked,
      }));

      // 1) CREATE attendance snapshot
      const attendanceRef = await addDoc(collection(db, "attendance"), {
        cutoffLabel,
        cutoffStart,
        cutoffEnd,
        periodKey,
        generatedAt: serverTimestamp(),
        generatedBy: me.email ?? me.uid ?? "unknown",
        count: items.length,
        items
      });

      function computeWorkingDays(start: Date, end: Date): number {
      let days = 0;
      const cur = new Date(start);
      while (cur <= end) {
        const day = cur.getDay(); // 0 = Sun, 6 = Sat
        if (day !== 0 && day !== 6) days++; // exclude weekends
        cur.setDate(cur.getDate() + 1);
      }
      return days;
    }

    const cutoffStartDate = new Date(selected.start.getFullYear(), selected.start.getMonth(), selected.start.getDate());
    const cutoffEndDate = new Date(selected.end.getFullYear(), selected.end.getMonth(), selected.end.getDate(), 23, 59, 59, 999);
    const workedDaysInCutoff = computeWorkingDays(cutoffStartDate, cutoffEndDate);


      // 2) CREATE payroll draft HEAD
      const draftRef = await addDoc(collection(db, "payrollDrafts"), {
        status: "draft",
        periodKey,
        cutoffLabel,
        cutoffStart,
        cutoffEnd,
        attendanceRef,
        createdAt: serverTimestamp(),
        createdBy: { uid: me.uid, name: me.displayName || me.email || "user" },
        requiredExecApprovals: 2,
        workedDays: workedDaysInCutoff,
      });

      // 2a) CREATE lines
      const start = selected.start;
      const end = selected.end;

      const byEmp = new Map<string, AttendanceRecord[]>();
      for (const row of attendance) {
        if (!byEmp.has(row.name)) byEmp.set(row.name, []);
        byEmp.get(row.name)!.push(row);
      }

      for (const [employeeName, rows] of byEmp.entries()) {
        const approved = await fetchApprovedAdjustments(employeeName, start, end);
        const timeInOut = rows.map((r) => ({
          date: r.date,
          in: r.timeIn ? r.timeIn.toISOString() : null,
          out: r.timeOut ? r.timeOut.toISOString() : null,
        }));
                const daysWorked = rows.reduce((s, r) => s + r.daysWorked, 0);
        const hoursWorked = rows.reduce((s, r) => s + r.hoursWorked, 0);

        // NEW: aggregate tardiness minutes
        const tardinessMinutes = rows.reduce((s, r) => s + computeTardinessMinutes(r.timeIn), 0);


        // Resolve alias to canonical employee
        const resolved = await resolveIdentity(employeeName);

        await setDoc(
          doc(collection(db, "payrollDrafts", draftRef.id, "lines"), resolved.employeeId),
          {
            employeeId: resolved.employeeId,
            name: resolved.canonicalName,
            email: resolved.email || null,
            periodKey,
            daysWorked,
            hoursWorked,
            tardinessMinutes,
            timeInOut,
            adjustments: {
              OT: approved.OT,
              OB: approved.OB,
              LEAVES: approved.LEAVES,
            },
            updatedAt: serverTimestamp(),
          }
        );
      }

      setSuccess("✅ Attendance saved and Payroll Draft created. Finance may finalize then request approvals.");
    } catch (err: any) {
      setError("Publish failed: " + (err?.message || "Unknown error."));
    } finally {
      setPublishing(false);
    }
  }

  function handleDeleteAll() {
    if (!attendance.length && !allPunches.length) return;
    if (!window.confirm("Clear everything (punches + processed records)?")) return;
    setAttendance([]);
    setEditing(null);
    setSuccess("");
    setError("");
    setAllPunches([]);
    setCutoffOptions([]);
    setSelectedCutoffIdx(-1);
    if (fileRef.current) fileRef.current.value = "";
  }

  // ───────── UI helper ─────────
  const Badge = ({ text, tone }: { text: string; tone: "in" | "out" }) => (
    <span
      className={
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium " +
        (tone === "in"
          ? "bg-amber-500/20 text-amber-200 ring-1 ring-inset ring-amber-500/30"
          : "bg-rose-500/20 text-rose-200 ring-1 ring-inset ring-rose-500/30")
      }
    >
      {text}
    </span>
  );

  return (
    <div className="min-h-screen w-full bg-gray-500 rounded-2xl text-white pt-20 px-4 sm:px-6 lg:px-8 pb-8">
      <div className="max-w-7xl mx-auto">
        {/* Header + Actions */}
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Attendance Management</h1>
            <p className="text-gray-300 mt-1">
              Upload biometric data and manage work hours.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!attendance.length || loading || publishing || !canPublish}
              onClick={handlePublish}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                attendance.length && !publishing && canPublish
                  ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                  : "bg-emerald-900/40 text-emerald-200/50 cursor-not-allowed"
              }`}
              title={
                !canPublish
                  ? "You don't have permission to publish"
                  : attendance.length
                  ? "Create Payroll Draft from this cutoff"
                  : "Process records first"
              }
            >
              {publishing ? "Publishing…" : "Publish"}
            </button>
            <button
              type="button"
              disabled={loading || publishing}
              onClick={handleDeleteAll}
              className="px-4 py-2 rounded-lg text-sm font-medium transition bg-rose-600 hover:bg-rose-500 text-white"
              title="Clear punches and processed records"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Upload */}
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-white/10 p-6 mb-4">
          <h2 className="text-xl font-semibold mb-4">Upload Biometric CSV/TXT/TSV</h2>
          <p className="text-gray-300 mb-4 text-sm">
            We’ll compute hours within shift only ({workHours.in}–{workHours.out}). Lunch ({breakMinutes} min) auto-deducted. OT is excluded here.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.tsv"
            onChange={handleFileUpload}
            className="block w-full text-sm text-gray-300
              file:mr-4 file:py-2 file:px-4
              file:rounded-full file:border-0
              file:text-sm file:font-medium
              file:bg-blue-600 file:text-white
              hover:file:bg-blue-700"
          />
          {loading && (
            <div className="mt-4 flex items-center text-blue-400">
              <svg className="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
              </svg>
              Reading file…
            </div>
          )}
        </div>

        {/* Cutoff selector (appears after file is read) */}
        {allPunches.length > 0 && (
          <div className="bg-gray-800/40 rounded-xl border border-white/10 p-6 mb-6">
            <div className="flex flex-col md:flex-row md:items-end gap-3">
              <div className="flex-1">
                <label className="block text-sm text-gray-300 mb-1">Cutoff window</label>
                <select
                  value={selectedCutoffIdx}
                  onChange={(e) => setSelectedCutoffIdx(parseInt(e.target.value, 10))}
                  className="w-full bg-gray-700 text-white border border-white/20 rounded-lg px-3 py-2 text-sm"
                >
                  <option value={-1} disabled className="bg-gray-700 text-gray-300">
                    Select a cutoff (e.g., Aug 11–25)
                  </option>
                  {cutoffOptions.map((opt, i) => (
                    <option
                      key={opt.label + i}
                      value={i}
                      className="bg-gray-700 text-white"
                    >
                      {opt.label} ({opt.start.toLocaleDateString()} – {opt.end.toLocaleDateString()})
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                disabled={selectedCutoffIdx === -1}
                onClick={processWithSelectedCutoff}
                className={`px-4 py-2 rounded-lg text-sm font-medium self-start md:self-auto ${
                  selectedCutoffIdx !== -1
                    ? "bg-blue-600 hover:bg-blue-500 text-white"
                    : "bg-blue-900/40 text-blue-200/50 cursor-not-allowed"
                }`}
              >
                Process
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Hint: If you need exactly “Aug 11 to 25 only”, pick the option like <em>Aug 11–25, 2025</em>, then click
              Process.
            </p>
          </div>
        )}

        {/* Messages */}
        {error && <div className="mb-6 p-4 bg-red-500/20 border border-red-500/30 text-red-200 rounded-xl">{error}</div>}
        {!error && success && (
          <div className="mb-6 p-4 bg-green-500/20 border border-green-500/30 text-green-200 rounded-xl">{success}</div>
        )}

        {/* Table / Empty */}
        {attendance.length > 0 ? (
          <div className="bg-gray-800/40 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700/60 bg-gray-800/60">
                    <th className="text-left py-4 px-6 font-semibold text-gray-200 uppercase text-sm tracking-wider">Name</th>
                    <th className="text-left py-4 px-6 font-semibold text-gray-200 uppercase text-sm tracking-wider">Date</th>
                    <th className="text-left py-4 px-6 font-semibold text-gray-200 uppercase text-sm tracking-wider">Time In</th>
                    <th className="text-left py-4 px-6 font-semibold text-gray-200 uppercase text-sm tracking-wider">Time Out</th>
                    <th className="text-right py-4 px-6 font-semibold text-gray-200 uppercase text-sm tracking-wider">
                      Hours Worked
                    </th>
                    <th className="text-right py-4 px-6 font-semibold text-gray-200 uppercase text-sm tracking-wider">
                      Days Worked
                    </th>
                    <th className="text-center py-4 px-6 font-semibold text-gray-200 uppercase text-sm tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.map((r) => (
                    <tr key={r.id} className="border-b border-gray-700/40 hover:bg-white/5 transition">
                      <td className="py-4 px-6 font-medium">{r.name}</td>
                      <td className="py-4 px-6 text-gray-300">{r.date}</td>
                      <td className="py-4 px-6 text-gray-300">
                        {editing?.id === r.id ? (
                          <input
                            type="time"
                            value={editing.timeInHHMM}
                            onChange={(e) => setEditing((p) => (p ? { ...p, timeInHHMM: e.target.value } : p))}
                            className="bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-sm"
                          />
                        ) : r.timeIn ? (
                          toHumanTime(r.timeIn)
                        ) : (
                          <Badge text="NO IN" tone="in" />
                        )}
                      </td>
                      <td className="py-4 px-6 text-gray-300">
                        {editing?.id === r.id ? (
                          <input
                            type="time"
                            value={editing.timeOutHHMM}
                            onChange={(e) => setEditing((p) => (p ? { ...p, timeOutHHMM: e.target.value } : p))}
                            className="bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-sm"
                          />
                        ) : r.timeOut ? (
                          toHumanTime(r.timeOut)
                        ) : (
                          <Badge text="NO OUT" tone="out" />
                        )}
                      </td>
                      <td className="py-4 px-6 text-right font-mono text-emerald-400">{r.hoursWorked.toFixed(2)} hrs</td>
                      <td className="py-4 px-6 text-right font-mono text-blue-400">{r.daysWorked.toFixed(3)} days</td>
                      <td className="py-4 px-6 text-center">
                        {editing?.id === r.id ? (
                          <>
                            <button onClick={saveEdit} className="text-green-400 hover:text-green-300 text-sm mr-2">
                              Save
                            </button>
                            <button onClick={cancelEdit} className="text-rose-400 hover:text-rose-300 text-sm">
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button onClick={() => startEdit(r)} className="text-blue-400 hover:text-blue-300 text-sm">
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          !loading &&
          !error && (
            <div className="rounded-xl border border-white/10 bg-gray-800/40 p-8 text-center text-gray-300">
              <p className="text-lg font-medium mb-2">No processed records</p>
              {allPunches.length === 0 ? (
                <p className="text-sm">
                  Upload a CSV/TXT/TSV with <strong>Name</strong> and <strong>Date</strong> (or a combined{" "}
                  <strong>Date/Time</strong>). If the device puts time in the Date column (e.g.,{" "}
                  <em>08/11/2025&nbsp;&nbsp;&nbsp;06:15:04</em>), we’ll read it automatically.
                </p>
              ) : (
                <p className="text-sm">
                  Choose a <strong>Cutoff window</strong> above (e.g., <em>Aug 11–25, 2025</em>) and click{" "}
                  <strong>Process</strong>.
                </p>
              )}
            </div>
          )
        )}

        {/* Notes */}
        <div className="mt-8 bg-black/20 rounded-xl p-6 border border-white/10">
          <h3 className="text-lg font-semibold mb-2">Notes</h3>
          <ul className="text-gray-300 text-sm space-y-1">
            <li>• IN window: 06:00–13:59. OUT window: 16:00 onward. Single-punch days are treated as 4 hours.</li>
            <li>
              • Shift used for hour calc: {workHours.in}–{workHours.out}; lunch ({breakMinutes} min) auto-deducted; 8h daily cap (OT excluded).
            </li>
            <li>• Cutoff must be chosen from the dropdown before processing (e.g., “Aug 11–25, 2025”).</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default AttendancePage;
