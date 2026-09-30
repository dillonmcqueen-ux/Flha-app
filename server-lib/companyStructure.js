// server-lib/companyStructure.js
// Per-company departments and divisions, and the validation around a roster
// member's profile fields (departments, divisions, default site, title).
//
// Departments and divisions are TAGS for routing, filtering and reporting.
// Holding one never grants access on its own; access only changes through
// explicit assignment (the locked rule for the login rework). That is why
// this file only validates and lists, it never decides who may see what.
//
// Built-in departments come from server-lib/portalDepartments.js and exist
// for every company. A company's Owner can add more; those live in
// company_departments with a key like "c_yard" so they can never collide
// with a built-in key. Divisions are company-defined from the start.
// Schema: docs/schema/owner-profile-migration.sql.

import { PORTAL_DEPARTMENTS, PORTAL_DEPARTMENT_LABELS } from './portalDepartments.js';
import { resolveSiteId } from './siteScope.js';

export const MAX_CUSTOM_DEPARTMENTS = 30;
export const MAX_DIVISIONS = 50;
export const MAX_TITLE_LENGTH = 80;
export const MAX_LABEL_LENGTH = 60;

export function cleanLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_LENGTH);
}

export function cleanTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH);
}

// "Yard Crew" -> "c_yard_crew". Always prefixed so it cannot equal a built-in.
export function departmentKeyFromLabel(label) {
  const slug = cleanLabel(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36);
  return slug ? `c_${slug}` : '';
}

export async function listDepartments(supabaseAdmin, companyId) {
  const builtin = PORTAL_DEPARTMENTS.map((key) => ({ key, label: PORTAL_DEPARTMENT_LABELS[key] || key, builtin: true }));
  const { data, error } = await supabaseAdmin
    .from('company_departments')
    .select('key, label')
    .eq('company_id', companyId)
    .order('label', { ascending: true });
  if (error) throw new Error(`company_departments read failed: ${error.message}`);
  return [...builtin, ...(data || []).map((d) => ({ key: d.key, label: d.label, builtin: false }))];
}

export async function validDepartmentKeys(supabaseAdmin, companyId) {
  return new Set((await listDepartments(supabaseAdmin, companyId)).map((d) => d.key));
}

// Returns the de-duplicated list, or null when any key is not one of this
// company's departments.
export async function sanitizeDepartments(supabaseAdmin, companyId, departments) {
  if (!Array.isArray(departments)) return null;
  const valid = await validDepartmentKeys(supabaseAdmin, companyId);
  if (departments.some((d) => typeof d !== 'string' || !valid.has(d))) return null;
  return [...new Set(departments)];
}

export async function listDivisions(supabaseAdmin, companyId) {
  const { data, error } = await supabaseAdmin
    .from('company_divisions')
    .select('id, name')
    .eq('company_id', companyId)
    .order('name', { ascending: true });
  if (error) throw new Error(`company_divisions read failed: ${error.message}`);
  return data || [];
}

// Returns the de-duplicated list of ids, or null when any id is not one of
// this company's divisions (a division id from another company is a
// tenancy question, not a validation detail).
export async function sanitizeDivisionIds(supabaseAdmin, companyId, ids) {
  if (!Array.isArray(ids)) return null;
  const wanted = [...new Set(ids.map((n) => Number(n)))];
  if (wanted.some((n) => !Number.isInteger(n) || n <= 0)) return null;
  if (wanted.length === 0) return [];
  const have = new Set((await listDivisions(supabaseAdmin, companyId)).map((d) => d.id));
  if (wanted.some((n) => !have.has(n))) return null;
  return wanted;
}

// Same contract as resolveSiteId in siteScope.js: null for empty, false for
// a site that is not this company's, otherwise the id.
export async function sanitizeDefaultSite(supabaseAdmin, companyId, siteId) {
  if (siteId === '' || siteId === undefined || siteId === null) return null;
  return resolveSiteId(supabaseAdmin, companyId, siteId);
}
