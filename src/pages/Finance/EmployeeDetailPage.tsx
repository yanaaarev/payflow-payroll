// src/pages/Finance/EmployeeDetailPage.tsx
import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebase/firebase";
import { doc, getDoc } from "firebase/firestore";
import { useNavigate, useParams } from "react-router-dom";

/* ───────────────── Types ───────────────── */
type EmployeeType =
  | "core"
  | "core_probationary"
  | "intern"
  | "freelancer"
  | "owner";

type EmpStatus = "active" | "inactive";

type FreelancerItem = {
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
  monthlySalary?: number;

  // new/legacy category fields
  type?: string;
  category?: string;

  // new fields
  perDayRate?: number; // Core(Probationary)
  allowancePerDay?: number; // Interns
  freelancerItems?: FreelancerItem[]; // Freelancers

  bankName?: string;
  accountNumber?: string;
  hireDate?: any;
  status?: EmpStatus;
  email?: string;
  phoneNumber?: string;
  address?: string;
  sssNumber?: string;
  philhealthNumber?: string;
  pagibigNumber?: string;
  profileImageUrl?: string;
  benefits?: { sss?: boolean; pagibig?: boolean; philhealth?: boolean };
  obRates?: Array<{ category: string; rate: number }>;
}

interface Employee
  extends Required<
    Pick<
      EmployeeDoc,
      "employeeId" | "name" | "position" | "department" | "email" | "status"
    >
  > {
  id: string;
  alias: string;
  type: EmployeeType;
  monthlySalary: number;
  perDayRate: number;
  allowancePerDay: number;
  freelancerItems: FreelancerItem[];

  bankName: string;
  accountNumber: string;
  hireDate: string;
  phoneNumber: string;
  address: string;
  sssNumber: string;
  philhealthNumber: string;
  pagibigNumber: string;
  profileImageUrl?: string;
  benefits: { sss: boolean; pagibig: boolean; philhealth: boolean };
  obRates: Array<{ category: string; rate: number }>;
}

/* ───────────────── Utils ───────────────── */
function formatMaybeTimestamp(x: any): string {
  if (!x) return "—";
  try {
    if (typeof x?.toDate === "function") return x.toDate().toLocaleDateString();
    if (typeof x === "string") {
      const d = new Date(x);
      if (!Number.isNaN(d.getTime())) return d.toLocaleDateString();
    }
  } catch {
    /* ignore */
  }
  return String(x);
}

const peso = (n?: number) =>
  `₱${Number(n ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const Badge = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${className}`}>
    {children}
  </span>
);

const Row = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string | number;
  mono?: boolean;
}) => {
  const v = value ?? "—";
  return (
    <div className="space-y-0.5">
      <p className="text-xs tracking-wide text-gray-400">{label}</p>
      <p className={`${mono ? "font-mono text-sm" : "text-base"} text-white`}>{v || "—"}</p>
    </div>
  );
};

const Pill = ({
  title,
  enabled,
  idValue,
}: {
  title: "SSS" | "PhilHealth" | "Pag-IBIG";
  enabled: boolean;
  idValue?: string;
}) => (
  <div
    className={`rounded-xl p-4 border transition ${
      enabled ? "bg-emerald-500/10 border-emerald-400/30" : "bg-gray-800/60 border-white/10"
    }`}
  >
    <div className="flex items-center justify-between">
      <div className="text-sm font-medium">{title}</div>
      <div
        className={`text-xs px-2 py-0.5 rounded-full border ${
          enabled
            ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/30"
            : "bg-gray-700/70 text-gray-300 border-white/10"
        }`}
      >
        {enabled ? "Enabled" : "Disabled"}
      </div>
    </div>
    <div className="mt-2 text-xs text-gray-300">
      ID: <span className="font-mono">{idValue || "—"}</span>
    </div>
  </div>
);

/* ───────────────── Page ───────────────── */
export default function EmployeeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!id) return;
      setLoading(true);
      try {
        const ref = doc(db, "employees", id);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setEmployee(null);
          return;
        }
        const d = (snap.data() || {}) as EmployeeDoc;

        // normalize category/type safely (support legacy fields/values)
        const raw = String(d.type || d.category || "core").toLowerCase();
        const normalized: EmployeeType =
          raw === "core_probationary" || raw === "core (probationary)"
            ? "core_probationary"
            : raw === "freelancer"
            ? "freelancer"
            : raw === "intern"
            ? "intern"
            : raw === "owner"
            ? "owner"
            : "core";

        const benefits = {
          sss: Boolean(d.benefits?.sss),
          pagibig: Boolean(d.benefits?.pagibig),
          philhealth: Boolean(d.benefits?.philhealth),
        };

        setEmployee({
          id: snap.id,
          employeeId: d.employeeId || "—",
          name: d.name || "—",
          alias: d.alias || "",
          position: d.position || "—",
          department: d.department || "—",
          monthlySalary: Number(d.monthlySalary ?? 0),
          perDayRate: Number(d.perDayRate ?? 0),
          allowancePerDay: Number(d.allowancePerDay ?? 125),
          freelancerItems: Array.isArray(d.freelancerItems) ? d.freelancerItems : [],
          type: normalized,
          bankName: d.bankName || "—",
          accountNumber: d.accountNumber || "—",
          hireDate: formatMaybeTimestamp(d.hireDate),
          status: (d.status as EmpStatus) || "active",
          email: d.email || "—",
          phoneNumber: d.phoneNumber || "—",
          address: d.address || "—",
          sssNumber: d.sssNumber || "—",
          philhealthNumber: d.philhealthNumber || "—",
          pagibigNumber: d.pagibigNumber || "—",
          profileImageUrl: d.profileImageUrl,
          benefits,
          obRates: Array.isArray(d.obRates) ? d.obRates : [],
        });
      } catch (e) {
        console.error("Employee load error:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const categoryChip = useMemo(() => {
    if (!employee) return "";
    switch (employee.type) {
      case "core":
        return "Core (Regular)";
      case "core_probationary":
        return "Core (Probationary)";
      case "owner":
        return "Owner";
      case "intern":
        return "Intern";
      case "freelancer":
        return "Freelancer";
      default:
        return employee.type;
    }
  }, [employee]);

  const salaryLabel = useMemo(() => {
    if (!employee) return "";
    if (employee.type === "intern") return "Daily Allowance";
    if (employee.type === "core_probationary") return "Per Day Rate";
    if (employee.type === "freelancer") return "Rates";
    return "Monthly Salary";
  }, [employee]);

  const salaryValue = useMemo(() => {
    if (!employee) return "—";
    if (employee.type === "intern") return peso(employee.allowancePerDay || 125);
    if (employee.type === "core_probationary") return peso(employee.perDayRate);
    if (employee.type === "freelancer") {
      const rates = employee.freelancerItems.map((i) => Number(i.rate || 0)).filter((n) => n > 0);
      if (rates.length === 0) return "—";
      const out = rates.slice(0, 3).map(peso).join(", ");
      return `${out}${rates.length > 3 ? `  +${rates.length - 3} more` : ""}`;
    }
    return peso(employee.monthlySalary);
  }, [employee]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white pt-20 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="min-h-screen bg-gray-900 rounded-2xl text-white pt-20 px-4">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => navigate("/finance/employees")}
            className="mb-6 flex items-center text-blue-400 hover:text-blue-300 transition"
          >
            ← Back to Employees
          </button>
          <div className="text-center py-10">
            <p className="text-gray-400">Employee not found.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 rounded-2xl text-white pt-20 px-4 sm:px-6 lg:px-8 pb-16">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Back */}
        <div>
          <button
            onClick={() => navigate("/finance/employees")}
            className="flex items-center text-blue-400 hover:text-blue-300 transition"
          >
            ← Back to Employees
          </button>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/10 bg-gray-800/40 backdrop-blur-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="p-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6 bg-gradient-to-br from-gray-800/70 to-gray-900/20">
            <div className="flex items-center gap-6">
              <div className="relative">
                <img
                  src={
                    employee.profileImageUrl ||
                    `https://ui-avatars.com/api/?name=${encodeURIComponent(employee.name)}&background=3B82F6&color=fff&size=128`
                  }
                  alt={employee.name}
                  className="h-20 w-20 md:h-24 md:w-24 rounded-full object-cover border-4 border-white/10 shadow-lg"
                />
                <span
                  className={`absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-2 border-white ${
                    employee.status === "active" ? "bg-emerald-500" : "bg-rose-500"
                  }`}
                />
              </div>
              <div className="space-y-1">
                <h1 className="text-2xl text-left md:text-3xl font-bold">{employee.name}</h1>
                <p className="text-gray-300 text-left">{employee.position}</p>
                <p className="text-gray-400 text-sm text-left">{employee.department}</p>
                <p className="text-gray-400 text-sm text-left">{employee.email}</p>
              </div>
            </div>

            {/* Pay */}
            <div className="text-center md:text-right space-y-1">
              <p className="text-sm text-gray-300">{salaryLabel}</p>
              <p className="text-3xl font-extrabold text-green-400">{salaryValue}</p>
              {employee.type === "intern" && (
                <p className="text-xs text-amber-300 italic">OB fixed rate: ₱500 per filed OB</p>
              )}
              {employee.type === "owner" && (
                <p className="text-xs text-gray-400">Owner salary is fixed by policy.</p>
              )}
            </div>
          </div>

          {/* Badges */}
          <div className="px-8 py-4 bg-black/20 border-y border-white/10 flex flex-wrap gap-3">
            <Badge
              className={
                employee.type === "core"
                  ? "bg-blue-500/15 text-blue-300 border-blue-400/30"
                  : employee.type === "core_probationary"
                  ? "bg-cyan-500/15 text-cyan-300 border-cyan-400/30"
                  : employee.type === "intern"
                  ? "bg-amber-500/15 text-amber-300 border-amber-400/30"
                  : employee.type === "owner"
                  ? "bg-pink-500/15 text-pink-300 border-pink-400/30"
                  : "bg-purple-500/15 text-purple-300 border-purple-400/30"
              }
            >
              {categoryChip}
            </Badge>

            <Badge
              className={
                employee.status === "active"
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/30"
                  : "bg-rose-500/15 text-rose-300 border-rose-400/30"
              }
            >
              {employee.status === "active" ? "Active" : "Inactive"}
            </Badge>

            <Badge className="bg-white/10 border-white/20 text-gray-300">
              ID: <span className="font-mono ml-1">{employee.employeeId}</span>
            </Badge>
          </div>

          {/* Sections */}
          <div className="p-8 space-y-10">
            <section className="space-y-4">
              <h2 className="text-lg font-semibold">Personal Information</h2>
              <div className="grid md:grid-cols-2 gap-6">
                <Row label="Email" value={employee.email} />
                <Row label="Phone" value={employee.phoneNumber} />
                <Row label="Address" value={employee.address} />
                <Row label="Hire Date" value={employee.hireDate} />
              </div>
            </section>

            <section className="space-y-4">
              <h2 className="text-lg font-semibold">Financial & Benefits</h2>
              <div className="grid md:grid-cols-2 gap-6">
                <Row label="Bank" value={employee.bankName} />
                <Row label="Account Number" value={employee.accountNumber} mono />
              </div>
              {employee.type !== "freelancer" ? (
                <div className="grid md:grid-cols-3 gap-4">
                  <Pill title="SSS" enabled={employee.benefits.sss} idValue={employee.sssNumber} />
                  <Pill
                    title="PhilHealth"
                    enabled={employee.benefits.philhealth}
                    idValue={employee.philhealthNumber}
                  />
                  <Pill title="Pag-IBIG" enabled={employee.benefits.pagibig} idValue={employee.pagibigNumber} />
                </div>
              ) : (
                <div className="text-sm text-amber-300 bg-amber-500/10 border border-amber-400/20 rounded-xl p-4">
                  Freelancers typically aren’t enrolled in SSS, PhilHealth, or Pag-IBIG.
                </div>
              )}
            </section>

            {/* Category-specific extra: Freelancer items table */}
            {employee.type === "freelancer" && (
              <section className="space-y-4">
                <h2 className="text-lg font-semibold">Freelance Items</h2>
                {employee.freelancerItems.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border border-white/10">
                    <table className="w-full">
                      <thead className="bg-gray-800/60 border-b border-white/10">
                        <tr>
                          <th className="text-left text-sm text-gray-300 py-2 px-3">Project</th>
                          <th className="text-left text-sm text-gray-300 py-2 px-3">Quantity</th>
                          <th className="text-left text-sm text-gray-300 py-2 px-3">Rate</th>
                          <th className="text-left text-sm text-gray-300 py-2 px-3">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {employee.freelancerItems.map((it, idx) => {
                          const subtotal = Number(it.quantity || 0) * Number(it.rate || 0);
                          return (
                            <tr key={`${it.project}-${idx}`} className="border-b border-white/5">
                              <td className="py-2 px-3">{it.project || "—"}</td>
                              <td className="py-2 px-3">{Number(it.quantity ?? 0)}</td>
                              <td className="py-2 px-3 font-mono">{peso(it.rate)}</td>
                              <td className="py-2 px-3 font-mono text-green-300">{peso(subtotal)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-sm text-gray-400 bg-white/5 border border-white/10 rounded-xl p-4">
                    No freelance line items recorded yet. Finance will add quantity × rate per project.
                  </div>
                )}
              </section>
            )}

            {/* OB Rates */}
            <section className="space-y-4">
              <h2 className="text-lg font-semibold">OB Rates</h2>
              {employee.type === "freelancer" ? (
                <div className="text-sm text-gray-400 bg-white/5 border border-white/10 rounded-xl p-4">
                  Not applicable for freelancers.
                </div>
              ) : employee.obRates.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full">
                    <thead className="bg-gray-800/60 border-b border-white/10">
                      <tr>
                        <th className="text-left text-sm text-gray-300 py-2 px-3">Category</th>
                        <th className="text-left text-sm text-gray-300 py-2 px-3">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employee.obRates.map((r, i) => (
                        <tr key={i} className="border-b border-white/5">
                          <td className="py-2 px-3">{r.category || "—"}</td>
                          <td className="py-2 px-3 font-mono">
                            {peso(r.rate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-gray-400 bg-white/5 border border-white/10 rounded-xl p-4">
                  No OB rate entries.
                  {employee.type === "intern" && (
                    <> Interns use default OB rate: <b>₱500</b>.</>
                  )}
                </div>
              )}
            </section>

            <div className="flex justify-center">
              <button
                onClick={() => navigate(`/finance/employees/${employee.id}/edit`)}
                className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-xl transition"
              >
                Edit Employee
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
