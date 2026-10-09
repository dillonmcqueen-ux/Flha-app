// The FLHA expressed as an engine layout, plus sample data equal to the WP0
// baseline capture. Used by the renderer tests and the golden comparison.
export const FLHA_LAYOUT = {
  version: 1,
  page: { size: 'A4', margin: 16, footer: true },
  blocks: [
    { id: 'header', type: 'header', title: 'Job Hazard Analysis (JHA)', subtitle: 'Field Level Hazard Assessment', showDate: 'datetime', showLogo: true },
    { id: 'info', type: 'info_box', items: [
      { label: 'COMPANY', value: '{{company.name}}', x: 4 },
      { label: 'WORKER', value: '{{record.author}}', x: 70 },
      { label: 'JOB SITE', value: '{{record.site}}', x: 130 },
    ] },
    { id: 'pending', type: 'banner', text: 'PENDING SUPERVISOR APPROVAL: EXTREME RISK', subtext: 'Work must not begin until a supervisor has signed off below.', tone: 'danger', showIf: { status: ['pending_approval'] } },
    { id: 'summary', type: 'text', heading: 'TASK SUMMARY', headingStyle: 'pill', field: 'task_summary' },
    { id: 'hazards', type: 'table', title: 'Hazard / Control / SOP Reference Checklist', field: 'hazards', measureBold: true, groupBy: 'task', groupLabel: 'TASK',
      columns: [
        { key: 'n', header: '#', width: 8, type: 'index' },
        { key: 'hazard', header: 'HAZARD', width: 46, style: 'bold' },
        { key: 'control', header: 'CONTROL MEASURE', width: 56 },
        { key: 'sopRef', header: 'SOP REF', width: 40, style: 'italic', emptyText: 'N/A' },
        { key: 'risk', header: 'RISK', width: 28, type: 'badge' },
      ] },
    { id: 'ppe', type: 'chips', heading: 'Required PPE', field: 'ppe' },
    { id: 'notes', type: 'text', heading: 'ADDITIONAL NOTES', headingStyle: 'pill', field: 'notes' },
    { id: 'sign', type: 'signature', heading: 'Worker Signature' },
    { id: 'crew', type: 'signature_grid', heading: 'Additional Crew Sign-Off ({{count}})' },
    { id: 'approval', type: 'approvals', heading: 'Supervisor Approval: Extreme-Risk Sign-Off' },
  ],
};

export const FLHA_FIELDS = [
  { field_key: 'task_summary', label: 'Task summary', field_type: 'long_text' },
  { field_key: 'hazards', label: 'Hazards', field_type: 'hazard_table' },
  { field_key: 'ppe', label: 'PPE', field_type: 'ppe_list' },
  { field_key: 'notes', label: 'Notes', field_type: 'long_text' },
];

const TASK = 'Worker will operate an excavator near an active roadway.';

export const FLHA_ANSWERS = {
  task_summary: TASK,
  hazards: [
    { task: TASK, hazard: 'Struck-by hazard from moving equipment', risk: 'High', control: 'Maintain a spotter and exclusion zone', sopRef: null },
    { task: TASK, hazard: 'Manual handling strain', risk: 'Medium', control: 'Use proper lifting technique', sopRef: null },
    { task: TASK, hazard: 'Fitness for duty', risk: 'Low', control: 'Confirm fitness for duty before starting, well-rested, not under the influence of drugs or alcohol, and free of any illness or medication that could affect safe performance of this task. Do not begin work if fatigued, ill, or impaired.', sopRef: null },
    { task: TASK, hazard: 'Muster point and emergency response plan awareness', risk: 'Low', control: "Confirm the site's muster/assembly point and emergency response plan with the supervisor before starting work, confirm 911/emergency services availability, and ensure a working communication method (two-way radio, cell phone, or land line) is on hand.", sopRef: null },
  ],
  ppe: ['Hard hat', 'Safety vest'],
  notes: '',
};
