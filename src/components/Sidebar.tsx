// src/components/Sidebar.tsx
import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FiMenu, FiX, FiLogOut } from "react-icons/fi";
import { CiSettings } from "react-icons/ci";
import {
  HiOutlineUsers,
  HiOutlineClipboardList,
  HiOutlineFolder,
  HiOutlineCurrencyDollar,
  HiOutlineDocumentText,
  HiOutlineBell,
} from "react-icons/hi";
import { GoHomeFill } from "react-icons/go";
import { MdOutlineRequestQuote } from "react-icons/md";
import { getAuth } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/firebase";

/* Page roles must match App.tsx */
type PageRole = "admin_final" | "admin_overseer" | "exec" | "finance" | "employee";
type NavItem = { label: string; href: string; icon: React.ReactNode };

const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const openerBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const desktopAsideRef = React.useRef<HTMLElement | null>(null);
  const mobileAsideRef = React.useRef<HTMLElement | null>(null);

  // ── session & roles from localStorage (set on Login)
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

  // ── display name (prefer users/{uid}, then local/auth/email)
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

        // prefer these keys in order
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
        // ignore fetch errors; fallback already set
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.uid]);

  const has = (r: PageRole) => pageRoles.includes(r);

  // Home route based on strongest role
  const getHomeRoute = React.useCallback(() => {
    if (has("admin_final") || has("admin_overseer")) return "/admin";
    if (has("finance")) return "/finance";
    if (has("exec")) return "/executive";
    return "/employee-dashboard";
  }, [pageRoles]);

  // ── open/close state (start CLOSED)
  const [open, setOpen] = React.useState(false);

  // Close when navigating
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Click-outside to close (desktop + mobile)
  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const isOpener = openerBtnRef.current?.contains(target) ?? false;
      const inDesktop = desktopAsideRef.current?.contains(target) ?? false;
      const inMobile = mobileAsideRef.current?.contains(target) ?? false;
      if (!isOpener && !inDesktop && !inMobile) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Build role-based nav strictly from existing routes (App.tsx)
  const nav: NavItem[] = React.useMemo(() => {
    const HOME: NavItem = { label: "Dashboard", href: getHomeRoute(), icon: <GoHomeFill size={20} /> };

    if (has("admin_final")) {
      return [
        HOME,
        { label: "Employees", href: "/finance/employees", icon: <HiOutlineUsers size={20} /> },
        { label: "Notifications", href: "/notifications", icon: <HiOutlineBell size={20} /> },
        { label: "Approvals", href: "/approvals", icon: <HiOutlineUsers size={20} /> },
        { label: "Reports", href: "/finance/reports", icon: <HiOutlineDocumentText size={20} /> },
        { label: "Audit Logs", href: "/finance/audit-logs", icon: <HiOutlineFolder size={20} /> },
       
      ];
    }

    if (has("admin_overseer")) {
      return [
        HOME,
        { label: "Employees", href: "/finance/employees", icon: <HiOutlineUsers size={20} /> },
        { label: "Notifications", href: "/notifications", icon: <HiOutlineBell size={20} /> },
        { label: "Approvals", href: "/approvals", icon: <HiOutlineUsers size={20} /> },
        { label: "Reports", href: "/finance/reports", icon: <HiOutlineDocumentText size={20} /> },
        { label: "Audit Logs", href: "/finance/audit-logs", icon: <HiOutlineFolder size={20} /> },
      ];
    }

    if (has("finance")) {
      return [
        HOME,
        { label: "My Payslips", href: "/employee/payslips", icon: <HiOutlineDocumentText size={20} /> },
        { label: "Notifications", href: "/notifications", icon: <HiOutlineBell size={20} /> },
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
        { label: "Notifications", href: "/notifications", icon: <HiOutlineBell size={20} /> },
        { label: "Requests", href: "/finance/requests", icon: <MdOutlineRequestQuote size={20} /> },
        { label: "Budgets", href: "/finance/budgets", icon: <HiOutlineCurrencyDollar size={20} /> },
        { label: "Reports", href: "/finance/reports", icon: <HiOutlineDocumentText size={20} /> },
      ];
    }

    return [
      HOME,
      { label: "My Payslips", href: "/employee/payslips", icon: <HiOutlineDocumentText size={20} /> },
      { label: "Notifications", href: "/notifications", icon: <HiOutlineBell size={20} /> },
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

  const desktopWidthOpen = "w-72";
  const desktopWidthClosed = "w-16";

  return (
    <>
      {/* Floating toggle:
          - Visible when sidebar is CLOSED on desktop (so it doesn't overlap the header)
          - Always visible on mobile (it also shows 'X' when open there) */}
      <button
        ref={openerBtnRef}
        onClick={() => setOpen((s) => !s)}
        className={[
          "fixed top-4 left-4 z-[60] inline-flex items-center justify-center rounded-md p-2.5 text-white transition",
          open ? "lg:hidden bg-black/40 hover:bg-black/60" : "bg-black/40 hover:bg-black/60",
        ].join(" ")}
        aria-label="Toggle menu"
      >
        {open ? <FiX size={20} /> : <FiMenu size={20} />}
      </button>

      {/* Desktop sidebar */}
      <aside
        ref={desktopAsideRef}
        className={[
          "fixed top-0 left-0 z-50 h-screen",
          "bg-[#0f1218]/90 text-white border-r border-white/10",
          "backdrop-blur-[16px] supports-[backdrop-filter]:bg-[#0f1218]/70",
          "shadow-[0_0_40px_rgba(0,0,0,0.35)]",
          "hidden lg:flex transition-[width] duration-200 ease-in-out",
          open ? desktopWidthOpen : desktopWidthClosed,
        ].join(" ")}
      >
        <div className="relative flex h-full w-full flex-col">
          {/* Internal close for desktop so the floating button can hide */}
          {open && (
            <button
              onClick={() => setOpen(false)}
              className="absolute right-2 top-2 inline-flex items-center justify-center rounded-md p-2 text-white/80 hover:text-white hover:bg-white/10 transition"
              aria-label="Close sidebar"
              title="Close"
            >
              <FiX size={18} />
            </button>
          )}

          {/* TOP: Brand */}
          <div className={`px-3 ${open ? "pt-5 pb-4" : "py-3"}`}>
            {open ? (
              <div className="text-left pl-2">
                <div className="text-lg font-semibold tracking-wide">Insta&nbsp;PayFlow</div>
                <div className="text-xs text-white/60 mt-0.5">Payroll System</div>
              </div>
            ) : (
              <div className="h-8" />
            )}
          </div>

          {/* NAV */}
          <nav className="mt-1 flex-1 overflow-y-auto px-2 no-scrollbar">
            <ul className="space-y-1.5">
              {nav.map((item) => (
                <li key={item.href}>
                  <button
                    onClick={() => navigate(item.href)}
                    className={[
                      "group w-full flex items-center rounded-md transition",
                      open ? "px-2.5 py-2.5" : "px-2 py-2",
                      isActive(item.href)
                        ? "bg-white/10 text-white"
                        : "text-white/80 hover:text-white hover:bg-white/5",
                    ].join(" ")}
                    title={!open ? item.label : undefined}
                  >
                    <span
                      className={[
                        "inline-flex shrink-0 items-center justify-center rounded-md",
                        isActive(item.href) ? "bg-white/10" : "bg-white/5",
                        open ? "h-9 w-9" : "h-10 w-10",
                      ].join(" ")}
                    >
                      {item.icon}
                    </span>
                    {open && (
                      <span className="ml-3 text-sm font-medium tracking-wide">
                        {item.label}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* BOTTOM */}
          <div className="px-3 pb-4 pt-3 border-t border-white/10">
            {open && (
              <div className="mb-3 truncate text-sm text-center text-white/80">
                Hi,&nbsp;<span className="font-semibold text-white">{displayName}</span>
              </div>
            )}
            <button
              onClick={handleLogout}
              className={[
                "w-full inline-flex items-center justify-center gap-2 rounded-md transition",
                open ? "px-3.5 py-2.5" : "px-2 py-2",
                "text-sm font-medium text-white/90 hover:text-white hover:bg-red-500/20",
              ].join(" ")}
              title={!open ? "Logout" : undefined}
            >
              <FiLogOut size={18} />
              {open && <span>Logout</span>}
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      <aside
        ref={mobileAsideRef}
        className={[
          "lg:hidden fixed top-0 left-0 z-50 h-screen w-80",
          "bg-[#0f1218]/90 text-white border-r border-white/10",
          "backdrop-blur-[16px] supports-[backdrop-filter]:bg-[#0f1218]/70",
          "shadow-[0_0_40px_rgba(0,0,0,0.35)]",
          "transition-transform duration-200 will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
        aria-hidden={!open}
      >
        <div className="flex h-full w-full flex-col">
          <div className="flex items-center justify-between px-5 py-5">
            <div className="flex flex-col text-left">
              <span className="text-lg font-semibold tracking-wide">Insta&nbsp;PayFlow</span>
              <span className="text-xs text-white/60 mt-0.5">Payroll System</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-md p-2.5 text-white/80 hover:text-white hover:bg-white/10 transition"
              aria-label="Close menu"
            >
              <FiX size={20} />
            </button>
          </div>

          <nav className="mt-1 flex-1 overflow-y-auto px-4 no-scrollbar">
            <ul className="space-y-1.5">
              {nav.map((item) => (
                <li key={item.href}>
                  <button
                    onClick={() => {
                      navigate(item.href);
                      setOpen(false);
                    }}
                    className={[
                      "group w-full flex items-center rounded-md px-3 py-2.5 transition",
                      isActive(item.href)
                        ? "bg-white/10 text-white"
                        : "text-white/80 hover:text-white hover:bg-white/5",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                        isActive(item.href) ? "bg-white/10" : "bg-white/5",
                      ].join(" ")}
                    >
                      {item.icon}
                    </span>
                    <span className="ml-3 text-sm font-medium tracking-wide">{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="px-5 pb-6 pt-3 border-t border-white/10">
          <div className="mb-3 flex flex-col items-center text-sm text-white/80">
            <span>
              Hi,&nbsp;<span className="font-semibold text-white">{displayName}</span>
            </span>
          </div>
          <button
            onClick={() => {
              setOpen(false);
              handleLogout();
            }}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2.5 text-sm font-medium text-white/90 hover:text-white hover:bg-red-500/20 transition"
          >
            <FiLogOut size={18} />
            <span>Logout</span>
          </button>
        </div>
        </div>
      </aside>

      {/* Hide scrollbars utility */}
      <style>{`
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>
    </>
  );
};

export default Sidebar;
