// src/useCompanyStructure.js
// Loads a company's departments, divisions and sites, plus the signed-in
// person's own profile (so the UI knows whether they are the Account Owner).
// Departments and divisions are routing tags; see server-lib/companyStructure.js.
import { useCallback, useEffect, useState } from "react";

async function call(body) {
  try {
    const res = await fetch("/api/companydata", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return res.ok ? data : { error: data.error || "Something went wrong." };
  } catch (e) {
    return { error: "Connection error. Please try again." };
  }
}

export default function useCompanyStructure({ token, companyId = null, enabled = true }) {
  const [departments, setDepartments] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [sites, setSites] = useState([]);
  const [me, setMe] = useState(null);

  const reload = useCallback(async () => {
    if (!token) return;
    const scope = companyId ? { companyId } : {};
    const [d, v, s, m] = await Promise.all([
      call({ action: "list_departments", token, ...scope }),
      call({ action: "list_divisions", token, ...scope }),
      call({ action: "list_sites", token, ...scope }),
      call({ action: "get_my_profile", token }),
    ]);
    if (d.departments) setDepartments(d.departments);
    if (v.divisions) setDivisions(v.divisions);
    if (s.sites) setSites(s.sites);
    if (!m.error) setMe(m);
  }, [token, companyId]);

  useEffect(() => { if (enabled) reload(); }, [enabled, reload]);

  return { departments, divisions, sites, me, reload, setDepartments, setDivisions };
}

export { call as companyCall };
