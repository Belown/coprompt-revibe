// One change counter for the whole app. Library modules mutate shared state and call emit();
// React re-renders through useSyncExternalStore (see useStore in App.jsx).
let version = 0;
const subs = new Set();
export const subscribe = f => { subs.add(f); return () => subs.delete(f); };
export const getVersion = () => version;
export function emit() { version++; subs.forEach(f => f()); }
