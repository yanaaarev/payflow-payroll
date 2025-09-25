// src/pages/Executive/ExecutiveDashboard.tsx
import React, { useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import {
  collection,
  query,
  where,
  orderBy,
  limit as fsLimit,
  getDocs,
} from "firebase/firestore";
import { db } from "../../firebase/firebase";

/* ========================= Types ========================= */
type Draft = {
  id: string;
  cutoffLabel: string;
  createdAt?: any;
  status: string;
};

type HistoryRow = {
  id: string;
  kind: string;
  action: "approved" | "rejected";
  actorName?: string;
  actorEmail?: string;
  ts?: any;
};

/* ========================= Component ========================= */
const ExecutiveDashboard: React.FC = () => {
  const auth = getAuth();
  const navigate = useNavigate();

  const [pendingDrafts, setPendingDrafts] = useState<Draft[]>([]);
  const [recent, setRecent] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const me = auth.currentUser;
  const displayName = me?.displayName || me?.email?.split("@")[0] || "Executive";

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // fetch drafts at exec stage
        const q = query(
          collection(db, "payrollDrafts"),
          where("status", "==", "pending_exec"),
          orderBy("createdAt", "desc"),
          fsLimit(6)
        );
        const snap = await getDocs(q);
        const arr: Draft[] = [];
        snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
        setPendingDrafts(arr);

        // fetch recent approval history
        const hq = query(
          collection(db, "approvalHistory"),
          orderBy("ts", "desc"),
          fsLimit(6)
        );
        const hsnap = await getDocs(hq);
        const hArr: HistoryRow[] = [];
        hsnap.forEach((d) => hArr.push({ id: d.id, ...(d.data() as any) }));
        setRecent(hArr);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white pt-20 pb-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
        {/* Header */}
        <header className="space-y-1">
          <h1 className="text-3xl md:text-4xl font-bold">Executive Dashboard</h1>
          <p className="text-gray-300">
            Welcome back, <span className="font-semibold">{displayName}</span>.  
            Review and approve payroll drafts below.
          </p>
        </header>

        {/* KPI Section */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <KPI
            label="Pending Drafts"
            value={pendingDrafts.length.toString()}
            accent="from-indigo-500/25 to-indigo-600/10"
            onClick={() => navigate("/approvals")}
          />
          <KPI
            label="Recent Approvals"
            value={recent.length.toString()}
            accent="from-emerald-500/25 to-emerald-600/10"
            onClick={() => navigate("/approvals")}
          />
          <KPI
            label="Budgets"
            value="—"
            accent="from-blue-500/25 to-blue-600/10"
            onClick={() => navigate("/finance/budgets")}
          />
          <KPI
            label="Requests"
            value="—"
            accent="from-yellow-500/25 to-yellow-600/10"
            onClick={() => navigate("/finance/requests")}
          />
        </section>

        {/* Pending Drafts Table */}
        <section className="rounded-2xl border border-white/10 bg-gray-800/40 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Pending Payroll Drafts</h2>
            {loading && <span className="text-xs text-gray-400">Loading…</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/10">
              <thead className="bg-gray-800/60">
                <tr>
                  <Th>Cutoff</Th>
                  <Th>Status</Th>
                  <Th>Created</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 bg-gray-900/20">
                {pendingDrafts.length === 0 ? (
                  <tr>
                    <Td colSpan={4}>
                      <div className="py-6 text-center text-gray-400">
                        No drafts waiting for approval.
                      </div>
                    </Td>
                  </tr>
                ) : (
                  pendingDrafts.map((d) => (
                    <tr key={d.id}>
                      <Td>{d.cutoffLabel || "—"}</Td>
                      <Td>
                        <span className="px-2 py-0.5 rounded-md bg-indigo-600/20 border border-indigo-500/30 text-indigo-200 text-xs font-medium">
                          {d.status}
                        </span>
                      </Td>
                      <Td>
                        {d.createdAt?.toDate
                          ? d.createdAt.toDate().toLocaleDateString()
                          : "—"}
                      </Td>
                      <Td>
                        <button
                          onClick={() => navigate(`/finance/payroll/drafts/${d.id}`)}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm"
                        >
                          Review
                        </button>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Recent Activity */}
        <section className="rounded-2xl border border-white/10 bg-gray-800/40 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10">
            <h2 className="text-lg font-semibold">Recent Approval Activity</h2>
          </div>
          <div className="p-6 space-y-3">
            {recent.length === 0 ? (
              <p className="text-gray-400 text-sm">No recent activity.</p>
            ) : (
              recent.map((h) => (
                <div
                  key={h.id}
                  className="p-3 bg-gray-900/40 rounded-lg border border-white/10 text-sm text-gray-300 flex justify-between"
                >
                  <span>
                    {h.kind} —{" "}
                    <span
                      className={
                        h.action === "approved"
                          ? "text-emerald-300"
                          : "text-rose-300"
                      }
                    >
                      {h.action.toUpperCase()}
                    </span>
                  </span>
                  <span className="text-gray-400">
                    {h.actorName || h.actorEmail || "—"}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

/* ========================= Small UI Bits ========================= */
function KPI({
  label,
  value,
  accent,
  onClick,
}: {
  label: string;
  value: string;
  accent: string;
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

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-300">
      {children}
    </th>
  );
}

function Td({
  children,
  colSpan,
}: {
  children: React.ReactNode;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className="px-4 py-3 align-middle text-sm text-gray-200"
    >
      {children}
    </td>
  );
}

export default ExecutiveDashboard;
