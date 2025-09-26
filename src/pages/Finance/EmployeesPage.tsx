// src/pages/EmployeesPage.tsx
import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebase/firebase";
import { collection, getDocs, updateDoc, doc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

/* ───────────────── Types ───────────────── */
type EmpStatus = "active" | "inactive";
type EmpCategory = "core" | "core_probationary" | "owner" | "intern" | "freelancer";

type FreelancerItem = {
  project: string;
  quantity: number;
  rate: number;
};

interface Employee {
  id: string; // Firestore doc id (EMP###)
  employeeId: string;
  name: string;
  position?: string;
  department?: string;
  email?: string;
  status: EmpStatus;

  category: EmpCategory;
  monthlySalary?: number;
  allowancePerDay?: number;
  perDayRate?: number;
  freelancerItems?: FreelancerItem[];
}

/* ───────────────── Helpers ───────────────── */
const peso = (n?: number) =>
  `₱${Number(n ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const categoryLabel = (c: EmpCategory): string => {
  switch (c) {
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
      return c;
  }
};

function makePaySummary(emp: Employee): { main: string; sub?: string } {
  const cat = emp.category;
  if (cat === "core" || cat === "owner") {
    return { main: `Monthly ${peso(emp.monthlySalary)}` };
  }
  if (cat === "core_probationary") {
    return { main: `Per day ${peso(emp.perDayRate)}` };
  }
  if (cat === "intern") {
    return { main: `Allowance/day ${peso(emp.allowancePerDay ?? 125)}` };
  }
  // freelancer: show the per-project rate(s)
  const rates = Array.isArray(emp.freelancerItems)
    ? emp.freelancerItems
        .map((i) => Number(i?.rate || 0))
        .filter((n) => !Number.isNaN(n) && n > 0)
    : [];
  if (rates.length === 0) return { main: "Rate —" };
  // Show first few rates; finance will compute quantity * rate elsewhere
  const first = rates.slice(0, 3).map((r) => peso(r)).join(", ");
  const more = rates.length > 3 ? `  +${rates.length - 3} more` : "";
  return { main: `Rate ${first}${more}` };
}

/* ───────────────── Component ───────────────── */
export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "employees"));
        const list: Employee[] = [];
        snap.forEach((d) => {
          const x = d.data() as any;
          const item: Employee = {
            id: d.id,
            employeeId: String(x.employeeId || d.id),
            name: String(x.name || "—"),
            position: x.position || "",
            department: x.department || "",
            email: x.email || "",
            status: (x.status as EmpStatus) || "active",
            category: (x.category as EmpCategory) || "core",
            monthlySalary: Number(x.monthlySalary ?? 0),
            allowancePerDay: Number(x.allowancePerDay ?? 0),
            perDayRate: Number(x.perDayRate ?? 0),
            freelancerItems: Array.isArray(x.freelancerItems) ? (x.freelancerItems as FreelancerItem[]) : [],
          };
          list.push(item);
        });
        setEmployees(list);
      } catch (err) {
        console.error("Error fetching employees:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleStatusToggle = async (emp: Employee) => {
    const newStatus: EmpStatus = emp.status === "active" ? "inactive" : "active";
    try {
      await updateDoc(doc(db, "employees", emp.id), { status: newStatus });
      setEmployees((prev) => prev.map((e) => (e.id === emp.id ? { ...e, status: newStatus } : e)));
    } catch (err) {
      console.error("Error updating status:", err);
    }
  };

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => {
      const hay =
        `${e.name}|${e.employeeId}|${e.position}|${e.department}|${e.email}|${categoryLabel(e.category)}`
          .toLowerCase();
      return hay.includes(q);
    });
  }, [employees, searchTerm]);

  return (
    <div className="min-h-screen bg-gray-900 rounded-2xl text-white pt-20 px-4 sm:px-6 lg:px-8 pb-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Employee Management
            </h1>
            <p className="text-gray-300 mt-1">View and manage all employee records with ease.</p>
          </div>
          <button
            onClick={() => navigate("/finance/employees/add")}
            className="px-5 py-2.5 rounded-xl text-sm font-medium bg-blue-600 hover:bg-blue-500 transition"
          >
            + Add Employee
          </button>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-lg">
            <input
              type="text"
              placeholder="Search by name, ID, position, department, or category…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3.5 bg-white/10 border border-white/20 rounded-2xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all duration-200 backdrop-blur-sm"
            />
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">No employees found.</div>
        ) : (
          <div className="bg-gray-800/40 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700/60 bg-gray-800/60 text-gray-300 text-xs uppercase tracking-wider">
                    <th className="py-3.5 px-6 text-left">ID</th>
                    <th className="py-3.5 px-6 text-left">Name</th>
                    <th className="py-3.5 px-6 text-left">Position</th>
                    <th className="py-3.5 px-6 text-left">Department</th>
                    <th className="py-3.5 px-6 text-left">Category</th>
                    <th className="py-3.5 px-6 text-left">Salary / Rate</th>
                    <th className="py-3.5 px-6 text-left">Status</th>
                    <th className="py-3.5 px-6 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((emp) => {
                    const pay = makePaySummary(emp);
                    return (
                      <tr key={emp.id} className="border-b border-gray-700/40 hover:bg-white/5 transition-all duration-200">
                        <td className="py-3 px-6 text-gray-200 font-mono text-sm">{emp.employeeId}</td>
                        <td className="py-3 px-6 font-medium text-white">{emp.name}</td>
                        <td className="py-3 px-6 text-gray-300 text-sm">{emp.position || "—"}</td>
                        <td className="py-3 px-6 text-gray-300 text-sm">{emp.department || "—"}</td>
                        <td className="py-3 px-6">
                          <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-white/10 border border-white/15">
                            {categoryLabel(emp.category)}
                          </span>
                        </td>
                        <td className="py-3 px-6">
                          <div className="text-green-300 font-mono text-sm">{pay.main}</div>
                          {pay.sub && <div className="text-xs text-gray-400">{pay.sub}</div>}
                        </td>
                        <td className="py-3 px-6">
                          <button
                            onClick={() => handleStatusToggle(emp)}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                              emp.status === "active"
                                ? "bg-green-500/20 text-green-300 border border-green-500/30 hover:bg-green-500/30"
                                : "bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30"
                            }`}
                          >
                            {emp.status}
                          </button>
                        </td>
                        <td className="py-3 px-6 text-center space-x-3">
                          <button
                            onClick={() => navigate(`/finance/employees/${emp.id}`)}
                            className="text-blue-400 hover:text-blue-300 text-sm"
                          >
                            Edit
                          </button>
                          {/* Hook up delete later if needed */}
                        </td>
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
  );
}
