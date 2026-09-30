-- Removes the Gatehouse product (transfer-station receipts) from the FORA
-- database. Gatehouse was pulled out of this platform on 2026-09-30 by
-- Dillon's decision: it belongs in its own project. The code is recoverable
-- at commit 023b9bb and a write-up lives in the archive artifact
-- https://claude.ai/artifact/JHsEaSAYpED6ZwymGNAXX4.
--
-- DO NOT APPLY until the PR that deletes api/gatehouse.js has merged and
-- deployed. Until then production still runs code that reads these tables.
--
-- Row counts at archive time: stations 2, price tiers 10, vehicles 12,
-- transactions 16, reconciliations 2, trailer counts 0. All demo data for
-- Red Deer County (companies.id 16). Row-level data is not archived.
--
-- Manual steps this file cannot do:
--   1. Delete the `gatehouse-uploads` storage bucket (1 cheque photo) from
--      the Supabase dashboard. Storage rows cannot be removed with SQL.
--   2. Delete company 16 (Red Deer County) with the Admin Panel's delete
--      company action, which knows every table that references a company.
--
-- companies.app_type is left in place on purpose: api/login.js still
-- stamps appType 'safety' into sessions. Dropping it is a separate change.

drop table if exists gatehouse_trailer_counts;
drop table if exists gatehouse_reconciliations;
drop table if exists gatehouse_transactions;
drop table if exists gatehouse_vehicles;
drop table if exists gatehouse_price_tiers;
drop table if exists gatehouse_stations;
