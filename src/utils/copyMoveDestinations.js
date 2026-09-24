// A section can't be moved into the notebook it already lives in; copying there is fine.
// Keyed off the section, not the open notebook — they differ once a move navigates away.
export function getDestinationNotebooks(notebooks, action, section) {
  if (action === 'copy') return notebooks
  return notebooks.filter((nb) => nb.id !== section?.notebook_id)
}
