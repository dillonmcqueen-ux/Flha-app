-- Step 4: company-name login.
--
-- Run this AFTER the code that stops reading these columns is deployed.
-- Dropping them first would break the live login, which still selects them.
-- (Order: merge the PR, wait for the production deploy, then run this.)
--
-- Workers and supervisors now find their company by name, then pick their own
-- name and enter their own PIN. The shared worker/supervisor codes and the
-- Gatehouse-era app_type flag have no reader left in the codebase.
-- companies.company_code is kept: it is the code staff type to find their company
-- (api/login.js find_company, chosen by the founder in the Admin Panel), and companies.roster_enabled is kept because the
-- Dashboard and crons still read it; every company is on the roster now.

alter table companies drop column if exists worker_code;
alter table companies drop column if exists supervisor_code;
alter table companies drop column if exists app_type;
