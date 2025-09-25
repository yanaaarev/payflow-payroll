// src/pages/BudgetsPage.tsx
import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebase/firebase";
import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { sendEmail } from "../../../api/email";

type BudgetKind = "shoot" | "event" | "office" | "others";

type BudgetDoc = {
  id: string;
  requesterId: string;
  requesterName: string;
  requesterEmail: string;
  kind: BudgetKind;
  title: string;          // name of the shoot/event/office supplies
  dateRequested: string;  // YYYY-MM-DD
  dateNeeded: string;     // YYYY-MM-DD
  amount: number;
  status: "pending" | "approved" | "rejected";
  filedAt?: any;
};

type Emp = {
  id: string;
  employeeId: string;
  name: string;
  email: string;
};

/* Roles from session (aligned to App/Login) */
type PageRole = "admin_final" | "admin_overseer" | "exec" | "finance" | "employee";
function getPageRolesFromSession(): PageRole[] {
  try {
    const raw = JSON.parse(localStorage.getItem("user") || "{}");
    if (Array.isArray(raw?.pageRoles) && raw.pageRoles.length) return raw.pageRoles as PageRole[];
    if (raw?.role) return [raw.role];
  } catch {}
  return ["employee"];
}
const canViewListByRole = (roles: PageRole[]) =>
  roles.includes("admin_final") || roles.includes("finance") || roles.includes("exec");

// ───────── helpers ─────────
const badge = (status: string) =>
  status === "approved"
    ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/30"
    : status === "rejected"
    ? "bg-rose-500/20 text-rose-300 border-rose-400/30"
    : "bg-amber-500/20 text-amber-200 border-amber-400/30";

const peso = (n: number) =>
  `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

// ───────── page ─────────
export default function BudgetsPage() {
  const auth = getAuth();

  // who am I / role gating
  const roles = getPageRolesFromSession();
  const canViewList = canViewListByRole(roles);

  // tabs & filters
  const [tab, setTab] = useState<"list" | "file">(canViewList ? "list" : "file");
  const [qText, setQText] = useState("");
  const [filterKind, setFilterKind] = useState<"" | BudgetKind>("");

  // my employee
  const [me, setMe] = useState<Emp | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);

  // list
  const [budgets, setBudgets] = useState<BudgetDoc[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // form
  const today = new Date().toISOString().slice(0, 10);
  const [dateRequested, setDateRequested] = useState<string>(today);
  const [kind, setKind] = useState<BudgetKind>("shoot");
  const [title, setTitle] = useState<string>("");
  const [dateNeeded, setDateNeeded] = useState<string>(today);
  const [amount, setAmount] = useState<number>(0);

  // load my employee by auth email
  useEffect(() => {
    (async () => {
      setLoadingMe(true);
      try {
        const email = (auth.currentUser?.email || "").toLowerCase();
        if (!email) return setMe(null);

        const snap = await getDocs(collection(db, "employees"));
        let found: Emp | null = null;
        snap.forEach((d) => {
          const x = d.data() as any;
          if ((x.email || "").toLowerCase() === email) {
            found = {
              id: d.id,
              employeeId: x.employeeId || "",
              name: x.name || "",
              email: x.email || "",
            };
          }
        });
        setMe(found);
      } finally {
        setLoadingMe(false);
      }
    })();
  }, [auth]);

  // load budgets list (only if user can view it)
  useEffect(() => {
    if (!canViewList) {
      setBudgets([]);
      setLoadingList(false);
      return;
    }
    (async () => {
      setLoadingList(true);
      try {
        const snap = await getDocs(
          query(collection(db, "budgets"), orderBy("filedAt", "desc"))
        );
        const list: BudgetDoc[] = [];
        snap.forEach((d) => {
          const x = d.data() as any;
          list.push({
            id: d.id,
            requesterId: x.requesterId,
            requesterName: x.requesterName,
            requesterEmail: x.requesterEmail,
            kind: x.kind,
            title: x.title,
            dateRequested: x.dateRequested,
            dateNeeded: x.dateNeeded,
            amount: Number(x.amount || 0),
            status: x.status || "pending",
            filedAt: x.filedAt,
          });
        });
        setBudgets(list);
      } finally {
        setLoadingList(false);
      }
    })();
  }, [canViewList]);

  const filtered = useMemo(() => {
    const q = qText.trim().toLowerCase();
    return budgets.filter((b) => {
      const byKind = filterKind ? b.kind === filterKind : true;
      const hit =
        !q ||
        b.requesterName.toLowerCase().includes(q) ||
        (b.requesterEmail || "").toLowerCase().includes(q) ||
        b.title.toLowerCase().includes(q) ||
        b.kind.toLowerCase().includes(q);
      return byKind && hit;
    });
  }, [budgets, qText, filterKind]);

  // submit
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const email = auth.currentUser?.email || "";
    const display = auth.currentUser?.displayName || "";
    const requesterName = me?.name || display || email.replace(/@.*/, "");
    const requesterId = me?.employeeId || me?.id || auth.currentUser?.uid || "";

    await addDoc(collection(db, "budgets"), {
      requesterId,
      requesterName,
      requesterEmail: email,
      kind,
      title,
      dateRequested,
      dateNeeded,
      amount: Number(amount || 0),
      status: "pending",
      filedAt: serverTimestamp(),
    });

// ✅ Notify approvers
  await sendEmail(
    [
      "jelynsonbattung@gmail.com",       // admin_final
      "hrfinance.instapost@gmail.com",   // finance
      "auquilang.instapost@gmail.com",   // exec
      "yana.instapost@gmail.com",        // exec
    ],
    "📑 New Budget Request Filed",
    `<p>A new budget request has been filed by <b>${requesterName}</b>.</p>
     <p><b>Title:</b> ${title}<br/>
        <b>Amount:</b> ₱${Number(amount).toLocaleString()}<br/>
        <b>Needed:</b> ${dateNeeded}</p>
     <p><a href="https://yourapp.com/approvals">Review in Approvals</a></p>`
  );

    // reset + switch
    setKind("shoot");
    setTitle("");
    setDateRequested(today);
    setDateNeeded(today);
    setAmount(0);
    setTab(canViewList ? "list" : "file");
    alert("Budget request submitted for admin approval.");
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white pt-20 pb-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Budgets</h1>
          <p className="text-gray-300 mt-2">
            Employees can request budgets for shoots, events, office supplies, or other purposes. Admin approval is required.
          </p>

          {/* Tabs – hide the “All Budgets” tab for employees */}
          {canViewList ? (
            <div className="mt-6 inline-flex rounded-xl overflow-hidden border border-white/10">
              <button
                className={`px-6 py-2 ${tab === "list" ? "bg-gray-800" : "bg-gray-800/40"} hover:bg-gray-800`}
                onClick={() => setTab("list")}
              >
                All Budgets
              </button>
              <button
                className={`px-6 py-2 ${tab === "file" ? "bg-blue-600" : "bg-gray-800/40"} hover:bg-blue-600/90`}
                onClick={() => setTab("file")}
                disabled={loadingMe}
                title={loadingMe ? "Loading profile…" : ""}
              >
                File a Budget
              </button>
            </div>
          ) : (
            <div className="mt-6 inline-flex rounded-xl overflow-hidden border border-white/10">
              <button className="px-6 py-2 bg-blue-600 cursor-default">File a Budget</button>
            </div>
          )}
        </div>

        {/* List or Form */}
        {tab === "list" && canViewList ? (
          <>
            {/* Filter bar */}
            <div className="max-w-5xl mx-auto space-y-4">
              <div className="rounded-2xl border border-white/10 bg-gray-800/40 p-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    className="inp h-12 w-full"
                    placeholder="Search by requester, email, title, or kind…"
                    value={qText}
                    onChange={(e) => setQText(e.target.value)}
                  />
                  <select
                    className="inp h-12 w-full select-gray no-native-ui"
                    value={filterKind}
                    onChange={(e) => setFilterKind((e.target.value || "") as any)}
                  >
                    <option value="">All Kinds</option>
                    <option value="shoot">Shoot</option>
                    <option value="event">Event</option>
                    <option value="office">Office Supplies</option>
                    <option value="others">Others</option>
                  </select>
                </div>
              </div>
            </div>

            {/* List */}
            <div className="rounded-2xl border border-white/10 bg-gray-800/40 overflow-hidden mt-4">
              {loadingList ? (
                <div className="p-8 text-center text-gray-400">Loading budgets…</div>
              ) : filtered.length === 0 ? (
                <div className="p-8 text-center text-gray-400">No budget requests found.</div>
              ) : (
                <div className="divide-y divide-white/10">
                  {filtered.map((b) => (
                    <div key={b.id} className="p-5 hover:bg-white/5 transition">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold">
                            {b.title}{" "}
                            <span className="text-sm text-gray-400">({b.kind.toUpperCase()})</span>
                          </div>
                          <div className="text-sm text-gray-300">
                            Requested by <span className="text-white">{b.requesterName}</span>{" "}
                            <span className="mx-2">•</span>
                            Date Requested: <span className="text-white">{b.dateRequested}</span>{" "}
                            <span className="mx-2">•</span>
                            Needed: <span className="text-white">{b.dateNeeded}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-green-300">{peso(b.amount)}</div>
                          <span className={`inline-block mt-1 px-3 py-1 rounded-full text-xs border ${badge(b.status)}`}>
                            {b.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          // ───────── centered form ─────────
          <form
            onSubmit={submit}
            className="max-w-3xl mx-auto rounded-2xl border border-white/10 bg-gray-800/40 p-6 space-y-6"
          >
            {/* Requester (auto) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="lbl">Date Requested</label>
                <input
                  type="date"
                  value={dateRequested}
                  onChange={(e) => setDateRequested(e.target.value)}
                  className="inp"
                  required
                />
              </div>
              <div>
                <label className="lbl">Requester</label>
                <input
                  className="inp"
                  disabled
                  value={me?.name || auth.currentUser?.displayName || auth.currentUser?.email || "—"}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-1">
                <label className="lbl">Type</label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as BudgetKind)}
                  className="inp select-gray no-native-ui"
                >
                  <option value="shoot">Shoot</option>
                  <option value="event">Event</option>
                  <option value="office">Office Supplies</option>
                  <option value="others">Others</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="lbl">Name of the Shoot / Event / Office Supplies</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="inp"
                  placeholder='e.g., “Client X Product Shoot”, “Printer toner & bond papers”…'
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="lbl">Date Needed</label>
                <input
                  type="date"
                  value={dateNeeded}
                  onChange={(e) => setDateNeeded(e.target.value)}
                  className="inp"
                  required
                />
              </div>
              <div>
                <label className="lbl">Amount</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="inp"
                  placeholder="0.00"
                  required
                />
              </div>
            </div>

            <div className="flex justify-center gap-3 pt-2">
              {canViewList && (
                <button
                  type="button"
                  onClick={() => setTab("list")}
                  className="px-5 py-2 rounded-xl bg-gray-700 hover:bg-gray-600"
                >
                  Back to List
                </button>
              )}
              <button type="submit" className="px-6 py-2 rounded-xl bg-blue-600 hover:bg-blue-500">
                Submit for Approval
              </button>
            </div>
          </form>
        )}
      </div>

      {/* tiny style helpers */}
      <style>{`
        .inp {
          width: 100%;
          padding: 0.75rem 1rem;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 0.75rem;
          color: #fff;
          outline: none;
          appearance: none;
          -webkit-appearance: none;
          -moz-appearance: none;
        }
        .inp:focus {
          box-shadow: 0 0 0 2px rgba(59,130,246,0.5);
          border-color: rgba(59,130,246,0.6);
        }
        .select-gray {
          background-color: rgba(31,41,55,0.8);
          color: #fff;
        }
        .select-gray option {
          background-color: #111827;
          color: #ffffff;
        }
        .no-native-ui { background-image: none !important; }
        .lbl {
          display:block;
          font-size: 0.9rem;
          color: #d1d5db;
          margin-bottom: 0.35rem;
        }
      `}</style>
    </div>
  );
}
