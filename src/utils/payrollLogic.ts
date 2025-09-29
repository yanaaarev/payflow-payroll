// src/utils/payrollLogic.ts

export interface PayrollInput {
  monthlySalary: number;
  perDayRate?: number;
  allowancePerDay?: number;
  workedDays: number;
  obQuantity?: number;
  obRate?: number; // 👈 keep but not used directly
  otHours: number;
  ndHours: number;
  rdotHours: number;
  holiday30Hours: number;
  holidayDoubleHours: number;
  holidayOtDoubleHours: number;
  tardinessMinutes: number;
  cutoffWorkingDays?: number;
  fixedWorkedDays?: number; // 👈 NEW — support fixed divisor
  category: "core" | "core_probationary" | "intern" | "freelancer" | "owner";
  obCategory?: "videographer" | "assisted" | "talent";
  benefits?: { sss: boolean; pagibig: boolean; philhealth: boolean };
  cashAdvance: {
    totalAmount: number;
    perCutOff: number;
    currentCutOff: "first" | "second";
    startDateCutOff: "first" | "second";
    approved: boolean;
    override?: number; // 👈 for manual override
  };
  manualNetPay?: number; // for manual override
  obPayFromReqs?: number; // 👈 injected from filed requests
}

export interface PayrollOutput {
  dailyRate: number;
  cutoffPay: number;
  obPay: number;
  otRate: number;
  otPay: number;
  nightDiffPay: number;
  rdotPay: number;
  holiday30Pay: number;
  holidayDoublePay: number;
  holidayOtDoublePay: number;
  grossEarnings: number;
  sss: number;
  pagibig: number;
  philhealth: number;
  cashAdvanceDeduction: number;
  tardinessDeduction: number;
  totalDeductions: number;
  netPay: number;
}

const DEFAULT_INTERN_DAILY = 125;
const OWNER_CUTOFF_PAY = 60000;

export const calculatePayroll = (data: PayrollInput): PayrollOutput => {
  // ✅ Freelancers: just return their stored grand total as net pay
  if (data.category === "freelancer") {
    const net = Number(data.manualNetPay || 0);
    return {
      dailyRate: 0,
      cutoffPay: 0,
      obPay: 0,
      otRate: 0,
      otPay: 0,
      nightDiffPay: 0,
      rdotPay: 0,
      holiday30Pay: 0,
      holidayDoublePay: 0,
      holidayOtDoublePay: 0,
      grossEarnings: net,
      sss: 0,
      pagibig: 0,
      philhealth: 0,
      cashAdvanceDeduction: 0,
      tardinessDeduction: 0,
      totalDeductions: 0,
      netPay: net,
    };
  }

  // Safe defaults
  const safeMonthly = Number(data.monthlySalary) || 0;
  const workedDays = Math.max(0, Number(data.workedDays) || 0);
  const otHours = Number(data.otHours) || 0;
  const ndHours = Number(data.ndHours) || 0;
  const rdotHours = Number(data.rdotHours) || 0;
  const h30 = Number(data.holiday30Hours) || 0;
  const h2x = Number(data.holidayDoubleHours) || 0;
  const h2xOt = Number(data.holidayOtDoubleHours) || 0;
  const tardyMins = Math.max(0, Number(data.tardinessMinutes) || 0);

  let dailyRate = 0;
  let cutoffPay = 0;

  // 1. Base pay per category
  switch (data.category) {
    case "core": {
      const cutoffBase = safeMonthly / 2;
      const divisor =
        (data.fixedWorkedDays && data.fixedWorkedDays > 0
          ? data.fixedWorkedDays
          : data.cutoffWorkingDays) || workedDays || 1;

      dailyRate = cutoffBase / divisor;
      cutoffPay = dailyRate * workedDays;
      break;
    }
    case "core_probationary": {
      dailyRate = Number(data.perDayRate) || 0;
      cutoffPay = dailyRate * workedDays;
      break;
    }
    case "intern": {
      dailyRate = Number(data.allowancePerDay) || DEFAULT_INTERN_DAILY;
      cutoffPay = dailyRate * workedDays;
      break;
    }
    case "owner": {
      dailyRate = 0;
      cutoffPay = OWNER_CUTOFF_PAY;
      break;
    }
  }

  // 2. OB Pay
  const obQuantity = Number(data.obQuantity) || 0;
  let obPay = 0;
  if (typeof data.obPayFromReqs === "number" && data.obPayFromReqs > 0) {
    obPay = data.obPayFromReqs;
  } else {
    if (data.category === "intern") {
      obPay = obQuantity * 500;
    } else {
      if (data.obCategory === "videographer") {
        obPay = obQuantity * 2500;
      } else if (data.obCategory === "talent") {
        obPay = obQuantity * 2000;
      } else {
        obPay = obQuantity * 1500; // default assisted
      }
    }
  }

  // 3. OT & premiums
  const otRate = dailyRate / 8;
  const otPay = otRate * otHours;
  const nightDiffPay = otRate * 1.1 * ndHours;
  const rdotPay = otRate * 1.3 * rdotHours;
  const holiday30Pay = otRate * 0.3 * h30;
  const holidayDoublePay = otRate * 2 * h2x;
  const holidayOtDoublePay = otRate * 2 * 1.3 * h2xOt;

  // 4. Gross Earnings
  const grossEarnings =
    cutoffPay +
    obPay +
    otPay +
    nightDiffPay +
    rdotPay +
    holiday30Pay +
    holidayDoublePay +
    holidayOtDoublePay;

  // 5. Gov’t deductions
  const sss = data.benefits?.sss ? 425 : 0;
  const pagibig = data.benefits?.pagibig ? 100 : 0;
  const philhealth = data.benefits?.philhealth ? 212.5 : 0;

  // 6. Tardiness
  const tardinessDeduction =
    tardyMins > 0 ? Number(((dailyRate / 480) * tardyMins).toFixed(2)) : 0;

  // 7. Cash Advance
  let cashAdvanceDeduction = 0;
  if (typeof data.cashAdvance.override === "number") {
    cashAdvanceDeduction = data.cashAdvance.override;
  } else if (data.cashAdvance.approved && data.cashAdvance.perCutOff > 0) {
    const sameHalf =
      data.cashAdvance.currentCutOff === data.cashAdvance.startDateCutOff;
    const secondHalfAfterFirstStart =
      data.cashAdvance.startDateCutOff === "first" &&
      data.cashAdvance.currentCutOff === "second";

    if (sameHalf || secondHalfAfterFirstStart) {
      cashAdvanceDeduction = Math.min(
        data.cashAdvance.perCutOff,
        data.cashAdvance.totalAmount
      );
    }
  }

  // 8. Totals
  const totalDeductions =
    sss + pagibig + philhealth + cashAdvanceDeduction + tardinessDeduction;
  const netPay = Math.max(0, grossEarnings - totalDeductions);

  return {
    dailyRate,
    cutoffPay,
    obPay,
    otRate,
    otPay,
    nightDiffPay,
    rdotPay,
    holiday30Pay,
    holidayDoublePay,
    holidayOtDoublePay,
    grossEarnings,
    sss,
    pagibig,
    philhealth,
    cashAdvanceDeduction,
    tardinessDeduction,
    totalDeductions,
    netPay,
  };
};
