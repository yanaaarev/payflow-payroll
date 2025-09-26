import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebase/firebase";
import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";

/* ───────────────── Types ───────────────── */
type Role = "admin" | "finance" | "exec" | string;

type Payslip = {
  id: string;
  employeeId: string;
  employeeName: string;
  grossPay?: number;
  deductions?: number;
  netPay?: number;
};

type DraftHead = {
  id: string;
  status: string;
  periodKey?: string;
  cutoffLabel?: string;
  cutoffStart?: any;
  cutoffEnd?: any;
  totalNet?: number;
  createdAt?: any;
  publishedAt?: any;
  payslips?: Payslip[];
};

//@ts-ignore
type LineDoc = {
  id: string;
  employeeId: string;
  employeeName: string;
  netPay?: number;
};

/* ───────────────── Utils ───────────────── */
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
function monthName(i: number) {
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][i] || "";
}
function formatPeso(n: number) {
  return `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** CSV helpers */
function csvEscape(v: any) {
  if (v == null) return "";
  const s = String(v);
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function downloadCSV(filename: string, rows: Array<Record<string, any>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const auth = getAuth();
  const [allow, setAllow] = useState<boolean | null>(null);

  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<DraftHead[]>([]);
  const [, setError] = useState("");

  /* ───────── Access Guard ───────── */
  useEffect(() => {
    (async () => {
      try {
        setAllow(null);
        const user = auth.currentUser;
        if (!user) return setAllow(false);
        const token = await user.getIdTokenResult();
        const roles: Role[] = (token.claims?.roles as Role[]) || [];
        setAllow(roles.includes("admin") || roles.includes("finance") || roles.includes("exec"));
      } catch {
        setAllow(false);
      }
    })();
  }, [auth.currentUser?.uid]);

  /* ───────── Load published drafts for selected year ───────── */
  useEffect(() => {
  (async () => {
    if (!allow) return;
    setLoading(true);
    setError("");

    const start = new Date(year, 0, 1);
    const end = new Date(year + 1, 0, 1);

    try {
      // Step 1: fetch approved drafts
      const qSnap = await getDocs(
        query(
          collection(db, "payrollDrafts"),
          where("status", "==", "approved"),
          orderBy("createdAt", "desc")
        )
      );

      const results: DraftHead[] = [];

for (const d of qSnap.docs) {
  const x = d.data() as any;

  const draft: DraftHead = {
    id: d.id,
    status: x.status,
    periodKey: x.periodKey,
    cutoffLabel: x.cutoffLabel,
    cutoffStart: x.cutoffStart,
    cutoffEnd: x.cutoffEnd,
    createdAt: x.createdAt,
    publishedAt: x.publishedAt,
    totalNet: 0,
    payslips: [],
  };

  const s = toDate(draft.cutoffStart) || toDate(draft.createdAt);
  if (!s || s < start || s >= end) continue;

  // 🔹 Fetch payslips under this draft
  const payslipSnap = await getDocs(
    query(collection(db, "payslips"), where("draftId", "==", draft.id))
  );

  let sum = 0;
  const slips: Payslip[] = [];
  payslipSnap.forEach((ps) => {
    const P = ps.data() as any;
    slips.push({
      id: ps.id,
      employeeId: P.employeeId,
      employeeName: P.employeeName,
      grossPay: Number(P.grossPay || 0),
      deductions: Number(P.totalDeductions || 0),
      netPay: Number(P.netPay || 0),
    });
    sum += Number(P.netPay || 0);
  });

  draft.totalNet = sum;
  draft.payslips = slips;
  results.push(draft);
}
setDrafts(results);
    } catch (e) {
      console.error(e);
      setError("Failed to load payroll data.");
    } finally {
      setLoading(false);
    }
  })();
}, [allow, year]);


  /* ───────── Aggregate per month ───────── */
  const perMonth = useMemo(() => {
    const buckets = Array.from({ length: 12 }, (_, i) => ({
      monthIdx: i,
      label: monthName(i),
      total: 0,
      count: 0,
      items: [] as DraftHead[],
    }));
    drafts.forEach((d) => {
      const when =
        toDate(d.cutoffStart) ||
        toDate(d.createdAt) ||
        toDate(d.publishedAt) ||
        new Date();
      const idx = when.getMonth();
      buckets[idx].total += Number(d.totalNet || 0);
      buckets[idx].count += 1;
      buckets[idx].items.push(d);
    });
    return buckets;
  }, [drafts]);

  const yearTotal = useMemo(
    () => perMonth.reduce((a, b) => a + b.total, 0),
    [perMonth]
  );
  const bestMonth = useMemo(() => {
    return perMonth.reduce(
      (acc, cur) => (cur.total > acc.total ? cur : acc),
      perMonth[0] || { total: 0, monthIdx: 0, label: "", count: 0, items: [] }
    );
  }, [perMonth]);

  /* ───────── CSV Exporters ───────── */
  function exportYearCSV() {
  const rows: Array<Record<string, any>> = [];

  perMonth.forEach((m) => {
    if (m.items.length === 0) return;
    const employees = m.items.reduce((acc, it) => acc + (it.payslips?.length || 0), 0);

    rows.push({
      Year: String(year),
      Month: m.label,
      Drafts: m.items.length,
      EmployeesPaid: employees,
      TotalPayroll: Number(m.total || 0),
    });
  });

  if (rows.length === 0) return;
  downloadCSV(`PayrollSummary_${year}.csv`, rows);
}

  function exportMonthCSV(m: { label: string; items: DraftHead[] }) {
  const rows: Array<Record<string, any>> = [];

  m.items.forEach((it) => {
    (it.payslips || []).forEach((ps) => {
      rows.push({
        Year: String(year),
        Month: m.label,
        DraftID: it.id,
        Cutoff: it.cutoffLabel || "",
        EmployeeID: ps.employeeId,
        Employee: ps.employeeName,
        GrossPay: Number(ps.grossPay || 0),
        Deductions: Number(ps.deductions || 0),
        NetPay: Number(ps.netPay || 0),
      });
    });
  });

  if (rows.length === 0) return;
  downloadCSV(`PayrollDetails_${year}_${m.label}.csv`, rows);
}


  /* ───────── Guards ───────── */
  if (allow === null) {
    return (
      <div className="min-h-screen bg-gray-900 text-white pt-20 flex items-center justify-center">
        <div className="animate-spin h-10 w-10 rounded-full border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }
  if (!allow) {
    return (
      <div className="min-h-screen bg-gray-900 text-white pt-20 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-2xl font-bold">Access denied</h1>
          <p className="text-gray-300 mt-2">Reports are restricted to Admin, Finance, or Exec.</p>
        </div>
      </div>
    );
  }

  /* ───────── UI ───────── */
  return (
    <div className="min-h-screen bg-gray-900 rounded-2xl text-white pt-20 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Header & Actions */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Payroll Reports</h1>
            <p className="text-gray-300 mt-2">Overview of published payroll totals by month and year.</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-300">Year</label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="px-4 py-2 rounded-xl bg-gray-800 border border-white/20 focus:outline-none"
              >
                {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            <button
              onClick={exportYearCSV}
              disabled={loading || drafts.length === 0}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900/40"
              title={drafts.length === 0 ? "No data to export" : "Download CSV for the whole year"}
            >
              Export Year CSV
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
          <div className="rounded-2xl border border-white/10 bg-gray-800/40 p-5">
            <div className="text-sm text-gray-400">Year-to-Date Total</div>
            <div className="text-2xl font-bold mt-1">{formatPeso(yearTotal)}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-gray-800/40 p-5">
            <div className="text-sm text-gray-400">Published Drafts</div>
            <div className="text-2xl font-bold mt-1">{drafts.length}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-gray-800/40 p-5">
            <div className="text-sm text-gray-400">Best Month</div>
            <div className="text-2xl font-bold mt-1">
              {bestMonth?.label || "—"}{" "}
              <span className="text-lg text-gray-300 ml-2">{formatPeso(bestMonth?.total || 0)}</span>
            </div>
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="rounded-2xl border border-white/10 bg-gray-800/40 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Monthly Payroll Totals</h2>
              <span className="text-xs text-gray-400">Bar</span>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={perMonth.map(m => ({ name: m.label, total: Math.round(m.total) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                  <XAxis dataKey="name" stroke="#A3A3A3" />
                  <YAxis stroke="#A3A3A3" />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.05)" }}
                    contentStyle={{ background: "#111827", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }}
                    formatter={(v:any) => [formatPeso(Number(v)), "Total"]}
                  />
                  <Bar dataKey="total" fill="#60A5FA" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-gray-800/40 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Annual Trend</h2>
              <span className="text-xs text-gray-400">Line</span>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={perMonth.map(m => ({ name: m.label, total: Math.round(m.total) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                  <XAxis dataKey="name" stroke="#A3A3A3" />
                  <YAxis stroke="#A3A3A3" />
                  <Tooltip
                    cursor={{ stroke: "rgba(255,255,255,0.2)" }}
                    contentStyle={{ background: "#111827", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }}
                    formatter={(v:any) => [formatPeso(Number(v)), "Total"]}
                  />
                  <Line type="monotone" dataKey="total" stroke="#34D399" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Month-by-month table (with per-month export) */}
        <div className="rounded-2xl border border-white/10 bg-gray-800/40 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Published Payrolls ({year})</h2>
            <span className="text-sm text-gray-400">Click a month row to expand items</span>
          </div>

          <div className="divide-y divide-white/10">
            {loading ? (
              <div className="p-6 text-center text-gray-400">Loading…</div>
            ) : perMonth.every(m => m.count === 0) ? (
              <div className="p-6 text-center text-gray-400">No published payrolls for this year.</div>
            ) : (
              perMonth.map((m, idx) => (
                <MonthRow
                  key={idx}
                  m={m}
                  year={year}
                  onExport={() => exportMonthCSV(m)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────── Expandable Month Row ───────── */
function MonthRow({
  m,
  year,
  onExport,
}: {
  m: { monthIdx: number; label: string; total: number; count: number; items: DraftHead[] };
  year: number;
  onExport: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="w-full px-6 py-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex-1 text-left hover:bg-white/5 rounded-lg px-3 py-2"
          title="Expand month"
        >
          <div className="font-semibold">{m.label}</div>
          <div className="text-sm text-gray-400">{m.count} published draft{m.count === 1 ? "" : "s"}</div>
        </button>

        <div className="text-right">
          <div className="font-mono">{formatPeso(m.total)}</div>
          <div className="mt-2">
            <button
              type="button"
              onClick={onExport}
              disabled={m.items.length === 0}
              className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900/40"
              title={m.items.length === 0 ? "No data to export" : `Export ${m.label} ${year}`}
            >
              Export {m.label}
            </button>
          </div>
        </div>
      </div>

      {open && m.items.length > 0 && (
        <div className="bg-black/20 border-t border-white/10">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/5">
                <tr>
                  <th className="text-left px-6 py-3">Cutoff</th>
                  <th className="text-left px-6 py-3">Period Key</th>
                  <th className="text-right px-6 py-3">Total Net</th>
                </tr>
              </thead>
              <tbody>
                {m.items.map((it) => (
                  <tr key={it.id} className="border-t border-white/10">
                    <td className="px-6 py-3">{it.cutoffLabel || "—"}</td>
                    <td className="px-6 py-3">{it.periodKey || "—"}</td>
                    <td className="px-6 py-3 text-right">
                      {formatPeso(Number(it.totalNet || 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
