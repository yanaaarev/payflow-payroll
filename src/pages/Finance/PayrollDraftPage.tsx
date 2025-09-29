// src/pages/PayrollDraftPage.tsx
import { useEffect, useMemo, useState } from "react";
import {
  getFirestore,
  doc,
  collection,
  onSnapshot,
  query,
  orderBy,
  addDoc,
  serverTimestamp,
  runTransaction,
  updateDoc,
  getDocs,
  where,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { useParams, useNavigate } from "react-router-dom";
import { calculatePayroll } from "../../utils/payrollLogic";

/* ========================================================================
   TYPES
   ======================================================================== */
type DraftHead = {
  status: "draft" | "finance_review" | "pending_exec" | "pending_admin" | "approved" | "published";
  periodKey: string;
  cutoffLabel: string | null;
  cutoffStart: string | null;
  cutoffEnd: string | null;
  createdAt?: any;
  createdBy?: { uid: string; name: string } | null;
  requiredExecApprovals: number;
  execApprovals?: any[];
  adminApproval?: any | null;
  totals?: { gross?: number; net?: number; count?: number };
  updatedAt?: any;
  workedDays?: number;
};

type TimeInOut = { date: string; in: string | null; out: string | null };

type NormalizedCategory = "core" | "core_probationary" | "intern" | "freelancer" | "owner";

type Line = {
  id: string;
  employeeId: string;
  name: string; // may be an alias snapshot; UI must override with canonical employees.name
  periodKey: string;
  daysWorked: number;
  hoursWorked: number;
  category?: NormalizedCategory;
  monthlySalary?: number;
  timeInOut: TimeInOut[];
  adjustments?: {
    OT?: { date: string; hours: number; rate?: number }[];
    OB?: { date: string; hours?: number; note?: string }[];
    LEAVES?: { date: string; type: string; hoursOrDays: number }[];
  };
  commissionsTotal?: number;
  adjustmentsTotal?: number;
  updatedAt?: any;
  _deleted?: boolean;
  manualCashAdvance?: number; // 👈 NEW - manual override
};

type CommissionDoc = {
  client: string;
  type: "sales" | "others";    // 👈 new
  amount: number;
  percent: number;             // can be 0 for "others"
  commission: number;          // computed final commission
  createdAt?: any;
};

type CommRow = {
  id: string;
  type: "sales" | "others";    // 👈 new
  project: string;
  amount: string;              // keep as string for inputs
  percent: string;             // keep as string for inputs
};

type EmployeeDoc = {
  name: string;
  alias?: string;
  category: NormalizedCategory | "core_probationary" | string;
  monthlySalary?: number;
  perDayRate?: number;
  perDayOrMonthly?: number;
  dailyProbationary?: number;
  fixedWorkedDays?: number;
  fixedOut?: string | null;
  benefits?: {
    sss?: boolean;
    philhealth?: boolean;
    pagibig?: boolean;
  };
  rates?: {
    ob?: number;
    obShoot?: number;
    obEvents?: number;
    ot?: number;
  };
};


type CashAdvanceEntry = {
  totalAmount: number;
  perCutOff: number;
  startDateCutOff: "first" | "second";
  approved: boolean;
};

type FiledRequest = {
  type: "OB" | "OT" | "LEAVE" | "REMOTEWORK" | "WFH" | "RDOT";
  date?: string;
  hours?: number;
  category?: "shoot" | "events" | "ob";
  status: "approved" | "pending" | "rejected";
  employeeName?: string;
  suggestedRate?: number;

  // 👇 always require explicit filed in/out for remote & rdot
  timeIn?: string | null;
  timeOut?: string | null;
};


type PayrollInputLike = Parameters<typeof calculatePayroll>[0];

/* ========================================================================
   UTILS
   ======================================================================== */
const db = getFirestore();

const peso = (n: number) =>
  `₱${(Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const hhmm = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
};

const toISOTAt = (dMMDDYYYY: string, hhmmStr: string) => {
  const [mm, dd, yyyy] = dMMDDYYYY.split("/").map((x) => parseInt(x, 10));
  if (!mm || !dd || !yyyy) return null;
  const [hh, mi] = hhmmStr.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(hh) || Number.isNaN(mi)) return null;
  const d = new Date(yyyy, mm - 1, dd, hh, mi, 0, 0);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

function inferCurrentCutoffHalf(head: DraftHead): "first" | "second" {
  const label = head.cutoffLabel || "";
  if (label.includes("11–25") || label.includes("11-25")) return "second";
  return "first";
}

// Normalize category strings (handles hyphen/underscore/case)
function normalizeCategory(input?: string | null): NormalizedCategory {
  const s = String(input || "").toLowerCase();
  if (s.includes("owner")) return "owner";
  if (s.includes("freelancer")) return "freelancer";
  if (s.includes("intern")) return "intern";
  if (s.includes("core") && (s.includes("probationary") || s.includes("probation"))) {
    return "core_probationary";
  }
  return "core";
}

// Attendance windows & breaks
const SHIFT_IN = { h: 7, m: 0 };
const SHIFT_OUT = { h: 17, m: 30 };
//@ts-ignore
const IN_MIN = 6 * 60;
//@ts-ignore
const IN_MAX = 13 * 60 + 59;
//@ts-ignore
const OUT_MIN = 16 * 60;

function clipToShift(timeIn: Date | null, timeOut: Date | null) {
  if (!timeIn || !timeOut) return { start: null as Date | null, end: null as Date | null };
  const dayStart = new Date(timeIn.getFullYear(), timeIn.getMonth(), timeIn.getDate(), SHIFT_IN.h, SHIFT_IN.m, 0, 0);
  const dayEnd = new Date(timeIn.getFullYear(), timeIn.getMonth(), timeIn.getDate(), SHIFT_OUT.h, SHIFT_OUT.m, 0, 0);
  const start = timeIn > dayStart ? timeIn : dayStart;
  const end = timeOut < dayEnd ? timeOut : dayEnd;
  if (end <= start) return { start: null, end: null };
  return { start, end };
}
function computeHoursAndDaysForOne(
  inISO: string | null,
  outISO: string | null,
  fixedOut?: string | null
) {
  if ((inISO && !outISO) || (!inISO && outISO)) {
    return { hours: 4, days: 0.5 };
  }

  const tIn = inISO ? new Date(inISO) : null;
  const tOut = outISO ? new Date(outISO) : null;
  if (!tIn || !tOut) return { hours: 0, days: 0 };

  const inM = tIn.getHours() * 60 + tIn.getMinutes();
  const outM = tOut.getHours() * 60 + tOut.getMinutes();
  if (inM < 360 || outM < 420 || outM <= inM) {
    return { hours: 0, days: 0 };
  }

  // 🔹 Hard rule: if time-in is 12:00–12:59 → half-day regardless of time-out
  if (tIn.getHours() === 12) {
    return { hours: 4, days: 0.5 };
  }

  // --- apply fixed out for interns ---
  let adjustedOut = tOut;
  if (fixedOut) {
    const [hh, mm] = fixedOut.split(":").map(Number);
    if (!isNaN(hh) && !isNaN(mm)) {
      const forced = new Date(tOut.getFullYear(), tOut.getMonth(), tOut.getDate(), hh, mm, 0, 0);
      if (forced.getTime() < adjustedOut.getTime()) {
        adjustedOut = forced;
      }
    }
  }

  const { start, end } = clipToShift(tIn, adjustedOut);
  if (!start || !end) return { hours: 0, days: 0 };

  // 🔹 Hard rule: If actual timeout ≤ 1:59 PM → always half-day
  if (end.getHours() < 13 || (end.getHours() === 13 && end.getMinutes() <= 59)) {
    return { hours: 4, days: 0.5 };
  }

  let mins = (end.getTime() - start.getTime()) / 60000;

  // Deduct lunch only if they worked into it
  const lunchStart = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12, 0);
  const lunchEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 13, 0);
  if (end > lunchStart) {
    const overlap =
      Math.max(0, Math.min(end.getTime(), lunchEnd.getTime()) - Math.max(start.getTime(), lunchStart.getTime())) /
      60000;
    mins -= overlap;
  }

  if (mins < 0) mins = 0;

  let hours = Math.round((mins / 60) * 100) / 100;
  if (hours > 8) hours = 8;

  let days = hours / 8;
  if (days > 1) days = 1;

  if (fixedOut) {
    days = 1;
    hours = 8;
  }

  return { hours, days };
}


/* ========================================================================
   ROLES
   ======================================================================== */
function useMyRoles() {
  const [roles, setRoles] = useState<string[]>([]);
  useEffect(() => {
    const auth = getAuth();
    const unsub = auth.onIdTokenChanged(async (u) => {
      if (!u) return setRoles([]);
      const token = await u.getIdTokenResult(true);
      setRoles(((token.claims.roles as string[]) || []).map(String));
    });
    return unsub;
  }, []);
  return roles;
}

/* ========================================================================
   COMPONENT
   ======================================================================== */
export default function PayrollDraftPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const navigate = useNavigate();

  const roles = useMyRoles();

const isFinance = roles.includes("finance");
const isExec = roles.includes("exec");
const isAdminFinal = roles.includes("admin_final");
//@ts-ignore
const isOverseer = roles.includes("admin_overseer");

// Finance = can edit, others are view-only
const canEdit = isFinance;


  const [head, setHead] = useState<DraftHead | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // canonical employee data (KEYED BY EXACT employees doc id)
  const [empMeta, setEmpMeta] = useState<
  Record<
    string,
    {
      name: string;
      alias?: string;
      category: NormalizedCategory;
      monthlySalary: number;
      perDayRate: number;
      fixedWorkedDays: number;
      fixedOut?: string | null;
      rates?: EmployeeDoc["rates"];
      // ✅ add these
      sss?: boolean;
      philhealth?: boolean;
      pagibig?: boolean;
    }
  >
>({});


  // commissions total per line
  const [commTotals, setCommTotals] = useState<Record<string, number>>({});

  // cash advance per full name
  const [cashAdvances, setCashAdvances] = useState<Record<string, CashAdvanceEntry[]>>({});

  // filed requests per full name
  const [filedRequests, setFiledRequests] = useState<Record<string, FiledRequest[]>>({});

  // freelancers dropdown
  const [freelanceOptions, setFreelanceOptions] = useState<Array<{ id: string; name: string }>>([]);

  // row expand / edit day state
  const [openId, setOpenId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<{ lineId: string; index: number; in: string; out: string } | null>(null);

  // commission modal
  const [showCommModal, setShowCommModal] = useState(false);
  const [commEmployeeKey, setCommEmployeeKey] = useState<string | null>(null);

  // Put this helper above or near where you define the commRows state.
const makeCommRow = (): CommRow => ({
  id: (crypto as any).randomUUID?.() || String(Math.random()),
  type: "sales",       // default to sales
  project: "",
  amount: "",
  percent: "",
});

// Replace your current commRows state with this (or keep if already identical):
const [commRows, setCommRows] = useState<CommRow[]>([]);


  // freelancer payment modal
  const [showFPModal, setShowFPModal] = useState(false);
  const [fpFreelancerId, setFpFreelancerId] = useState("");
  const [, setFpProject] = useState("");
  const [, setFpQty] = useState<string>("1");
  const [, setFpRate] = useState<string>("0");
  const [fpEntries, setFpEntries] = useState<
    { project: string; qty: number; rate: number }[]
  >([{ project: "", qty: 1, rate: 0 }]);


  /* ------------------------------------------------------------
     SUBSCRIBE: DRAFT + LINES
     ------------------------------------------------------------ */
  useEffect(() => {
    if (!draftId) return;
    setLoading(true);
    setErr("");

    const headRef = doc(db, "payrollDrafts", draftId);
    const unsubHead = onSnapshot(
      headRef,
      (snap) => {
        if (!snap.exists()) {
          setErr("Draft not found.");
          setHead(null);
          setLoading(false);
          return;
        }
        setHead(snap.data() as DraftHead);
        setLoading(false);
      },
      (e) => {
        console.error(e);
        setErr(e.message || "Failed to load draft.");
        setLoading(false);
      }
    );

    const linesRef = collection(db, "payrollDrafts", draftId, "lines");
    const unsubLines = onSnapshot(
      query(linesRef, orderBy("name")),
      (snap) => {
        const list: Line[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as any) }));
        setLines(list.filter((l) => !l._deleted));
      },
      (e) => console.error(e)
    );

    return () => {
      unsubHead();
      unsubLines();
    };
  }, [draftId]);

  /* ------------------------------------------------------------
     ENSURE: OWNERS ARE ALWAYS IN THE DRAFT
     ------------------------------------------------------------ */
  useEffect(() => {
    (async () => {
      if (!draftId || !head) return;
      try {
        const ownersSnap = await getDocs(
        query(collection(db, "employees"), where("category", "==", "owner"))
        );

        if (ownersSnap.empty) return;

        const present = new Set(lines.map((l) => l.employeeId));
        const toAdd: Array<Promise<void>> = [];
        ownersSnap.forEach((d) => {
          const e = d.data() as EmployeeDoc;
          if (!present.has(d.id)) {
            const lineRef = doc(db, "payrollDrafts", draftId, "lines", d.id);
            toAdd.push(
              setDoc(lineRef, {
                employeeId: d.id,
                name: e.name || d.id,
                role: "owner",
                periodKey: head.periodKey,
                daysWorked: 0,
                hoursWorked: 0,
                monthlySalary: Number(e.monthlySalary || 60000),
                timeInOut: [],
                adjustments: {},
                adjustmentsTotal: 0,
                commissionsTotal: 0,
                updatedAt: serverTimestamp(),
              } as Partial<Line>)
            );
          }
        });
        if (toAdd.length) await Promise.all(toAdd);
      } catch {
        // no-op
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, head?.periodKey, lines.map((l) => l.employeeId).join(",")]);

  /* ------------------------------------------------------------
     SUBSCRIBE: COMMISSIONS PER LINE
     ------------------------------------------------------------ */
  useEffect(() => {
    if (!draftId || !lines.length) return;
    const unsubs: Array<() => void> = [];
    lines.forEach((ln) => {
      const ref = collection(db, "payrollDrafts", draftId, "lines", ln.id, "commissions");
      const u = onSnapshot(ref, (snap) => {
        let t = 0;
        snap.forEach((d) => {
          const c = d.data() as CommissionDoc;
          t += Number(c.commission || 0);
        });
        setCommTotals((prev) => ({ ...prev, [ln.id]: t }));
      });
      unsubs.push(u);
    });
    return () => unsubs.forEach((fn) => fn());
  }, [draftId, lines.map((l) => l.id).join(",")]);

  /* ------------------------------------------------------------
     FETCH: ALL NEEDED EMPLOYEE DATA (CANONICAL NAMES + RATES)
     ------------------------------------------------------------ */
  useEffect(() => {
  (async () => {
    if (!lines.length) return;

    // exact employees doc ids (must match Firestore doc ids)
    const ids = Array.from(
      new Set(lines.map((l) => String(l.employeeId || l.id).trim()).filter(Boolean))
    );
    if (!ids.length) return;

    const map: Record<
      string,
      {
        name: string;
        alias?: string;
        category: NormalizedCategory;
        monthlySalary: number;
        perDayRate: number;
        fixedWorkedDays: number;
        fixedOut: string | null;
        rates?: EmployeeDoc["rates"];
        // ✅ add deduction flags in the type
        sss: boolean;
        philhealth: boolean;
        pagibig: boolean;
      }
    > = {};

    await Promise.all(
      ids.map(async (id) => {
        try {
          const s = await getDoc(doc(db, "employees", id));
          if (s.exists()) {
            const e = s.data() as EmployeeDoc;
            const perDayRaw =
              Number(e.perDayRate || e.perDayOrMonthly || e.dailyProbationary || 0) || 0;
            const monthlyRaw = Number(e.monthlySalary || 0) || 0;

            map[id] = {
              name: e.name ? String(e.name) : id,
              alias: e.alias ? String(e.alias) : undefined,
              category: normalizeCategory((e as any).category),
              monthlySalary: monthlyRaw,
              perDayRate: perDayRaw,
              fixedWorkedDays: Number(e.fixedWorkedDays || 0),
              fixedOut:
                normalizeCategory((e as any).category) === "intern"
                  ? "16:00"
                  : e.fixedOut || null,
              rates: e.rates || {},
              // ✅ now these are valid
             // ✅ pull booleans from nested benefits
  sss: Boolean(e.benefits?.sss),
  philhealth: Boolean(e.benefits?.philhealth),
  pagibig: Boolean(e.benefits?.pagibig),
            };
          } else {
            map[id] = {
              name: id,
              category: "core",
              monthlySalary: 0,
              perDayRate: 0,
              fixedWorkedDays: 0,
              fixedOut: null,
              rates: {},
              sss: false,
              philhealth: false,
              pagibig: false,
            };
          }
        } catch {
          map[id] = {
            name: id,
            category: "core",
            monthlySalary: 0,
            perDayRate: 0,
            fixedWorkedDays: 0,
            fixedOut: null,
            rates: {},
            sss: false,
            philhealth: false,
            pagibig: false,
          };
        }
      })
    );

    setEmpMeta(map);
  })();
}, [lines.length]);

  /* ------------------------------------------------------------
     FETCH: FREELANCER OPTIONS
     ------------------------------------------------------------ */
  useEffect(() => {
    (async () => {
      try {
        const qRef = query(collection(db, "employees"), where("category", "==", "freelancer"));
        const snap = await getDocs(qRef);
        const list: Array<{ id: string; name: string }> = [];
        snap.forEach((d) => {
          const e = d.data() as EmployeeDoc;
          list.push({ id: d.id, name: e.name || d.id });
        });
        setFreelanceOptions(list);
      } catch {
        setFreelanceOptions([]);
      }
    })();
  }, []);

  /* ------------------------------------------------------------
   FETCH: CASH ADVANCES (APPROVED)
   ------------------------------------------------------------ */
useEffect(() => {
  (async () => {
    if (!head || !lines.length) return;
    try {
      // ✅ read from cashAdvances collection, not requests
      const qy = query(
  collection(db, "cashAdvances"),
  where("approved", "==", true)
);

      const snap = await getDocs(qy);

      const map: Record<string, CashAdvanceEntry[]> = {};

      snap.forEach((d) => {
        const r = d.data() as any;
        const key = String(r.employeeName || r.name || "").trim();
        if (!key) return;

        const entry: CashAdvanceEntry = {
          totalAmount: Number(r.totalAmount || 0),
          perCutOff: Number(r.perCutOff || 0),
          startDateCutOff: (r.startDateCutOff as "first" | "second") || "first",
          approved: r.approved === true,
        };

        if (!map[key]) map[key] = [];
        map[key].push(entry);
      });

      setCashAdvances(map);
    } catch (err) {
      console.error("Failed to fetch cash advances", err);
      setCashAdvances({});
    }
  })();
}, [head?.cutoffStart, head?.cutoffEnd, lines.length]);


  /* ------------------------------------------------------------
   FETCH: FILED REQUESTS (APPROVED, WITHIN CUTOFF)
   ------------------------------------------------------------ */
    useEffect(() => {
      (async () => {
        if (!head || !head.cutoffStart || !head.cutoffEnd || !lines.length) return;
        const start = new Date(head.cutoffStart);
        const end = new Date(head.cutoffEnd);

        // ✅ move end to 23:59:59
        end.setHours(23, 59, 59, 999);


        try {
          const qRef = query(collection(db, "requests"), where("status", "==", "approved"));
          const snap = await getDocs(qRef);
          const map: Record<string, FiledRequest[]> = {};

          snap.forEach((d) => {
            const r = d.data() as any;
            const details = r.details || {}; // ✅ wrapper fallback
            const fullName = String(r.employeeName || r.name || "").trim();
            if (!fullName) return;

            // ✅ date comes from details first
            const dtStr: string | undefined = details.date || r.date || r.filedDate;
            if (dtStr) {
      const dt = new Date(dtStr);

      // ✅ End date must be INCLUDED (<= end)
      if (isNaN(dt.getTime()) || dt < start || dt > new Date(end.getTime() + 24 * 60 * 60 * 1000 - 1)) {
        return;
      }
    }


        const fr: FiledRequest = {
        type: (r.type || details.type || details.kind || "OB").toUpperCase(),
        date: dtStr,
        hours: Number(details.hours ?? r.hours ?? 0),
        category: details.categoryKey || details.category || r.category || r.obType || undefined,
        status: "approved",
        employeeName: fullName,
        suggestedRate: Number(details.suggestedRate ?? r.suggestedRate ?? 0) || undefined,

        // ✅ pick up filed in/out (always required for remotework/wfh/rdot)
        timeIn: details.in || r.in || null,
        timeOut: details.out || r.out || null,
      };


        if (!map[fullName]) map[fullName] = [];
        map[fullName].push(fr);
      });

      setFiledRequests(map);
    } catch {
      setFiledRequests({});
    }
  })();
}, [head?.cutoffStart, head?.cutoffEnd, lines.length]);


  /* ------------------------------------------------------------
     PREVIEW TOTALS (ALWAYS COMPUTED FROM payrollLogic)
     ------------------------------------------------------------ */
  const previewTotals = useMemo(() => {
    if (!head) return { count: lines.length, gross: 0, net: 0 };
    let gross = 0;
    let net = 0;
    for (const ln of lines) {
      const p = calculatePayroll(buildPayrollInput(ln));
      const comm = commTotals[ln.id] || 0;
      gross += (p.grossEarnings || 0) + comm;
      net += (p.netPay || 0) + comm;
    }
    return { count: lines.length, gross, net };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [head?.periodKey, lines, commTotals, empMeta, cashAdvances, filedRequests]);

  /* ========================================================================
     ACTIONS
     ======================================================================== */
  async function requestExecApproval() {
  if (!draftId || !canEdit) return;
  await updateDoc(doc(db, "payrollDrafts", draftId), {
    status: "pending_exec",
    updatedAt: serverTimestamp(),
  });

  // ✅ Call API route instead of direct nodemailer
  await fetch("/api/sendEmail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: ["auquilang.instapost@gmail.com", "yana.instapost@gmail.com"],
      subject: "🔔 Payroll Draft Needs Review",
      html: `<p>A payroll draft (${draftId}) is awaiting executive review.</p>
             <p><a href="https://payflow-payroll.vercel.app/finance/payroll/drafts/${draftId}">View Draft</a></p>`,
    }),
  });
}
  
  async function execApprove() {
  if (!draftId || !isExec) return;
  const auth = getAuth();
  const u = auth.currentUser;
  if (!u) return;

  const ref = doc(db, "payrollDrafts", draftId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Draft not found");
    const data = snap.data() as any;

    const execs: any[] = Array.isArray(data.execApprovals) ? data.execApprovals : [];
    if (!execs.some((e) => e?.uid === u.uid)) {
      execs.push({
        uid: u.uid,
        name: u.displayName || u.email || "exec",
        at: new Date(), // ✅ use Date, not serverTimestamp
      });
    }

    const needed = Number(data.requiredExecApprovals || 1);
    const newStatus = execs.length >= needed ? "pending_admin" : "pending_exec";
    tx.update(ref, { execApprovals: execs, status: newStatus, updatedAt: serverTimestamp() });

    // ✅ If final exec approval reached, notify admin_final
    if (newStatus === "pending_admin") {
      // ✅ Call API route instead of direct nodemailer
  await fetch("/api/sendEmail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: ["jelynsonbattung@gmail.com"],
      subject: "🔔 Payroll Draft Ready for Final Approval",
      html: `<p>The payroll draft (${draftId}) has been approved by execs and is awaiting final admin approval.</p>
         <p><a href="https://yourapp.com/finance/payroll/drafts/${draftId}">Review Draft</a></p>`,
    }),
  });
}
  });
}

useEffect(() => {
  if (!draftId || !previewTotals) return;
  updateDoc(doc(db, "payrollDrafts", draftId), {
    totals: {
      gross: previewTotals.gross,
      net: previewTotals.net,
      count: previewTotals.count,
    },
    updatedAt: serverTimestamp(),
  }).catch(() => {});
}, [draftId, previewTotals.gross, previewTotals.net, previewTotals.count]);


  async function adminFinalApprove() {
  if (!draftId || !isAdminFinal || !head) return;
  const auth = getAuth();
  const u = auth.currentUser;
  if (!u) return;

  const draftRef = doc(db, "payrollDrafts", draftId);
  const slipsCol = collection(db, "payslips");

  await runTransaction(db, async (tx) => {
    for (const ln of lines) {
      // ✅ compute via payrollLogic
      const input = buildPayrollInput(ln);
      const out = calculatePayroll(input);
      const comm = commTotals[ln.id] || 0;

      // ✅ fetch employee meta
      const empDoc = await getDoc(doc(db, "employees", ln.employeeId));
      let employeeEmail = "";
      let employeeUid = "";
      let designation = "";
      let department = "";
      let alias = "";
      let employeeName = ln.name;

      if (empDoc.exists()) {
        const e = empDoc.data();
        employeeEmail = (e.email || "").toLowerCase();
        employeeUid = e.uid || "";
        designation = e.position || "";
        department = e.department || "";
        alias = e.alias || "";
        employeeName = e.name || ln.name;
      }

      // ✅ cutoff span → count working days (Mon–Fri only)
      const cutoffStart = head.cutoffStart ? new Date(head.cutoffStart) : new Date();
      const cutoffEnd = head.cutoffEnd ? new Date(head.cutoffEnd) : new Date();

      let daysOfWork = 0;
      let cur = new Date(cutoffStart);

      while (cur <= cutoffEnd) {
        const day = cur.getDay(); // 0 = Sunday, 6 = Saturday
        if (day !== 0 && day !== 6) { // ✅ count only Mon–Fri
          daysOfWork++;
        }
        cur.setDate(cur.getDate() + 1);
      }


      // ✅ detailed earnings
      const earnings = [
        {
          label: "Basic Pay",
          amount: out.cutoffPay,
          rateDay: `${out.dailyRate || 0}`,
          rateHour: "",
        },
        {
          label: "Official Business (OB)",
          amount: out.obPay,
          note: `${input.obQuantity || 0} OBs`,
        },
        {
          label: "OT Pay",
          amount: out.otPay,
          note: `${input.otHours || 0} hrs`,
        },
        {
          label: "Holiday Pay",
          amount: out.holiday30Pay + out.holidayDoublePay + out.holidayOtDoublePay,
        },
        {
          label: "Night Differential",
          amount: out.nightDiffPay,
          note: `${input.ndHours || 0} hrs`,
        },
        {
          label: "RDOT Pay",
          amount: out.rdotPay,
          note: `${input.rdotHours || 0} hrs`,
        },
        {
          label: "Commission",
          amount: comm,
        },
      ].filter((e) => e.amount && e.amount !== 0);

      // ✅ detailed deductions
      const deductions = [
        { label: "Cash Advance", amount: out.cashAdvanceDeduction },
        { label: "SSS", amount: out.sss },
        { label: "Pagibig", amount: out.pagibig },
        { label: "Philhealth", amount: out.philhealth },
        {
          label: "Tardiness / Lates",
          amount: out.tardinessDeduction,
          note: `${input.tardinessMinutes || 0} mins`,
        },
      ].filter((d) => d.amount && d.amount !== 0);

      // ✅ Notify employee
if (employeeEmail) {
  await fetch("/api/sendEmail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: employeeEmail,
      subject: "💰 Your Payslip is Ready",
      html: `
        <p>Hello ${employeeName},</p>
        <p>Your payslip for <b>${head.cutoffLabel}</b> is now available.</p>
        <p>
          Gross: ${peso(out.grossEarnings + comm)}<br/>
          Net: ${peso(out.netPay + comm)}
        </p>
      `,
    }),
  });
}


      // ✅ save payslip
      await addDoc(slipsCol, {
        draftId,
        employeeId: employeeUid || ln.employeeId,
        employeeEmail,
        employeeName,
        designation,
        department,
        employeeAlias: alias,
        cutoffLabel: head.cutoffLabel,
        cutoffStart: head.cutoffStart,
        cutoffEnd: head.cutoffEnd,
        periodKey: head.periodKey,
        workDays: ln.daysWorked || 0,
        daysOfWork,
        createdAt: serverTimestamp(),
        status: "ready",

        grossEarnings: out.grossEarnings + comm,
        totalDeductions: out.totalDeductions,
        netPay: out.netPay + comm,

        earnings,
        deductions,

        // ✅ full details for traceability
        details: {
          input,
          output: out,
          commissions: comm,
        },
      });
    }

    // ✅ mark draft as approved
   tx.update(draftRef, {
  adminApproval: {
    uid: u.uid,
    name: u.displayName || u.email || "admin_final",
    at: serverTimestamp(),
  },
  status: "approved",
  totals: {
    gross: previewTotals.gross,
    net: previewTotals.net,
    count: previewTotals.count,
  },
  updatedAt: serverTimestamp(),
});
  });
}

    async function rejectDraft(role: string) {
    if (!draftId) return;
    await updateDoc(doc(db, "payrollDrafts", draftId), {
      status: "rejected",
      rejectedBy: role,
      rejectedAt: serverTimestamp(),
    });

    // ✅ Notify finance/admin/exec depending on role
  // ✅ Call API route instead of direct nodemailer
  await fetch("/api/sendEmail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: ["hrfinance.instapost@gmail.com"],
      subject: "❌ Payroll Draft Rejected",
      html: `<p>The payroll draft (${draftId}) was rejected by ${role}.</p>`,
    }),
  });
}

  async function saveDayEdit(lineId: string, index: number) {
  if (!draftId || !editRow) return;
  const line = lines.find((l) => l.id === lineId);
  if (!line) return;

  const newArr = [...line.timeInOut];
  const row = newArr[index];
  const newIn = editRow.in ? toISOTAt(row.date, editRow.in) : null;
  const newOut = editRow.out ? toISOTAt(row.date, editRow.out) : null;
  newArr[index] = { ...row, in: newIn, out: newOut };

  // Recompute totals
  let h = 0;
  let d = 0;
  newArr.forEach((r) => {
    const meta = empMeta[lineId];
    const c = computeHoursAndDaysForOne(r.in, r.out, meta?.fixedOut);
    h += c.hours;

    let daily = c.days;
    if (meta?.fixedOut) {
      daily = r.in && r.out ? 1 : 0;
    } else {
      if (c.days >= 0.75) daily = 1;
      else if (c.days >= 0.25) daily = 0.5;
      else daily = 0;
    }
    d += daily;
  });

  h = Math.round(h * 100) / 100;
  d = Math.round(d * 1000) / 1000;

  await updateDoc(doc(db, "payrollDrafts", draftId, "lines", lineId), {
    timeInOut: newArr,
    hoursWorked: h,
    daysWorked: d,
    updatedAt: serverTimestamp(),
  });

  setEditRow(null);
}


async function deleteDay(lineId: string, index: number) {
  if (!draftId) return;
  const line = lines.find((l) => l.id === lineId);
  if (!line) return;

  const newArr = line.timeInOut.filter((_, i) => i !== index);

  let h = 0;
  let d = 0;
  newArr.forEach((r) => {
    const meta = empMeta[lineId];
    const c = computeHoursAndDaysForOne(r.in, r.out, meta?.fixedOut);
    h += c.hours;

    let daily = c.days;
    if (meta?.fixedOut) {
      daily = r.in && r.out ? 1 : 0;
    } else {
      if (c.days >= 0.75) daily = 1;
      else if (c.days >= 0.25) daily = 0.5;
      else daily = 0;
    }
    d += daily;
  });

  h = Math.round(h * 100) / 100;
  d = Math.round(d * 1000) / 1000;

  await updateDoc(doc(db, "payrollDrafts", draftId, "lines", lineId), {
    timeInOut: newArr,
    hoursWorked: h,
    daysWorked: d,
    updatedAt: serverTimestamp(),
  });
}


  // Commission modal helpers
  const openCommModal = (lineId: string) => {
  setCommEmployeeKey(lineId);
  setCommRows([makeCommRow()]);     // start with 1 default row
  setShowCommModal(true);
};
  const addCommRow = () => {
  setCommRows((rows) => [...rows, makeCommRow()]);
};
  const removeCommRow = (id: string) => {
  setCommRows((rows) => rows.filter((r) => r.id !== id));
};

// field is keyof CommRow so it works for "type" | "project" | "amount" | "percent"
const updateCommField = (id: string, field: keyof CommRow, v: string) => {
  setCommRows((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: v } : r)));
};
  async function submitCommissionRows() {
  if (!draftId || !commEmployeeKey) return;

  const commissionsRef = collection(
    db,
    "payrollDrafts",
    draftId,
    "lines",
    commEmployeeKey,
    "commissions"
  );

  const cleaned = commRows
    .map((r) => {
      const amount = Number(r.amount || 0);
      const percent = Number(r.percent || 0);
      let commission = 0;

      if (r.type === "sales") {
        // Sales → commission is percent of amount
        if (amount > 0 && percent > 0) {
          commission = Math.round(((amount * percent) / 100) * 100) / 100;
        }
      } else {
        // Others → flat amount only
        if (amount > 0) {
          commission = Math.round(amount * 100) / 100;
        }
      }

      return {
        client: r.project?.trim() || "-",
        type: r.type,          // ✅ save type for clarity
        amount,
        percent,
        commission,
      };
    })
    .filter((x) => x.client && x.commission > 0);

  for (const row of cleaned) {
    await addDoc(commissionsRef, { ...row, createdAt: serverTimestamp() });
  }

  setShowCommModal(false);
}


  // Freelancer modal
  const openFPModal = () => {
    setShowFPModal(true);
    setFpFreelancerId("");
    setFpProject("");
    setFpQty("1");
    setFpRate("0");
  };
  async function submitFreelancerPayment() {
  if (!draftId || !fpFreelancerId) return;

  const freelancer = freelanceOptions.find((f) => f.id === fpFreelancerId);
  const name = freelancer?.name || fpFreelancerId;

  const lineRef = doc(db, "payrollDrafts", draftId, "lines", fpFreelancerId);

  // compute totals
  const newProjects = fpEntries.map((e) => ({
    project: e.project,
    qty: Number(e.qty) || 0,
    rate: Number(e.rate) || 0,
    total: (Number(e.qty) || 0) * (Number(e.rate) || 0),
  }));
  const grandTotal = newProjects.reduce((sum, p) => sum + p.total, 0);

  if (grandTotal <= 0) {
    setShowFPModal(false);
    return;
  }

  await setDoc(
    lineRef,
    {
      employeeId: fpFreelancerId,
      name,
      category: "freelancer",        // 👈 ensure category is set!
      role: "freelancer",
      periodKey: head?.periodKey || "",
      cutoffStart: head?.cutoffStart || null,
      cutoffEnd: head?.cutoffEnd || null,

      daysWorked: 0,
      hoursWorked: 0,
      monthlySalary: 0,
      timeInOut: [],

      // merge new projects into existing
      projects: newProjects,
      adjustments: {},
      adjustmentsTotal: grandTotal,  // 👈 payrollLogic will use this
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  // reset & close
  setFpEntries([{ project: "", qty: 1, rate: 0 }]);
  setShowFPModal(false);
}

/* ------------------------------------------------------------
   DAILY MERGE HELPER
   biometric + filed RemoteWork/WFH + RDOT
   ------------------------------------------------------------ */
function computeDailyWithFiled(
  timeInOut: TimeInOut[],
  reqs: FiledRequest[],
  fixedOut?: string | null
) {
  const allDates = new Set<string>([
    ...timeInOut.map(r => r.date),
    ...reqs
      .filter(r =>
        ["remotework", "wfh", "rdot"].includes(r.type?.toLowerCase() || "")
      )
      .map(r => r.date || "")
  ]);

  let totalHours = 0;
  let totalDays = 0;
  let rdotHours = 0;

  for (const d of Array.from(allDates)) {
    if (!d) continue;
    let dailyHours = 0;

    // biometric for this date
    const bio = timeInOut.find(r => r.date === d);
    if (bio) {
      const { hours } = computeHoursAndDaysForOne(bio.in, bio.out, fixedOut);
      dailyHours += hours;
    }

    // filed remote/wfh for this date
    const remotes = reqs.filter(
      r =>
        ["remotework", "wfh"].includes(r.type?.toLowerCase() || "") &&
        r.date === d
    );
    for (const rw of remotes) {
      if ((rw as any).timeIn && (rw as any).timeOut) {
        const { hours } = computeHoursAndDaysForOne(
          (rw as any).timeIn,
          (rw as any).timeOut,
          fixedOut
        );
        dailyHours += hours;
      } else {
        dailyHours += Number(rw.hours || 0);
      }
    }

    // filed rdot for this date
    const rdots = reqs.filter(
      r => r.type?.toLowerCase() === "rdot" && r.date === d
    );
    for (const rd of rdots) {
      if ((rd as any).timeIn && (rd as any).timeOut) {
        const { hours } = computeHoursAndDaysForOne(
          (rd as any).timeIn,
          (rd as any).timeOut,
          fixedOut
        );
        rdotHours += hours;
      } else {
        rdotHours += Number(rd.hours || 0);
      }
    }

    // ✅ cap total worked at 8h/day
    if (dailyHours > 8) dailyHours = 8;

    totalHours += dailyHours;
    totalDays += Math.round((dailyHours / 8) * 1000) / 1000;
  }

  return { totalHours, totalDays, rdotHours };
}

/* ------------------------------------------------------------
   BUILD PAYROLL INPUT FOR payrollLogic
   ------------------------------------------------------------ */
function buildPayrollInput(ln: Line): PayrollInputLike {
  const empId = String(ln.employeeId || ln.id).trim();
  const meta =
    empMeta[empId] || {
      name: "",
      category: normalizeCategory(ln.category),
      monthlySalary: 0,
      perDayRate: 0,
      fixedWorkedDays: 0,
    };

  const canonicalName = meta.name || empId;
  const reqs = filedRequests[canonicalName] || [];

  // --- DAILY MERGE ---
  const { totalDays, rdotHours } = computeDailyWithFiled(
    ln.timeInOut,
    reqs,
    meta.fixedOut
  );

  // Determine worked days (probationary might have fixed cutoff days)
  let workedDays = Math.max(totalDays, 0.0001);

// ✅ manual override from line.daysWorked
if (typeof ln.daysWorked === "number" && ln.daysWorked > 0) {
  workedDays = ln.daysWorked;
} else if (meta.fixedWorkedDays && meta.fixedWorkedDays > 0) {
  workedDays = meta.fixedWorkedDays;
}


  // Determine base rate strategy:
  const hasPerDay = Number(meta.perDayRate || 0) > 0;
  const normalizedMonthly = hasPerDay
    ? Number(meta.perDayRate) * 22 * 2
    : Number(meta.monthlySalary || ln.monthlySalary || 0);

  // OB + OT requests
  // OB + OT requests
const obReqs = reqs.filter(r => r.type === "OB");
const obQtyReq = obReqs.length;

// ✅ compute OB total with rates
const obPayFromReqs = obReqs.reduce((s, r) => {
  const rate = Number(r.suggestedRate || meta.rates?.ob || 1500); // fallback if missing
  return s + rate;
}, 0);

// Manual adjustments still just count
const obQtyAdj = Number(ln.adjustments?.OB?.length || 0);

const obQuantity = obQtyReq + obQtyAdj;

  const otHrsReq = reqs
    .filter(r => r.type === "OT")
    .reduce((s, r) => s + Number(r.hours || 0), 0);

  // Manual adjustments
  const otHrsAdj = (ln.adjustments?.OT || []).reduce(
    (s, a) => s + Number(a.hours || 0),
    0
  );
  const otHours = otHrsReq + otHrsAdj;

// Cash advances
const half = head ? inferCurrentCutoffHalf(head) : "first";
const caList = cashAdvances[canonicalName] || [];
let totalAmount = caList.reduce((s, c) => s + Number(c.totalAmount || 0), 0);
let perCutOff = caList.reduce((s, c) => s + Number(c.perCutOff || 0), 0);
const startIsSecond = caList.some(c => c.startDateCutOff === "second");

// ✅ allow finance manual override
if (typeof ln.manualCashAdvance === "number") {
  perCutOff = ln.manualCashAdvance;
  totalAmount = ln.manualCashAdvance; // keep them equal if manual
}

  // Category
  let category: PayrollInputLike["category"];
  if (meta.category === "core_probationary") {
    category = "core_probationary";
  } else if (meta.category === "intern") {
    category = "intern";
  } else if (meta.category === "freelancer") {
    category = "freelancer";
  } else if (meta.category === "owner") {
    category = "owner";
  } else {
    category = "core";
  }

  // --- TARDINESS COMPUTATION ---
  let tardyMins = 0;
  ln.timeInOut.forEach(r => {
    if (r.in) {
      const tIn = new Date(r.in);
      const mins = tIn.getHours() * 60 + tIn.getMinutes();
      const startWindow = 7 * 60; // 07:00
      const endWindow = 8 * 60; // 08:00

      if (mins > startWindow && mins < endWindow) {
        tardyMins += mins - startWindow;
      } else if (mins >= endWindow) {
        return;
      }
    }
  });

  // --- FREELANCER SHORT CIRCUIT ---
  if (category === "freelancer") {
    return {
      monthlySalary: 0,
      perDayRate: 0,
      cutoffWorkingDays: 0,
      workedDays: 0,
      obQuantity: 0,
      otHours: 0,
      ndHours: 0,
      rdotHours: 0,
      holiday30Hours: 0,
      holidayDoubleHours: 0,
      holidayOtDoubleHours: 0,
      tardinessMinutes: 0,
      category: "freelancer",
      benefits: { sss: false, philhealth: false, pagibig: false },
     cashAdvance: {
  totalAmount,
  perCutOff,
  currentCutOff: half,
  startDateCutOff: startIsSecond ? "second" : "first",
  approved: caList.length > 0,
},
      manualNetPay: ln.adjustmentsTotal || 0,
    };
  }

  // --- NORMAL EMPLOYEES ---
  return {
    monthlySalary: normalizedMonthly,
    perDayRate: meta.perDayRate,
    cutoffWorkingDays: head?.workedDays || 0,
    workedDays,
    fixedWorkedDays: meta.fixedWorkedDays || 0,   
    obQuantity,
    obPayFromReqs, // ✅ new field for OB from requests
    otHours,
    ndHours: 0,
    rdotHours, // ✅ merged
    holiday30Hours: 0,
    holidayDoubleHours: 0,
    holidayOtDoubleHours: 0,
    tardinessMinutes: tardyMins,
    category,
    benefits: {
      sss: meta.sss || false,
      philhealth: meta.philhealth || false,
      pagibig: meta.pagibig || false,
    },
    cashAdvance: {
      totalAmount,
      perCutOff,
      currentCutOff: half,
      startDateCutOff: startIsSecond ? "second" : "first",
      approved: caList.length > 0,
        // ✅ inject manual override if present
  override: typeof ln.manualCashAdvance === "number" ? ln.manualCashAdvance : undefined,
    },
  };
}

const uid = getAuth().currentUser?.uid || "";

const alreadyExecApproved =
  isExec && head?.execApprovals?.some((e: any) => e?.uid === uid);

const alreadyAdminApproved =
  isAdminFinal && head?.adminApproval?.uid === uid;

  /* ========================================================================
     UI
     ======================================================================== */
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white pt-20 px-4 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (err) {
    return (
      <div className="min-h-screen bg-gray-900 text-white pt-20 px-4">
        <div className="max-w-5xl mx-auto">
          <button onClick={() => navigate(-1)} className="text-blue-400 hover:text-blue-300">
            ← Back
          </button>
          <div className="mt-6 p-4 bg-red-500/20 border border-red-500/30 text-red-200 rounded-xl">{err}</div>
        </div>
      </div>
    );
  }

  if (!head) {
    return (
      <div className="min-h-screen bg-gray-900 text-white pt-20 px-4">
        <div className="max-w-5xl mx-auto">
          <button onClick={() => navigate(-1)} className="text-blue-400 hover:text-blue-300">
            ← Back
          </button>
          <div className="mt-6 p-4 bg-yellow-500/20 border border-yellow-500/30 text-yellow-200 rounded-xl">
            Draft not found.
          </div>
        </div>
      </div>
    );
  }

  return (
   <div className="min-h-screen bg-gray-900 text-white pt-20 px-4 sm:px-6 lg:px-8 pb-8">
      <div className="max-w-6xl mx-auto">
        {/* Header + actions */}
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Payroll Draft</h1>
            <p className="text-gray-300 mt-1">
              {head.cutoffLabel || head.periodKey} • Status: <span className="font-semibold">{head.status}</span>
            </p>
            <p className="text-gray-400 text-sm">
              {head.cutoffStart && head.cutoffEnd
                ? `${new Date(head.cutoffStart).toLocaleDateString()} – ${new Date(head.cutoffEnd).toLocaleDateString()}`
                : null}
            </p>
            {head.workedDays !== undefined && (
              <p className="text-gray-400 text-sm">
                Worked Days in Cutoff: <span className="font-semibold text-blue-400">{head.workedDays}</span>
              </p>
            )}
          </div>

         <div className="flex items-center gap-2">
  {/* Finance role only */}
  {isFinance && (
    <>
      <button
        type="button"
        onClick={openFPModal}
        className="px-4 py-2 rounded-lg text-sm font-medium transition bg-purple-600 hover:bg-purple-500 text-white"
      >
        + Freelancer Payment
      </button>

      {head.status === "draft" && (
        <button
          type="button"
          onClick={requestExecApproval}
          className="px-4 py-2 rounded-lg text-sm font-medium transition bg-amber-600 hover:bg-amber-500 text-white"
        >
          Submit for Approval
        </button>
      )}
    </>
  )}

  {/* Exec role only */}
  {isExec && head.status === "pending_exec" && (
    <>
      <button
        type="button"
        disabled={alreadyExecApproved}
        onClick={execApprove}
        className={`px-4 py-2 rounded-lg text-sm font-medium transition text-white ${
          alreadyExecApproved
            ? "bg-gray-600 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-500"
        }`}
      >
        {alreadyExecApproved ? "Approved" : "Exec Approve"}
      </button>

      <button
        type="button"
        disabled={alreadyExecApproved}
        onClick={() => rejectDraft("exec")}
        className={`px-4 py-2 rounded-lg text-sm font-medium transition text-white ${
          alreadyExecApproved
            ? "bg-gray-600 cursor-not-allowed"
            : "bg-rose-600 hover:bg-rose-500"
        }`}
      >
        Reject
      </button>
    </>
  )}

  {/* Admin Final role only */}
  {isAdminFinal && head.status === "pending_admin" && (
    <>
      <button
        type="button"
        disabled={alreadyAdminApproved}
        onClick={adminFinalApprove}
        className={`px-4 py-2 rounded-lg text-sm font-medium transition text-white ${
          alreadyAdminApproved
            ? "bg-gray-600 cursor-not-allowed"
            : "bg-emerald-600 hover:bg-emerald-500"
        }`}
      >
        {alreadyAdminApproved ? "Approved" : "Approve to Publish"}
      </button>

      <button
        type="button"
        disabled={alreadyAdminApproved}
        onClick={() => rejectDraft("admin_final")}
        className={`px-4 py-2 rounded-lg text-sm font-medium transition text-white ${
          alreadyAdminApproved
            ? "bg-gray-600 cursor-not-allowed"
            : "bg-rose-600 hover:bg-rose-500"
        }`}
      >
        Reject
      </button>
    </>
  )}

  {/* Always show back button */}
  <button
    type="button"
    onClick={() => navigate(-1)}
    className="px-4 py-2 rounded-lg text-sm font-medium transition bg-gray-700 hover:bg-gray-600 text-white"
  >
    Back
  </button>
</div>
        </div>

        {/* Totals preview (from payrollLogic) */}
         <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-800/50 rounded-xl border border-white/10 p-4 text-center">
            <p className="text-sm text-gray-300">Employees</p>
            <p className="text-2xl font-bold text-blue-400">{previewTotals.count}</p>
          </div>
          <div className="bg-gray-800/50 rounded-xl border border-white/10 p-4 text-center">
            <p className="text-sm text-gray-300">Gross Preview</p>
            <p className="text-2xl font-bold text-emerald-400">{peso(previewTotals.gross)}</p>
          </div>
          <div className="bg-gray-800/50 rounded-xl border border-white/10 p-4 text-center">
            <p className="text-sm text-gray-300">Net Preview</p>
            <p className="text-2xl font-bold text-green-400">{peso(previewTotals.net)}</p>
          </div>
        </div>

        {/* Lines - keep the dropdown UI */}
        <div className="space-y-4">
          {lines.map((ln) => {
            const empId = String(ln.employeeId || ln.id).trim();
            const meta = empMeta[empId];
            // ALWAYS display canonical /employees.name; never alias
            const canonicalName = meta?.name || empId;
            const p = calculatePayroll(buildPayrollInput(ln));
            const comm = commTotals[ln.id] || 0;


            return (
              <div key={ln.id} className="rounded-xl border border-white/10 bg-gray-800/40 overflow-hidden">
                <div className="flex items-center justify-between px-4 sm:px-6 py-3 bg-gray-800/60 border-b border-gray-700/60">
                  <div className="flex items-center gap-3">
                    <button className="text-left" onClick={() => setOpenId(openId === ln.id ? null : ln.id)} title="Expand">
                      <span className="inline-block w-5 text-gray-300">{openId === ln.id ? "▾" : "▸"}</span>
                      {/* Name then gray (employeeId) */}
                      <span className="font-semibold">{canonicalName}</span>
                      <span className="ml-2 text-xs text-gray-400">({empId})</span>
                    </button>
                  </div>
                 <div className="flex items-center gap-4">
                                {(() => {
  const empId = String(ln.employeeId || ln.id).trim();
  const meta = empMeta[empId];
  const canonicalName = meta?.name || empId;
  const reqs = filedRequests[canonicalName] || [];

  // ✅ use merged helper instead of plain reduce
  const { totalDays, totalHours } = computeDailyWithFiled(
    ln.timeInOut,
    reqs,
    meta?.fixedOut
  );

  return (
    <>
      <div className="text-sm font-mono text-blue-300 flex items-center gap-2">
  <span>Days:</span>
  {canEdit ? (
    <input
      type="number"
      step="00"
      min="0"
      value={ln.daysWorked?.toFixed(3) ?? totalDays.toFixed(3)}
      onChange={async (e) => {
        const val = parseFloat(e.target.value) || 0;
        await updateDoc(
          doc(db, "payrollDrafts", draftId!, "lines", ln.id),
          {
            daysWorked: val,
            updatedAt: serverTimestamp(),
          }
        );
      }}
      className="bg-white/10 border border-white/20 rounded px-2 py-1 text-sm w-24 text-blue-300 font-mono"
    />
  ) : (
    <span>{(ln.daysWorked ?? totalDays).toFixed(3)}</span>
  )}
</div>
      <div className="text-sm font-mono text-emerald-300">
        Hours: {totalHours.toFixed(2)}
      </div>
    </>
  );
})()}

                    <div className="text-sm font-mono text-amber-300">Commission: {peso(comm)}</div>
                    {/* Net pay for ALL employees (not just owners) */}
                    <div className="text-sm font-semibold text-green-400">Net: {peso((p.netPay || 0) + comm)}</div>

                    {canEdit ? (
                      <>
                        <button onClick={() => openCommModal(ln.id)} className="text-blue-400 hover:text-blue-300 text-sm">
                          + Commission
                        </button>
                        <button
                          onClick={async () => {
                            await updateDoc(doc(db, "payrollDrafts", draftId!, "lines", ln.id), {
                              _deleted: true,
                              updatedAt: serverTimestamp(),
                            });
                          }}
                          className="text-rose-400 hover:text-rose-300 text-sm"
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <span className="text-gray-500 text-sm">View only</span>
                    )}
                  </div>
                </div>

                {/* Expanded body */}
                {openId === ln.id && (
                  <div className="p-4 sm:p-6">
                    {/* Cut-off days editable table */}
                    <div className="mb-6">
                      <h3 className="font-semibold mb-3">Cut-off Days (editable)</h3>
                      <div className="overflow-x-auto rounded-lg border border-white/10">
                        <table className="w-full">
                          <thead>
                            <tr className="bg-gray-800/60 border-b border-gray-700/60">
                              <th className="text-left py-2 px-3 text-sm text-gray-300">Date</th>
                              <th className="text-left py-2 px-3 text-sm text-gray-300">Time In</th>
                              <th className="text-left py-2 px-3 text-sm text-gray-300">Time Out</th>
                              <th className="text-right py-2 px-3 text-sm text-gray-300">Hours</th>
                              <th className="text-right py-2 px-3 text-sm text-gray-300">Days</th>
                              <th className="text-center py-2 px-3 text-sm text-gray-300">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ln.timeInOut.map((r, idx) => {
                              const calc = computeHoursAndDaysForOne(r.in, r.out, meta?.fixedOut);
                              const isEditing = editRow?.lineId === ln.id && editRow?.index === idx;
                              return (
                                <tr key={ln.id + idx} className="border-b border-gray-700/40">
                                  <td className="py-2 px-3">{r.date}</td>
                                  <td className="py-2 px-3">
                                    {isEditing ? (
                                      <input
                                        type="time"
                                        value={editRow?.in}
                                        onChange={(e) =>
                                          setEditRow((prev) => (prev ? { ...prev, in: e.target.value } : prev))
                                        }
                                        className="bg-white/10 border border-white/20 rounded px-2 py-1 text-sm"
                                      />
                                    ) : hhmm(r.in) ? (
                                      hhmm(r.in)
                                    ) : (
                                      <span className="text-amber-300 text-sm">NO IN</span>
                                    )}
                                  </td>
                                  <td className="py-2 px-3">
                                    {isEditing ? (
                                      <input
                                        type="time"
                                        value={editRow?.out}
                                        onChange={(e) =>
                                          setEditRow((prev) => (prev ? { ...prev, out: e.target.value } : prev))
                                        }
                                        className="bg-white/10 border border-white/20 rounded px-2 py-1 text-sm"
                                      />
                                    ) : hhmm(r.out) ? (
                                      hhmm(r.out)
                                    ) : (
                                      <span className="text-rose-300 text-sm">NO OUT</span>
                                    )}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono text-emerald-300">{calc.hours.toFixed(2)}</td>
                                  <td className="py-2 px-3 text-right font-mono text-blue-300">{calc.days.toFixed(3)}</td>
                                  <td className="py-2 px-3 text-center">
                                    {isEditing ? (
                                      <>
                                        <button
                                          onClick={() => saveDayEdit(ln.id, idx)}
                                          className="text-green-400 hover:text-green-300 text-sm mr-2"
                                        >
                                          Save
                                        </button>
                                        <button
                                          onClick={() => setEditRow(null)}
                                          className="text-gray-400 hover:text-gray-300 text-sm"
                                        >
                                          Cancel
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <button
                                          onClick={() =>
                                            setEditRow({
                                              lineId: ln.id,
                                              index: idx,
                                              in: hhmm(r.in),
                                              out: hhmm(r.out),
                                            })
                                          }
                                          className="text-blue-400 hover:text-blue-300 text-sm mr-3"
                                        >
                                          Edit
                                        </button>
                                        <button
                                          onClick={() => deleteDay(ln.id, idx)}
                                          className="text-rose-400 hover:text-rose-300 text-sm"
                                        >
                                          Delete
                                        </button>
                                      </>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                            {ln.timeInOut.length === 0 && (
                              <tr>
                                <td colSpan={6} className="py-4 px-3 text-center text-gray-400">
                                  No days in this cut-off.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Requests + CA + Summary */}
                    <div className="grid md:grid-cols-2 gap-6">
                      <div className="rounded-xl border border-white/10 p-4 bg-gray-800/30">
                        <h4 className="font-semibold mb-3">Official Business / Leaves</h4>
                        <div className="text-sm text-gray-300">
                          <p className="text-gray-400 mb-1">Filed (approved within cut-off)</p>
                          {(filedRequests[canonicalName] || []).length ? (
                            <ul className="list-disc ml-5">
                              {(filedRequests[canonicalName] || []).map((f, i) => (
                                <li key={i}>
                                  {f.type} {f.date ? `• ${f.date}` : ""} {f.hours ? `• ${f.hours}h` : ""}{" "}
                                  {f.category ? `• ${f.category}` : ""}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-gray-500">N/A</p>
                          )}
                          <p className="text-gray-400 mt-3 mb-1">Manual Adjustments</p>
                          {ln.adjustments?.OB?.length || ln.adjustments?.LEAVES?.length || ln.adjustments?.OT?.length ? (
                            <ul className="list-disc ml-5">
                              {(ln.adjustments?.OB || []).map((o, i) => (
                                <li key={"m-ob" + i}>OB {o.date ? `• ${o.date}` : ""}</li>
                              ))}
                              {(ln.adjustments?.OT || []).map((o, i) => (
                                <li key={"m-ot" + i}>OT {o.date ? `• ${o.date}` : ""} {o.hours ? `• ${o.hours}h` : ""}</li>
                              ))}
                              {(ln.adjustments?.LEAVES || []).map((lv, i) => (
                                <li key={"m-leave" + i}>
                                  LEAVE {lv.type} {lv.date ? `• ${lv.date}` : ""} {lv.hoursOrDays ? `• ${lv.hoursOrDays}` : ""}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-gray-500">N/A</p>
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border border-white/10 p-4 bg-gray-800/30">
                        <h4 className="font-semibold mb-3">Cash Advance</h4>

                        {canEdit ? (
                          <div className="flex items-center gap-2">
                            <label className="text-sm text-gray-300">Manual Input (₱)</label>
                            <input
                          type="number"
                          min="0"
                          value={ln.manualCashAdvance ?? ""}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            // ✅ Update local state immediately so deductions/net pay refresh instantly
                            setLines((prev) =>
                              prev.map((l) =>
                                l.id === ln.id ? { ...l, manualCashAdvance: val } : l
                              )
                            );
                          }}
                          onBlur={async (e) => {
                            const val = parseFloat(e.target.value) || 0;
                            // ✅ Write to Firestore only once, when user leaves input
                            await updateDoc(
                              doc(db, "payrollDrafts", draftId!, "lines", ln.id),
                              {
                                manualCashAdvance: val,
                                updatedAt: serverTimestamp(),
                              }
                            );
                          }}
                          className="bg-white/10 border border-white/20 rounded px-2 py-1 text-sm w-32 text-amber-300 font-mono"
                        />

                          </div>
                        ) : (
                          <p className="text-gray-400 text-sm">
                            {ln.manualCashAdvance !== undefined
                              ? peso(ln.manualCashAdvance)
                              : "N/A"}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Payroll summary using payrollLogic */}
                    <div className="mt-6 rounded-xl border border-white/10 p-4 bg-gray-800/30">
                      <h4 className="font-semibold mb-3">Payroll Summary</h4>
                      <div className="grid md:grid-cols-3 gap-4 text-sm">
                        <div className="space-y-1">
                          <div>
                            Daily Rate:{" "}
                            <span className="font-mono">
                              {peso((calculatePayroll(buildPayrollInput(ln)).dailyRate as number) || 0)}
                            </span>
                          </div>
                          <div>
                            Cut-off Pay:{" "}
                            <span className="font-mono">{peso((calculatePayroll(buildPayrollInput(ln)).cutoffPay as number) || 0)}</span>
                          </div>
                          <div>
                            OB Pay:{" "}
                            <span className="font-mono">{peso((calculatePayroll(buildPayrollInput(ln)).obPay as number) || 0)}</span>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div>OT Pay: <span className="font-mono">{peso((calculatePayroll(buildPayrollInput(ln)).otPay as number) || 0)}</span></div>
                          <div>Night Diff: <span className="font-mono">{peso((calculatePayroll(buildPayrollInput(ln)).nightDiffPay as number) || 0)}</span></div>
                          <div>RDOT: <span className="font-mono">{peso((calculatePayroll(buildPayrollInput(ln)).rdotPay as number) || 0)}</span></div>
                        </div>
                        <div className="space-y-1">
                          <div>
                            Gross Earnings:{" "}
                            <span className="font-mono">
                              {peso(((calculatePayroll(buildPayrollInput(ln)).grossEarnings as number) || 0) + (commTotals[ln.id] || 0))}
                            </span>
                          </div>
                          <div> Total Deductions: <span className="font-mono">{peso((calculatePayroll(buildPayrollInput(ln)).totalDeductions as number) || 0)}</span></div>
                          <div className="font-semibold">
                            Net Pay:{" "}
                            <span className="font-mono text-green-400">
                              {peso(((calculatePayroll(buildPayrollInput(ln)).netPay as number) || 0) + (commTotals[ln.id] || 0))}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

       {/* Commission Modal */}
{showCommModal && (
  <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
    <div className="w-full max-w-2xl bg-gray-900 border border-white/10 rounded-xl p-6">
      <h3 className="text-lg font-semibold mb-4">Add Commission</h3>
      <div className="max-h-64 overflow-y-auto pr-2 space-y-3">
        {commRows.map((row) => {
          const amt = Number(row.amount || 0);
          const pct = Number(row.percent || 0);
          //@ts-ignore
          const com =
            row.type === "sales"
              ? amt > 0 && pct > 0
                ? Math.round(((amt * pct) / 100) * 100) / 100
                : 0
              : amt > 0
              ? Math.round(amt * 100) / 100
              : 0;

          return (
            <div key={row.id} className="border-b border-white/10 pb-3 mb-3">
  {/* Top row: type, project, amount, percent, remove */}
  <div className="grid grid-cols-12 gap-2 items-end">
    {/* Type */}
    <div className="col-span-2">
      <label className="block text-sm text-gray-300 mb-1">Type</label>
      <select
        value={row.type}
        onChange={(e) => updateCommField(row.id, "type", e.target.value)}
        className="w-full bg-gray-800 border border-white/20 rounded px-3 py-2 text-white"
      >
        <option value="sales">Sales</option>
        <option value="others">Others</option>
      </select>
    </div>

    {/* Project */}
    <div className="col-span-4">
      <label className="block text-sm text-gray-300 mb-1">Project / Client</label>
      <input
        type="text"
        value={row.project}
        onChange={(e) => updateCommField(row.id, "project", e.target.value)}
        className="w-full bg-white/10 border border-white/20 rounded px-3 py-2 text-white"
      />
    </div>

    {/* Amount */}
    <div className="col-span-3">
      <label className="block text-sm text-gray-300 mb-1">Amount (₱)</label>
      <input
        type="number"
        min="0"
        value={row.amount}
        onChange={(e) => updateCommField(row.id, "amount", e.target.value)}
        className="w-full bg-white/10 border border-white/20 rounded px-3 py-2 text-white"
      />
    </div>

    {/* Percent (only sales) */}
    {row.type === "sales" ? (
      <div className="col-span-2">
        <label className="block text-sm text-gray-300 mb-1">% </label>
        <input
          type="number"
          min="0"
          max="100"
          value={row.percent}
          onChange={(e) => updateCommField(row.id, "percent", e.target.value)}
          className="w-full bg-white/10 border border-white/20 rounded px-3 py-2 text-white text-center"
          placeholder="0–100"
        />
      </div>
    ) : (
      <div className="col-span-2" />
    )}

    {/* Remove (✕) */}
    <div className="col-span-1 flex justify-end items-center">
      <button
        onClick={() => removeCommRow(row.id)}
        className="text-red-400 hover:text-red-300 text-lg leading-none"
        aria-label="Remove"
      >
        ✕
      </button>
    </div>
  </div>

  {/* Bottom row: Computed Comm */}
<div className="mt-2 bg-white/5 border border-white/10 rounded px-3 py-2 text-emerald-300 font-mono text-sm">
  Commission:{" "}
  {peso(
    row.type === "sales"
      ? Math.round((Number(row.amount || 0) * Number(row.percent || 0)) ) / 100
      : Math.round(Number(row.amount || 0) * 100) / 100
  )}
  </div>
</div>

          );
        })}

        {/* + Add row button */}
        <button
          onClick={addCommRow}
          className="text-blue-400 hover:text-blue-300 text-sm mt-2"
        >
          + Add Row
        </button>
      </div>

      {/* Actions */}
      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={() => setShowCommModal(false)}
          className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600"
        >
          Cancel
        </button>
        <button
          onClick={submitCommissionRows}
          className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500"
        >
          Save
        </button>
      </div>
    </div>
  </div>
)}

        {/* Freelancer Payment Modal */}
{showFPModal && (
  <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
    <div className="w-full max-w-2xl bg-gray-900 border border-white/10 rounded-xl p-6">
      <h3 className="text-lg font-semibold mb-4">Add Freelancer Payment</h3>

      {/* Freelancer Selector */}
      <div className="mb-4">
        <label className="block text-sm text-gray-300 mb-1">Freelancer</label>
        <select
          value={fpFreelancerId}
          onChange={(e) => setFpFreelancerId(e.target.value)}
          className="w-full bg-gray-800 border border-white/20 rounded px-3 py-2 text-white"
        >
          <option value="">Select freelancer…</option>
          {freelanceOptions.map((f) => (
            <option key={f.id} value={f.id} className="bg-gray-800 text-white">
              {f.name}
            </option>
          ))}
        </select>
      </div>

      {/* Dynamic Project Entries */}
      <div className="space-y-4">
        {fpEntries.map((entry, idx) => {
          const rowTotal = entry.qty * entry.rate;
          return (
            <div key={idx} className="grid grid-cols-12 gap-3 items-end">
              <div className="col-span-5">
                <label className="block text-sm text-gray-300 mb-1">Project</label>
                <input
                  type="text"
                  value={entry.project}
                  onChange={(e) => {
                    const copy = [...fpEntries];
                    copy[idx].project = e.target.value;
                    setFpEntries(copy);
                  }}
                  className="w-full bg-white/10 border border-white/20 rounded px-3 py-2 text-white"
                  placeholder="Project / Work description"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-300 mb-1">Qty</label>
                <input
                  type="number"
                  min="0"
                  value={entry.qty}
                  onChange={(e) => {
                    const copy = [...fpEntries];
                    copy[idx].qty = Number(e.target.value);
                    setFpEntries(copy);
                  }}
                  className="w-full bg-white/10 border border-white/20 rounded px-3 py-2 text-white"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-300 mb-1">Rate (₱)</label>
                <input
                  type="number"
                  min="0"
                  value={entry.rate}
                  onChange={(e) => {
                    const copy = [...fpEntries];
                    copy[idx].rate = Number(e.target.value);
                    setFpEntries(copy);
                  }}
                  className="w-full bg-white/10 border border-white/20 rounded px-3 py-2 text-white"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-300 mb-1">Total</label>
                <div className="px-3 py-2 bg-white/5 border border-white/10 rounded text-emerald-300 font-mono">
                  {peso(rowTotal)}
                </div>
              </div>
              <div className="col-span-1">
                {fpEntries.length > 1 && (
                  <button
                    onClick={() =>
                      setFpEntries(fpEntries.filter((_, i) => i !== idx))
                    }
                    className="text-red-400 hover:text-red-300"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Add New Project Row */}
        <button
          onClick={() =>
            setFpEntries([...fpEntries, { project: "", qty: 1, rate: 0 }])
          }
          className="mt-2 px-3 py-1.5 text-sm rounded bg-blue-700 hover:bg-blue-600"
        >
          ➕ Add Project
        </button>
      </div>

      {/* Grand Total */}
      <div className="mt-6 flex justify-between items-center border-t border-white/10 pt-4">
        <span className="text-gray-300 font-medium">Grand Total:</span>
        <span className="text-xl font-bold text-emerald-400 font-mono">
          {peso(fpEntries.reduce((sum, e) => sum + e.qty * e.rate, 0))}
        </span>
      </div>

      {/* Actions */}
      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={() => setShowFPModal(false)}
          className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600"
        >
          Cancel
        </button>
        <button
          onClick={submitFreelancerPayment}
          className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500"
        >
          Save Payment
        </button>
      </div>
    </div>
  </div>
)}
        <div className="mt-6 text-xs text-gray-400">
          • Employee names come from <code>/employees.name</code> (never alias). • Monthly &amp; per-day baselines are
          fetched from <code>/employees</code> and normalized for <code>payrollLogic</code>. • Owners are auto-added. •
          Net previews include commissions.
        </div>
      </div>
    </div>
  );
}
