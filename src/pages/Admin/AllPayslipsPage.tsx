// src/pages/admin/AllPayslipsPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../firebase/firebase";
import {
  collection,
  doc,
  getDocs,
  query,
  orderBy,
  updateDoc,
  where,
} from "firebase/firestore";
import iplogo from "../../assets/iplogo.png";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

/* ================= Types ================= */
type MoneyRow = {
  label: string;
  note?: string;
  rateHour?: string;
  rateDay?: string;
  amount?: number;
};

type FiledRequest = {
  type: string;
  date: string;
  filedAt?: any;
};

type PayslipDoc = {
  id: string;
  employeeId?: string;
  employeeEmail?: string;
  employeeName?: string;
  department?: string;
  designation?: string;
  employeeAlias?: string;
  category?: string;
  cutoffLabel?: string;
  cutoffStart?: any;
  cutoffEnd?: any;
  workDays?: number;
  daysOfWork?: number;
  earnings?: MoneyRow[];
  deductions?: MoneyRow[];
  totalEarnings?: number;
  totalDeductions?: number;
  netPay?: number;
  periodKey?: string;
  draftId?: string;
  createdAt?: any;
  status?: string;
  details?: {
    filedRequests?: FiledRequest[];
  };
};

type AttendanceSnapshot = {
  id: string;
  periodKey?: string;
  cutoffLabel?: string;
  items?: any[];
};

/* ============== Utils ============== */
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
function peso(n?: number) {
  return `₱${Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/* ============== Main Component ============== */
export default function AllPayslipsPage() {
  const [loading, setLoading] = useState(true);
  const [payslips, setPayslips] = useState<PayslipDoc[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<PayslipDoc | null>(null);
  const [att, setAtt] = useState<AttendanceSnapshot | null>(null);

  // filters
  const [selectedCutoff, setSelectedCutoff] = useState<string>("all");
  const [search, setSearch] = useState<string>("");

  // TODO: wire actual auth role
  const role = "admin_final"; // simulate current user role

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const payslipRef = collection(db, "payslips");
        const snap = await getDocs(query(payslipRef, orderBy("cutoffEnd", "desc")));
        const rows: PayslipDoc[] = [];
        snap.forEach((d) => rows.push({ id: d.id, ...(d.data() as any) }));

        rows.sort((a, b) => {
          const da = toDate(a.cutoffEnd) || toDate(a.createdAt) || new Date(0);
          const dbb = toDate(b.cutoffEnd) || toDate(b.createdAt) || new Date(0);
          return dbb.getTime() - da.getTime();
        });

        setPayslips(rows);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // collect unique cutoff labels
  const cutoffOptions = useMemo(() => {
    const labels = Array.from(
      new Set(payslips.map((p) => p.cutoffLabel || periodSpan(p)))
    );
    return ["all", ...labels];
  }, [payslips]);

  // apply filters
  const filtered = useMemo(() => {
    let rows = payslips;
    if (selectedCutoff !== "all") {
      rows = rows.filter(
        (p) => (p.cutoffLabel || periodSpan(p)) === selectedCutoff
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (p) =>
          (p.employeeName || "").toLowerCase().includes(q) ||
          (p.employeeEmail || "").toLowerCase().includes(q) ||
          (p.department || "").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [payslips, selectedCutoff, search]);

  async function openSlip(p: PayslipDoc) {
    setActive(p);
    setOpen(true);
    setAtt(null);

    try {
      const aSnap = await getDocs(query(collection(db, "attendance")));
      let hit: AttendanceSnapshot | null = null;

      aSnap.forEach((d) => {
        const x = d.data() as any;
        const samePeriod =
          (p.periodKey && x.periodKey === p.periodKey) ||
          (p.cutoffLabel && x.cutoffLabel === p.cutoffLabel);

        if (samePeriod) {
          hit = { id: d.id, ...(x as Record<string, any>) } as AttendanceSnapshot;
        }
      });

      if (hit) {
        let itemsArr: any[] = [];
        const rawItems: any = (hit as any).items ?? [];
        if (Array.isArray(rawItems)) itemsArr = rawItems;
        else if (rawItems && typeof rawItems === "object") itemsArr = Object.values(rawItems);

        const empAlias = (p.employeeAlias || "").toLowerCase();
        let mine = itemsArr.filter(
          (it: any) => String(it?.name || "").toLowerCase() === empAlias
        );

        // 🔎 fetch filed requests from /requests
const reqSnap = await getDocs(
  query(
    collection(db, "requests"),
    where("employeeId", "==", p.employeeId || ""),
    where("status", "==", "approved")
  )
);

reqSnap.forEach((d) => {
  const r = (d.data() as any).details;
  if (!r?.date) return;

  const reqDate = new Date(r.date).toLocaleDateString("en-US"); // format date MM/DD/YYYY
  const existing = mine.find((it: any) => new Date(it.date).toLocaleDateString("en-US") === reqDate);

  const type = (r.type || "").toUpperCase();

if (existing) {
  existing.timeIn = r.timeIn || existing.timeIn || "";
  existing.timeOut = r.timeOut || existing.timeOut || "";
  existing.type = type;
} else {
  mine.push({
    date: r.date,
    type,
    timeIn: r.timeIn || "",
    timeOut: r.timeOut || "",
    hoursWorked: r.hours || 8,
    daysWorked: 1,
  });
}
});
        // merge filed remotework/wfh
        const filed = (p.details?.filedRequests || []).filter((f) =>
          ["remotework", "wfh"].includes((f.type || "").toLowerCase())
        );
        filed.forEach((f) => {
          const dateStr = f.date;
          const existing = mine.find((it: any) => it.date === dateStr);
          if (existing) {
            if (!existing.timeIn) existing.timeIn = "wfh";
            if (!existing.timeOut) existing.timeOut = "wfh";
            existing.note = `${f.type} • filedAt: ${toDate(f.filedAt)?.toLocaleString() || ""}`;
          } else {
            mine.push({
              date: dateStr,
              timeIn: "wfh",
              timeOut: "wfh",
              hoursWorked: 8,
              daysWorked: 1,
              note: `${f.type} • filedAt: ${toDate(f.filedAt)?.toLocaleString() || ""}`,
            });
          }
        });

        setAtt({ ...(hit as any), items: mine });
      }
    } catch (e) {
      console.error("Error getting attendance:", e);
    }
  }

  async function publishPayslip(p: PayslipDoc) {
    try {
      await updateDoc(doc(db, "payslips", p.id), { status: "ready" });
      // send email
      await fetch("/api/sendEmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: p.employeeEmail,
          subject: `Payslip for ${p.cutoffLabel}`,
          text: `Your payslip for ${p.cutoffLabel} is now available.`,
        }),
      });
      alert("Payslip published & email sent.");
    } catch (e) {
      console.error("Publish error:", e);
      alert("Failed to publish.");
    }
  }

  async function publishAllPayslips(rows: PayslipDoc[]) {
  try {
    for (const p of rows) {
      await updateDoc(doc(db, "payslips", p.id), { status: "ready" });

      if (p.employeeEmail) {
        await fetch("/api/sendEmail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: p.employeeEmail,
            subject: `Payslip for ${p.cutoffLabel}`,
            text: `Your payslip for ${p.cutoffLabel} is now available.`,
          }),
        });
      }
    }
    alert("All payslips published & emails sent.");
  } catch (e) {
    console.error("Publish All error:", e);
    alert("Failed to publish all payslips.");
  }
}


  async function rejectPayslip(p: PayslipDoc) {
    try {
      await updateDoc(doc(db, "payslips", p.id), { status: "rejected" });
      alert("Payslip rejected.");
    } catch (e) {
      console.error("Reject error:", e);
      alert("Failed to reject.");
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white pt-20 pb-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold">All Payslips</h1>
          <p className="text-gray-300 mt-1 text-sm sm:text-base">
            Admin & Finance view of all employees’ payslips
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <input
            type="text"
            placeholder="Search by name, email, department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-2 rounded-md bg-gray-800 border border-white/10 text-sm flex-1"
          />
          <select
            value={selectedCutoff}
            onChange={(e) => setSelectedCutoff(e.target.value)}
            className="px-3 py-2 rounded-md bg-gray-800 border border-white/10 text-sm w-full sm:w-auto"
          >
            {cutoffOptions.map((c) => (
              <option key={c} value={c}>
                {c === "all" ? "All Cutoffs" : c}
              </option>
            ))}
          </select>
        </div>

        {/* List */}
        <div className="rounded-2xl border border-white/10 bg-gray-800/40 overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-white/10 flex items-center justify-between">
            <div className="text-lg font-semibold">Available Payslips</div>
            {role === "admin_final" && filtered.length > 0 && (
                <button
                onClick={() => publishAllPayslips(filtered)}
                className="px-3 sm:px-4 py-2 rounded-xl bg-green-700 hover:bg-green-600 text-sm"
                >
                Publish All
                </button>
            )}
            </div>


          {loading ? (
            <div className="p-8 text-center text-gray-400">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-400">No payslips found.</div>
          ) : (
            <div className="divide-y divide-white/10">
              {filtered.map((p) => {
                const label = p.cutoffLabel || periodSpan(p);
                return (
                  <div
                    key={p.id}
                    className="px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3 hover:bg-white/5"
                  >
                    <div>
                      <div className="font-semibold text-left">{label}</div>
                      <div className="text-xs sm:text-sm text-gray-300">
                        {p.employeeName || "—"} <span className="mx-2">•</span>{" "}
                        Net Pay <span className="text-white font-medium">{peso(p.netPay)}</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openSlip(p)}
                        className="px-3 sm:px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm"
                      >
                        View / Download
                      </button>
                      {role === "admin_final" && (
                        <>
                          <button
                            onClick={() => publishPayslip(p)}
                            className="px-3 sm:px-4 py-2 rounded-xl bg-green-600 hover:bg-green-500 text-sm"
                          >
                            Publish
                          </button>
                          <button
                            onClick={() => rejectPayslip(p)}
                            className="px-3 sm:px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-sm"
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {open && active && (
        <PayslipModal
          onClose={() => setOpen(false)}
          payslip={active}
          attendance={att}
          title={active.cutoffLabel || periodSpan(active)}
        />
      )}
    </div>
  );
}

/* ============== Payslip Modal (full MyPayslips layout) ============== */
function PayslipModal({
  onClose,
  payslip,
  attendance,
  title,
}: {
  onClose: () => void;
  payslip: PayslipDoc;
  attendance: AttendanceSnapshot | null;
  title: string;
}) {
  const printRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    if (!printRef.current) return;
    setDownloading(true);
    try {
      printRef.current.classList.add("force-a4");
      const dataUrl = await toPng(printRef.current, { cacheBust: true, pixelRatio: 3 });

      const pdf = new jsPDF("p", "pt", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const img = new Image();
      img.src = dataUrl;
      await new Promise((resolve) => {
        img.onload = () => {
          const imgWidth = pdfWidth - 40;
          const imgHeight = (img.height * imgWidth) / img.width;
          pdf.addImage(dataUrl, "PNG", 20, 20, imgWidth, imgHeight, undefined, "FAST");
          pdf.save(buildFileName(payslip));
          resolve(true);
        };
      });
    } finally {
      printRef.current?.classList.remove("force-a4");
      setDownloading(false);
    }
  }

  const earnings = payslip.earnings || [];
  const deductions = payslip.deductions || [];
  const totE =
    payslip.totalEarnings ??
    earnings.reduce((a, b) => a + Number(b.amount || 0), 0);
  const totD =
    payslip.totalDeductions ??
    deductions.reduce((a, b) => a + Number(b.amount || 0), 0);
  const net = payslip.netPay ?? totE - totD;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="w-full sm:max-w-5xl max-h-[95vh] overflow-auto rounded-2xl border border-white/10 bg-gray-900">
        {/* Header */}
        <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-white/10 flex items-center justify-between sticky top-0 bg-gray-900">
          <div className="font-semibold">{title}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="px-3 sm:px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900/40 text-sm"
            >
              {downloading ? "Preparing…" : "Download PDF"}
            </button>
            <button
              onClick={onClose}
              className="px-3 sm:px-4 py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-sm"
            >
              Close
            </button>
          </div>
        </div>

        {/* Printable content */}
        <div
          ref={printRef}
          className="bg-white text-black p-4 sm:p-8 md:p-10 mx-auto w-full max-w-[794px]"
        >
          {/* Header with logo */}
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold font-serif">Payslip</h1>
            <img src={iplogo} alt="Company Logo" className="h-8 sm:h-10 md:h-12 object-contain" />
          </div>

          {/* Employee + Period */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mt-4 sm:mt-6 text-xs sm:text-sm font-medium">
            <div className="space-y-2">
              <Row2 label="EMPLOYEE" value={payslip.employeeName || "—"} />
              <Row2 label="DESIGNATION" value={payslip.designation || "—"} />
              <Row2 label="DEPARTMENT" value={payslip.department || "—"} />
            </div>
            <div className="space-y-2">
              <Row2 label="PAY PERIOD" value={payslip.cutoffLabel || periodSpan(payslip)} />
              <Row2 label="WORK DAYS" value={String(payslip.daysOfWork ?? "—")} />
              <Row2 label="DAYS OF WORK" value={String(payslip.workDays ?? "—")} />
            </div>
          </div>

          {/* Earnings/Deductions */}
          <div className="mt-4 sm:mt-6 border border-black rounded-none">
            {/* Earnings Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm min-w-[600px]">
                <thead className="bg-gray-100 font-bold">
                  <tr className="border-b border-black">
                    <th className="text-left p-2 sm:p-3 border-r border-black w-[40%]">EARNINGS</th>
                    <th className="text-left p-2 sm:p-3 border-r border-black">RATE/ HOUR</th>
                    <th className="text-left p-2 sm:p-3 border-r border-black">RATE/ DAY</th>
                    <th className="text-right p-2 sm:p-3">TOTAL AMOUNT</th>
                  </tr>
                </thead>
                <tbody>
                  {earnings.map((e, i) => (
                    <tr key={i} className="border-b border-black align-top">
                      <td className="p-2 sm:p-3 border-r border-black font-medium">
                        {e.label}
                        {e.note && <div className="text-[10px] sm:text-xs text-gray-600">{e.note}</div>}
                      </td>
                      <td className="p-2 sm:p-3 border-r border-black">{e.rateHour || ""}</td>
                      <td className="p-2 sm:p-3 border-r border-black">{e.rateDay || ""}</td>
                      <td className="p-2 sm:p-3 text-right">{e.amount != null ? peso(e.amount) : ""}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3} className="p-2 sm:p-3 font-semibold border-r border-black">TOTAL</td>
                    <td className="p-2 sm:p-3 text-right font-semibold">{peso(totE)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Deductions Table */}
            <div className="overflow-x-auto border-t border-black">
              <table className="w-full text-xs sm:text-sm min-w-[600px]">
                <tbody>
                  <tr className="bg-gray-100 border-b border-black font-bold">
                    <td className="p-2 sm:p-3 border-r border-black w-[40%]">DEDUCTIONS</td>
                    <td className="p-2 sm:p-3 border-r border-black"></td>
                    <td className="p-2 sm:p-3 border-r border-black"></td>
                    <td className="p-2 sm:p-3 text-right"></td>
                  </tr>
                  {deductions.map((d, i) => (
                    <tr key={i} className="border-b border-black">
                      <td className="p-2 sm:p-3 border-r border-black">{d.label}</td>
                      <td className="p-2 sm:p-3 border-r border-black">{d.rateHour || ""}</td>
                      <td className="p-2 sm:p-3 border-r border-black">{d.rateDay || ""}</td>
                      <td className="p-2 sm:p-3 text-right">{d.amount != null ? peso(d.amount) : ""}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3} className="p-2 sm:p-3 font-semibold border-r border-black">TOTAL DEDUCTIONS</td>
                    <td className="p-2 sm:p-3 text-right font-semibold">{peso(totD)}</td>
                  </tr>
                  <tr className="bg-gray-100 font-bold">
                    <td colSpan={3} className="p-2 sm:p-3 border-r border-black">TOTAL NET PAY</td>
                    <td className="p-2 sm:p-3 text-right text-base sm:text-lg font-extrabold">{peso(net)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Attendance */}
          {Array.isArray((attendance as any)?.items) && (attendance as any)?.items?.[0] && (
            <div className="mt-6 sm:mt-8">
              <div className="text-sm sm:text-base font-bold mb-2">
                Attendance ({attendance?.cutoffLabel || payslip.cutoffLabel || ""})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] sm:text-xs border border-black min-w-[560px]">
                  <thead className="bg-gray-100 font-semibold">
                    <tr className="border-b border-black">
                      <th className="text-left p-2 border-r border-black">Date</th>
                      <th className="text-left p-2 border-r border-black">In</th>
                      <th className="text-left p-2 border-r border-black">Out</th>
                      <th className="text-right p-2 border-r border-black">Hours/Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {((attendance as any)?.items || []).map((l: any, i: number) => {
                      const category = (payslip.category || "").toLowerCase();

                      let hoursOrDays;
                      if (["core", "core-probationary", "owner"].includes(category)) {
                        hoursOrDays = `${l?.daysWorked || 0} day(s)`;
                      } else if (category === "intern") {
                        hoursOrDays = `${Number(l?.hoursWorked || 0).toFixed(2)} hrs / ${l?.daysWorked || 0} day(s)`;
                      } else {
                        hoursOrDays = Number(l?.hoursWorked || 0).toFixed(2);
                      }

                      const inLabel = l?.timeIn
                        ? l.timeIn
                        : <span className="text-red-600 font-bold">NO IN</span>;
                        const outLabel = l?.timeOut
                        ? l.timeOut
                        : <span className="text-red-600 font-bold">NO OUT</span>;


                      return (
                        <tr key={i} className="border-b border-black">
                         <td className="p-2 border-r border-black">
                        {l?.date ? new Date(l.date).toLocaleDateString("en-US", { year: "2-digit" }) : ""}
                        {l?.type ? ` ${l.type}` : ""}
                        </td>
                          <td className="p-2 border-r border-black">{inLabel}</td>
                          <td className="p-2 border-r border-black">{outLabel}</td>
                          <td className="p-2 border-r border-black text-right">{hoursOrDays}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{`
        .force-a4 { width: 794px !important; }
      `}</style>
    </div>
  );
}

function Row2({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <div className="font-semibold">{label}:</div>
      <div>{value}</div>
    </div>
  );
}
function periodSpan(p: PayslipDoc) {
  const s = toDate(p.cutoffStart);
  const e = toDate(p.cutoffEnd);
  if (!s || !e) return "—";
  return `${s.toLocaleDateString()} – ${e.toLocaleDateString()}`;
}
function buildFileName(p: PayslipDoc) {
  const who = (p.employeeName || "payslip").replace(/\s+/g, "_");
  const period = (p.cutoffLabel || p.periodKey || "period").replace(/\s+/g, "_");
  return `${who}_${period}.pdf`;
}