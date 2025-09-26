// src/pages/Dashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { getAuth } from "firebase/auth";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../../firebase/firebase";

/* ========================= Types ========================= */
type EmpType = "core" | "intern" | "freelancer";
type MyEmployee = {
  id: string;
  employeeId: string; // e.g. EMP001
  name: string;
  email: string;
  type: EmpType;
};

type ReqType =
  | "ob"
  | "ot"
  | "sl"
  | "bl"
  | "vl"
  | "remotework"
  | "wfh"
  | "rdot"
  | "CA";
type RequestDoc = {
  id: string;
  employeeId: string;
  employeeName: string;
  type: ReqType;
  status: "pending" | "approved" | "rejected";
  filedAt?: any;
  filedBy: string;
  details: any;
};

type Payslip = {
  id: string;
  employeeId: string;
  employeeEmail?: string;
  employeeAlias?: string;
  periodKey?: string;
  cutoffLabel?: string;
  netPay?: number;
  createdAt?: any;
};

type Budget = {
  id: string;
  requesterId?: string;
  filedBy?: string;
  title?: string;
  amount?: number;
  filedAt?: any;
};

type Holiday = {
  id: string;
  name: string;
  date: any;
  recurring: boolean;
};

/* ========================= Helpers ========================= */
function peso(n?: number) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return `₱${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
function toDate(v: any): Date | null {
  try {
    if (!v) return null;
    if (typeof v?.toDate === "function") return v.toDate();
    if (v instanceof Date) return v;
    if (typeof v === "string") {
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  } catch {
    return null;
  }
}
function fmtWhen(ts?: any) {
  const d = toDate(ts);
  return d ? d.toLocaleString() : "—";
}
function statusBadge(status: string) {
  if (status === "approved")
    return "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30";
  if (status === "rejected")
    return "bg-rose-500/15 text-rose-300 border border-rose-500/30";
  return "bg-amber-500/15 text-amber-200 border border-amber-500/30";
}
async function safeGetDocs<T = any>(q: any): Promise<T[]> {
  try {
    const s = await getDocs(q);
    const out: T[] = [];
    s.forEach((d: any) => out.push({ id: d.id, ...(d.data() as any) }));
    return out;
  } catch {
    return [];
  }
}

/* ========================= Page ========================= */
export default function Dashboard() {
  const auth = getAuth();
  const me = auth.currentUser;
  const myEmail = (me?.email || "").toLowerCase();
  const myUid = me?.uid || "";

  const [loading, setLoading] = useState(true);
  const [emp, setEmp] = useState<MyEmployee | null>(null);
  const [requests, setRequests] = useState<RequestDoc[]>([]);
  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);

  const pendingCount = useMemo(
    () => requests.filter((r) => r.status === "pending").length,
    [requests]
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        /* ========= Employee ========= */
        const empSnap = await safeGetDocs<MyEmployee>(collection(db, "employees"));
        const meEmp =
          empSnap.find(
            (x) =>
              (x as any).email &&
              (x as any).email.toLowerCase() === myEmail
          ) || null;

        setEmp(
          meEmp
            ? {
                id: (meEmp as any).id,
                employeeId: (meEmp as any).employeeId || "", // EMP001
                name: (meEmp as any).name || "",
                email: (meEmp as any).email || myEmail,
                type: ((meEmp as any).type as EmpType) || "core",
              }
            : null
        );

        const employeeIdCode = meEmp?.employeeId || myUid;

        /* ========= Requests ========= */
        let reqs: RequestDoc[] = [];
        if (myEmail) {
          reqs = await safeGetDocs<RequestDoc>(
            query(collection(db, "requests"), where("filedBy", "==", myEmail), limit(20))
          );
        }
        if (reqs.length === 0 && employeeIdCode) {
          reqs = await safeGetDocs<RequestDoc>(
            query(collection(db, "requests"), where("employeeId", "==", employeeIdCode), limit(20))
          );
        }
        reqs.sort(
          (a, b) => (toDate(b.filedAt)?.getTime() || 0) - (toDate(a.filedAt)?.getTime() || 0)
        );
        setRequests(reqs);

        /* ========= Payslips ========= */
        let slips: Payslip[] = [];
        if (employeeIdCode) {
          slips = await safeGetDocs<Payslip>(
            query(collection(db, "payslips"), where("employeeId", "==", employeeIdCode), limit(10))
          );
        }
        if (slips.length === 0 && myEmail) {
          slips = await safeGetDocs<Payslip>(
            query(collection(db, "payslips"), where("employeeEmail", "==", myEmail), limit(10))
          );
        }
        slips.sort(
          (a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0)
        );
        setPayslip(slips[0] || null);

        /* ========= Budgets ========= */
      let budgetsArr: Budget[] = [];
      if (emp?.employeeId) {
        budgetsArr = await safeGetDocs<Budget>(
          query(collection(db, "budgets"), where("requesterId", "==", emp.employeeId), limit(10))
        );
      }
      if (budgetsArr.length === 0 && myEmail) {
        budgetsArr = await safeGetDocs<Budget>(
          query(collection(db, "budgets"), where("requesterEmail", "==", myEmail), limit(10))
        );
      }
      budgetsArr.sort(
        (a, b) => (toDate(b.filedAt)?.getTime() || 0) - (toDate(a.filedAt)?.getTime() || 0)
      );
      setBudgets(budgetsArr);


        /* ========= Holidays ========= */
        const hols = await safeGetDocs<Holiday>(query(collection(db, "holidays"), limit(100)));
        hols.sort((a, b) => (toDate(a.date)?.getTime() || 0) - (toDate(b.date)?.getTime() || 0));
        setHolidays(hols);
      } finally {
        setLoading(false);
      }
    })();
  }, [myEmail, myUid]);

  /* ========= Upcoming Holidays ========= */
  const upcomingHolidays = useMemo(() => {
    const today = new Date();
    const soon = new Date();
    soon.setDate(soon.getDate() + 60);
    const curYear = today.getFullYear();

    const parse = (h: Holiday) => {
      const d = toDate(h.date);
      if (!d) return null;
      if (h.recurring) {
        const [month, day] = [d.getMonth(), d.getDate()];
        return new Date(curYear, month, day);
      }
      return d;
    };

    return holidays
      .map((h) => ({ ...h, _d: parse(h) }))
      .filter((x) => x._d && x._d >= today && x._d <= soon)
      .sort((a, b) => (a._d as Date).getTime() - (b._d as Date).getTime())
      .slice(0, 6);
  }, [holidays]);

  /* ========= UI ========= */
  return (
    <div className="min-h-screen bg-gray-900 text-white rounded-2xl pt-20 pb-28">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Header */}
        <header className="space-y-1">
          <h1 className="text-3xl font-bold">
            {emp?.name ? `Welcome, ${emp.name.split(" ")[0]}!` : "Welcome!"}
          </h1>
          <p className="text-gray-400">
            Your requests, payslips, budgets, and holidays at a glance.
          </p>
        </header>

        {/* Profile · Stats · Holidays */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card padded>
            <div className="flex items-start gap-4">
              <div className="h-14 w-14 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-2xl">
                👤
              </div>
              <div className="min-w-0">
                <div className="text-lg font-semibold truncate">{emp?.name || "Employee"}</div>
                <div className="text-sm text-gray-300 truncate">{emp?.email || myEmail || "—"}</div>
                <div className="mt-1 text-xs text-gray-400">
                  <span className="mr-2">ID: {emp?.employeeId || "—"}</span>
                  <span>Type: {emp?.type || "—"}</span>
                </div>
              </div>
            </div>
          </Card>

          <Card padded>
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Pending Requests" value={loading ? "…" : String(pendingCount)} />
              <Stat
                label="Latest Net Pay"
                value={loading ? "…" : payslip ? peso(payslip.netPay) : "—"}
              />
            </div>
          </Card>

          <Card header="Upcoming Holidays" padded>
            {!loading && upcomingHolidays.length === 0 ? (
              <Empty small text="No upcoming holidays." />
            ) : (
              <div className="space-y-2">
                {(loading ? Array.from({ length: 3 }) : upcomingHolidays).map((h: any, i) => (
                  <div
                    key={h?.id || i}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-gray-800/40 px-3 py-2"
                  >
                    <div>
                      <div className="text-sm font-medium">{loading ? "…" : h.name}</div>
                      <div className="text-xs text-gray-400">
                        {loading ? "…" : (h._d as Date)?.toLocaleDateString()}
                        {loading ? "" : h.recurring ? " · annual" : ""}
                      </div>
                    </div>
                    🎉
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Requests */}
        <Card header="Your Recent Requests" padded>
          {loading ? (
            <SkeletonRows rows={4} />
          ) : requests.length === 0 ? (
            <Empty text="You haven’t filed any requests yet." />
          ) : (
            <div className="divide-y divide-white/10">
              {requests.slice(0, 6).map((r) => (
                <div key={r.id} className="py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {r.type.toUpperCase()} ·{" "}
                      <span className="text-gray-300">{r.details?.date || "—"}</span>
                    </div>
                    <div className="text-xs text-gray-400">Filed {fmtWhen(r.filedAt)}</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-md text-[11px] ${statusBadge(r.status)}`}>
                    {r.status.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Payslip */}
        <Card header="Latest Payslip" padded>
          {loading ? (
            <SkeletonRows rows={2} />
          ) : !payslip ? (
            <Empty text="Your payslip will appear here when available." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Info label="Period" value={payslip.cutoffLabel || payslip.periodKey || "—"} />
              <Info label="Net Pay" value={peso(payslip.netPay)} />
              <Info label="Released" value={fmtWhen(payslip.createdAt)} />
              <Info label="Employee ID" value={emp?.employeeId || payslip.employeeId || "—"} />
            </div>
          )}
        </Card>

       {/* Budgets */}
      <Card header="Recent Budgets" padded>
        {loading ? (
          <SkeletonRows rows={3} />
        ) : budgets.length === 0 ? (
          <Empty text="No budgets filed yet." />
        ) : (
          <div className="space-y-3">
            {budgets.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-gray-800/50 p-4 hover:bg-gray-800/70 transition"
              >
                {/* Left side */}
                <div className="min-w-0 text-left">
                  <div className="text-sm text-gray-400">Budget</div>
                  <div className="text-base font-semibold text-white truncate">
                    {b.title || "Untitled Budget"}
                  </div>
                  <div className="text-sm text-gray-300 mt-1">{peso(b.amount)}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    Filed {fmtWhen(b.filedAt)}
                  </div>
                </div>

                {/* Status */}
                <span
                  className={`px-3 py-1 rounded-full text-xs font-semibold ${statusBadge(
                    (b as any).status || "pending"
                  )}`}
                >
                  {((b as any).status || "pending").toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
      </div>
    </div>
  );
}

/* ========================= UI Bits ========================= */
function Card({ header, padded = false, children }: { header?: string; padded?: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-gray-800/40 shadow-md shadow-black/20">
      {header && (
        <div className="px-4 sm:px-6 py-3 border-b border-white/10 text-sm font-semibold text-gray-200">
          {header}
        </div>
      )}
      <div className={padded ? "px-4 sm:px-6 py-4 space-y-2" : ""}>{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-gray-800/40 p-4 text-center">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function Empty({ text, small = false }: { text: string; small?: boolean }) {
  return <div className={`text-center text-gray-400 ${small ? "py-2" : "py-8"}`}>{text}</div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-gray-800/40 p-4">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="mt-1 text-base font-semibold">{value}</div>
    </div>
  );
}

function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-10 rounded-xl bg-gradient-to-r from-gray-800/50 via-gray-700/40 to-gray-800/50 animate-pulse"
        />
      ))}
    </div>
  );
}
