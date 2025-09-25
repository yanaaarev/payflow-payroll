import { useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../../firebase/firebase";

/* ========================= Types ========================= */
type FinanceSettings = {
  requiredExecApprovals?: number;
  cashAdvanceMax?: number;
  updatedAt?: string; // ✅ always string after sanitize
  updatedBy?: string;
};

type Holiday = {
  id: string;
  name: string;
  date: string;
  recurring: boolean;
  createdAt?: string; // ✅ always string after sanitize
  createdBy?: string;
};

type HolidayLite = { name: string; date: string; recurring: boolean };

/* ========================= Utils ========================= */
function toNumber(v: any, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function formatDate(v: any): string {
  if (!v) return "—";
  try {
    if (typeof v.toDate === "function") return v.toDate().toLocaleString();
    if (v.seconds) return new Date(v.seconds * 1000).toLocaleString();
    return String(v);
  } catch {
    return String(v);
  }
}

function sanitize<T extends Record<string, any>>(obj: T): T {
  const out: any = {};
  for (const k in obj) {
    const v = obj[k];
    if (v && typeof v === "object" && ("seconds" in v || typeof v.toDate === "function")) {
      out[k] = formatDate(v); // ✅ convert Firestore Timestamp → string
    } else {
      out[k] = v;
    }
  }
  return out;
}

/* ========================= Page ========================= */
export default function FinanceSettingsPage() {
  const auth = getAuth();
  const me = auth.currentUser;
  const myEmail = (me?.email || "").toLowerCase();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);

  const [finSettings, setFinSettings] = useState<FinanceSettings>({
    requiredExecApprovals: 2,
    cashAdvanceMax: 0,
  });

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [hName, setHName] = useState("");
  const [hDate, setHDate] = useState("");
  const [hRecurring, setHRecurring] = useState(false);

  /* ---------- Load data ---------- */
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // Finance settings
        const fsRef = doc(db, "settings", "finance");
        const fsDoc = await getDoc(fsRef);
        if (fsDoc.exists()) {
          setFinSettings(sanitize(fsDoc.data()) as FinanceSettings);
        }

        // Holidays
        const hq = query(collection(db, "holidays"), orderBy("date", "asc"), fsLimit(500));
        const hSnap = await getDocs(hq);
        const hArr: Holiday[] = [];
        hSnap.forEach((d) => hArr.push({ id: d.id, ...(sanitize(d.data()) as any) }));
        setHolidays(hArr);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ---------- Save finance settings ---------- */
  async function saveSettings(applyAfter = false) {
    setSaving(true);
    try {
      const ref = doc(db, "settings", "finance");
      await setDoc(
        ref,
        {
          requiredExecApprovals: toNumber(finSettings.requiredExecApprovals, 2),
          cashAdvanceMax: toNumber(finSettings.cashAdvanceMax, 0),
          updatedAt: serverTimestamp(),
          updatedBy: myEmail || null,
        },
        { merge: true }
      );
      if (applyAfter) await applyToDrafts();
    } finally {
      setSaving(false);
    }
  }

  /* ---------- Holiday CRUD ---------- */
  async function addHoliday(applyAfter = false) {
    if (!hName.trim() || !hDate) return;
    const newObj = {
      name: hName.trim(),
      date: hDate,
      recurring: !!hRecurring,
      createdAt: serverTimestamp(),
      createdBy: myEmail || null,
    };
    const id = (await addDoc(collection(db, "holidays"), newObj)).id;
    setHolidays((prev) => [...prev, { id, ...(sanitize(newObj) as any) }]);
    setHName("");
    setHDate("");
    setHRecurring(false);
    if (applyAfter) await applyToDrafts();
  }

  async function deleteHoliday(id: string, applyAfter = false) {
    if (!id) return;
    await deleteDoc(doc(db, "holidays", id));
    setHolidays((prev) => prev.filter((h) => h.id !== id));
    if (applyAfter) await applyToDrafts();
  }

  /* ---------- Apply to drafts ---------- */
  async function applyToDrafts() {
    setApplying(true);
    try {
      const holidaysLite: HolidayLite[] = holidays.map((h) => ({
        name: h.name,
        date: h.date,
        recurring: h.recurring,
      }));

      const statuses = ["draft", "finance_review", "pending_exec"] as const;
      for (const st of statuses) {
        const qy = query(collection(db, "payrollDrafts"), where("status", "==", st), fsLimit(400));
        const snap = await getDocs(qy);
        for (const d of snap.docs) {
          await updateDoc(doc(db, "payrollDrafts", d.id), {
            financeConfig: {
              requiredExecApprovals: toNumber(finSettings.requiredExecApprovals, 2),
              cashAdvanceMax: toNumber(finSettings.cashAdvanceMax, 0),
              holidays: holidaysLite,
              appliedAt: serverTimestamp(),
              appliedBy: myEmail || null,
            },
          });
        }
      }
    } finally {
      setApplying(false);
    }
  }

  /* ---------- UI ---------- */
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div>Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white pt-20 pb-24">
      <div className="max-w-5xl mx-auto px-4 space-y-8">
        <h1 className="text-3xl font-bold">Finance Settings</h1>

        {/* Finance Settings */}
        <Card title="General Finance Configuration">
          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Required Executive Approvals">
              <input
                type="number"
                min={1}
                className="inp h-11"
                value={finSettings.requiredExecApprovals ?? 2}
                onChange={(e) =>
                  setFinSettings((s) => ({
                    ...s,
                    requiredExecApprovals: toNumber(e.target.value, 2),
                  }))
                }
              />
            </Field>
            <Field label="Cash Advance Maximum">
              <input
                type="number"
                min={0}
                className="inp h-11"
                value={finSettings.cashAdvanceMax ?? 0}
                onChange={(e) =>
                  setFinSettings((s) => ({
                    ...s,
                    cashAdvanceMax: toNumber(e.target.value, 0),
                  }))
                }
              />
            </Field>
          </div>
          {finSettings.updatedAt && (
            <p className="text-xs text-gray-400 mt-2">
              Last updated: {finSettings.updatedAt} by {finSettings.updatedBy || "—"}
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={() => saveSettings(false)}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => saveSettings(true)}
              disabled={saving || applying}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60"
            >
              {saving || applying ? "Saving & Applying…" : "Save & Apply"}
            </button>
          </div>
        </Card>

        {/* Holidays */}
        <Card title="Company Holidays">
          <div className="grid md:grid-cols-3 gap-5">
            <Field label="Holiday Name">
              <input
                className="inp h-11"
                placeholder="e.g., New Year’s Day"
                value={hName}
                onChange={(e) => setHName(e.target.value)}
              />
            </Field>
            <Field label="Date">
              <input
                type="date"
                className="inp h-11"
                value={hDate}
                onChange={(e) => setHDate(e.target.value)}
              />
            </Field>
            <Field label="Recurring?">
              <input
                type="checkbox"
                checked={hRecurring}
                onChange={(e) => setHRecurring(e.target.checked)}
              />{" "}
              Annually
            </Field>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => addHoliday(false)}
              disabled={!hName.trim() || !hDate}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500"
            >
              Add Holiday
            </button>
          </div>

          <div className="mt-8 overflow-x-auto rounded-lg border border-white/10">
            <table className="min-w-full divide-y divide-white/10">
              <thead className="bg-gray-800/60">
                <tr>
                  <Th>Holiday</Th>
                  <Th>Date</Th>
                  <Th>Recurring</Th>
                  <Th>Created</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 bg-gray-900/20">
                {holidays.length === 0 ? (
                  <tr>
                    <Td colSpan={5}>No holidays yet.</Td>
                  </tr>
                ) : (
                  holidays.map((h) => (
                    <tr key={h.id}>
                      <Td>{h.name}</Td>
                      <Td>{h.date}</Td>
                      <Td>{h.recurring ? "Yes" : "No"}</Td>
                      <Td>{h.createdAt || "—"} {h.createdBy ? `by ${h.createdBy}` : ""}</Td>
                      <Td>
                        <button
                          onClick={() => deleteHoliday(h.id, false)}
                          className="px-3 py-1 bg-rose-600 hover:bg-rose-500 rounded text-sm"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => deleteHoliday(h.id, true)}
                          disabled={applying}
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-sm ml-2 disabled:opacity-60"
                        >
                          Delete & Apply
                        </button>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Apply All */}
        <div className="mt-8">
          <button
            onClick={applyToDrafts}
            disabled={applying}
            className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-60"
          >
            {applying ? "Applying…" : "Apply Settings & Holidays to Drafts"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ========================= UI bits ========================= */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-gray-800/40">
      <div className="px-6 py-3 border-b border-white/10 text-lg font-semibold">{title}</div>
      <div className="p-6">{children}</div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm text-gray-200">{label}</label>
      {children}
    </div>
  );
}
function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-300">{children}</th>
  );
}
function Td({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) {
  return <td colSpan={colSpan} className="px-4 py-2 text-gray-200">{children}</td>;
}
