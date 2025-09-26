// src/pages/PayrollPage.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  Timestamp,
} from "firebase/firestore";
import { getAuth, onAuthStateChanged } from "firebase/auth";

type DraftHead = {
  id: string;
  status: "draft" | "finance_review" | "pending_exec" | "pending_admin" | "approved" | "published";
  periodKey: string;
  cutoffLabel?: string | null;
  cutoffStart?: string | null; // ISO
  cutoffEnd?: string | null;   // ISO
  createdAt?: Timestamp | null;
  createdBy?: { uid: string; name?: string | null } | null;
  requiredExecApprovals?: number;
  execApprovals?: Array<{ uid: string; name?: string; approvedAt?: any }>;
  adminApproval?: { uid: string; name?: string; approvedAt?: any } | null;
  totals?: { gross?: number; net?: number; count?: number };
};

const db = getFirestore();
const auth = getAuth();

const badgeForStatus: Record<string, string> = {
  draft: "bg-yellow-500/20 text-yellow-200 ring-1 ring-inset ring-yellow-500/30",
  finance_review: "bg-blue-500/20 text-blue-200 ring-1 ring-inset ring-blue-500/30",
  pending_exec: "bg-amber-500/20 text-amber-200 ring-1 ring-inset ring-amber-500/30",
  pending_admin: "bg-fuchsia-500/20 text-fuchsia-200 ring-1 ring-inset ring-fuchsia-500/30",
  approved: "bg-emerald-500/20 text-emerald-200 ring-1 ring-inset ring-emerald-500/30",
  published: "bg-green-600/20 text-green-200 ring-1 ring-inset ring-green-600/30",
};

function fmtPeso(n?: number) {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return `₱${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
function toDateString(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export default function PayrollPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<DraftHead[]>([]);
  const [userReady, setUserReady] = useState(false);
  const [error, setError] = useState("");

  const [stats, setStats] = useState({
  totalEmployees: 0,
  draftPayrolls: 0,
  pendingApprovals: 0,
  monthlyPayroll: 0,
});

  // Wait for auth (rules require signed in)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, () => setUserReady(true));
    return unsub;
  }, []);

  useEffect(() => {
  if (!userReady) return;
  (async () => {
    try {
      setError("");
      setLoading(true);
      const qy = query(collection(db, "payrollDrafts"), orderBy("createdAt", "desc"), limit(50));
      const snap = await getDocs(qy);

      const rows: DraftHead[] = [];
      let totalEmployees = 0;
      let latestGross = 0;

      for (const docSnap of snap.docs) {
        const d = docSnap.data() as Partial<DraftHead>;

        // 🔽 Fetch lines subcollection for this draft
        const linesSnap = await getDocs(collection(db, "payrollDrafts", docSnap.id, "lines"));
        const employees = linesSnap.docs.length; // count employees
        totalEmployees += employees;

        // You may want to compute gross/net here from lines
        // Example: sum(hoursWorked * hourlyRate) if you store rates
        // For now, assume gross/net = 0 unless stored elsewhere
        if (latestGross === 0 && linesSnap.docs.length > 0) {
          latestGross = linesSnap.docs.reduce((sum, line) => {
            const data = line.data();
            return sum + (data.gross || 0); // ensure you store gross per line
          }, 0);
        }

        rows.push({
          id: docSnap.id,
          status: (d.status as DraftHead["status"]) ?? "draft",
          periodKey: d.periodKey ?? "—",
          cutoffLabel: d.cutoffLabel ?? null,
          cutoffStart: d.cutoffStart ?? null,
          cutoffEnd: d.cutoffEnd ?? null,
          createdAt: (d.createdAt as Timestamp) ?? null,
          createdBy: d.createdBy ?? { uid: "—", name: "—" },
          requiredExecApprovals: typeof d.requiredExecApprovals === "number" ? d.requiredExecApprovals : 2,
          execApprovals: Array.isArray(d.execApprovals) ? d.execApprovals : [],
          adminApproval: d.adminApproval ?? null,
          totals: {
            gross: 0, // or compute if you store line gross
            net: 0,   // same here
            count: employees,
          },
        });
      }

      setDrafts(rows);
      setStats({
        totalEmployees,
        draftPayrolls: rows.filter((d) => d.status !== "published").length,
        pendingApprovals: rows.filter((d) => d.status === "pending_exec" || d.status === "pending_admin").length,
        monthlyPayroll: latestGross,
      });

    } catch (e: any) {
      setError(e?.message || "Failed to load drafts.");
    } finally {
      setLoading(false);
    }
  })();
}, [userReady]);


  return (
    <div className="min-h-screen bg-gray-900 rounded-2xl text-white pt-20 px-4 sm:px-6 lg:px-8 pb-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold">Employee Payroll</h1>
          <p className="text-gray-300 mt-1">View, finalize, and approve payroll drafts.</p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/30 text-red-200 rounded-xl">
            {error}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 border border-white/10 text-center">
            <p className="text-sm font-medium text-gray-200">Total Employees (in listed drafts)</p>
            <p className="text-2xl font-bold text-blue-400 mt-1">{stats.totalEmployees}</p>
          </div>
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 border border-white/10 text-center">
            <p className="text-sm font-medium text-gray-200">Draft Payrolls</p>
            <p className="text-2xl font-bold text-yellow-400 mt-1">{stats.draftPayrolls}</p>
          </div>
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 border border-white/10 text-center">
            <p className="text-sm font-medium text-gray-200">Pending Approvals</p>
            <p className="text-2xl font-bold text-orange-400 mt-1">{stats.pendingApprovals}</p>
          </div>
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 border border-white/10 text-center">
            <p className="text-sm font-medium text-gray-200">Latest Draft Gross</p>
            <p className="text-2xl font-bold text-green-400 mt-1">{fmtPeso(stats.monthlyPayroll)}</p>
          </div>
        </div>

        {/* Entry to Attendance → Publish */}
        <div className="space-y-6">
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-white/10 p-6 text-center">
            <h2 className="text-xl font-semibold mb-4">Create Payroll Draft</h2>
            <p className="text-gray-300 mb-4">
              Drafts are created from processed attendance. Upload and process a cutoff, then publish to generate a draft.
            </p>
            <button
              onClick={() => navigate("/finance/attendance")}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl transition"
            >
              Go to Attendance → Publish
            </button>
          </div>

          {/* Drafts list */}
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-white/10 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Payroll Drafts</h2>
              {/* optional list page later */}
              {/* <button
                onClick={() => navigate("/finance/payroll/drafts")}
                className="text-sm text-blue-300 hover:text-blue-200 underline"
              >
                View all
              </button> */}
            </div>

            {loading ? (
              <div className="flex items-center text-blue-300">
                <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                </svg>
                Loading drafts…
              </div>
            ) : drafts.length === 0 ? (
              <div className="text-gray-300 text-sm">
                No drafts yet. Publish processed attendance to create your first draft.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-700/60 bg-gray-800/60">
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-200">Status</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-200">Cutoff</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-200">Period Key</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-200">Created</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-200">By</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-200">Gross</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-200">Net</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-200">Employees</th>
                      <th className="text-center py-3 px-4 text-sm font-semibold text-gray-200">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.map((d) => (
                      <tr
                        key={d.id}
                        className="border-b border-gray-700/40 even:bg-gray-800/30 hover:bg-white/5 transition"
                      >

                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                              badgeForStatus[d.status] ||
                              "bg-gray-500/20 text-gray-200 ring-1 ring-inset ring-gray-500/30"
                            }`}
                          >
                            {d.status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-gray-300">
                          {d.cutoffLabel ?? `${toDateString(d.cutoffStart)} – ${toDateString(d.cutoffEnd)}`}
                        </td>
                        <td className="py-3 px-4 text-gray-300">{d.periodKey}</td>
                        <td className="py-3 px-4 text-gray-300">
                          {d.createdAt?.toDate ? d.createdAt.toDate().toLocaleString() : "—"}
                        </td>
                        <td className="py-3 px-4 text-gray-300">{d.createdBy?.name ?? "—"}</td>
                        <td className="py-3 px-4 text-right text-emerald-300">{fmtPeso(d.totals?.gross)}</td>
                        <td className="py-3 px-4 text-right text-blue-300">{fmtPeso(d.totals?.net)}</td>
                        <td className="py-3 px-4 text-right text-gray-200">{d.totals?.count ?? 0}</td>
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => navigate(`/finance/payroll/drafts/${d.id}`)}
                            className="text-blue-400 hover:text-blue-300 text-sm"
                          >
                            Open draft →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
            </div>
          </div>
        </div>
  );
}
