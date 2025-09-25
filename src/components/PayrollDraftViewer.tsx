// src/components/PayrollDraftViewer.tsx
import { calculatePayroll } from "../utils/payrollLogic";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { useState } from "react";

type DraftHead = {
  status: string;
  periodKey: string;
  cutoffLabel?: string | null;
  cutoffStart?: string | null;
  cutoffEnd?: string | null;
  workedDays?: number;
};

type Line = {
  id: string;
  employeeId: string;
  name: string;
  daysWorked: number;
  hoursWorked: number;
  category?: string;
  monthlySalary?: number;
  perDayRate?: number;
  adjustments?: any;
  timeInOut?: any[];
};

type PayrollDraftViewerProps = {
  head: DraftHead;
  lines: Line[];
  empMeta: Record<string, any>;
  commTotals: Record<string, number>;
  cashAdvances: Record<string, any[]>;
  filedRequests: Record<string, any[]>;
  editable: boolean;
  db: any;
  draftId: string;
};

function peso(n?: number) {
  return `₱${Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function PayrollDraftViewer({
  head,
  lines,
  empMeta,
  commTotals,
  cashAdvances,
  filedRequests,
  editable,
  db,
  draftId,
}: PayrollDraftViewerProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {lines.map((ln) => {
        const empId = String(ln.employeeId || ln.id).trim();
        const meta = empMeta[empId];
        const canonicalName = meta?.name || ln.name || empId;

        // compute payroll using logic.ts
        const p = calculatePayroll({
          monthlySalary: ln.monthlySalary || meta?.monthlySalary || 0,
          perDayRate: ln.perDayRate || meta?.perDayRate || 0,
          cutoffWorkingDays: head?.workedDays || 0,
          workedDays: ln.daysWorked,
          obQuantity: ln.adjustments?.OB?.length || 0,
          otHours:
            (ln.adjustments?.OT || []).reduce(
              (s: number, a: any) => s + Number(a.hours || 0),
              0
            ) || 0,
          ndHours: 0,
          rdotHours: 0,
          holiday30Hours: 0,
          holidayDoubleHours: 0,
          holidayOtDoubleHours: 0,
          tardinessMinutes: 0,
          category: (ln.category as any) || "core",
          benefits: {
            sss: meta?.sss || false,
            philhealth: meta?.philhealth || false,
            pagibig: meta?.pagibig || false,
          },
          cashAdvance: {
            totalAmount: 0,
            perCutOff: 0,
            currentCutOff: "first",
            startDateCutOff: "first",
            approved: false,
          },
        });

        const comm = commTotals[ln.id] || 0;
        const open = openId === ln.id;

        return (
          <div
            key={ln.id}
            className="rounded-xl border border-white/10 bg-gray-800/40 overflow-hidden"
          >
            {/* Header row */}
            <div
              className="flex items-center justify-between px-4 sm:px-6 py-3 bg-gray-800/60 border-b border-gray-700/60 cursor-pointer"
              onClick={() => setOpenId(open ? null : ln.id)}
            >
              <div>
                <p className="font-semibold">{canonicalName}</p>
                <p className="text-xs text-gray-400">{empId}</p>
              </div>
              <div className="text-right">
                <p className="text-sm">Gross: {peso(p.grossEarnings)}</p>
                <p className="text-sm font-bold text-green-400">
                  Net: {peso(p.netPay + comm)}
                </p>
              </div>
            </div>

            {/* Expanded section */}
            {open && (
              <div className="p-4 sm:p-6 text-sm text-gray-300 space-y-2">
                <p>Days Worked: {ln.daysWorked}</p>
                <p>Hours Worked: {ln.hoursWorked}</p>
                <p>OB Count: {ln.adjustments?.OB?.length || 0}</p>
                <p>OT Hours: {(ln.adjustments?.OT || []).length}</p>
                <p>
                  Commissions:{" "}
                  <span className="font-mono">{peso(comm || 0)}</span>
                </p>
                <p>
                  Cash Advances:{" "}
                  {peso(
                    (cashAdvances[canonicalName] || []).reduce(
                      (s, c) => s + Number(c.perCutOff || 0),
                      0
                    )
                  )}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
