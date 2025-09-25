// src/pages/FinanceDashboard.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../firebase/firebase";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit as fsLimit,
} from "firebase/firestore";

/* ───────── utils ───────── */
function toDate(v: any): Date | null {
  try {
    if (!v) return null;
    if (typeof v?.toDate === "function") return v.toDate();
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/* ───────── types ───────── */
type PayrollDraft = {
  id: string;
  status: "draft" | "finance_review" | "pending_exec" | "pending_admin" | "approved" | "published";
  cutoffLabel?: string;
  periodKey?: string;
  createdAt?: any;
};

type ReqRow = {
  id: string;
  employeeName?: string;
  filedBy?: string;
  filedAt?: any;
  type?: string;
  status?: string;
};

type ActivityRow = {
  id: string;
  kind?: "request" | "budget" | "cashAdvance" | "payrollDraft";
  action?: "approved" | "rejected";
  actorName?: string;
  actorEmail?: string;
  ts?: any;
};

const FinanceDashboard: React.FC = () => {
  const navigate = useNavigate();

  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      return {};
    }
  }, []);

  /* ───────── state ───────── */
  const [loading, setLoading] = useState(true);

  const [employeesCount, setEmployeesCount] = useState(0);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const [pendingBudgetsCount, setPendingBudgetsCount] = useState(0);
  const [pendingCashAdvCount, setPendingCashAdvCount] = useState(0);
  const [draftPayrollCount, setDraftPayrollCount] = useState(0);

  const [openDrafts, setOpenDrafts] = useState<PayrollDraft[]>([]);
  const [pendingRequests, setPendingRequests] = useState<ReqRow[]>([]);
  const [activities, setActivities] = useState<ActivityRow[]>([]);

  /* ───────── load ───────── */
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // Employees
        const empSnap = await getDocs(collection(db, "employees"));
        setEmployeesCount(empSnap.size);

        // Requests (pending)
        const reqSnap = await getDocs(
          query(collection(db, "requests"), where("status", "==", "pending"))
        );
        setPendingRequestsCount(reqSnap.size);

        // Budgets (pending)
        const budSnap = await getDocs(
          query(collection(db, "budgets"), where("status", "==", "pending"))
        );
        setPendingBudgetsCount(budSnap.size);

        // Cash Advances (pending) — dedicated coll, else fallback to requests
        let caCount = 0;
        const caSnap = await getDocs(
          query(collection(db, "cashAdvances"), where("status", "==", "pending"))
        );
        if (caSnap.size > 0) {
          caCount = caSnap.size;
        } else {
          const caReq = await getDocs(
            query(
              collection(db, "requests"),
              where("type", "==", "CA"),
              where("status", "==", "pending")
            )
          );
          caCount = caReq.size;
        }
        setPendingCashAdvCount(caCount);

        // Payroll drafts: count "draft" + "finance_review"
        const pdDraft = await getDocs(
          query(collection(db, "payrollDrafts"), where("status", "==", "draft"))
        );
        const pdReview = await getDocs(
          query(collection(db, "payrollDrafts"), where("status", "==", "finance_review"))
        );
        setDraftPayrollCount(pdDraft.size + pdReview.size);

        // Open drafts list (newest across draft + finance_review)
        const listDrafts: PayrollDraft[] = [];
        pdDraft.forEach((d) => listDrafts.push({ id: d.id, ...(d.data() as any) }));
        pdReview.forEach((d) => listDrafts.push({ id: d.id, ...(d.data() as any) }));
        listDrafts.sort(
          (a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0)
        );
        setOpenDrafts(listDrafts.slice(0, 6));

        // Pending requests list (newest)
        const reqListSnap = await getDocs(
          query(collection(db, "requests"), where("status", "==", "pending"), fsLimit(6))
        );
        const reqList: ReqRow[] = [];
        reqListSnap.forEach((d) => reqList.push({ id: d.id, ...(d.data() as any) }));
        reqList.sort(
          (a, b) => (toDate(b.filedAt)?.getTime() || 0) - (toDate(a.filedAt)?.getTime() || 0)
        );
        setPendingRequests(reqList);

        // Activity feed
        const actSnap = await getDocs(
          query(collection(db, "approvalHistory"), orderBy("ts", "desc"), fsLimit(8))
        );
        const acts: ActivityRow[] = [];
        actSnap.forEach((d) => acts.push({ id: d.id, ...(d.data() as any) }));
        setActivities(acts);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ───────── derived ───────── */
  const stats = [
    {
      label: "Employees",
      value: employeesCount,
      bg: "bg-blue-500/12",
      ring: "ring-1 ring-blue-400/20",
      onClick: () => navigate("/finance/employees"),
    },
    {
      label: "Pending Requests",
      value: pendingRequestsCount,
      bg: "bg-amber-500/12",
      ring: "ring-1 ring-amber-400/20",
      onClick: () => navigate("/finance/approvals"),
    },
    {
      label: "Draft/Review Payrolls",
      value: draftPayrollCount,
      bg: "bg-emerald-500/12",
      ring: "ring-1 ring-emerald-400/20",
      onClick: () => navigate("/finance/payroll"),
    },
    {
      label: "Pending CAs / Budgets",
      value: `${pendingCashAdvCount} / ${pendingBudgetsCount}`,
      bg: "bg-purple-500/12",
      ring: "ring-1 ring-purple-400/20",
      onClick: () => navigate("/finance/approvals?tab=cashadvance"),
    },
  ];

  const quickActions = [
    { label: "Employees", icon: "👥", path: "/finance/employees" },
    { label: "Upload Attendance", icon: "📊", path: "/finance/attendance" },
    { label: "Generate Payroll", icon: "💰", path: "/finance/payroll/generate" },
    { label: "Approvals", icon: "✅", path: "/finance/approvals" },
    { label: "Cash Advances", icon: "💸", path: "/finance/approvals?tab=cashadvance" },
    { label: "Reports", icon: "📈", path: "/finance/reports" },
  ];

  /* ───────── UI ───────── */
  return (
    <div className="min-h-screen bg-gray-900 text-white pt-20 px-4 sm:px-6 lg:px-8 pb-12">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <header className="flex flex-col items-center text-center gap-2 sm:flex-row sm:items-end sm:justify-between sm:text-left">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Finance Dashboard
            </h1>
            <p className="text-gray-300 mt-1">
              Hi, <span className="font-semibold text-white">{user.displayName || "User"}</span>. Stay on top of finance ops.
            </p>
          </div>
          <div className="text-xs sm:text-sm text-gray-400">{new Date().toLocaleString()}</div>
        </header>

        {/* Stats */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((s, idx) => (
            <button
              key={idx}
              onClick={s.onClick}
              className={`group rounded-2xl ${s.bg} ${s.ring} border border-white/10 hover:border-white/20 transition focus:outline-none`}
            >
              <div className="h-full w-full p-5 flex flex-col items-center justify-center text-center gap-1">
                <p className="text-sm text-gray-300">{s.label}</p>
                <p className="text-3xl font-black tracking-tight">
                  {loading ? "…" : s.value}
                </p>
              </div>
            </button>
          ))}
        </section>

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Quick Actions */}
          <section className="rounded-2xl border border-white/10 bg-gray-800/40 p-5">
            <h2 className="text-lg font-semibold text-center sm:text-left mb-4">Quick Actions</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {quickActions.map((a, i) => (
                <button
                  key={i}
                  onClick={() => navigate(a.path)}
                  className="flex items-center justify-center gap-3 p-3.5 bg-gray-900/40 hover:bg-gray-900/60 rounded-xl border border-white/10 transition text-center"
                >
                  <span className="text-xl">{a.icon}</span>
                  <span className="text-white font-medium">{a.label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Open Payroll Drafts */}
          <section className="lg:col-span-2 rounded-2xl border border-white/10 bg-gray-800/40 p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
              <h2 className="text-lg font-semibold text-center sm:text-left">Open Payroll Drafts</h2>
              <button
                onClick={() => navigate("/finance/payroll")}
                className="text-blue-400 hover:text-blue-300 text-sm self-center"
              >
                View all →
              </button>
            </div>
            {loading ? (
              <div className="text-gray-400 p-6 text-center">Loading drafts…</div>
            ) : openDrafts.length === 0 ? (
              <div className="text-gray-400 p-6 text-center">No drafts in progress.</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full">
                  <thead className="text-sm text-gray-300 border-b border-white/10 bg-gray-800/60">
                    <tr>
                      <th className="text-left py-2.5 px-3">Cutoff</th>
                      <th className="text-left py-2.5 px-3">Status</th>
                      <th className="text-left py-2.5 px-3">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openDrafts.map((d) => (
                      <tr key={d.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="py-2.5 px-3">{d.cutoffLabel || d.periodKey || d.id}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2.5 py-0.5 rounded-full border text-xs ${
                              d.status === "finance_review"
                                ? "bg-amber-500/15 text-amber-300 border-amber-400/30"
                                : "bg-blue-500/15 text-blue-300 border-blue-400/30"
                            }`}
                          >
                            {d.status.replace("_", " ")}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-sm text-gray-300">
                          {toDate(d.createdAt)?.toLocaleString() || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Pending Requests */}
          <section className="rounded-2xl border border-white/10 bg-gray-800/40 p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
              <h2 className="text-lg font-semibold text-center sm:text-left">Pending Requests</h2>
              <button
                onClick={() => navigate("/finance/approvals")}
                className="text-blue-400 hover:text-blue-300 text-sm self-center"
              >
                Review →
              </button>
            </div>
            {loading ? (
              <div className="text-gray-400 p-4 text-center">Loading requests…</div>
            ) : pendingRequests.length === 0 ? (
              <div className="text-gray-400 p-4 text-center">No pending requests.</div>
            ) : (
              <ul className="divide-y divide-white/10">
                {pendingRequests.map((r) => (
                  <li key={r.id} className="py-3 flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {r.employeeName || r.filedBy || "Request"}
                      </p>
                      <p className="text-xs text-gray-400">
                        {String(r.type || "").toUpperCase()} •{" "}
                        {toDate(r.filedAt)?.toLocaleDateString() || "—"}
                      </p>
                    </div>
                    <span className="text-xs text-amber-300 border border-amber-400/30 bg-amber-500/10 rounded-full px-2 py-0.5">
                      pending
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Recent Activity */}
          <section className="lg:col-span-2 rounded-2xl border border-white/10 bg-gray-800/40 p-5">
            <h2 className="text-lg font-semibold mb-4 text-center sm:text-left">Recent Activity</h2>
            {loading ? (
              <div className="text-gray-400 p-4 text-center">Loading activity…</div>
            ) : activities.length === 0 ? (
              <div className="text-gray-400 p-4 text-center">No recent activity recorded.</div>
            ) : (
              <ul className="divide-y divide-white/10">
                {activities.map((a) => (
                  <li key={a.id} className="py-3 flex items-center justify-between">
                    <div className="min-w-0 pr-3">
                      <p className="truncate">
                        <span className="text-gray-300">
                          {a.actorName || a.actorEmail || "Someone"}
                        </span>{" "}
                        <span className="text-white font-semibold">
                          {a.action === "approved" ? "approved" : "rejected"}
                        </span>{" "}
                        <span className="text-gray-300">
                          {a.kind === "request"
                            ? "a request"
                            : a.kind === "budget"
                            ? "a budget"
                            : a.kind === "cashAdvance"
                            ? "a cash advance"
                            : "a payroll draft"}
                        </span>
                      </p>
                    </div>
                    <div className="text-xs text-gray-400">
                      {toDate(a.ts)?.toLocaleString() || "—"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default FinanceDashboard;
