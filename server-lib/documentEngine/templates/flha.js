// server-lib/documentEngine/templates/flha.js
// The FLHA (Field Level Hazard Assessment) as a FORA template for the unified
// document engine. Nothing here touches a database by itself: seedFlhaTemplate
// creates the template (a definition with no company) through the engine's own
// service, so it gets the same validation as anything a builder saves.
//
// What it carries over from the built-in FLHA (src/App.jsx, api/flhas.js,
// src/generatePDF.js):
//   - the hazard table (task, hazard, control, SOP reference, risk) with the AI
//     assist that writes it from a task description (src/flhaHazardAi.js)
//   - SOP alerts, required PPE, additional notes, an AI-assisted flag
//   - the worker's signature (now or later) and crew sign-off
//   - supervisor approval, only when a hazard is rated Extreme; a crew lead may
//     approve for their own crew
//   - the PDF, laid out like today's
//
// Not carried here, tracked as the remaining parity items: amending a filed
// FLHA, the flha_edit Brain signal and the 24 hour sign-afterwards alert wording.

import { createDefinition, saveDraft, publishDraft } from '../service.js';

export const FLHA_FIELDS = [
  { fieldKey: 'task_summary', label: 'Task summary', fieldType: 'long_text', required: true },
  {
    fieldKey: 'hazards', label: 'Hazard, control and SOP reference checklist', fieldType: 'hazard_table', required: true,
    // The worker form shows a "describe the task" box on this field and fills
    // these fields from the AI's answer (src/documentEngine/HazardAssist.jsx).
    config: { aiAssist: { taskField: 'task_summary', alertsField: 'sop_alerts', ppeField: 'ppe', notesField: 'notes', flagField: 'ai_assisted' } },
  },
  { fieldKey: 'sop_alerts', label: 'SOP alerts triggered', fieldType: 'text_list' },
  { fieldKey: 'ppe', label: 'Required PPE', fieldType: 'ppe_list' },
  { fieldKey: 'notes', label: 'Additional notes', fieldType: 'long_text' },
  // Set by the AI assist; lets a supervisor see which FLHAs were written without it.
  { fieldKey: 'ai_assisted', label: 'Written with AI assistance', fieldType: 'yesno', config: { hidden: true } },
  { fieldKey: 'crew', label: 'Additional crew sign-off', fieldType: 'crew_signatures' },
];

export const FLHA_RULES = [
  { ruleType: 'signature_step', config: { signer: 'worker' } },
  {
    ruleType: 'reviewer_step',
    config: {
      label: 'Supervisor approval: extreme-risk sign-off', role: 'supervisor', allowLeads: true,
      onlyIf: { field: 'hazards', riskIn: ['Extreme'] },
    },
  },
  // Tell the people the scope rules place the record with (the FLHA's audience today).
  { ruleType: 'notify', config: {} },
];

// Box for box what src/generatePDF.js draws, in the order it draws it.
export const FLHA_LAYOUT = {
  version: 1,
  page: { size: 'A4', margin: 16, footer: true },
  blocks: [
    { id: 'header', type: 'header', title: 'Job Hazard Analysis (JHA)', subtitle: 'Field Level Hazard Assessment', showDate: 'datetime', showLogo: true },
    {
      id: 'info', type: 'info_box', items: [
        { label: 'COMPANY', value: '{{company.name}}', x: 4 },
        { label: 'WORKER', value: '{{record.author}}', x: 70 },
        { label: 'JOB SITE', value: '{{record.site}}', x: 130 },
      ],
    },
    { id: 'pending', type: 'banner', text: 'PENDING SUPERVISOR APPROVAL: EXTREME RISK', subtext: 'Work must not begin until a supervisor has signed off below.', tone: 'danger', showIf: { status: ['pending_approval'] } },
    { id: 'summary', type: 'text', heading: 'TASK SUMMARY', headingStyle: 'pill', field: 'task_summary' },
    { id: 'alerts', type: 'callout', heading: 'SOP alerts triggered', field: 'sop_alerts', tone: 'warning' },
    {
      id: 'hazards', type: 'table', title: 'Hazard / Control / SOP Reference Checklist', field: 'hazards', measureBold: true, groupBy: 'task', groupLabel: 'TASK',
      columns: [
        { key: 'n', header: '#', width: 8, type: 'index' },
        { key: 'hazard', header: 'HAZARD', width: 46, style: 'bold' },
        { key: 'control', header: 'CONTROL MEASURE', width: 56 },
        { key: 'sopRef', header: 'SOP REF', width: 40, style: 'italic', emptyText: 'N/A' },
        { key: 'risk', header: 'RISK', width: 28, type: 'badge' },
      ],
    },
    { id: 'ppe', type: 'chips', heading: 'Required PPE', field: 'ppe' },
    { id: 'notes', type: 'text', heading: 'ADDITIONAL NOTES', headingStyle: 'pill', field: 'notes' },
    { id: 'sign', type: 'signature', heading: 'Worker Signature' },
    { id: 'crew', type: 'signature_grid', heading: 'Additional Crew Sign-Off ({{count}})' },
    { id: 'approval', type: 'approvals', heading: 'Supervisor Approval: Extreme-Risk Sign-Off' },
  ],
};

export const FLHA_TEMPLATE = {
  key: 'flha', title: 'FLHA', icon: null, category: 'safety',
  fields: FLHA_FIELDS, rules: FLHA_RULES, layout: FLHA_LAYOUT,
};

/**
 * Creates and publishes the FLHA template if it does not exist yet. Safe to
 * run twice: an existing template is left alone and reported. Returns
 * { created, definitionId }.
 */
export async function seedFlhaTemplate(db) {
  const { data, error } = await db.from('document_definitions').select('id').is('company_id', null).eq('key', FLHA_TEMPLATE.key);
  if (error) throw new Error(`Could not check for the FLHA template: ${error.message}`);
  if (data && data.length > 0) return { created: false, definitionId: data[0].id };
  const { definition } = await createDefinition(db, { companyId: null, title: FLHA_TEMPLATE.title, icon: FLHA_TEMPLATE.icon, category: FLHA_TEMPLATE.category, key: FLHA_TEMPLATE.key });
  await saveDraft(db, { companyId: null, definitionId: definition.id, title: FLHA_TEMPLATE.title, fields: FLHA_TEMPLATE.fields, rules: FLHA_TEMPLATE.rules, layout: FLHA_TEMPLATE.layout });
  await publishDraft(db, { companyId: null, definitionId: definition.id });
  return { created: true, definitionId: definition.id };
}
