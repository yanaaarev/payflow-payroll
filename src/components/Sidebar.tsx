// src/components/Sidebar.tsx
import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FiMenu, FiLogOut } from "react-icons/fi";
import { CiSettings } from "react-icons/ci";
import {
  HiOutlineUsers,
  HiOutlineClipboardList,
  HiOutlineFolder,
  HiOutlineCurrencyDollar,
  HiOutlineDocumentText,
} from "react-icons/hi";
import { GoHomeFill } from "react-icons/go";
import { MdOutlineRequestQuote } from "react-icons/md";
import { getAuth } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/firebase";

type PageRole = "admin_final" | "admin_overseer" | "exec" | "finance" | "employee";
type NavItem = { label: string; href: string; icon: React.ReactNode };

const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const openerBtnRef = React.useRef<HTMLButtonElement | null>(null);

  const session = React.useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      return {};
    }
  }, []);

  const pageRoles: PageRole[] = React.useMemo(() => {
    if (Array.isArray(session?.pageRoles)) return session.pageRoles as PageRole[];
    if (session?.role) return [session.role];
    return ["employee"];
  }, [session]);

  const [displayName, setDisplayName] = React.useState<string>(() => {
    if (session?.displayName) return session.displayName;
    if (session?.email) return String(session.email).split("@")[0];
    return "User";
  });

  React.useEffect(() => {
    const uid = session?.uid;
    if (!uid) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "users", uid));
        const data = snap.exists() ? (snap.data() as any) : {};
        const authName =
          getAuth().currentUser?.displayName ||
          (session?.email ? String(session.email).split("@")[0] : "");

        const bestName =
          data?.name ||
          data?.displayName ||
          data?.fullName ||
          data?.profile?.name ||
          data?.profile?.displayName ||
          session?.displayName ||
          authName ||
          "User";

        if (bestName && bestName !== displayName) {
          setDisplayName(bestName);
          try {
            const merged = { ...(session || {}), displayName: bestName };
            localStorage.setItem("user", JSON.stringify(merged));
          } catch {}
        }
      } catch {
        // ignore
      }
    })();
  }, [session?.uid]);

  const has = (r: PageRole) => pageRoles.includes(r);

  const getHomeRoute = React.useCallback(() => {
    if (has("admin_final") || has("admin_overseer")) return "/admin";
    if (has("finance")) return "/finance";
    if (has("exec")) return "/executive";
    return "/employee-dashboard";
  }, [pageRoles]);

  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const nav: NavItem[] = React.useMemo(() => {
    const HOME: NavItem = { label: "Dashboard", href: getHomeRoute(), icon: <GoHomeFill size={20} /> };

    if (has("admin_final")) {
      return [
        HOME,
        { label: "Employees", href: "/finance/employees", icon: <HiOutlineUsers size={20} /> },
        { label: "Approvals", href: "/approvals", icon: <HiOutlineUsers size={20} /> },
        { label: "Reports", href: "/finance/reports", icon: <HiOutlineDocumentText size={20} /> },
        { label: "Audit Logs", href: "/finance/audit-logs", icon: <HiOutlineFolder size={20} /> },
      ];
    }

    if (has("admin_overseer")) {
      return [
        HOME,
        { label: "Employees", href: "/finance/employees", icon: <HiOutlineUsers size={20} /> },
        { label: "Approvals", href: "/approvals", icon: <HiOutlineUsers size={20} /> },
        { label: "Reports", href: "/finance/reports", icon: <HiOutlineDocumentText size={20} /> },
        { label: "Audit Logs", href: "/finance/audit-logs", icon: <HiOutlineFolder size={20} /> },
      ];
    }

    if (has("finance")) {
      return [
        HOME,
        { label: "My Payslips", href: "/employee/payslips", icon: <HiOutlineDocumentText size={20} /> },
        { label: "Employees", href: "/finance/employees", icon: <HiOutlineUsers size={20} /> },
        { label: "Attendance", href: "/finance/attendance", icon: <HiOutlineClipboardList size={20} /> },
        { label: "Requests", href: "/finance/requests", icon: <MdOutlineRequestQuote size={20} /> },
        { label: "Payroll", href: "/finance/payroll", icon: <HiOutlineDocumentText size={20} /> },
        { label: "Cash Advances", href: "/finance/cash-advances", icon: <HiOutlineCurrencyDollar size={20} /> },
        { label: "Budgets", href: "/finance/budgets", icon: <HiOutlineCurrencyDollar size={20} /> },
        { label: "Reports", href: "/finance/reports", icon: <HiOutlineDocumentText size={20} /> },
        { label: "Audit Logs", href: "/finance/audit-logs", icon: <HiOutlineFolder size={20} /> },
        { label: "Approvals", href: "/approvals", icon: <HiOutlineUsers size={20} /> },
        { label: "Settings", href: "/finance/settings", icon: <CiSettings size={20} /> },
      ];
    }

    if (has("exec")) {
      return [
        HOME,
        { label: "Approvals", href: "/approvals", icon: <HiOutlineUsers size={20} /> },
        { label: "Requests", href: "/finance/requests", icon: <MdOutlineRequestQuote size={20} /> },
        { label: "Budgets", href: "/finance/budgets", icon: <HiOutlineCurrencyDollar size={20} /> },
        { label: "Reports", href: "/finance/reports", icon: <HiOutlineDocumentText size={20} /> },
      ];
    }

    return [
      HOME,
      { label: "My Payslips", href: "/employee/payslips", icon: <HiOutlineDocumentText size={20} /> },
      { label: "File Requests", href: "/finance/requests", icon: <MdOutlineRequestQuote size={20} /> },
      { label: "Budgets", href: "/finance/budgets", icon: <HiOutlineCurrencyDollar size={20} /> },
      { label: "Profile", href: "/profile", icon: <HiOutlineUsers size={20} /> },
    ];
  }, [pageRoles, getHomeRoute]);

  const handleLogout = () => {
    try { localStorage.removeItem("user"); } catch {}
    const auth = getAuth();
    auth.signOut().finally(() => navigate("/"));
  };

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      {/* Toggle Button */}
      <button
        ref={openerBtnRef}
        onClick={() => setOpen((s) => !s)}
        className="fixed top-4 left-4 z-[70] inline-flex items-center justify-center rounded-md p-2.5 text-white bg-black/40 hover:bg-black/60 lg:hidden"
        aria-label="Toggle menu"
      >
        <FiMenu size={20} />
      </button>

      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex fixed top-0 left-0 z-50 h-screen w-64 flex-col bg-[#0f1218]/90 text-white border-r border-white/10 backdrop-blur-md"
      >
        <div className="flex flex-col h-full">
          <div className="px-4 py-5">
            <div className="text-lg font-semibold">Insta PayFlow</div>
            <div className="text-xs text-white/60">Payroll System</div>
          </div>
          <nav className="flex-1 overflow-y-auto px-2 no-scrollbar">
            <ul className="space-y-1.5">
              {nav.map((item) => (
                <li key={item.href}>
                  <button
                    onClick={() => navigate(item.href)}
                    className={[
                      "group w-full flex items-center rounded-md px-3 py-2 transition",
                      isActive(item.href)
                        ? "bg-white/10 text-white"
                        : "text-white/80 hover:text-white hover:bg-white/5",
                    ].join(" ")}
                  >
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-white/5">
                      {item.icon}
                    </span>
                    <span className="ml-3 text-sm font-medium">{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="px-4 py-4 border-t border-white/10">
            <div className="mb-2 text-sm">Hi, <span className="font-semibold">{displayName}</span></div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white/90 hover:bg-red-500/20"
            >
              <FiLogOut size={18} /> Logout
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      <aside
        className={[
          "lg:hidden fixed top-0 left-0 z-50 h-screen w-72 flex-col bg-[#0f1218]/95 text-white border-r border-white/10 backdrop-blur-md transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="flex flex-col h-full">
          <div className="px-5 py-5">
            <div className="text-lg font-semibold">Insta PayFlow</div>
            <div className="text-xs text-white/60">Payroll System</div>
          </div>
          <nav className="flex-1 overflow-y-auto px-4 no-scrollbar">
            <ul className="space-y-1.5">
              {nav.map((item) => (
                <li key={item.href}>
                  <button
                    onClick={() => {
                      navigate(item.href);
                      setOpen(false);
                    }}
                    className={[
                      "group w-full flex items-center rounded-md px-3 py-2 transition",
                      isActive(item.href)
                        ? "bg-white/10 text-white"
                        : "text-white/80 hover:text-white hover:bg-white/5",
                    ].join(" ")}
                  >
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-white/5">
                      {item.icon}
                    </span>
                    <span className="ml-3 text-sm font-medium">{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="px-5 py-4 border-t border-white/10">
            <div className="mb-2 text-sm">Hi, <span className="font-semibold">{displayName}</span></div>
            <button
              onClick={() => {
                setOpen(false);
                handleLogout();
              }}
              className="w-full flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white/90 hover:bg-red-500/20"
            >
              <FiLogOut size={18} /> Logout
            </button>
          </div>
        </div>
      </aside>

      {/* Backdrop for mobile */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      <style>{`
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>
    </>
  );
};

export default Sidebar;
