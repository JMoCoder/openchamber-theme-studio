/** A bounded snapshot history; a drag is one undoable transaction. */
export function createHistory({ now = Date.now, max = 64, mergeMs = 360 } = {}) {
  const past = [], future = [];
  let last = null;
  function record(before, after, { key, label = key, phase } = {}) {
    const at = now();
    if (before !== after) {
      const merge = key && last?.key === key && (last.drag || (phase !== 'drag' && at - last.at < mergeMs));
      if (!merge) {
        past.push({ project: before, label });
        if (past.length > max) past.shift();
      }
      future.length = 0;
      last = { key, at, drag: phase === 'drag' };
    }
    if (phase === 'commit') last = null;
  }
  function move(from, to, current) {
    last = null;
    const entry = from.pop();
    if (!entry) return current;
    to.push({ project: current, label: entry.label });
    return entry.project;
  }
  return {
    record,
    undo: (current) => move(past, future, current),
    redo: (current) => move(future, past, current),
    state: () => ({ canUndo: past.length > 0, canRedo: future.length > 0, undoLabel: past.at(-1)?.label }),
    split: () => { last = null; },
  };
}
