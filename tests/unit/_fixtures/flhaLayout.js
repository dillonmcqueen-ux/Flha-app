// The FLHA expressed as an engine layout, plus sample data equal to the WP0
// baseline capture. Used by the renderer tests and the golden comparison.
import { FLHA_LAYOUT as TEMPLATE_LAYOUT } from '../../../server-lib/documentEngine/templates/flha.js';

// The layout is the template's own, so the golden test checks what ships.
export const FLHA_LAYOUT = TEMPLATE_LAYOUT;

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
