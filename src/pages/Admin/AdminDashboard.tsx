// src/pages/AdminDashboard.tsx
// ✅ No Navbar import — handled in your Layout
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAuth } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  query,
  where,
  orderBy,
  limit as fsLimit,
} from "firebase/firestore";
import { db } from "../../firebase/firebase";

/* ========================= Types / Roles ========================= */
type Role = "admin_final" | "admin_overseer" | "exec" | "finance" | "employee";

const OWNER_ADMIN_FINAL = {
  email: "jelynsonbattung@gmail.com",
  uid: "XddCcBNNErU0uTwcY3wb9whOoM83",
};
const OWNER_ADMIN_OVERSEER = {
  email: "jropatpat@gmail.com",
  uid: "azDiemn8ArZTLbpMLy7yyxijW2Z2",
};

function mapUserRolesToPageRoles({
  uid,
  email,
  rolesFromUsers,
}: {
  uid?: string;
  email?: string;
  rolesFromUsers?: string[];
}): Role[] {
  const lowerEmail = (email || "").toLowerCase();
  if (uid === OWNER_ADMIN_FINAL.uid || lowerEmail === OWNER_ADMIN_FINAL.email) return ["admin_final"];
  if (uid === OWNER_ADMIN_OVERSEER.uid || lowerEmail === OWNER_ADMIN_OVERSEER.email)
    return ["admin_overseer"];

  const raw = Array.isArray(rolesFromUsers) ? rolesFromUsers.map(String) : [];
  const out = new Set<Role>();
  if (raw.some((r) => r.toLowerCase() === "admin")) out.add("admin_final");
  if (raw.some((r) => r.toLowerCase() === "exec")) out.add("exec");
  if (raw.some((r) => r.toLowerCase() === "finance")) out.add("finance");
  if (out.size === 0) out.add("employee");
  return Array.from(out);
}
function hasRole(roles: Role[], r: Role) {
  return roles.includes(r);
}

/* ========================= Safe FS helpers ========================= */
async function safeGetCount(qry: any, label: string): Promise<number | null> {
  try {
    const snap = await getCountFromServer(qry);
    return snap.data().count;
  } catch (e) {
    try {
      // Best-effort fallback (limited)
      const s = await getDocs(qry);
      let n = 0;
      s.forEach(() => (n += 1));
      return n;
    } catch (e2) {
      console.warn(`[FS] count failed: ${label}`, e2);
      return null;
    }
  }
}
async function safeGetDocs<T = any>(qry: any, label: string): Promise<T[]> {
  try {
    const s = await getDocs(qry);
    const arr: T[] = [];
    s.forEach((d: any) => arr.push({ id: d.id, ...(d.data() as any) }));
    return arr;
  } catch (e) {
    console.warn(`[FS] getDocs failed: ${label}`, e);
    return [];
  }
}

/* ========================= Page ========================= */
const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const auth = getAuth();
  const me = auth.currentUser;
  const myUid = me?.uid || "";
  const myEmail = (me?.email || "").toLowerCase();

  /* ---------- user (local greeting fallback) ---------- */
  const localUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      return {};
    }
  }, []);

  /* ---------- roles ---------- */
  const [rolesLoading, setRolesLoading] = useState(true);
  const [roles, setRoles] = useState<Role[]>(["employee"]);

  useEffect(() => {
    (async () => {
      setRolesLoading(true);
      try {
        if (!myUid) {
          setRoles(["employee"]);
          return;
        }
        const uref = doc(db, "users", myUid);
        const usnap = await getDoc(uref).catch(() => null);
        const rolesFromUsers: string[] | undefined =
          (usnap && (usnap as any).exists?.() ? (usnap as any).data()?.roles : undefined) || undefined;

        setRoles(mapUserRolesToPageRoles({ uid: myUid, email: myEmail, rolesFromUsers }));
      } finally {
        setRolesLoading(false);
      }
    })();
  }, [myUid, myEmail]);

  /* ---------- stats ---------- */
  const [pendingRequests, setPendingRequests] = useState<number | null>(null);
  const [pendingBudgets, setPendingBudgets] = useState<number | null>(null);
  const [pdPendingExec, setPdPendingExec] = useState<number | null>(null);
  const [pdPendingAdmin, setPdPendingAdmin] = useState<number | null>(null);
  const [unreadNotifs, setUnreadNotifs] = useState<number | null>(null);

  /* ---------- recent activity ---------- */
  type HistoryRow = {
    id: string;
    kind: "request" | "budget" | "cashAdvance" | "payrollDraft";
    targetId: string;
    action: "approved" | "rejected";
    comment?: string;
    actorEmail?: string;
    actorName?: string;
    meta?: any;
    ts?: any;
  };
  const [recent, setRecent] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // requests pending
        const rq = query(collection(db, "requests"), where("status", "==", "pending"));
        setPendingRequests(await safeGetCount(rq, "requests/pending"));

        // budgets pending
        const bq = query(collection(db, "budgets"), where("status", "==", "pending"));
        setPendingBudgets(await safeGetCount(bq, "budgets/pending"));

        // payroll drafts
        const pdExecQ = query(collection(db, "payrollDrafts"), where("status", "==", "pending_exec"));
        const pdAdminQ = query(collection(db, "payrollDrafts"), where("status", "==", "pending_admin"));
        setPdPendingExec(await safeGetCount(pdExecQ, "payrollDrafts/pending_exec"));
        setPdPendingAdmin(await safeGetCount(pdAdminQ, "payrollDrafts/pending_admin"));

        // notifications unread (strictly 1:1)
        // Two simple fetches with client-side filter (no array-contains-not supported for "not contains")
        let totalUnread = 0;
        if (myUid) {
          const toUidDocs = await safeGetDocs<any>(
            query(collection(db, "notifications"), where("toUid", "==", myUid), fsLimit(500)),
            "notifications/toUid"
          );
          totalUnread += toUidDocs.filter((n) => !Array.isArray(n.readBy) || !n.readBy.includes(myUid)).length;
        }
        if (myEmail) {
          const toEmailDocs = await safeGetDocs<any>(
            query(collection(db, "notifications"), where("toEmail", "==", myEmail), fsLimit(500)),
            "notifications/toEmail"
          );
          totalUnread += toEmailDocs.filter((n) => !Array.isArray(n.readBy) || !n.readBy.includes(myUid)).length;
        }
        setUnreadNotifs(totalUnread);

        // recent approval history
        const hq = query(collection(db, "approvalHistory"), orderBy("ts", "desc"), fsLimit(8));
        const hist = await safeGetDocs<HistoryRow>(hq, "approvalHistory");
        setRecent(hist);
      } finally {
        setLoading(false);
      }
    })();
  }, [myUid, myEmail]);

  const canView =
    hasRole(roles, "admin_final") ||
    hasRole(roles, "admin_overseer") ||
    hasRole(roles, "exec") ||
    hasRole(roles, "finance");

  if (rolesLoading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white pt-20 flex items-center justify-center">
        <div className="text-gray-300">Loading access…</div>
      </div>
    );
  }
  if (!canView) {
    return (
      <div className="min-h-screen bg-gray-900 text-white pt-20 px-4">
        <div className="max-w-xl mx-auto text-center space-y-3">
          <h1 className="text-2xl font-bold">Not authorized</h1>
          <p className="text-gray-300">You don’t have access to Admin Dashboard.</p>
        </div>
      </div>
    );
  }

  /* ---------- helpers for pretty values ---------- */
  const fmt = (n: number | null) => (n === null ? "—" : `${n}`);
  const fullName =
    me?.displayName ||
    (localUser && (localUser as any).displayName) ||
    (localUser && (localUser as any).name) ||
    (localUser && (localUser as any).fullName) ||
    me?.email ||
    "User";

  /* ========================= UI ========================= */
  return (
    <div className="min-h-screen bg-gray-900 rounded-2xl text-white pt-20 pb-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Header */}
        <header className="space-y-1">
          <h1 className="text-3xl md:text-4xl font-bold">Admin Dashboard</h1>
          <p className="text-gray-300">
            Welcome back, <span className="font-semibold text-white">{fullName}</span>.
          </p>
          {hasRole(roles, "admin_overseer") && (
            <p className="text-amber-300 text-sm">
              You are in overseer mode: read-only visibility into approvals.
            </p>
          )}
        </header>

        {/* KPI Cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
          <KPI
            label="Pending Requests"
            value={fmt(pendingRequests)}
            accent="from-yellow-500/25 to-yellow-600/10"
            onClick={() => navigate("/admin/requests")}
          />
          <KPI
            label="Budgets to Approve"
            value={fmt(pendingBudgets)}
            accent="from-blue-500/25 to-blue-600/10"
            onClick={() => navigate("/admin/budgets")}
          />
          <KPI
            label="Drafts: Exec Stage"
            value={fmt(pdPendingExec)}
            accent="from-emerald-500/25 to-emerald-600/10"
            onClick={() => navigate("/admin/payroll-review")}
          />
          <KPI
            label="Drafts: Admin Stage"
            value={fmt(pdPendingAdmin)}
            accent="from-teal-500/25 to-teal-600/10"
            onClick={() => navigate("/admin/payroll-review")}
          />
        </section>

        {/* Secondary Cards */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Unread Notifications */}
          <div className="lg:col-span-1 rounded-2xl border border-white/10 bg-gray-800/40 overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Notifications</h2>
              <span className="text-xs px-2 py-0.5 rounded-md bg-indigo-500/20 border border-indigo-400/30 text-indigo-200">
                Unread: {fmt(unreadNotifs)}
              </span>
            </div>
            <div className="p-6">
              <p className="text-sm text-gray-300 mb-4">
                Only your notifications are counted here. Visit the center to review.
              </p>
              <button
                onClick={() => navigate("/admin/notifications")}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500"
              >
                Open Notification Center
              </button>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-gray-800/40 overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10">
              <h2 className="text-lg font-semibold">Quick Actions</h2>
            </div>
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <QuickAction label="Approve Requests" icon="📋" onClick={() => navigate("/admin/requests")} />
              <QuickAction label="Approve Budgets" icon="💳" onClick={() => navigate("/admin/budgets")} />
              <QuickAction label="Review Payroll Drafts" icon="💰" onClick={() => navigate("/admin/payroll-review")} />
              <QuickAction label="Finance Settings" icon="⚙️" onClick={() => navigate("/finance/settings")} />
              <QuickAction label="Employees" icon="👥" onClick={() => navigate("/admin/employees")} />
              <QuickAction label="Reports" icon="📊" onClick={() => navigate("/admin/reports")} />
            </div>
          </div>
        </section>

        {/* Recent Approval Activity */}
        <section className="rounded-2xl border border-white/10 bg-gray-800/40 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent Approval Activity</h2>
            {loading && <span className="text-xs text-gray-400">Loading…</span>}
          </div>
          <div className="p-0 overflow-x-auto">
            <table className="min-w-full divide-y divide-white/10">
              <thead className="bg-gray-800/60">
                <tr>
                  <Th>Item</Th>
                  <Th>Action</Th>
                  <Th>Person / Title</Th>
                  <Th>Amount</Th>
                  <Th>By</Th>
                  <Th>When</Th>
                  <Th>Comment</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 bg-gray-900/20">
                {recent.length === 0 ? (
                  <tr>
                    <Td colSpan={7}>
                      <div className="py-8 text-center text-gray-400">No activity yet.</div>
                    </Td>
                  </tr>
                ) : (
                  recent.map((h) => {
                    const when =
                      (h.ts && typeof (h.ts as any).toDate === "function"
                        ? (h.ts as any).toDate().toLocaleString()
                        : "") || "—";

                    // Defaults
                    let item = "—";
                    let person = "—";
                    let amount = "—";

                    if (h.kind === "budget") {
                      item = "Budget";
                      person = h.meta?.requesterName || h.meta?.title || "—";
                      amount =
                        typeof h.meta?.amount === "number"
                          ? `₱${Number(h.meta.amount).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`
                          : "—";
                    } else if (h.kind === "cashAdvance") {
                      item = "Cash Advance";
                      person = h.meta?.employeeName || "—";
                      amount =
                        typeof h.meta?.amount === "number"
                          ? `₱${Number(h.meta.amount).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`
                          : "—";
                    } else if (h.kind === "request") {
                      item = "Filed Request";
                      // person is not tracked in meta for requests in earlier code; keep "—"
                    } else if (h.kind === "payrollDraft") {
                      const stage =
                        h.meta?.stage
                          ?.toString()
                          .replace("_", " ")
                          .replace(/\b\w/g, (c: string) => c.toUpperCase()) || "";
                      item = `Payroll Draft${stage ? ` (${stage})` : ""}`;
                      person = h.meta?.cutoffLabel || h.meta?.periodKey || "—";
                    }

                    const actor = h.actorName || h.actorEmail || "—";

                    return (
                      <tr key={h.id} className="align-top">
                        <Td>{item}</Td>
                        <Td>
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                              h.action === "approved"
                                ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/30"
                                : "bg-rose-600/20 text-rose-300 border border-rose-500/30"
                            }`}
                          >
                            {h.action.toUpperCase()}
                          </span>
                        </Td>
                        <Td>{person}</Td>
                        <Td>{amount}</Td>
                        <Td>{actor}</Td>
                        <Td>{when}</Td>
                        <Td className="max-w-[320px] break-words">
                          {h.comment ? (
                            <span title={h.comment} className="text-gray-200">
                              {h.comment}
                            </span>
                          ) : (
                            <span className="text-gray-500">—</span>
                          )}
                        </Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* styles */}
      <style>{`
        .inp {
          width: 100%;
          padding: 0.85rem 1rem;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 0.9rem;
          color: #fff;
          outline: none;
          appearance: none;
        }
        .inp:focus {
          box-shadow: 0 0 0 2px rgba(59,130,246,0.5);
          border-color: rgba(59,130,246,0.6);
        }
      `}</style>
    </div>
  );
};

/* ========================= Bits ========================= */
function KPI({
  label,
  value,
  accent = "from-slate-500/25 to-slate-600/10",
  onClick,
}: {
  label: string;
  value: string;
  accent?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-5 rounded-2xl bg-gradient-to-br ${accent} border border-white/10 hover:border-white/20 transition w-full`}
    >
      <p className="text-sm text-gray-300">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </button>
  );
}

function QuickAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 p-4 rounded-xl bg-gray-800/60 hover:bg-gray-700 border border-white/10 hover:border-white/20 transition"
    >
      <span className="text-2xl">{icon}</span>
      <span className="text-white font-medium">{label}</span>
    </button>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={`px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-300 ${className}`}>
      {children}
    </th>
  );
}
function Td({
  children,
  className = "",
  colSpan,
}: {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`px-4 py-3 align-middle ${className}`}>
      {children}
    </td>
  );
}

export default AdminDashboard;
