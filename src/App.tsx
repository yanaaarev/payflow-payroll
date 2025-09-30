// src/App.tsx
import "./App.css";
import { Routes, Route, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { db } from "./firebase/firebase";
import { doc, getDoc } from "firebase/firestore";


import Login from "./pages/Login";
import EmployeeDashboard from "./pages/Employee/EmployeeDashboard";
import AdminDashboard from "./pages/Admin/AdminDashboard";
import FinanceDashboard from "./pages/Finance/FinanceDashboard";
import EmployeesPage from "./pages/Finance/EmployeesPage";
import AddEmployeePage from "./pages/Finance/AddEmployee";
import EmployeeDetailPage from "./pages/Finance/EmployeeDetailPage";
import EditEmployeePage from "./pages/Finance/EditEmployeePage";
import PayrollPage from "./pages/Finance/PayrollPage";
import CashAdvancePage from "./pages/Finance/CashAdvance";
import PayrollDraftPage from "./pages/Finance/PayrollDraftPage";
import AttendancePage from "./pages/Finance/AttendancePage";
import RequestsPage from "./pages/Finance/RequestsPage";
import BudgetsPage from "./pages/Finance/BudgetsPage";
import ReportsPage from "./pages/Finance/ReportsPage";
import MyPayslipPage from "./pages/Finance/MyPayslipPage";
import AuditLogsPage from "./pages/Finance/AuditLogsPage";
import ApprovalsPage from "./pages/Admin/ApprovalsPage";
import FinanceSettingsPage from "./pages/Finance/FinanceSettingsPage";
import ProfilePage from "./pages/Employee/ProfilePage";
import ViewingBudget from "./pages/Viewing/ViewingBudget";
import ViewingRequest from "./pages/Viewing/ViewingRequest";
import AllPayslipsPage from "./pages/Admin/AllPayslipsPage";
import ExecutiveDashboard from "./pages/Executive/ExecutiveDashboard";
import ProtectedRoute from "./components/ProtectedRoute";
import Sidebar from "./components/Sidebar";

/* ───────────────────────── Role plumbing ───────────────────────── */
type PageRole = "admin_final" | "admin_overseer" | "exec" | "finance" | "employee";

const OWNER_ADMIN_FINAL = {
  email: "jelynsonbattung@gmail.com",
  uid: "XddCcBNNErU0uTwcY3wb9whOoM83",
};
const OWNER_ADMIN_OVERSEER = {
  email: "jropatpat@gmail.com",
  uid: "azDiemn8ArZTLbpMLy7yyxijW2Z2",
};

function normalizeRoles(roles: unknown, legacyRole?: unknown): string[] {
  const rawList: string[] = Array.isArray(roles)
    ? roles
    : roles
    ? [String(roles)]
    : legacyRole
    ? [String(legacyRole)]
    : [];
  return rawList.map((r) => String(r || "").trim().toLowerCase()).filter(Boolean);
}

function mapUserRolesToPageRoles(
  uid?: string,
  email?: string | null,
  rolesFromUsers?: unknown,
  legacyRole?: unknown
): PageRole[] {
  const lowerEmail = (email || "").toLowerCase();

  if (uid === OWNER_ADMIN_FINAL.uid || lowerEmail === OWNER_ADMIN_FINAL.email) {
    return ["admin_final"];
  }
  if (uid === OWNER_ADMIN_OVERSEER.uid || lowerEmail === OWNER_ADMIN_OVERSEER.email) {
    return ["admin_overseer"];
  }

  const norm = normalizeRoles(rolesFromUsers, legacyRole);
  const out = new Set<PageRole>();

  for (const r of norm) {
    if (r === "admin") out.add("admin_final");
    if (r === "exec" || r === "executive") out.add("exec");
    if (r === "finance" || r === "fin") out.add("finance");
  }

  if (out.size === 0) out.add("employee");
  return Array.from(out);
}


function hasAnyRole(current: PageRole[], allow: PageRole[]) {
  return allow.some((r) => current.includes(r));
}

function RoleGate({ allow, children }: { allow: PageRole[]; children: React.ReactNode }) {
  const auth = getAuth();
  const me = auth.currentUser;

  const cached = (() => {
    try {
      const raw = localStorage.getItem("user");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.pageRoles) && parsed.pageRoles.length) {
        return parsed.pageRoles as PageRole[];
      }
      if (Array.isArray(parsed?.roles) && parsed.roles.length) {
        return mapUserRolesToPageRoles(me?.uid, me?.email, parsed.roles, undefined);
      }
    } catch {}
    return null;
  })();

  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<PageRole[]>(cached || ["employee"]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setRoles(["employee"]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const uref = doc(db, "users", u.uid);
        const usnap = await getDoc(uref).catch(() => null);
        const data = usnap && usnap.exists() ? (usnap.data() as any) : undefined;
        const mapped = mapUserRolesToPageRoles(u.uid, u.email, data?.roles, data?.role);
        setRoles(mapped);

        try {
          const prev = JSON.parse(localStorage.getItem("user") || "{}");
          localStorage.setItem(
            "user",
            JSON.stringify({
              ...prev,
              pageRoles: mapped,
            })
          );
        } catch {}
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [auth]);

  if (loading) {
    return <div className="min-h-[40vh] grid place-items-center text-gray-300">Checking access…</div>;
  }

  if (!hasAnyRole(roles, allow)) {
    return <div className="min-h-[40vh] grid place-items-center text-gray-300">Not authorized.</div>;
  }

  return <>{children}</>;
}

function WithSidebar() {
  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className="lg:ml-5 xl:ml-10 px-4 sm:px-6 lg:px-8 py-6">
        <Outlet />
      </div>
    </div>
  );
}

/* ───────────────────────── Routes ───────────────────────── */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<WithSidebar />}>
          {/* Employee area (all signed-in) */}
          <Route path="/employee-dashboard" element={<EmployeeDashboard />} />
          <Route path="/employee/payslips" element={<MyPayslipPage />} />
          <Route path="/finance/requests" element={<RequestsPage />} />
          <Route path="/approvals/view-budget/:id" element={<ViewingBudget />} />
          <Route path="/approvals/view-request/:id" element={<ViewingRequest />} />


          {/* Admin dashboards */}
          <Route
            path="/admin"
            element={
              <RoleGate allow={["admin_final", "admin_overseer", "exec"]}>
                <AdminDashboard />
              </RoleGate>
            }
          />

          {/* Finance dashboard */}
          <Route
            path="/finance"
            element={
              <RoleGate allow={["admin_final", "finance", "exec"]}>
                <FinanceDashboard />
              </RoleGate>
            }
          />

          {/* Executive dashboard */}
          <Route
            path="/executive"
            element={
              <RoleGate allow={["exec", "admin_final"]}>
                <ExecutiveDashboard />
              </RoleGate>
            }
          />

          {/* Employees CRUD */}
          <Route
            path="/finance/employees"
            element={
              <RoleGate allow={["admin_final", "finance", "exec"]}>
                <EmployeesPage />
              </RoleGate>
            }
          />
          <Route
            path="/finance/employees/add"
            element={
              <RoleGate allow={["admin_final", "finance", "exec"]}>
                <AddEmployeePage />
              </RoleGate>
            }
          />
          <Route
            path="/finance/employees/:id"
            element={
              <RoleGate allow={["admin_final", "finance", "exec"]}>
                <EmployeeDetailPage />
              </RoleGate>
            }
          />
          <Route
            path="/finance/employees/:id/edit"
            element={
              <RoleGate allow={["admin_final", "finance", "exec"]}>
                <EditEmployeePage />
              </RoleGate>
            }
          />

          {/* Payroll & related */}
          <Route
            path="/finance/payroll"
            element={
              <RoleGate allow={["admin_final", "finance", "exec"]}>
                <PayrollPage />
              </RoleGate>
            }
          />
          <Route
            path="/finance/payroll/drafts/:draftId"
            element={
              <RoleGate allow={["admin_final", "finance", "exec", "admin_overseer"]}>
                <PayrollDraftPage />
              </RoleGate>
            }
          />
          <Route
            path="/finance/attendance"
            element={
              <RoleGate allow={["admin_final", "finance", "exec"]}>
                <AttendancePage />
              </RoleGate>
            }
          />
          <Route
            path="/finance/cash-advances"
            element={
              <RoleGate allow={["admin_final", "finance", "exec"]}>
                <CashAdvancePage />
              </RoleGate>
            }
          />

          {/* Budgets */}
          <Route
            path="/finance/budgets"
            element={
              <RoleGate allow={["admin_final", "finance", "exec", "employee"]}>
                <BudgetsPage />
              </RoleGate>
            }
          />

          {/* Reports */}
          <Route
            path="/finance/reports"
            element={
              <RoleGate allow={["admin_final", "finance", "exec"]}>
                <ReportsPage />
              </RoleGate>
            }
          />

          {/* Audit logs */}
          <Route
            path="/finance/audit-logs"
            element={
              <RoleGate allow={["admin_final", "finance", "exec"]}>
                <AuditLogsPage />
              </RoleGate>
            }
          />

          {/* Approvals */}
          <Route
            path="/approvals"
            element={
              <RoleGate allow={["admin_final", "admin_overseer", "exec", "finance"]}>
                <ApprovalsPage />
              </RoleGate>
            }
          />

          {/* All Payslips */}
          <Route
            path="/all-payslips"
            element={
              <RoleGate allow={["admin_final", "admin_overseer", "exec", "finance"]}>
                <AllPayslipsPage />
              </RoleGate>
            }
          />

          {/* Finance settings */}
          <Route
            path="/finance/settings"
            element={
              <RoleGate allow={["admin_final", "finance", "exec"]}>
                <FinanceSettingsPage />
              </RoleGate>
            }
          />
          <Route
            path="/profile"
            element={
              <RoleGate allow={["admin_final", "admin_overseer", "exec", "finance", "employee"]}>
                <ProfilePage />
              </RoleGate>
            }
          />
        </Route>
      </Route>
    </Routes>
  );
}
