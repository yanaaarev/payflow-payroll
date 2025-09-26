// src/pages/CashAdvancePage.tsx
import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebase/firebase";
import {
  collection,
  getDocs,
  serverTimestamp,
  addDoc,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { getAuth } from "firebase/auth";

type Emp = {
  id: string;           // doc id
  employeeId: string;   // EMP001
  name: string;
  status?: "active" | "inactive";
};

export default function CashAdvancePage() {
  const navigate = useNavigate();
  const auth = getAuth();

  // employees
  const [emps, setEmps] = useState<Emp[]>([]);
  const [loadingEmps, setLoadingEmps] = useState(true);

  // form data
  const [employeeDocId, setEmployeeDocId] = useState("");
  const [amount, setAmount] = useState<number | "">("");
  const [perCutOff, setPerCutOff] = useState<number | "">("");
  const [startDateCutOff, setStartDateCutOff] = useState<"first" | "second">("first");
  const [note, setNote] = useState("");

  // ui
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  // fetch employees
  useEffect(() => {
    (async () => {
      try {
        setLoadingEmps(true);
        const snap = await getDocs(collection(db, "employees"));
        const list: Emp[] = [];
        snap.forEach((d) => {
          const x = d.data() as any;
          list.push({
            id: d.id,
            employeeId: x.employeeId || "",
            name: x.name || "",
            status: x.status || "active",
          });
        });
        // active first, then by name
        list.sort((a, b) => {
          const sa = a.status === "active" ? 0 : 1;
          const sb = b.status === "active" ? 0 : 1;
          if (sa !== sb) return sa - sb;
          return a.name.localeCompare(b.name);
        });
        setEmps(list);
      } finally {
        setLoadingEmps(false);
      }
    })();
  }, []);

  const selectedEmp = useMemo(
    () => emps.find((e) => e.id === employeeDocId),
    [emps, employeeDocId]
  );

  // derived helper
  const cutoffsNeeded = useMemo(() => {
    const a = Number(amount || 0);
    const p = Number(perCutOff || 0);
    if (a > 0 && p > 0) return Math.ceil(a / p);
    return 0;
  }, [amount, perCutOff]);

  // submit
  const onPublish: React.FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    setErr("");
    setOk("");

    try {
      if (!selectedEmp) throw new Error("Please select an employee.");
      const a = Number(amount);
      const p = Number(perCutOff);
      if (!a || a <= 0) throw new Error("Enter a valid CA Amount.");
      if (!p || p <= 0) throw new Error("Enter a valid deduction per cut-off.");
      if (p > a) throw new Error("Per-cutoff deduction cannot exceed total amount.");

      const user = auth.currentUser;
      const filedBy = user?.email || "unknown@local";
      setSaving(true);

      // CA document stored in cashAdvances collection
      const payload = {
        employeeId: selectedEmp.employeeId,
        employeeName: selectedEmp.name,
        status: "pending", // always pending first
        filedAt: serverTimestamp(),
        filedBy,

        // core CA fields (flat for payrollDraftPage consumption)
        totalAmount: a,
        perCutOff: p,
        startDateCutOff,
        note: note || "",

        // workflow flags
        approved: false,
        approvedAt: null,
        approvedBy: null,
      };

      await addDoc(collection(db, "cashAdvances"), payload);

      setOk("Cash advance submitted for admin approval.");
      setTimeout(() => navigate("/finance/requests"), 900);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Failed to submit cash advance.");
    } finally {
      setSaving(false);
    }
  };

  return (
  <div className="min-h-screen bg-gray-900 rounded-2xl text-white pt-20 px-4 sm:px-6 lg:px-8 pb-12">
    {/* Top */}
    <div className="max-w-3xl mx-auto mb-6">
      <button
        onClick={() => navigate(-1)}
        className="text-blue-400 hover:text-blue-300"
      >
        ← Back
      </button>
    </div>

    {/* Card */}
    <form onSubmit={onPublish} className="max-w-3xl mx-auto">
      <div className="rounded-2xl border border-white/10 bg-gray-800/60 shadow-xl p-8 space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Cash Advance</h1>
          <p className="text-gray-400 mt-1">
            File a cash advance request. Admin approval is required.
          </p>
        </div>

        {err && (
          <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 text-rose-200 p-3 text-sm">
            {err}
          </div>
        )}
        {ok && (
          <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 text-emerald-200 p-3 text-sm">
            {ok}
          </div>
        )}

        {/* Employee */}
        <div>
          <label className="lbl">Employee</label>
          <select
            value={employeeDocId}
            onChange={(e) => setEmployeeDocId(e.target.value)}
            className="inp"
            required
            disabled={loadingEmps}
          >
            <option value="" disabled>
              {loadingEmps ? "Loading…" : "Select employee"}
            </option>
            {emps.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} — {e.employeeId}
                {e.status === "inactive" ? " (inactive)" : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Amounts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="lbl">CA Amount (₱)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) =>
                setAmount(e.target.value === "" ? "" : Number(e.target.value))
              }
              className="inp"
              placeholder="e.g., 10000"
              required
            />
          </div>
          <div>
            <label className="lbl">Deduct Per Cut-off (₱)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={perCutOff}
              onChange={(e) =>
                setPerCutOff(e.target.value === "" ? "" : Number(e.target.value))
              }
              className="inp"
              placeholder="e.g., 2000"
              required
            />
          </div>
        </div>

        {/* Deduction start */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="lbl">When to Deduct (start)</label>
            <select
              value={startDateCutOff}
              onChange={(e) =>
                setStartDateCutOff(e.target.value as "first" | "second")
              }
              className="inp"
            >
              <option value="first">First Cut-off (1–10 / 26–10)</option>
              <option value="second">Second Cut-off (11–25)</option>
            </select>
          </div>
          <div>
            <label className="lbl">Estimated # of Cut-offs</label>
            <input
              className="inp bg-gray-700/50 text-gray-300"
              value={cutoffsNeeded || ""}
              readOnly
              placeholder="—"
            />
          </div>
        </div>

        {/* Note */}
        <div>
          <label className="lbl">Note (optional)</label>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="inp"
            placeholder="Any extra details for approver…"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-4 pt-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-5 py-2 rounded-xl bg-gray-700 hover:bg-gray-600"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 flex items-center gap-2"
          >
            {saving ? "Publishing…" : "Publish for Approval"}
          </button>
        </div>
      </div>
    </form>

    {/* small style helpers */}
    <style>{`
      .inp {
        width: 100%;
        padding: 0.75rem 1rem;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 0.75rem;
        color: #fff;
        outline: none;
      }
      .inp:focus {
        box-shadow: 0 0 0 2px rgba(59,130,246,0.5);
        border-color: rgba(59,130,246,0.6);
      }
      .lbl {
        display:block;
        font-size: 0.9rem;
        font-weight: 500;
        color: #d1d5db;
        margin-bottom: 0.35rem;
      }
    `}</style>
  </div>
);
}