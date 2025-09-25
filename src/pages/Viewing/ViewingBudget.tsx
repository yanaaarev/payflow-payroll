// src/pages/ViewingBudget.tsx
import { useEffect, useState } from "react";
import { db } from "../../firebase/firebase";
import { doc, getDoc } from "firebase/firestore";
import { useParams, useNavigate } from "react-router-dom";

type BudgetKind = "shoot" | "event" | "office" | "others";

type BudgetDoc = {
  id: string;
  requesterName: string;
  requesterEmail: string;
  kind: BudgetKind;
  title: string;
  dateRequested: string;
  dateNeeded: string;
  amount: number;
  status: "pending" | "approved" | "rejected";
  filedAt?: any;
};

const peso = (n: number) =>
  `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

export default function ViewingBudget() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [budget, setBudget] = useState<BudgetDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, "budgets", id));
        if (snap.exists()) {
          const data = snap.data() as any;
          setBudget({
            id: snap.id,
            requesterName: data.requesterName,
            requesterEmail: data.requesterEmail,
            kind: data.kind,
            title: data.title,
            dateRequested: data.dateRequested,
            dateNeeded: data.dateNeeded,
            amount: Number(data.amount || 0),
            status: data.status,
            filedAt: data.filedAt,
          });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return <div className="p-10 text-center text-gray-400">Loading budget…</div>;
  }

  if (!budget) {
    return <div className="p-10 text-center text-red-400">Budget not found.</div>;
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white pt-20 pb-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold mb-6 mt-15">Budget Details</h1>

        <form className="rounded-2xl border border-white/10 bg-gray-800/40 p-6 space-y-6">
          {/* Row 1 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="lbl">Date Requested</label>
              <input className="inp" value={budget.dateRequested} readOnly />
            </div>
            <div>
              <label className="lbl">Requester</label>
              <input className="inp" value={budget.requesterName} readOnly />
            </div>
          </div>

          {/* Row 2 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1">
              <label className="lbl">Type</label>
              <input className="inp" value={budget.kind} readOnly />
            </div>
            <div className="md:col-span-2">
              <label className="lbl">Name of the Shoot / Event / Office Supplies</label>
              <input className="inp" value={budget.title} readOnly />
            </div>
          </div>

          {/* Row 3 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="lbl">Date Needed</label>
              <input className="inp" value={budget.dateNeeded} readOnly />
            </div>
            <div>
              <label className="lbl">Amount</label>
              <input className="inp" value={peso(budget.amount)} readOnly />
            </div>
          </div>

          <div className="flex justify-center pt-4">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="px-6 py-2 rounded-xl bg-gray-700 hover:bg-gray-600"
            >
              Back
            </button>
          </div>
        </form>
      </div>

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
