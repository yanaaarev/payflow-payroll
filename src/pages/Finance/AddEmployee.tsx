// src/pages/Finance/AddEmployee.tsx
import { useState, useEffect } from "react";
import { db, firebaseConfig } from "../../firebase/firebase";
import {
  collection,
  getDocs,
  serverTimestamp,
  setDoc,
  doc,
  query,
  where,
  limit as fsLimit,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";

// Secondary-app trick (create auth user without logging out current admin/finance)
import { getApps, initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";

type Category = "core" | "core_probationary" | "owner" | "intern" | "freelancer";

type UserDoc = {
  uid: string;
  email: string;
  name?: string;
  roles?: string[];
  status?: string;
  createdAt?: any;
};

type ObRate = { category: string; rate: number };
type FreelancerItem = { project: string; quantity: number; rate: number };

function unionRoles(existing: string[] | undefined, extras: string[]) {
  const set = new Set<string>(Array.isArray(existing) ? existing : []);
  extras.forEach((r) => set.add(r));
  return Array.from(set.values());
}

const AddEmployeePage = () => {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    alias: "",
    position: "",
    department: "",
    category: "core" as Category,
    monthlySalary: 0,
    allowancePerDay: 0, // interns (fixed 125)
    perDayRate: 0, // core probationary only
    obRates: [] as ObRate[],
    freelancerItems: [] as FreelancerItem[], // freelancer only
    benefits: { sss: false, pagibig: false, philhealth: false },
    status: "active",
    password: "",
  });

  const [nextId, setNextId] = useState<string>("EMP001");
  const [loadingId, setLoadingId] = useState(true);
  const [saving, setSaving] = useState(false);

  /* ───────────────── Auto-generate next EMP### ───────────────── */
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "employees"));
        let maxNum = 0;
        snap.forEach((d) => {
          const data: any = d.data();
          if (data.employeeId && /^EMP\d+$/.test(data.employeeId)) {
            const num = parseInt(String(data.employeeId).replace("EMP", ""), 10);
            if (!Number.isNaN(num) && num > maxNum) maxNum = num;
          }
        });
        const padded = String(maxNum + 1).padStart(3, "0");
        setNextId(`EMP${padded}`);
      } catch {
        setNextId("EMP001");
      } finally {
        setLoadingId(false);
      }
    })();
  }, []);

  /* ───────────────── Form handlers ───────────────── */
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    if (name === "category") {
      const v = value as Category;

      if (v === "intern") {
        setFormData((prev) => ({
          ...prev,
          category: v,
          monthlySalary: 0,
          allowancePerDay: 125, // fixed
          perDayRate: 0,
          freelancerItems: [],
          obRates: [{ category: "OB", rate: 500 }],
        }));
        return;
      }

      if (v === "owner") {
        setFormData((prev) => ({
          ...prev,
          category: v,
          monthlySalary: 60000, // fixed, locked in UI
          allowancePerDay: 0,
          perDayRate: 0,
          freelancerItems: [],
          obRates: prev.obRates || [],
        }));
        return;
      }

      if (v === "core_probationary") {
        setFormData((prev) => ({
          ...prev,
          category: v,
          monthlySalary: 0,
          perDayRate: prev.perDayRate || 0,
          allowancePerDay: 0,
          freelancerItems: [],
        }));
        return;
      }

      if (v === "freelancer") {
        setFormData((prev) => ({
          ...prev,
          category: v,
          monthlySalary: 0,
          allowancePerDay: 0,
          perDayRate: 0,
          freelancerItems:
            prev.freelancerItems && prev.freelancerItems.length
              ? prev.freelancerItems
              : [{ project: "", quantity: 1, rate: 0 }],
        }));
        return;
      }

      // default: core (regular)
      setFormData((prev) => ({
        ...prev,
        category: v,
        allowancePerDay: 0,
        perDayRate: 0,
        freelancerItems: [],
      }));
      return;
    }

    setFormData((prev) => ({
      ...prev,
      [name]:
        type === "number"
          ? Number(value)
          : type === "checkbox"
          ? checked
          : value,
    }));
  };

  /* OB RATES HANDLERS */
  const addObRate = () => {
    if (formData.category === "intern") return;
    setFormData((prev) => ({
      ...prev,
      obRates: [...prev.obRates, { category: "", rate: 0 }],
    }));
  };
  const updateObRate = (index: number, field: "category" | "rate", value: string | number) => {
    if (formData.category === "intern") return;
    setFormData((prev) => {
      const updated = [...prev.obRates];
      updated[index] = {
        ...updated[index],
        [field]: field === "rate" ? Number(value) : (value as string),
      };
      return { ...prev, obRates: updated };
    });
  };
  const removeObRate = (index: number) => {
    if (formData.category === "intern") return;
    setFormData((prev) => {
      const updated = [...prev.obRates];
      updated.splice(index, 1);
      return { ...prev, obRates: updated };
    });
  };

  /* FREELANCER ITEMS HANDLERS */
  const addFreelancerItem = () =>
    setFormData((prev) => ({
      ...prev,
      freelancerItems: [...prev.freelancerItems, { project: "", quantity: 1, rate: 0 }],
    }));

  const updateFreelancerItem = <K extends keyof FreelancerItem>(
    index: number,
    field: K,
    value: FreelancerItem[K]
  ) =>
    setFormData((prev) => {
      const list = [...prev.freelancerItems];
      const item = { ...list[index], [field]: field === "quantity" || field === "rate" ? Number(value) : value };
      list[index] = item;
      return { ...prev, freelancerItems: list };
    });

  const removeFreelancerItem = (index: number) =>
    setFormData((prev) => {
      const list = [...prev.freelancerItems];
      list.splice(index, 1);
      return { ...prev, freelancerItems: list };
    });

  /* ───────────────── Existing user lookup ───────────────── */
  async function findUserByEmail(email: string): Promise<UserDoc | null> {
    const q1 = query(collection(db, "users"), where("email", "==", email.toLowerCase()), fsLimit(1));
    const snap = await getDocs(q1);
    if (snap.empty) return null;
    const d = snap.docs[0];
    const x = d.data() as any;
    return {
      uid: x.uid || d.id,
      email: x.email || email.toLowerCase(),
      name: x.name || "",
      roles: Array.isArray(x.roles) ? x.roles : [],
      status: x.status || "active",
      createdAt: x.createdAt,
    };
  }

  /* Secondary-app user creation (no logout for the creator) */
  async function createAuthUserWithoutAffectingSession(email: string, password: string) {
    const SECONDARY_NAME = "secondary-app-for-admin-create";
    const secondary =
      getApps().find((a) => a.name === SECONDARY_NAME) || initializeApp(firebaseConfig, SECONDARY_NAME);

    const secondaryAuth = getAuth(secondary);
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      return cred.user;
    } finally {
      try {
        await deleteApp(secondary);
      } catch {
        /* ignore */
      }
    }
  }

  /* ───────────────── Submit ───────────────── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = formData.email.trim().toLowerCase();
    if (!email) {
      alert("Email is required.");
      return;
    }

    setSaving(true);
    try {
      const category = formData.category;
      const isIntern = category === "intern";
      const isOwner = category === "owner";
      const isCoreProb = category === "core_probationary";
      const isFreelancer = category === "freelancer";

      // Enforce category-specific rules (source of truth)
      const payload = {
        employeeId: nextId,
        name: formData.name.trim(),
        email,
        alias: formData.alias.trim(),
        position: formData.position.trim(),
        department: formData.department.trim(),
        category,
        status: formData.status,
        benefits: formData.benefits,

        monthlySalary: isIntern || isCoreProb || isFreelancer ? 0 : isOwner ? 60000 : Number(formData.monthlySalary || 0),
        allowancePerDay: isIntern ? 125 : 0,
        perDayRate: isCoreProb ? Number(formData.perDayRate || 0) : 0,

        obRates: isIntern ? [{ category: "OB", rate: 500 }] : formData.obRates,

        freelancerItems: isFreelancer
          ? formData.freelancerItems
              .map((x) => ({
                project: String(x.project || "").trim(),
                quantity: Number(x.quantity || 0),
                rate: Number(x.rate || 0),
              }))
              .filter((x) => x.project || x.quantity || x.rate)
          : [],

        createdAt: serverTimestamp(),
      };

      // 0) Check if a users doc already exists for this email
      const existing = await findUserByEmail(email);
      let finalUid = existing?.uid;
      let finalRoles = existing?.roles || [];

      if (!existing) {
        if (!formData.password) {
          alert("Password is required for NEW accounts.");
          setSaving(false);
          return;
        }
        const newUser = await createAuthUserWithoutAffectingSession(email, formData.password);
        finalUid = newUser.uid;

        const baseRoles = ["employee"];
        finalRoles = isOwner ? unionRoles(baseRoles, ["admin", "exec"]) : baseRoles;

        await setDoc(doc(db, "users", finalUid!), {
          uid: finalUid,
          email,
          name: payload.name,
          roles: finalRoles,
          status: payload.status,
          createdAt: serverTimestamp(),
        });
      } else {
        const needExtras = isOwner ? ["employee", "admin", "exec"] : ["employee"];
        finalRoles = unionRoles(existing.roles, needExtras);
        await setDoc(
          doc(db, "users", finalUid!),
          {
            uid: finalUid,
            email,
            name: existing.name || payload.name,
            roles: finalRoles,
            status: existing.status || payload.status,
            createdAt: existing.createdAt || serverTimestamp(),
          },
          { merge: true }
        );
      }

      // 3) Write employees/{EMP###}
      await setDoc(doc(db, "employees", payload.employeeId), {
        ...payload,
        uid: finalUid,
      });

      alert(`Employee ${nextId} saved successfully!`);
      navigate("/finance/employees");
    } catch (err: any) {
      console.error("Save employee error:", err);
      alert(err?.message || "Failed to save employee.");
    } finally {
      setSaving(false);
    }
  };

  const category = formData.category;
  const isIntern = category === "intern";
  const isOwner = category === "owner";
  const isCoreProb = category === "core_probationary";
  const isFreelancer = category === "freelancer";

  /* ───────────────── UI ───────────────── */
  return (
    <div className="min-h-screen bg-gray-900 text-white pt-20 px-4 sm:px-6 lg:px-8 pb-8">
      <div className="max-w-4xl mx-auto bg-gray-800/50 rounded-2xl border border-white/10 shadow-xl p-8">
        <h1 className="text-2xl font-bold mb-6 text-center bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
          Add New Employee
        </h1>

        {loadingId ? (
          <div className="text-center text-gray-400">Generating Employee ID...</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Auto ID */}
            <div>
              <label className="block text-sm text-gray-300 mb-1">Employee ID</label>
              <input
                type="text"
                value={nextId}
                disabled
                className="w-full px-4 py-2 rounded-lg bg-gray-700 text-gray-300 border border-white/20 cursor-not-allowed"
              />
            </div>

            {/* Name, Email, Password */}
            <div className="grid md:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Full Name</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 rounded-lg bg-gray-800/70 border border-white/20 focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Email</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 rounded-lg bg-gray-800/70 border border-white/20"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Password</label>
                <input
                  type="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="Needed only for NEW accounts"
                  className="w-full px-4 py-2 rounded-lg bg-gray-800/70 border border-white/20"
                />
                <p className="text-xs text-gray-400 mt-1">
                  If this email already exists in <span className="font-semibold">users</span>, password is ignored.
                </p>
              </div>
            </div>

            {/* Alias, Category, Department */}
            <div className="grid md:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Alias (Biometric)</label>
                <input
                  type="text"
                  name="alias"
                  value={formData.alias}
                  onChange={handleChange}
                  placeholder="Biometric Alias"
                  className="w-full px-4 py-2 rounded-lg bg-gray-800/70 border border-white/20"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Category</label>
                <select
                  name="category"
                  value={formData.category}
                  onChange={handleChange}
                  className="w-full px-4 py-2 rounded-lg bg-gray-800/70 text-white border border-white/20"
                >
                  <option value="core">Core (Regular)</option>
                  <option value="core_probationary">Core (Probationary)</option>
                  <option value="owner">Owner</option>
                  <option value="intern">Intern</option>
                  <option value="freelancer">Freelancer</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Department</label>
                <input
                  type="text"
                  name="department"
                  value={formData.department}
                  onChange={handleChange}
                  className="w-full px-4 py-2 rounded-lg bg-gray-800/70 border border-white/20"
                />
              </div>
            </div>

            {/* Position & Pay */}
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Position</label>
                <input
                  type="text"
                  name="position"
                  value={formData.position}
                  onChange={handleChange}
                  className="w-full px-4 py-2 rounded-lg bg-gray-800/70 border border-white/20"
                />
              </div>

              {/* Right column swaps based on category */}
              {isIntern ? (
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Allowance (per day)</label>
                  <input
                    type="number"
                    name="allowancePerDay"
                    value={formData.allowancePerDay}
                    onChange={handleChange}
                    disabled
                    className="w-full px-4 py-2 rounded-lg bg-gray-700 text-gray-300 border border-white/20 cursor-not-allowed"
                  />
                  <p className="text-xs text-gray-400 mt-1">Fixed at ₱125/day for interns.</p>
                </div>
              ) : isCoreProb ? (
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Per-day Rate (Core - Probationary)</label>
                  <input
                    type="number"
                    name="perDayRate"
                    value={formData.perDayRate}
                    onChange={handleChange}
                    className="w-full px-4 py-2 rounded-lg bg-gray-800/70 border border-white/20"
                  />
                  <p className="text-xs text-gray-400 mt-1">Used instead of monthly salary for probationary core employees.</p>
                </div>
              ) : isFreelancer ? (
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Projects (Freelancer)</label>
                  <div className="space-y-2">
                    {formData.freelancerItems.map((it, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                        <input
                          className="col-span-6 px-3 py-2 rounded-lg bg-gray-800/70 border border-white/20"
                          placeholder="Project"
                          value={it.project}
                          onChange={(e) => updateFreelancerItem(idx, "project", e.target.value)}
                        />
                        <input
                          type="number"
                          className="col-span-3 px-3 py-2 rounded-lg bg-gray-800/70 border border-white/20"
                          placeholder="Qty"
                          value={it.quantity}
                          onChange={(e) => updateFreelancerItem(idx, "quantity", Number(e.target.value))}
                        />
                        <input
                          type="number"
                          className="col-span-3 px-3 py-2 rounded-lg bg-gray-800/70 border border-white/20"
                          placeholder="Rate (₱)"
                          value={it.rate}
                          onChange={(e) => updateFreelancerItem(idx, "rate", Number(e.target.value))}
                        />
                        <div className="col-span-12 flex justify-end">
                          <button
                            type="button"
                            onClick={() => removeFreelancerItem(idx)}
                            className="text-rose-400 hover:text-rose-300 text-xs"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={addFreelancerItem}
                      className="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm"
                    >
                      + Add Project
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Monthly Salary</label>
                  <input
                    type="number"
                    name="monthlySalary"
                    value={isOwner ? 60000 : formData.monthlySalary}
                    onChange={handleChange}
                    disabled={isOwner} // lock when Owner
                    className={`w-full px-4 py-2 rounded-lg border border-white/20 ${
                      isOwner ? "bg-gray-700 text-gray-300 cursor-not-allowed" : "bg-gray-800/70"
                    }`}
                  />
                  {isOwner && (
                    <p className="text-xs text-gray-400 mt-1">Owner monthly salary is fixed at ₱60,000.</p>
                  )}
                </div>
              )}
            </div>

            {/* OB Rates */}
            <div>
              <label className="block text-sm text-gray-300 mb-2">OB Rates</label>
              {isIntern ? (
                <div className="space-y-2">
                  <div className="flex gap-3 items-center">
                    <input
                      type="text"
                      value="OB"
                      disabled
                      className="flex-1 px-3 py-2 rounded-lg bg-gray-700 text-gray-300 border border-white/20 cursor-not-allowed"
                    />
                    <input
                      type="number"
                      value={500}
                      disabled
                      className="w-32 px-3 py-2 rounded-lg bg-gray-700 text-gray-300 border border-white/20 cursor-not-allowed"
                    />
                  </div>
                  <p className="text-xs text-gray-400">Intern OB is fixed at ₱500.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {formData.obRates.map((ob, idx) => (
                    <div key={idx} className="flex gap-3 items-center">
                      <input
                        type="text"
                        placeholder="Category (e.g. Videographer)"
                        value={ob.category}
                        onChange={(e) => updateObRate(idx, "category", e.target.value)}
                        className="flex-1 px-3 py-2 rounded-lg bg-gray-800/70 border border-white/20"
                      />
                      <input
                        type="number"
                        placeholder="Rate (₱)"
                        value={ob.rate}
                        onChange={(e) => updateObRate(idx, "rate", Number(e.target.value))}
                        className="w-32 px-3 py-2 rounded-lg bg-gray-800/70 border border-white/20"
                      />
                      <button
                        type="button"
                        onClick={() => removeObRate(idx)}
                        className="text-rose-400 hover:text-rose-300 text-sm"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addObRate}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm"
                  >
                    + Add OB Rate
                  </button>
                </div>
              )}
            </div>

            {/* Benefits */}
            <div>
              <label className="block text-sm text-gray-300 mb-2">Benefits</label>
              <div className="grid grid-cols-3 gap-4">
                {(["sss", "pagibig", "philhealth"] as const).map((b) => (
                  <label
                    key={b}
                    className={`flex flex-col items-center justify-center px-4 py-3 rounded-lg cursor-pointer border transition ${
                      (formData.benefits as any)[b]
                        ? "bg-blue-600/40 border-blue-400 text-blue-200"
                        : "bg-gray-800/70 border-white/20 text-gray-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={(formData.benefits as any)[b]}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setFormData((prev) => ({
                          ...prev,
                          benefits: { ...prev.benefits, [b]: on },
                        }));
                      }}
                      className="hidden"
                    />
                    <span className="uppercase">{b}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm text-gray-300 mb-1">Status</label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="w-full px-4 py-2 rounded-lg bg-gray-800/70 text-white border border-white/20"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-3 pt-6">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="px-5 py-2 rounded-lg bg-gray-700 hover:bg-gray-600"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60"
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Employee"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default AddEmployeePage;
