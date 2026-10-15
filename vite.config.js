// base "./" = asset links relative to index.html, so the build works in any folder (GitHub Pages serves it under /end-effector-evolver/)
export default { base: "./", worker: { format: "es" }, optimizeDeps: { exclude: ["replicad-opencascadejs"] }, build: { target: "esnext" } };
