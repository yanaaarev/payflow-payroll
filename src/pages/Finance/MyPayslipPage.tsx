import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../firebase/firebase";
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { onAuthStateChanged, getAuth, type User } from "firebase/auth";
import iplogo from "../../assets/iplogo.png";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

/** ───────────────── Types ───────────────── */
type MoneyRow = {
  label: string;
  note?: string;
  rateHour?: string;
  rateDay?: string;
  amount?: number;
};

type PayslipDoc = {
  id: string;
  employeeId?: string;
  employeeEmail?: string;
  employeeName?: string;
  department?: string;
  designation?: string;
  employeeAlias?: string;
  category?: string; // core, core_probationary, intern, owner, freelancer

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
};

type AttendanceSnapshot = {
  id: string;
  periodKey?: string;
  cutoffLabel?: string;
  items?: any[];
};

/** ───────────────── Utils ───────────────── */
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

/** ───────────────── Component ───────────────── */
export default function MyPayslipsPage() {
  const [loading, setLoading] = useState(true);
  const [payslips, setPayslips] = useState<PayslipDoc[]>([]);
  const [me, setMe] = useState<{ email?: string; uid?: string } | null>(null);

  // detail modal
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<PayslipDoc | null>(null);
  const [att, setAtt] = useState<AttendanceSnapshot | null>(null);

  useEffect(() => {
  const auth = getAuth();

  const unsub = onAuthStateChanged(auth, async (user: User | null) => {
    setLoading(true);
    try {
      if (!user) {
        setMe(null);
        setPayslips([]);
        return;
      }

      const email = (user.email || "").toLowerCase();
      setMe({ email, uid: user.uid });

      const payslipRef = collection(db, "payslips");
      let rows: PayslipDoc[] = [];

      // 🔎 fetch by email
      const snapEmail = await getDocs(query(payslipRef, where("employeeEmail", "==", email)));
      snapEmail.forEach((d) => rows.push({ id: d.id, ...(d.data() as any) }));

      // 🔎 fallback fetch by uid
      if (rows.length === 0) {
        const s2 = await getDocs(query(payslipRef, where("employeeId", "==", user.uid)));
        s2.forEach((d) => rows.push({ id: d.id, ...(d.data() as any) }));
      }

      // 🔎 fallback fetch by alias
      if (rows.length === 0) {
        const empSnap = await getDocs(
          query(collection(db, "employees"), where("email", "==", email))
        );
        if (!empSnap.empty) {
          const emp = empSnap.docs[0].data() as any;
          const alias = (emp.alias || "").toLowerCase();
          if (alias) {
            const s3 = await getDocs(query(payslipRef, where("employeeAlias", "==", alias)));
            s3.forEach((d) => rows.push({ id: d.id, ...(d.data() as any) }));
          }
        }
      }

      // sort by cutoffEnd/createdAt
      rows.sort((a, b) => {
        const da = toDate(a.cutoffEnd) || toDate(a.createdAt) || new Date(0);
        const dbb = toDate(b.cutoffEnd) || toDate(b.createdAt) || new Date(0);
        return dbb.getTime() - da.getTime();
      });

      setPayslips(rows);
    } finally {
      setLoading(false);
    }
  });

  return () => unsub();
}, []);


  async function openSlip(p: PayslipDoc) {
  setActive(p);
  setOpen(true);
  setAtt(null);

  try {
    // 🔑 fetch category from employees collection
    if (!p.category) {
      const empSnap = await getDocs(
        query(collection(db, "employees"), where("alias", "==", p.employeeAlias))
      );
      if (!empSnap.empty) {
        const emp = empSnap.docs[0].data() as any;
        p.category = emp.category || "";
      }
    }

    const aSnap = await getDocs(query(collection(db, "attendance")));
  let hit: AttendanceSnapshot | null = null;

  aSnap.forEach((d) => {
    const x = d.data() as any;
    const samePeriod =
      (p.periodKey && x.periodKey === p.periodKey) ||
      (p.cutoffLabel && x.cutoffLabel === p.cutoffLabel);

    if (samePeriod) {
      hit = {
        id: d.id,
        ...(x as Record<string, any>),
      } as AttendanceSnapshot;
    }
  });

  if (hit) {
  let itemsArr: any[] = [];
  const rawItems: any = (hit as any).items ?? [];

  if (Array.isArray(rawItems)) {
    itemsArr = rawItems;
  } else if (rawItems && typeof rawItems === "object") {
    itemsArr = Object.values(rawItems);
  }

  // 🔑 Fix: compare payslip.employeeAlias to attendance.name
  const empAlias = (p.employeeAlias || "").toLowerCase();
  const mine = itemsArr.filter(
    (it: any) => String(it?.name || "").toLowerCase() === empAlias
  );

  // ✅ Even if multiple logs match, include them all
  if (mine.length > 0) {
    setAtt({ ...(hit as any), items: mine });
  } else {
    console.warn("No attendance match for alias:", empAlias, itemsArr);
    setAtt({ ...(hit as any), items: [] });
  }
}
    } catch (e) {
      console.error("Error getting attendance:", e);
    }
  }

  const title = useMemo(() => {
    if (!active) return "Payslip";
    const when =
      active.cutoffLabel ||
      `${(toDate(active.cutoffStart) || new Date()).toLocaleDateString()} – ${
        (toDate(active.cutoffEnd) || new Date()).toLocaleDateString()
      }`;
    return `Payslip • ${when}`;
  }, [active]);

  return (
    <div className="min-h-screen bg-gray-900 rounded-2xl text-white pt-20 pb-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">My Payslips</h1>
          <p className="text-gray-300 mt-1">
            View and download your published payslips.
          </p>
        </div>

        {/* List */}
        <div className="rounded-2xl border border-white/10 bg-gray-800/40 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
            <div className="text-lg font-semibold">Available Payslips</div>
            <div className="text-sm text-gray-400">{me?.email}</div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-400">Loading…</div>
          ) : payslips.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              No payslips yet.
            </div>
          ) : (
            <div className="divide-y text-left divide-white/10">
              {payslips.map((p) => {
                const end = toDate(p.cutoffEnd) || toDate(p.createdAt);
                const label =
                  p.cutoffLabel ||
                  end?.toLocaleDateString() ||
                  p.periodKey ||
                  "Period";
                return (
                  <div
                    key={p.id}
                    className="px-6 py-5 flex flex-wrap items-center justify-between gap-3 hover:bg-white/5"
                  >
                    <div>
                      <div className="font-semibold">{label}</div>
                      <div className="text-sm text-gray-300">
                        {p.employeeName || "—"} <span className="mx-2">•</span>{" "}
                        Net Pay{" "}
                        <span className="text-white font-medium">
                          {peso(p.netPay)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openSlip(p)}
                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500"
                      >
                        View / Download
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {open && active && (
        <PayslipModal
          onClose={() => setOpen(false)}
          payslip={active}
          attendance={att}
          title={title}
        />
      )}
    </div>
  );
}

/* ───────────────── Payslip Modal + PDF export ───────────────── */
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
    const dataUrl = await toPng(printRef.current, { cacheBust: true, pixelRatio: 5 });

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
  } catch (e) {
    console.error("Error generating PDF:", e);
  } finally {
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
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-5xl max-h-[90vh] overflow-auto rounded-2xl border border-white/10 bg-gray-900">
        {/* Modal header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between sticky top-0 bg-gray-900">
          <div className="font-semibold">{title}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900/40"
            >
              {downloading ? "Preparing…" : "Download PDF"}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-gray-700 hover:bg-gray-600"
            >
              Close
            </button>
          </div>
        </div>

        {/* Printable slip */}
        <div ref={printRef} className="bg-white text-black p-10">
          {/* Header with logo */}
          <div className="flex items-center justify-between">
            <h1 className="text-4xl font-extrabold font-serif">Payslip</h1>
            <img src={iplogo} alt="Company Logo" className="h-12 object-contain" />
          </div>

          {/* Employee + Period */}
          <div className="grid grid-cols-2 gap-6 mt-6 text-sm font-medium">
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
          <div className="mt-6 border border-black">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 font-bold">
                <tr className="border-b border-black">
                  <th className="text-left p-3 border-r border-black w-[40%]">EARNINGS</th>
                  <th className="text-left p-3 border-r border-black">RATE/ HOUR</th>
                  <th className="text-left p-3 border-r border-black">RATE/ DAY</th>
                  <th className="text-right p-3">TOTAL AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                {earnings.map((e, i) => (
                  <tr key={i} className="border-b border-black align-top">
                    <td className="p-3 border-r border-black font-medium">
                      {e.label}
                      {e.note && <div className="text-xs text-gray-600">{e.note}</div>}
                    </td>
                    <td className="p-3 border-r border-black">{e.rateHour || ""}</td>
                    <td className="p-3 border-r border-black">{e.rateDay || ""}</td>
                    <td className="p-3 text-right">{e.amount != null ? peso(e.amount) : ""}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3} className="p-3 font-semibold border-r border-black">TOTAL</td>
                  <td className="p-3 text-right font-semibold">{peso(totE)}</td>
                </tr>
              </tbody>
            </table>

            {/* Deductions */}
            <table className="w-full text-sm border-t border-black">
              <tbody>
                <tr className="bg-gray-100 border-b border-black font-bold">
                  <td className="p-3 border-r border-black w-[40%]">DEDUCTIONS</td>
                  <td className="p-3 border-r border-black"></td>
                  <td className="p-3 border-r border-black"></td>
                  <td className="p-3 text-right"></td>
                </tr>
                {deductions.map((d, i) => (
                  <tr key={i} className="border-b border-black">
                    <td className="p-3 border-r border-black">{d.label}</td>
                    <td className="p-3 border-r border-black">{d.rateHour || ""}</td>
                    <td className="p-3 border-r border-black">{d.rateDay || ""}</td>
                    <td className="p-3 text-right">{d.amount != null ? peso(d.amount) : ""}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3} className="p-3 font-semibold border-r border-black">TOTAL DEDUCTIONS</td>
                  <td className="p-3 text-right font-semibold">{peso(totD)}</td>
                </tr>
                <tr className="bg-gray-100 font-bold">
                  <td colSpan={3} className="p-3 border-r border-black">TOTAL NET PAY</td>
                  <td className="p-3 text-right text-lg font-extrabold">{peso(net)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Attendance */}
          {Array.isArray((attendance as any)?.items) && (attendance as any)?.items?.[0] && (
            <div className="mt-8">
              <div className="text-base font-bold mb-2">Attendance ({attendance?.cutoffLabel || payslip.cutoffLabel || ""})</div>
              <table className="w-full text-xs border border-black">
                <thead className="bg-gray-100 font-semibold">
                  <tr className="border-b border-black">
                    <th className="text-left p-2 border-r border-black">Date</th>
                    <th className="text-left p-2 border-r border-black">In</th>
                    <th className="text-left p-2 border-r border-black">Out</th>
                    <th className="text-right p-2 border-r border-black">Hours</th>
                  </tr>
                </thead>
                <tbody>
                {((attendance as any)?.items || []).map((l: any, i: number) => {
                  const category = (payslip.category || "").toLowerCase();

                  // ✅ Hours vs Days depending on category
                  let hoursOrDays;
                  if (["core", "core-probationary", "owner"].includes(category)) {
                    hoursOrDays = `${l?.daysWorked || 0} day(s)`;
                  } else if (category === "intern") {
                    hoursOrDays = `${Number(l?.hoursWorked || 0).toFixed(2)} hrs / ${l?.daysWorked || 0} day(s)`;
                  } else {
                    hoursOrDays = Number(l?.hoursWorked || 0).toFixed(2);
                  }

                  // ✅ Safe labels for IN/OUT
                  const inLabel = l?.timeIn
                    ? new Date(l.timeIn).toLocaleTimeString()
                    : <span className="text-red-600 font-bold">NO IN</span>;
                  const outLabel = l?.timeOut
                    ? new Date(l.timeOut).toLocaleTimeString()
                    : <span className="text-red-600 font-bold">NO OUT</span>;

                  return (
                    <tr key={i} className="border-b border-black">
                      <td className="p-2 border-r border-black">{l?.date || ""}</td>
                      <td className="p-2 border-r border-black">{inLabel}</td>
                      <td className="p-2 border-r border-black">{outLabel}</td>
                      <td className="p-2 border-r border-black text-right">{hoursOrDays}</td>
                    </tr>
                  );
                })}
              </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body { background: #fff; margin: 0; padding: 0; }
          .bg-black\\/70, .backdrop-blur-sm, .fixed { position: static !important; inset: auto !important; }
          button { display: none !important; }
        }
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
