import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';


// https://vite.dev/config/

const env = loadEnv('development', process.cwd(), '');
const skipViewerDependencyOptimization =
	env.BODYMAPS_SKIP_VIEWER_DEP_OPTIMIZATION === 'true';

const viewerCodecDependencies = [
	"dicom-parser",
	"jpeg-lossless-decoder-js",
	"@cornerstonejs/codec-charls/decodewasmjs",
	"@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs",
	"@cornerstonejs/codec-openjpeg/decodewasmjs",
	"@cornerstonejs/codec-openjph/wasmjs",
];

// React Router's source imports these CommonJS helpers. Pre-bundle only those
// helpers in the lightweight mode so their named imports work in the browser,
// without traversing the CT viewer codec tree.
const lightweightDependencies = [
	"react",
	"react/jsx-dev-runtime",
	"react-dom/client",
	"cookie",
	"set-cookie-parser",
	"jszip",
	"pako",
];

export default defineConfig({
	plugins: [react(), tailwindcss(), wasm(), topLevelAwait()],
	resolve: {
		extensions: ['.js', '.jsx', '.ts', '.tsx', '.json', '.wasm'], // add .wasm
	},
	optimizeDeps: {
		// In lightweight local mode, avoid Vite's full dependency discovery too.
		// That scan can otherwise reach the CT viewer's optional codec tree even
		// when the dashboard is the only route being opened.
		noDiscovery: skipViewerDependencyOptimization,
		// @cornerstonejs/dicom-image-loader ships its pixel-decode WORKERS as separate
		// entry files (decodeImageFrameWorker.js?worker_file). If the dep optimizer
		// pre-bundles the loader it mangles those worker references ("file does not
		// exist … in the optimize deps directory"), the decode worker never runs, and
		// every DICOM slice decodes to zeros → black viewport. Exclude the loader so
		// its workers are served from source and Vite's worker pipeline handles them.
		exclude: ["@cornerstonejs/dicom-image-loader"],
		// With the loader excluded, its decode worker imports the codecs from source.
		// The worker STATICALLY imports every codec at load time, so if any one fails
		// the whole worker dies (no slice decodes). Those codecs are CommonJS emscripten
		// glue (`module.exports = …`); served raw they "provide no default export".
		// Pre-bundling each gives it the CJS→ESM default-export interop. Plus the bare
		// `import('jpeg-lossless-decoder-js')` for JPEG-Lossless (TS .4.70) scans.
		// dicom-parser is UMD/CJS: served raw its UMD footer runs `root["zlib"]` with
		// `root = this` = undefined at ESM top level → "Cannot read properties of
		// undefined (reading 'zlib')". This exclude+include pair matches the official
		// Cornerstone3D Vite guidance. (comlink is real ESM, chai is test-only — safe.)
		// Some memory-constrained local computers cannot pre-bundle the full
		// viewer codec stack. This opt-in switch keeps lightweight pages, such
		// as the dashboard, usable while deliberately leaving viewer testing for
		// a machine with sufficient memory. Production never sets this flag.
		include: skipViewerDependencyOptimization
			? lightweightDependencies
			: viewerCodecDependencies,
	},
	build: {
		target: "esnext",
	},
	// The DICOM image loader's decode workers use dynamic imports; the default
	// "iife" worker format can't code-split, so build workers as ES modules.
	worker: {
		format: "es",
	},
	assetsInclude: ['**/*.wasm'],
	server: {
		// https: {
		// 	key: fs.readFileSync(path.resolve(__dirname, '../certs/localhost-key.pem')),
		// 	cert: fs.readFileSync(path.resolve(__dirname, '../certs/localhost-cert.pem')),
		// },
		// headers: {
		// 	'Cross-Origin-Opener-Policy': 'same-origin',
		// 	'Cross-Origin-Embedder-Policy': 'require-corp',
		// },
		cors: true,
		proxy: {
			"/api": {
				target: env.VITE_API_BASE,
				changeOrigin: true,
				secure: false,
			},
			"/ws": {
				target: env.VITE_WS_BASE || "ws://127.0.0.1:8001",
				ws: true,
				changeOrigin: true,
			},
		},
	},
});
