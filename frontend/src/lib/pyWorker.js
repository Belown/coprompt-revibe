// Pyodide runs in a Web Worker (as in the paper, §6.3) so the page never freezes.
// This function is the worker's whole source: python.js starts it from a Blob, as a classic worker,
// because a worker loaded from its own URL could not importScripts the Pyodide CDN in our tests (Edge).
export function pyWorkerMain() {
  const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
  self.importScripts(PYODIDE + 'pyodide.js');
  let ready;
  self.onmessage = async ({ data }) => {
    if (data.init) {
      ready = (async () => {
        const py = await self.loadPyodide({ indexURL: PYODIDE });
        self.postMessage({ stat: 'Python: loading packages…' });
        await py.loadPackage(['pandas', 'matplotlib', 'scipy', 'scikit-learn', 'micropip']);
        try { await py.pyimport('micropip').install('seaborn'); } catch { /* optional */ }
        py.FS.mkdirTree('/home/pyodide/data');
        py.FS.writeFile('/home/pyodide/data/titanic.csv', await (await fetch(data.csvUrl)).text());
        py.runPython("import matplotlib; matplotlib.use('Agg')");
        self.postMessage({ stat: 'Python: ready' });
        return py;
      })();
      ready.catch(e => self.postMessage({ stat: 'Python failed: ' + e.message }));
      return;
    }
    try {
      const py = await ready; // runPython is synchronous, so queued runs never interleave
      py.globals.set('_cells', py.toPy(data.cells));
      self.postMessage({ id: data.id, res: JSON.parse(py.runPython(data.runner)) });
    } catch (e) { self.postMessage({ id: data.id, err: e.message }); }
  };
}
