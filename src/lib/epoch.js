// "Is this still the profile it started in?" The budget store runs one job at
// a time, and the code that awaits a job carries on before the next job (a
// close asked for meanwhile) has run. So once a profile is closed, an open,
// an unlock or a restore that was already on its way still comes back as if
// nothing had happened, and store.session() still says so. The app counts its
// closes instead: anything that awaits the store and then shows a budget
// takes a check before the await, and does nothing once a close came between.
export function createEpoch() {
  let n = 0;
  return {
    // A close: everything checked before it is stale. Resolves to the new count.
    bump: () => (n += 1),
    // A check to keep across an await: true while no close came since.
    check: () => {
      const at = n;
      return () => n === at;
    },
  };
}
