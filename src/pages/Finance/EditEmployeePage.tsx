// src/pages/Finance/EditEmployeePage.tsx
import { useEffect, useState } from "react";
import { db } from "../../firebase/firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { useNavigate, useParams } from "react-router-dom";

/* ───────── Types ───────── */
type EmpType = "core" | "core_probationary" | "intern" | "freelancer" | "owner";
type EmpStatus = "active" | "inactive";

interface CommissionRule {
  id: string;
  amount: number;
  payrollMonths: string[]; // ["2025-08", "2025-09"]
}

type ObRate = { id: string; category: string; rate: number };

type FreelancerItem = {
  id: string;
  project: string;
  quantity: number;
  rate: number;
};

interface EmployeeDoc {
  employeeId?: string;
  name?: string;
  alias?: string;
  position?: string;
  department?: string;

  // legacy/new category field
  type?: string;
  category?: string;

  monthlySalary?: number;    // core/owner
  perDayRate?: number;       // core_probationary
  allowancePerDay?: number;  // intern
  freelancerItems?: Array<Partial<FreelancerItem>>; // freelancer

  status?: EmpStatus;
  email?: string;
  phoneNumber?: string;
  address?: string;
  hireDate?: any;
  bankName?: string;
  accountNumber?: string;

  benefits?: { sss?: boolean; pagibig?: boolean; philhealth?: boolean };
  sssNumber?: string;
  philhealthNumber?: string;
  pagibigNumber?: string;

  obRates?:
    | Array<{ id?: string; category?: string; rate?: number }>
    | Record<string, number>
    | number[]; // legacy-friendly
  commissionRules?: CommissionRule[];
}

/* ───────── Helpers ───────── */
function inflateObRates(raw: any): ObRate[] {
  if (!raw) return [];
  if (!Array.isArray(raw) && typeof raw === "object") {
    return Object.entries(raw).map(([k, v], i) => ({
      id: `m_${i}_${Date.now()}`,
      category: String(k),
      rate: Number(v ?? 0),
    }));
  }
  if (Array.isArray(raw)) {
    return raw.map((x, i) => ({
      id: (x && (x as any).id) || `a_${i}_${Date.now()}`,
      category:
        (x && ((x as any).category ?? (x as any).role ?? (x as any).title ?? (x as any).name)) || "",
      rate: Number((x && ((x as any).rate ?? (x as any).amount)) ?? x ?? 0),
    }));
  }
  return [];
}
function deflateObRates(list: ObRate[]): Array<{ category: string; rate: number }> {
  return (list || []).map((r) => ({ category: r.category, rate: Number(r.rate || 0) }));
}
function fmtDateMaybe(x: any) {
  try {
    if (!x) return "";
    if (typeof x?.toDate === "function") return x.toDate().toISOString().slice(0, 10);
    if (x instanceof Date) return x.toISOString().slice(0, 10);
    const d = new Date(x);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return "";
  } catch {
    return "";
  }
}
const money = (n: number) =>
  `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

/* ───────── Page ───────── */
export default function EditEmployeePage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [emp, setEmp] = useState<{
    id: string;
    employeeId: string;
    name: string;
    alias: string;
    position: string;
    department: string;
    type: EmpType;
    status: EmpStatus;
    email: string;
    phoneNumber: string;
    address: string;
    hireDate: string; // yyyy-mm-dd

    // pay fields
    monthlySalary: number;     // Core/Owner
    perDayRate: number;        // Core(Probationary)
    allowancePerDay: number;   // Intern
    freelancerItems: FreelancerItem[]; // Freelancer

    bankName: string;
    accountNumber: string;

    benefits: { sss: boolean; pagibig: boolean; philhealth: boolean };
    sssNumber: string;
    philhealthNumber: string;
    pagibigNumber: string;

    obRates: ObRate[];
    commissionRules: CommissionRule[];
  }>({
    id: "",
    employeeId: "",
    name: "",
    alias: "",
    position: "",
    department: "",
    type: "core",
    status: "active",
    email: "",
    phoneNumber: "",
    address: "",
    hireDate: "",

    monthlySalary: 0,
    perDayRate: 0,
    allowancePerDay: 125,
    freelancerItems: [],

    bankName: "",
    accountNumber: "",

    benefits: { sss: false, pagibig: false, philhealth: false },
    sssNumber: "",
    philhealthNumber: "",
    pagibigNumber: "",

    obRates: [],
    commissionRules: [],
  });

  useEffect(() => {
    (async () => {
      if (!id) return;
      setLoading(true);
      try {
        const ref = doc(db, "employees", id);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setError("Employee not found.");
          return;
        }
        const d = (snap.data() || {}) as EmployeeDoc;

        // normalize type/category
        const raw = String(d.type || d.category || "core").toLowerCase();
        const normalized: EmpType =
          raw === "core_probationary" || raw === "core (probationary)"
            ? "core_probationary"
            : raw === "freelancer"
            ? "freelancer"
            : raw === "intern"
            ? "intern"
            : raw === "owner"
            ? "owner"
            : "core";

        const inflatedRates = inflateObRates(d.obRates);

        setEmp({
          id: snap.id,
          employeeId: d.employeeId || "",
          name: d.name || "",
          alias: d.alias || "",
          position: d.position || "",
          department: d.department || "",
          type: normalized,
          status: (d.status as EmpStatus) || "active",
          email: d.email || "",
          phoneNumber: d.phoneNumber || "",
          address: d.address || "",
          hireDate: fmtDateMaybe(d.hireDate),

          monthlySalary: Number(d.monthlySalary ?? (normalized === "owner" ? 60000 : 0)),
          perDayRate: Number(d.perDayRate ?? 0),
          allowancePerDay: Number(d.allowancePerDay ?? 125),
          freelancerItems: Array.isArray(d.freelancerItems)
            ? d.freelancerItems.map((x, i) => ({
                id: x?.id || `fi_${i}_${Date.now()}`,
                project: String(x?.project || ""),
                quantity: Number(x?.quantity || 0),
                rate: Number(x?.rate || 0),
              }))
            : [],

          bankName: d.bankName || "",
          accountNumber: d.accountNumber || "",

          benefits: {
            sss: Boolean(d.benefits?.sss),
            pagibig: Boolean(d.benefits?.pagibig),
            philhealth: Boolean(d.benefits?.philhealth),
          },
          sssNumber: d.sssNumber || "",
          philhealthNumber: d.philhealthNumber || "",
          pagibigNumber: d.pagibigNumber || "",

          obRates: inflatedRates,
          commissionRules: Array.isArray(d.commissionRules)
            ? d.commissionRules.map((c, idx) => ({
                id: c.id || String(idx + 1),
                amount: Number(c.amount || 0),
                payrollMonths: Array.isArray(c.payrollMonths) ? c.payrollMonths : [],
              }))
            : [],
        });
      } catch (e) {
        console.error(e);
        setError("Failed to load employee data.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  /* ───────── UI helpers ───────── */
  const salaryLabel =
    emp.type === "intern"
      ? "Daily Allowance (₱)"
      : emp.type === "core_probationary"
      ? "Per Day Rate (₱)"
      : "Monthly Salary (₱)";

  const salaryDisabled =
    emp.type === "intern" || emp.type === "owner" || emp.type === "freelancer";

  const salaryValue =
    emp.type === "intern"
      ? emp.allowancePerDay
      : emp.type === "core_probationary"
      ? emp.perDayRate
      : emp.monthlySalary;

  const internNote =
    emp.type === "intern" ? "Interns use ₱125/day allowance and ₱500 per OB (fixed)." : "";

  const ownerNote =
    emp.type === "owner" ? "Owner monthly salary is fixed at ₱60,000." : "";

  const freelancerNote =
    emp.type === "freelancer" ? "Use Freelancer Rates section to set Project × Quantity × Rate." : "";

  const onTypeChange: React.ChangeEventHandler<HTMLSelectElement> = (e) => {
    const newType = e.target.value as EmpType;
    setEmp((prev) => {
      const updated = { ...prev, type: newType };
      if (newType === "intern") {
        updated.allowancePerDay = 125;
        updated.monthlySalary = 0;
        updated.perDayRate = 0;
        const exists = (updated.obRates || []).some(
          (r) => r.category?.toLowerCase?.() === "ob (intern fixed)"
        );
        if (!exists) {
          const rand = (crypto as any).randomUUID ? crypto.randomUUID() : String(Date.now());
          updated.obRates = [...(updated.obRates || []), { id: rand, category: "OB (Intern Fixed)", rate: 500 }];
        }
      } else if (newType === "owner") {
        updated.monthlySalary = 60000;
        updated.allowancePerDay = 0;
        updated.perDayRate = 0;
      } else if (newType === "core_probationary") {
        updated.perDayRate = prev.perDayRate || 0;
        updated.allowancePerDay = 0;
      } else if (newType === "freelancer") {
        updated.monthlySalary = 0;
        updated.perDayRate = 0;
        updated.allowancePerDay = 0;
      }
      return updated;
    });
  };

  const handleChange: React.ChangeEventHandler<HTMLInputElement | HTMLSelectElement> = (e) => {
    const { name, value, type } = e.target;
    setEmp((prev) => ({
      ...prev,
      [name]: type === "number" ? Number(value) : value,
    }));
  };

  const handleHireDate: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    setEmp((prev) => ({ ...prev, hireDate: e.target.value }));
  };

  /* ───────── OB RATES ───────── */
  const addObRate = () =>
    setEmp((p) => ({
      ...p,
      obRates: [
        ...(p.obRates || []),
        { id: (crypto as any).randomUUID ? crypto.randomUUID() : String(Date.now()), category: "", rate: 0 },
      ],
    }));
  const updateObRate = (id: string, field: "category" | "rate", value: string) =>
    setEmp((p) => ({
      ...p,
      obRates: (p.obRates || []).map((r) =>
        r.id === id ? { ...r, [field]: field === "rate" ? Number(value) || 0 : value } : r
      ),
    }));
  const removeObRate = (id: string) =>
    setEmp((p) => ({ ...p, obRates: (p.obRates || []).filter((r) => r.id !== id) }));

  /* ───────── Commission rules ───────── */
  const addCommissionRule = () =>
    setEmp((p) => ({
      ...p,
      commissionRules: [
        ...(p.commissionRules || []),
        { id: (crypto as any).randomUUID ? crypto.randomUUID() : String(Date.now()), amount: 0, payrollMonths: [] },
      ],
    }));
  const updateCommissionAmount = (id: string, amountStr: string) =>
    setEmp((p) => ({
      ...p,
      commissionRules: (p.commissionRules || []).map((r) => (r.id === id ? { ...r, amount: Number(amountStr) || 0 } : r)),
    }));
  const updateCommissionMonths = (id: string, monthsStr: string) => {
    const list = monthsStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setEmp((p) => ({
      ...p,
      commissionRules: (p.commissionRules || []).map((r) => (r.id === id ? { ...r, payrollMonths: list } : r)),
    }));
  };
  const removeCommissionRule = (id: string) =>
    setEmp((p) => ({ ...p, commissionRules: (p.commissionRules || []).filter((r) => r.id !== id) }));

  /* ───────── Benefits ───────── */
  const toggleBenefit = (key: "sss" | "pagibig" | "philhealth") =>
    setEmp((p) => ({ ...p, benefits: { ...(p.benefits || {}), [key]: !p.benefits?.[key] } }));

  /* ───────── Freelancer Items ───────── */
  const addFreelancerItem = () =>
    setEmp((p) => ({
      ...p,
      freelancerItems: [
        ...(p.freelancerItems || []),
        {
          id: (crypto as any).randomUUID ? crypto.randomUUID() : String(Date.now()),
          project: "",
          quantity: 0,
          rate: 0,
        },
      ],
    }));
  const updateFreelancerItem = (id: string, field: "project" | "quantity" | "rate", val: string) =>
    setEmp((p) => ({
      ...p,
      freelancerItems: (p.freelancerItems || []).map((it) =>
        it.id === id
          ? {
              ...it,
              [field]: field === "project" ? val : Number(val) || 0,
            }
          : it
      ),
    }));
  const removeFreelancerItem = (id: string) =>
    setEmp((p) => ({ ...p, freelancerItems: (p.freelancerItems || []).filter((it) => it.id !== id) }));

  /* ───────── Save ───────── */
  const onSubmit: React.FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      if (!id) throw new Error("Missing doc id.");

      // normalize pay fields according to type
      let monthlySalary = 0;
      let perDayRate = 0;
      let allowancePerDay = 0;

      if (emp.type === "core") monthlySalary = Number(emp.monthlySalary || 0);
      if (emp.type === "owner") monthlySalary = 60000;
      if (emp.type === "core_probationary") perDayRate = Number(emp.perDayRate || 0);
      if (emp.type === "intern") allowancePerDay = Number(emp.allowancePerDay || 125);

      const payload: EmployeeDoc = {
        employeeId: emp.employeeId,
        name: emp.name,
        alias: emp.alias,
        email: emp.email,
        phoneNumber: emp.phoneNumber,
        address: emp.address,
        department: emp.department,
        position: emp.position,

        // save both for compatibility with add page
        type: emp.type,
        category: emp.type,

        status: emp.status,
        bankName: emp.bankName,
        accountNumber: emp.accountNumber,
        benefits: emp.benefits,
        sssNumber: emp.sssNumber,
        philhealthNumber: emp.philhealthNumber,
        pagibigNumber: emp.pagibigNumber,

        obRates: deflateObRates(emp.obRates),
        commissionRules: emp.commissionRules,

        monthlySalary,
        perDayRate,
        allowancePerDay,
        freelancerItems:
          emp.type === "freelancer"
            ? (emp.freelancerItems || []).map((it) => ({
                id: it.id,
                project: it.project,
                quantity: Number(it.quantity || 0),
                rate: Number(it.rate || 0),
              }))
            : [],

        hireDate: emp.hireDate ? new Date(emp.hireDate) : null,
      };

      const ref = doc(db, "employees", id);
      await updateDoc(ref, payload as any);

      setSuccess("Employee updated successfully!");
      setTimeout(() => navigate("/finance/employees"), 900);
    } catch (e) {
      console.error(e);
      setError("Failed to update employee. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white pt-20 px-4 flex items-center justify-center">
        <div className="h-10 w-10 border-t-2 border-b-2 border-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!emp.id) {
    return (
      <div className="min-h-screen bg-gray-900 text-white pt-20 px-4">
        <div className="max-w-3xl mx-auto">
          <button onClick={() => navigate("/finance/employees")} className="text-blue-400 hover:text-blue-300">
            ← Back to Employees
          </button>
          <div className="text-center mt-10 text-gray-400">{error || "Employee not found."}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 rounded-2xl text-white pt-20 px-4 sm:px-6 lg:px-8 pb-16">
      {/* Top bar */}
      <div className="max-w-5xl mx-auto mb-6">
        <button onClick={() => navigate("/finance/employees")} className="text-blue-400 hover:text-blue-300">
          ← Back to Employees
        </button>
      </div>

      {/* Title */}
      <div className="max-w-5xl mx-auto text-center mb-8">
        <h1 className="text-2xl md:text-3xl font-bold">Edit Employee</h1>
        <p className="text-gray-300 mt-1">Update {emp.name || "employee"}’s information & configuration.</p>
        <div className="inline-flex mt-4 gap-2 bg-white/10 border border-white/20 px-4 py-2 rounded-xl">
          <span className="text-sm text-gray-400">Employee ID:</span>
          <span className="font-mono">{emp.employeeId || "—"}</span>
        </div>
      </div>

      <form onSubmit={onSubmit} className="max-w-5xl mx-auto space-y-8">
        {error && (
          <div className="p-3 text-center rounded-xl border border-rose-400/30 bg-rose-500/10 text-rose-200">
            {error}
          </div>
        )}
        {success && (
          <div className="p-3 text-center rounded-xl border border-emerald-400/30 bg-emerald-500/10 text-emerald-200">
            {success}
          </div>
        )}

        {/* Personal */}
        <section className="rounded-2xl border border-white/10 bg-gray-800/40 p-6 space-y-6">
          <h2 className="text-lg font-semibold border-b border-white/10 pb-3">Personal Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Field label="Full Name">
              <input name="name" value={emp.name} onChange={handleChange} className="inp" required />
            </Field>
            <Field label="Email">
              <input name="email" type="email" value={emp.email} onChange={handleChange} className="inp" required />
            </Field>
            <Field label="Phone">
              <input name="phoneNumber" value={emp.phoneNumber} onChange={handleChange} className="inp" />
            </Field>
            <Field label="Hire Date">
              <input type="date" value={emp.hireDate} onChange={handleHireDate} className="inp" />
            </Field>
            <Field label="Address" className="md:col-span-2">
              <input name="address" value={emp.address} onChange={handleChange} className="inp" />
            </Field>
            <Field label="Alias (Biometric)">
              <input name="alias" value={emp.alias} onChange={handleChange} className="inp" />
            </Field>
          </div>
        </section>

        {/* Job */}
        <section className="rounded-2xl border border-white/10 bg-gray-800/40 p-6 space-y-6">
          <h2 className="text-lg font-semibold border-b border-white/10 pb-3">Job Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Field label="Position">
              <input name="position" value={emp.position} onChange={handleChange} className="inp" required />
            </Field>
            <Field label="Department">
              <input name="department" value={emp.department} onChange={handleChange} className="inp" required />
            </Field>
            <Field label="Employee Type">
              <select name="type" value={emp.type} onChange={onTypeChange} className="inp">
                <option value="core">Core (Regular)</option>
                <option value="core_probationary">Core (Probationary)</option>
                <option value="owner">Owner</option>
                <option value="intern">Intern</option>
                <option value="freelancer">Freelancer</option>
              </select>
            </Field>
            <Field label="Status">
              <select name="status" value={emp.status} onChange={handleChange} className="inp">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </Field>

            {/* Salary slot (adapts by type) */}
            <Field label={salaryLabel} className="md:col-span-2">
              <input
                name={
                  emp.type === "intern"
                    ? "allowancePerDay"
                    : emp.type === "core_probationary"
                    ? "perDayRate"
                    : "monthlySalary"
                }
                type="number"
                min={0}
                step="0.01"
                value={salaryValue}
                onChange={handleChange}
                className="inp"
                placeholder={
                  emp.type === "intern" ? "125" : emp.type === "core_probationary" ? "Per day rate" : "30000"
                }
                disabled={salaryDisabled}
              />
              {internNote && <p className="text-xs text-amber-300 mt-2">{internNote}</p>}
              {ownerNote && <p className="text-xs text-gray-400 mt-2">{ownerNote}</p>}
              {freelancerNote && <p className="text-xs text-gray-400 mt-2">{freelancerNote}</p>}
            </Field>
          </div>
        </section>

        {/* Freelancer Rates */}
        {emp.type === "freelancer" && (
          <section className="rounded-2xl border border-white/10 bg-gray-800/40 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Freelancer Rates</h2>
              <button type="button" onClick={addFreelancerItem} className="btn-link">
                + Add Project Rate
              </button>
            </div>
            <div className="space-y-3">
              {(emp.freelancerItems || []).map((it) => (
                <div key={it.id} className="flex flex-wrap gap-3 items-center">
                  <input
                    placeholder="Project"
                    value={it.project}
                    onChange={(e) => updateFreelancerItem(it.id, "project", e.target.value)}
                    className="inp flex-1 min-w-[200px]"
                  />
                  <input
                    type="number"
                    placeholder="Quantity"
                    value={it.quantity}
                    onChange={(e) => updateFreelancerItem(it.id, "quantity", e.target.value)}
                    className="inp w-32"
                  />
                  <input
                    type="number"
                    placeholder="Rate (₱)"
                    value={it.rate}
                    onChange={(e) => updateFreelancerItem(it.id, "rate", e.target.value)}
                    className="inp w-36"
                  />
                  <span className="text-sm text-green-300 min-w-[120px]">
                    Subtotal: <b>{money(it.quantity * it.rate)}</b>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFreelancerItem(it.id)}
                    className="text-rose-400 hover:text-rose-300"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* OB Rates */}
        <section className="rounded-2xl border border-white/10 bg-gray-800/40 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">OB Rates</h2>
            <button type="button" onClick={addObRate} className="btn-link">
              + Add OB Rate
            </button>
          </div>
          <p className="text-sm text-gray-300">Set per-category rates, e.g., “Videographer = 2500”, “Shoot = 1500”.</p>
          <div className="space-y-3">
            {(emp.obRates || []).map((r) => (
              <div key={r.id} className="flex gap-3 items-center">
                <input
                  placeholder="Category (e.g., Videographer)"
                  value={r.category}
                  onChange={(e) => updateObRate(r.id!, "category", e.target.value)}
                  className="inp flex-1 min-w-[220px]"
                />
                <input
                  type="number"
                  placeholder="Rate"
                  value={r.rate}
                  onChange={(e) => updateObRate(r.id!, "rate", e.target.value)}
                  className="inp w-36"
                />
                <button type="button" onClick={() => removeObRate(r.id!)} className="text-rose-400 hover:text-rose-300">
                  Remove
                </button>
              </div>
            ))}
            {emp.type === "intern" && (
              <div className="text-xs text-amber-300">Interns include a fixed entry “OB (Intern Fixed)” = ₱500.</div>
            )}
          </div>
        </section>

        {/* Commission Rules */}
        <section className="rounded-2xl border border-white/10 bg-gray-800/40 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Commission Rules</h2>
            <button type="button" onClick={addCommissionRule} className="btn-link">
              + Add Commission Rule
            </button>
          </div>
          <p className="text-sm text-gray-300">Example: ₱2,000 per cutoff for 2025-08 to 2025-10.</p>
          <div className="space-y-3">
            {(emp.commissionRules || []).map((c) => (
              <div key={c.id} className="rounded-xl border border-white/10 p-4 bg-black/20">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="lbl">Amount (₱)</label>
                    <input
                      type="number"
                      value={c.amount}
                      onChange={(e) => updateCommissionAmount(c.id, e.target.value)}
                      className="inp"
                    />
                  </div>
                  <div>
                    <label className="lbl">Months (comma-separated YYYY-MM)</label>
                    <input
                      type="text"
                      value={c.payrollMonths.join(", ")}
                      onChange={(e) => updateCommissionMonths(c.id, e.target.value)}
                      className="inp"
                      placeholder="2025-08, 2025-09, 2025-10"
                    />
                  </div>
                </div>
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => removeCommissionRule(c.id)}
                    className="text-rose-400 hover:text-rose-300"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Financial & Benefits */}
        <section className="rounded-2xl border border-white/10 bg-gray-800/40 p-6 space-y-6">
          <h2 className="text-lg font-semibold border-b border-white/10 pb-3">Financial & Benefits</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Field label="Bank Name">
              <input name="bankName" value={emp.bankName} onChange={handleChange} className="inp" />
            </Field>
            <Field label="Account Number">
              <input name="accountNumber" value={emp.accountNumber} onChange={handleChange} className="inp" />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <BenefitCard
              title="SSS"
              enabled={!!emp.benefits.sss}
              onToggle={() => toggleBenefit("sss")}
              idValue={emp.sssNumber}
              onIdChange={(v) => setEmp((p) => ({ ...p, sssNumber: v }))}
            />
            <BenefitCard
              title="PhilHealth"
              enabled={!!emp.benefits.philhealth}
              onToggle={() => toggleBenefit("philhealth")}
              idValue={emp.philhealthNumber}
              onIdChange={(v) => setEmp((p) => ({ ...p, philhealthNumber: v }))}
            />
            <BenefitCard
              title="Pag-IBIG"
              enabled={!!emp.benefits.pagibig}
              onToggle={() => toggleBenefit("pagibig")}
              idValue={emp.pagibigNumber}
              onIdChange={(v) => setEmp((p) => ({ ...p, pagibigNumber: v }))}
            />
          </div>
        </section>

        {/* Actions */}
        <div className="flex flex-wrap gap-3 justify-end">
          <button
            type="button"
            onClick={() => navigate("/finance/employees")}
            disabled={saving}
            className="px-5 py-2 rounded-xl bg-gray-700 hover:bg-gray-600 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 flex items-center gap-2"
          >
            {saving ? (
              <>
                <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" className="opacity-75" />
                </svg>
                Saving…
              </>
            ) : (
              "Save Changes"
            )}
          </button>
        </div>
      </form>

      {/* styles */}
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
        .lbl { display:block; font-size:0.9rem; color:#d1d5db; margin-bottom:0.35rem; }
        .btn-link { color:#93c5fd; }
        .btn-link:hover { color:#bfdbfe; }
      `}</style>
    </div>
  );
}

/* ---------- small UI atoms ---------- */
function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="lbl">{label}</label>
      {children}
    </div>
  );
}

function BenefitCard({
  title,
  enabled,
  onToggle,
  idValue,
  onIdChange,
}: {
  title: "SSS" | "PhilHealth" | "Pag-IBIG";
  enabled: boolean;
  onToggle: () => void;
  idValue?: string;
  onIdChange: (v: string) => void;
}) {
  return (
    <div
      className={`rounded-xl p-4 border space-y-2 ${
        enabled ? "bg-emerald-500/10 border-emerald-400/30" : "bg-gray-800/60 border-white/10"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{title}</div>
        <button
          type="button"
          onClick={onToggle}
          className={`text-xs px-2 py-0.5 rounded-full border ${
            enabled
              ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/30"
              : "bg-gray-700/70 text-gray-300 border-white/10"
          }`}
        >
          {enabled ? "Enabled" : "Disabled"}
        </button>
      </div>
      <div>
        <label className="lbl">ID Number</label>
        <input value={idValue || ""} onChange={(e) => onIdChange(e.target.value)} className="inp" />
      </div>
    </div>
  );
}
