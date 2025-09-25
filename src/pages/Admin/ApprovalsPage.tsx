// src/pages/ApprovalsPage.tsx
import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebase/firebase";
import { collection, getDocs, query, where, updateDoc, doc } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { sendEmail } from "../../../api/sendEmail";

/* ========================= Types ========================= */
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

type RequestRow = {
  id: string;
  employeeName?: string;
  type?: ReqType;
  status?: "pending" | "approved" | "rejected";
  filedBy?: string;
  filedAt?: string;
  details?: Record<string, any>;
};

type BudgetRow = {
  id: string;
  requesterName?: string;
  title?: string;
  kind?: string;
  amount?: number;
  status?: "pending" | "approved" | "rejected";
  filedAt?: string;
  dateRequested?: string;
  dateNeeded?: string;
  requesterEmail?: string;
  rejection?: Record<string, any>;
};

type PayrollDraft = {
  id: string;
  status: "pending_exec" | "pending_admin" | "approved" | "rejected";
  cutoffLabel?: string;
  periodKey?: string;
  createdAt?: any;
};

/* ========================= Component ========================= */
export default function ApprovalsPage() {
const auth = getAuth();
const user = auth.currentUser;
const [roles, setRoles] = useState<string[]>([]);

useEffect(() => {
  if (!user) return;
  user.getIdTokenResult().then((token) => {
    setRoles(((token.claims.roles as string[]) || []).map(String));
  });
}, [user]);

const canApproveBudget = roles.includes("admin_final") || roles.includes("finance");
const canApproveRequest = canApproveBudget || roles.includes("exec");

  const navigate = useNavigate();

  const [tab, setTab] = useState<"approvals" | "history">("approvals");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [drafts, setDrafts] = useState<PayrollDraft[]>([]);

  /* ---------- Load Data ---------- */
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const reqSnap = await getDocs(collection(db, "requests"));
        setRequests(reqSnap.docs.map((d) => ({ id: d.id, ...d.data() } as RequestRow)));

        const budSnap = await getDocs(collection(db, "budgets"));
        setBudgets(budSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BudgetRow)));

        const pdSnap = await getDocs(
          query(
            collection(db, "payrollDrafts"),
            where("status", "in", ["pending_exec", "pending_admin", "approved", "rejected"])
          )
        );
        setDrafts(pdSnap.docs.map((d) => ({ id: d.id, ...d.data() } as PayrollDraft)));
      } catch (err) {
        console.error("Failed to fetch approvals", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ---------- Filtering ---------- */
  const ql = q.trim().toLowerCase();
  const filterText = (txt: any) =>
    String(txt || "").toLowerCase().includes(ql);

  const reqsFiltered = useMemo(
    () =>
      requests.filter((r) =>
        !ql
          ? true
          : Object.values(r).some((val) => filterText(val))
      ),
    [requests, ql]
  );

  const budsFiltered = useMemo(
    () =>
      budgets.filter((b) =>
        !ql
          ? true
          : Object.values(b).some((val) => filterText(val))
      ),
    [budgets, ql]
  );

  const draftsFiltered = useMemo(
    () =>
      drafts.filter((d) =>
        !ql
          ? true
          : Object.values(d).some((val) => filterText(val))
      ),
    [drafts, ql]
  );

async function approveBudget(id: string) {
  await updateDoc(doc(db, "budgets", id), { status: "approved" });

  // 🔔 notify requester
  const b = budgets.find((x) => x.id === id);
  if (b?.requesterEmail) {
    await sendEmail(
      b.requesterEmail,
      "Budget Approved",
      `<p>Hi ${b.requesterName}, your budget "<b>${b.title}</b>" has been approved.</p>`
    );
  }
}

async function rejectBudget(id: string) {
  await updateDoc(doc(db, "budgets", id), { status: "rejected" });

  // 🔔 notify requester
  const b = budgets.find((x) => x.id === id);
  if (b?.requesterEmail) {
    await sendEmail(
      b.requesterEmail,
      "Budget Rejected",
      `<p>Hi ${b.requesterName}, your budget "<b>${b.title}</b>" has been rejected.</p>`
    );
  }
}

async function approveRequest(id: string) {
  await updateDoc(doc(db, "requests", id), { status: "approved" });

  // 🔔 notify requester
  const r = requests.find((x) => x.id === id);
  if (r?.filedBy) {
    await sendEmail(
      r.filedBy,
      "Request Approved",
      `<p>Hi ${r.employeeName}, your request (<b>${r.type}</b>) has been approved.</p>`
    );
  }
}

async function rejectRequest(id: string) {
  await updateDoc(doc(db, "requests", id), { status: "rejected" });

  // 🔔 notify requester
  const r = requests.find((x) => x.id === id);
  if (r?.filedBy) {
    await sendEmail(
      r.filedBy,
      "Request Rejected",
      `<p>Hi ${r.employeeName}, your request (<b>${r.type}</b>) has been rejected.</p>`
    );
  }
}


  /* ---------- UI ---------- */
  return (
    <div className="min-h-screen bg-gray-900 text-white pt-20 pb-24">
      <div className="max-w-7xl mx-auto px-6 space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Approvals</h1>
          <p className="text-gray-300">
            Review, approve, or reject items. Approved payroll drafts are auto-published to payslips.
          </p>
        </div>

        {/* Tabs + Search */}
        <div className="flex items-center gap-4">
          <div className="inline-flex rounded-xl overflow-hidden border border-white/10">
            {["approvals", "history"].map((k) => (
              <button
                key={k}
                onClick={() => setTab(k as any)}
                className={`px-4 py-2 ${
                  tab === k ? "bg-blue-600" : "bg-gray-800/40"
                } hover:bg-blue-500`}
              >
                {k === "approvals" ? "Approvals" : "History"}
              </button>
            ))}
          </div>
          <input
            className="flex-1 inp h-12"
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

       
{/* Panels */}
{tab === "approvals" && (
  <div className="space-y-8">
    {/* Requests */}
    <CardPanel
      title={`Requests (${reqsFiltered.filter((r) => r.status === "pending").length})`}
      loading={loading}
    >
      {reqsFiltered.filter((r) => r.status === "pending").length === 0 ? (
        <Empty text="No pending requests." />
      ) : (
        groupByDate(reqsFiltered.filter((r) => r.status === "pending")).map(
          ([date, items]) => (
            <div key={date}>
              <div className="px-6 py-2 bg-gray-700/50 text-sm font-medium text-gray-300">
                {date}
              </div>
              {items.map((r) => (
                <DetailsView
              key={r.id}
              title={r.employeeName}
              status={r.status}
              right={
                canApproveRequest && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => approveRequest(r.id)}
                      className="px-3 py-1 text-xs rounded bg-green-600 hover:bg-green-500"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => rejectRequest(r.id)}
                      className="px-3 py-1 text-xs rounded bg-red-600 hover:bg-red-500"
                    >
                      Reject
                    </button>
                  </div>
                )
              }
            />
              ))}
            </div>
          )
        )
      )}
    </CardPanel>

    {/* Budgets */}
    <CardPanel
      title={`Budgets (${budsFiltered.filter((b) => b.status === "pending").length})`}
      loading={loading}
    >
      {budsFiltered.filter((b) => b.status === "pending").length === 0 ? (
        <Empty text="No pending budgets." />
      ) : (
        groupByDate(budsFiltered.filter((b) => b.status === "pending")).map(
          ([date, items]) => (
            <div key={date}>
              <div className="px-6 py-2 bg-gray-700/50 text-sm font-medium text-gray-300">
                {date}
              </div>
              {items.map((b) => (
                <DetailsView
              key={b.id}
              title={b.title}
              status={b.status}
              right={
                canApproveBudget && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => approveBudget(b.id)}
                      className="px-3 py-1 text-xs rounded bg-green-600 hover:bg-green-500"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => rejectBudget(b.id)}
                      className="px-3 py-1 text-xs rounded bg-red-600 hover:bg-red-500"
                    >
                      Reject
                    </button>
                  </div>
                )
              }
            />
              ))}
            </div>
          )
        )
      )}
    </CardPanel>

    {/* Payroll Drafts */}
    <CardPanel
      title={`Payroll Drafts (${draftsFiltered.filter(
        (d) => d.status === "pending_exec" || d.status === "pending_admin"
      ).length})`}
      loading={loading}
    >
      {draftsFiltered.filter(
        (d) => d.status === "pending_exec" || d.status === "pending_admin"
      ).length === 0 ? (
        <Empty text="No pending payroll drafts." />
      ) : (
        groupByDate(
          draftsFiltered.filter(
            (d) => d.status === "pending_exec" || d.status === "pending_admin"
          )
        ).map(([date, items]) => (
          <div key={date}>
            <div className="px-6 py-2 bg-gray-700/50 text-sm font-medium text-gray-300">
              {date}
            </div>
            {items.map((d) => (
              <DetailsView
                key={d.id}
                title={d.cutoffLabel || d.periodKey || d.id}
                status="pending"
                right={
                  <button
                    onClick={() => navigate(`/finance/payroll/drafts/${d.id}`)}
                    className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500"
                  >
                    View
                  </button>
                }
              />
            ))}
          </div>
        ))
      )}
    </CardPanel>
  </div>
)}

{tab === "history" && (
  <div className="space-y-8">
    {/* Requests History */}
    <CardPanel title="Requests History" loading={loading}>
      {reqsFiltered.filter((r) => r.status !== "pending").length === 0 ? (
        <Empty text="No approved/rejected requests yet." />
      ) : (
        groupByDate(reqsFiltered.filter((r) => r.status !== "pending")).map(
          ([date, items]) => (
            <div key={date}>
              <div className="px-6 py-2 bg-gray-700/50 text-sm font-medium text-gray-300">
                {date}
              </div>
              {items.map((r) => (
                <DetailsView
                  key={r.id}
                  title={r.employeeName}
                  status={r.status}
                  right={
                    <button
                      onClick={() => navigate(`/approvals/view-request/${r.id}`)}
                      className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500"
                    >
                      View
                    </button>
                  }
                />
              ))}
            </div>
          )
        )
      )}
    </CardPanel>

    {/* Budgets History */}
    <CardPanel title="Budgets History" loading={loading}>
      {budsFiltered.filter((b) => b.status !== "pending").length === 0 ? (
        <Empty text="No approved/rejected budgets yet." />
      ) : (
        groupByDate(budsFiltered.filter((b) => b.status !== "pending")).map(
          ([date, items]) => (
            <div key={date}>
              <div className="px-6 py-2 bg-gray-700/50 text-sm font-medium text-gray-300">
                {date}
              </div>
              {items.map((b) => (
                <DetailsView
                  key={b.id}
                  title={b.title}
                  status={b.status}
                  right={
                    <button
                      onClick={() => navigate(`/approvals/view-budget/${b.id}`)}
                      className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500"
                    >
                      View
                    </button>
                  }
                />
              ))}
            </div>
          )
        )
      )}
    </CardPanel>

    {/* Payroll History */}
    <CardPanel title="Payroll Drafts History" loading={loading}>
      {draftsFiltered.filter(
        (d) => d.status === "approved" || d.status === "rejected"
      ).length === 0 ? (
        <Empty text="No approved/rejected payroll drafts yet." />
      ) : (
        groupByDate(
          draftsFiltered.filter(
            (d) => d.status === "approved" || d.status === "rejected"
          )
        ).map(([date, items]) => (
          <div key={date}>
            <div className="px-6 py-2 bg-gray-700/50 text-sm font-medium text-gray-300">
              {date}
            </div>
            {items.map((d) => (
              <DetailsView
                key={d.id}
                title={d.cutoffLabel || d.periodKey || d.id}
                status={
                  d.status === "pending_exec" || d.status === "pending_admin"
                    ? "pending"
                    : d.status
                }
                right={
                  <button
                    onClick={() => navigate(`/finance/payroll/drafts/${d.id}`)}
                    className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500"
                  >
                    View
                  </button>
                }
              />
            ))}
          </div>
        ))
      )}
    </CardPanel>
  </div>
)}
      </div>

      <style>{`
        .inp {
          width: 100%;
          padding: 0.85rem 1rem;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 0.9rem;
          color: #fff;
          outline: none;
        }
        .inp:focus {
          box-shadow: 0 0 0 2px rgba(59,130,246,0.5);
          border-color: rgba(59,130,246,0.6);
        }
      `}</style>
    </div>
  );
}

/* ========================= UI Helpers ========================= */
function CardPanel({ title, loading, children }: { title: string; loading: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-gray-800/40 overflow-hidden">
      <div className="px-6 py-4 border-b border-white/10 text-lg font-semibold">{title}</div>
      {loading ? <div className="p-10 text-center text-gray-400">Loading…</div> : <div>{children}</div>}
    </div>
  );
}

function DetailsView({
  title,
  status,
  right,
}: {
  title?: string;
  status?: "pending" | "approved" | "rejected";
  right?: React.ReactNode;
}) {
  const statusStyles =
    status === "approved"
      ? "text-green-400 border border-green-400/40 bg-green-400/10"
      : status === "rejected"
      ? "text-red-400 border border-red-400/40 bg-red-400/10"
      : "text-yellow-400 border border-yellow-400/40 bg-yellow-400/10";

  return (
    <div className="px-6 py-5 flex justify-between items-center border-b border-white/10">
      {/* Show only the requester/title */}
      <div className="font-semibold text-base">{title}</div>

      {/* Status + View button */}
      <div className="flex items-center gap-3">
        {status && (
          <span
            className={`px-3 py-1 rounded-full text-xs font-medium ${statusStyles}`}
          >
            {status.toUpperCase()}
          </span>
        )}
        {right}
      </div>
    </div>
  );
}


function Empty({ text }: { text: string }) {
  return <div className="p-10 text-center text-gray-400">{text}</div>;
}

function groupByDate<T extends { filedAt?: any; createdAt?: any }>(items: T[]) {
  const groups: Record<string, T[]> = {};
  items.forEach((i) => {
    const ts = i.filedAt || i.createdAt;
    const d = ts?.seconds ? new Date(ts.seconds * 1000) : new Date();
    const dateStr = d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    if (!groups[dateStr]) groups[dateStr] = [];
    groups[dateStr].push(i);
  });
  return Object.entries(groups).sort(
    (a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime()
  );
}
