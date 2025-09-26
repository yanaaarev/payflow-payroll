// src/pages/Login.tsx
import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase/firebase";
import { useNavigate } from "react-router-dom";
import ipLogo from "../assets/iplogo.png";

/* ───────────────────── Role mapping (aligned with App.tsx) ───────────────────── */
type PageRole = "admin_final" | "admin_overseer" | "exec" | "finance" | "employee";

// Owners (overrides)
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
  uid: string | undefined,
  email: string | null | undefined,
  rolesFromUsers?: unknown,
  legacyRole?: unknown
): PageRole[] {
  const lowerEmail = (email || "").toLowerCase();

  // Owner overrides
  if (uid === OWNER_ADMIN_FINAL.uid || lowerEmail === OWNER_ADMIN_FINAL.email) {
    return ["admin_final"];
  }
  if (uid === OWNER_ADMIN_OVERSEER.uid || lowerEmail === OWNER_ADMIN_OVERSEER.email) {
    return ["admin_overseer"];
  }

  const norm = normalizeRoles(rolesFromUsers, legacyRole);
  const out = new Set<PageRole>();
  if (norm.includes("admin")) out.add("admin_final");
  if (norm.includes("exec") || norm.includes("executive")) out.add("exec");
  if (norm.includes("finance")) out.add("finance");
  if (out.size === 0) out.add("employee");
  return Array.from(out.values());
}

function landingFor(pageRoles: PageRole[]) {
  if (pageRoles.includes("admin_final")) return "/admin";
  if (pageRoles.includes("admin_overseer")) return "/admin";
  if (pageRoles.includes("finance")) return "/finance";
  if (pageRoles.includes("exec")) return "/executive";
  return "/employee-dashboard";
}

/* ───────────────────────── Component ───────────────────────── */
const Login = () => {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      const user = cred.user;

      const uref = doc(db, "users", user.uid);
      const usnap = await getDoc(uref).catch(() => null);
      const udata = usnap && usnap.exists() ? (usnap.data() as any) : undefined;

      const pageRoles = mapUserRolesToPageRoles(
        user.uid,
        user.email,
        udata?.roles,
        udata?.role
      );

      const isOwnerFinal =
        user.uid === OWNER_ADMIN_FINAL.uid || (user.email || "").toLowerCase() === OWNER_ADMIN_FINAL.email;
      const isOwnerOverseer =
        user.uid === OWNER_ADMIN_OVERSEER.uid || (user.email || "").toLowerCase() === OWNER_ADMIN_OVERSEER.email;

      if (!isOwnerFinal && !isOwnerOverseer && !udata) {
        setError("Your account exists but is not provisioned in the system yet. Please contact the admin.");
        setLoading(false);
        return;
      }

      localStorage.setItem(
        "user",
        JSON.stringify({
          uid: user.uid,
          email: user.email,
          roles: Array.isArray(udata?.roles)
            ? udata.roles
            : udata?.role
            ? [udata.role]
            : isOwnerFinal
            ? ["admin"]
            : isOwnerOverseer
            ? ["admin"]
            : ["employee"],
          pageRoles,
          displayName: udata?.name || user.displayName || (user.email || "").split("@")[0],
        })
      );

      navigate(landingFor(pageRoles), { replace: true });
    } catch (err: any) {
      console.error("Login error:", err);
      const code = err?.code || "";
      if (code === "auth/user-not-found") setError("No user found with this email.");
      else if (code === "auth/wrong-password") setError("Incorrect password.");
      else if (code === "auth/invalid-email") setError("Invalid email address.");
      else setError("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center rounded-2xl justify-center px-4 sm:px-6 lg:px-8">
      {/* Login Card */}
      <div className="w-full max-w-md bg-black/30 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl p-8">
        {/* Logo + Header */}
        <div className="text-center mb-8">
          <img
          src={ipLogo}
          alt="Insta Payflow Logo"
          className="mx-auto h-16 w-16 object-contain mb-4"
        />
          <h1 className="text-3xl font-bold text-white">Insta Payflow</h1>
          <p className="mt-2 text-gray-400 text-sm">Secure Payroll Login</p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 text-red-200 text-sm rounded-xl text-center">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-5">
          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              className="w-full px-4 py-3 bg-white/10 border border-white/20 placeholder-gray-400 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-60 transition"
              placeholder="you@company.com"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-2">Password</label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 placeholder-gray-400 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-60 transition pr-12"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-xs"
                tabIndex={-1}
              >
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 disabled:from-gray-600 disabled:to-gray-700 text-white font-semibold rounded-xl transition duration-200 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg
                  className="animate-spin h-5 w-5 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Signing in...
              </>
            ) : (
              "Sign In"
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
