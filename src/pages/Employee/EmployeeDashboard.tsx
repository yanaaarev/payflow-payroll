// src/pages/Dashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { getAuth } from "firebase/auth";
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../../firebase/firebase";

/* ========================= Types ========================= */
type EmpType = "core" | "intern" | "freelancer";
type MyEmployee = {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  type: EmpType;
};

type ReqType = "ob" | "ot" | "sl" | "bl" | "vl" | "remotework" | "wfh" | "rdot" | "CA";
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
  periodKey?: string;
  cutoffLabel?: string;
  netPay?: number;
  releasedAt?: any;
};

type NotificationDoc = {
  id: string;
  toUid?: string;
  toEmail?: string;
  kind: string;
  title: string;
  body?: string;
  createdAt?: any;
  readBy?: string[];
};

type Holiday = {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  recurring: boolean;
};

/* ========================= Helpers ========================= */
function peso(n?: number) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function toDate(v: any): Date | null {
  try {
    if (!v) return null;
    if (typeof v?.toDate === "function") return v.toDate();
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
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
//@ts-ignore
async function safeGetDoc<T = any>(ref: any): Promise<T | null> {
  try {
    const s = await getDoc(ref);
    return s.exists() ? ({ id: s.id, ...(s.data() as any) } as T) : null;
  } catch {
    return null;
  }
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
  const [notes, setNotes] = useState<NotificationDoc[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);

  const pendingCount = useMemo(
    () => requests.filter((r) => r.status === "pending").length,
    [requests]
  );
  const unreadCount = useMemo(
    () => notes.filter((n) => !(n.readBy || []).includes(myUid)).length,
    [notes, myUid]
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // Employee by email
        const empSnap = await safeGetDocs<MyEmployee>(collection(db, "employees"));
        const meEmp =
          empSnap.find(
            (x) => (x as any).email && (x as any).email.toLowerCase() === myEmail
          ) || null;
        setEmp(
          meEmp
            ? {
                id: (meEmp as any).id,
                employeeId: (meEmp as any).employeeId || "",
                name: (meEmp as any).name || "",
                email: (meEmp as any).email || myEmail,
                type: ((meEmp as any).type as EmpType) || "core",
              }
            : null
        );

        // My requests
        if (myEmail) {
          const rq = query(
            collection(db, "requests"),
            where("filedBy", "==", myEmail),
            orderBy("filedAt", "desc"),
            limit(10)
          );
          const reqArr = await safeGetDocs<RequestDoc>(rq);
          setRequests(reqArr);
        } else setRequests([]);

        // My payslip by email, fallback by employeeId
        let latestPayslip: Payslip | null = null;
        if (myEmail) {
          const pq = query(
            collection(db, "payslips"),
            where("employeeEmail", "==", myEmail),
            orderBy("releasedAt", "desc"),
            limit(1)
          );
          const p1 = await safeGetDocs<Payslip>(pq);
          latestPayslip = p1[0] || null;
        }
        if (!latestPayslip && (meEmp as any)?.employeeId) {
          const pq2 = query(
            collection(db, "payslips"),
            where("employeeId", "==", (meEmp as any).employeeId),
            orderBy("releasedAt", "desc"),
            limit(1)
          );
          const p2 = await safeGetDocs<Payslip>(pq2);
          latestPayslip = p2[0] || null;
        }
        setPayslip(latestPayslip);

        // My notifications (two queries merged)
        const byUid = myUid
          ? await safeGetDocs<NotificationDoc>(
              query(
                collection(db, "notifications"),
                where("toUid", "==", myUid),
                orderBy("createdAt", "desc"),
                limit(20)
              )
            )
          : [];
        const byEmail = myEmail
          ? await safeGetDocs<NotificationDoc>(
              query(
                collection(db, "notifications"),
                where("toEmail", "==", myEmail),
                orderBy("createdAt", "desc"),
                limit(20)
              )
            )
          : [];
        const merged = [...byUid, ...byEmail].reduce<NotificationDoc[]>((acc, cur) => {
          if (!acc.find((x) => x.id === cur.id)) acc.push(cur);
          return acc;
        }, []);
        merged.sort(
          (a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0)
        );
        setNotes(merged.slice(0, 20));

        // Holidays
        const hq = query(
          collection(db, "settings", "holidays"),
          orderBy("date", "asc"),
          limit(100)
        );
        const hArr = await safeGetDocs<Holiday>(hq);
        setHolidays(hArr);
      } finally {
        setLoading(false);
      }
    })();
  }, [myEmail, myUid]);

  async function markNoteRead(id: string) {
    if (!myUid) return;
    try {
      const ref = doc(db, "notifications", id);
      await updateDoc(ref, { readBy: arrayUnion(myUid) });
      setNotes((prev) =>
        prev.map((n) =>
          n.id === id
            ? { ...n, readBy: Array.from(new Set([...(n.readBy || []), myUid])) }
            : n
        )
      );
    } catch (e) {
      console.warn("mark read failed", e);
    }
  }

  // Upcoming holidays (next 60 days)
  // Upcoming holidays (next 60 days)
const upcomingHolidays = useMemo(() => {
  const today = new Date();
  const soon = new Date();
  soon.setDate(soon.getDate() + 60);
  const curYear = today.getFullYear();

  const parse = (h: Holiday) => {
    if (!h.date) return null;
    //@ts-ignore
    const [yyyy, mm, dd] = h.date.split("-");
    const d = new Date(h.recurring ? `${curYear}-${mm}-${dd}` : h.date);
    return isNaN(d.getTime()) ? null : d;
  };

  return holidays
    .map((h) => ({ ...h, _d: parse(h) }))
    .filter(
      (x) =>
        x._d &&
        (x._d as Date).getTime() >= today.getTime() &&
        (x._d as Date).getTime() <= soon.getTime()
    )
    .sort(
      (a: any, b: any) =>
        (a._d as Date).getTime() - (b._d as Date).getTime()
    )
    .slice(0, 6);
}, [holidays]);


  return (
    <div className="min-h-screen bg-gray-900 text-white pt-20 pb-28">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* ===== Header ===== */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            {emp?.name ? `Welcome, ${emp.name.split(" ")[0]}!` : "Welcome!"}
          </h1>
          <p className="mt-1 text-gray-300">
            A tidy overview of your requests, notifications, payslips, and upcoming holidays.
          </p>
        </div>

        {/* ===== Top Row: Profile · Stats · Holidays ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Profile */}
          <Card padded>
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
                <span className="text-lg">👤</span>
              </div>
              <div className="min-w-0">
                <div className="text-base sm:text-lg font-semibold truncate">
                  {emp?.name || "Employee"}
                </div>
                <div className="text-sm text-gray-300 truncate">
                  {emp?.email || myEmail || "—"}
                </div>
                <div className="mt-1 text-xs text-gray-400">
                  <span className="mr-2">
                    ID: <span className="text-gray-200">{emp?.employeeId || "—"}</span>
                  </span>
                  <span>
                    Type: <span className="text-gray-200 capitalize">{emp?.type || "—"}</span>
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* Quick Stats */}
          <Card padded>
            <div className="grid grid-cols-3 gap-3 sm:gap-4">
              <Stat
                label="Pending Requests"
                value={loading ? "…" : String(pendingCount)}
                hint="Awaiting action"
              />
              <Stat
                label="Unread Notices"
                value={loading ? "…" : String(unreadCount)}
                hint="Tap to read"
              />
              <Stat
                label="Latest Net Pay"
                value={loading ? "…" : payslip ? peso(payslip.netPay) : "—"}
                hint={payslip?.cutoffLabel || payslip?.periodKey || ""}
              />
            </div>
          </Card>

          {/* Upcoming Holidays */}
          <Card header="Upcoming Holidays" padded>
            <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
              <span>Next 60 days</span>
            </div>
            {!loading && upcomingHolidays.length === 0 ? (
              <Empty small text="No upcoming holidays." />
            ) : (
              <div className="space-y-2">
                {(loading ? Array.from({ length: 3 }) : upcomingHolidays).map((h: any, i) => (
                  <div
                    key={h?.id || i}
                    className="flex items-center justify-between rounded-lg border border-white/10 bg-gray-800/40 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{loading ? "…" : h.name}</div>
                      <div className="text-xs text-gray-400">
                        {loading ? "…" : (h._d as Date)?.toLocaleDateString()}
                        {loading ? "" : h.recurring ? " · repeats annually" : ""}
                      </div>
                    </div>
                    <span className="text-lg">🎉</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ===== Two Column: Requests · Notifications ===== */}
        <div className="mt-4 sm:mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
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
                      <div className="mt-0.5 text-xs text-gray-400">
                        Filed {fmtWhen(r.filedAt)}
                        {r.details?.title ? ` · ${r.details.title}` : ""}
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-md text-[11px] ${statusBadge(r.status)}`}>
                      {r.status.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Notifications */}
          <Card header="Notifications" padded>
            {loading ? (
              <SkeletonRows rows={4} />
            ) : notes.length === 0 ? (
              <Empty text="No notifications yet." />
            ) : (
              <div className="space-y-3">
                {notes.slice(0, 8).map((n) => {
                  const isRead = (n.readBy || []).includes(myUid);
                  return (
                    <div
                      key={n.id}
                      className={`rounded-xl border px-4 py-3 ${
                        isRead ? "bg-gray-800/30 border-white/10" : "bg-blue-600/10 border-blue-500/30"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">{n.title}</div>
                          {n.body && (
                            <div className="mt-0.5 text-xs text-gray-300 line-clamp-2">{n.body}</div>
                          )}
                          <div className="mt-1 text-[11px] text-gray-400">{fmtWhen(n.createdAt)}</div>
                        </div>
                        {!isRead && (
                          <button
                            onClick={() => markNoteRead(n.id)}
                            className="text-xs px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-500"
                            title="Mark as read"
                          >
                            Mark read
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* ===== Payslip ===== */}
        <div className="mt-4 sm:mt-6">
          <Card header="Latest Payslip" padded>
            {loading ? (
              <SkeletonRows rows={2} />
            ) : !payslip ? (
              <Empty text="Your payslip will appear here when available." />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 sm:gap-4">
                <Info label="Period" value={payslip.cutoffLabel || payslip.periodKey || "—"} />
                <Info label="Net Pay" value={peso(payslip.netPay)} />
                <Info label="Released" value={fmtWhen(payslip.releasedAt)} />
                <Info label="Employee ID" value={payslip.employeeId || emp?.employeeId || "—"} />
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* local styles (consistent paddings & rounded) */}
      <style>{`
        .card-shell {
          border-radius: 1rem;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(31,41,55,0.45);
        }
      `}</style>
    </div>
  );
}

/* ========================= UI Bits ========================= */
function Card({
  header,
  padded = false,
  children,
}: {
  header?: string;
  padded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="card-shell">
      {header && (
        <div className="px-4 sm:px-5 lg:px-6 py-3 border-b border-white/10 text-sm font-semibold">
          {header}
        </div>
      )}
      <div className={`${padded ? "px-4 sm:px-5 lg:px-6 py-4" : ""}`}>{children}</div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-gray-800/40 p-3 sm:p-4">
      <div className="text-[11px] sm:text-xs text-gray-400">{label}</div>
      <div className="mt-1 text-xl sm:text-2xl font-bold leading-tight">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-gray-400 truncate">{hint}</div>}
    </div>
  );
}

function Empty({ text, small = false }: { text: string; small?: boolean }) {
  return <div className={`text-center text-gray-400 ${small ? "py-2" : "py-8"}`}>{text}</div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-gray-800/40 p-3 sm:p-4">
      <div className="text-[11px] sm:text-xs text-gray-400">{label}</div>
      <div className="mt-1 text-sm sm:text-base font-semibold truncate">{value}</div>
    </div>
  );
}

function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-10 rounded-lg bg-gradient-to-r from-gray-800/50 via-gray-700/40 to-gray-800/50 animate-pulse"
        />
      ))}
    </div>
  );
}
