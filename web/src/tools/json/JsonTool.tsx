import type { ChangeEvent, DragEvent as ReactDragEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import init, { generate } from "../../wasm/json2obj_wasm.js";

type Stats = {
	samples: number;
	objects: number;
	fields: number;
	optionalFields: number;
	enums: number;
};

type Payload = {
	raw: string;
	typescript: string;
	zod: string;
	stats: Stats;
};

type OutputTab = "typescript" | "zod" | "raw";
const EXAMPLE = `{"id": 1001, "status": "paid", "total": 89.9, "currency": "USD", "items": [{"sku": "KB-01", "qty": 1}], "customer": {"id": 7, "name": "Ada"}, "created_at": "2026-03-01T10:00:00Z"}
{"id": 1002, "status": "pending", "total": 39, "currency": "USD", "items": [{"sku": "HUB-02", "qty": 2}, {"sku": "CBL-03", "qty": 1}], "customer": {"id": 8, "name": "Bob", "vip": true}, "created_at": "2026-03-02T08:30:00Z"}
{"id": 1003, "status": "paid", "total": 120.5, "currency": "EUR", "items": [], "customer": {"id": 7, "name": "Ada"}, "created_at": "2026-03-03T12:15:00Z", "refunded_at": null}
{"id": 1004, "status": "refunded", "total": 15, "currency": "USD", "items": [{"sku": "PAD-04", "qty": 1}], "customer": {"id": 9, "name": "Cara"}, "created_at": "2026-03-04T09:45:00Z", "refunded_at": "2026-03-05T10:00:00Z"}
{"id": 1005, "status": "pending", "total": 64.2, "currency": "EUR", "items": [{"sku": "KB-01", "qty": 2}], "customer": {"id": 8, "name": "Bob"}, "created_at": "2026-03-05T16:20:00Z"}
{"id": 1006, "status": "paid", "total": 210, "currency": "USD", "items": [{"sku": "MON-05", "qty": 1}], "customer": {"id": 7, "name": "Ada", "vip": true}, "created_at": "2026-03-06T11:05:00Z"}`;

const wasmReady = init();

function escapeHtml(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function highlight(code: string) {
	if (!code) return "";
	const pattern =
		/(\/\/[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:export|import|from|interface|type|const|string|number|boolean|null|unknown|Record)\b)/g;
	const out: string[] = [];
	let last = 0;
	for (const match of code.matchAll(pattern)) {
		const index = match.index ?? 0;
		const token = match[0];
		out.push(escapeHtml(code.slice(last, index)));
		const klass = token.startsWith("//")
			? "tok-comment"
			: token.startsWith('"') || token.startsWith("'")
				? "tok-string"
				: "tok-keyword";
		out.push(`<span class="${klass}">${escapeHtml(token)}</span>`);
		last = index + token.length;
	}
	out.push(escapeHtml(code.slice(last)));
	return out.join("");
}

export default function App() {
	const [input, setInput] = useState(EXAMPLE);
	const [rootName, setRootName] = useState("Order");
	const [detectEnums, setDetectEnums] = useState(true);
	const [activeTab, setActiveTab] = useState<OutputTab>("raw");
	const [typescript, setTypescript] = useState("");
	const [zod, setZod] = useState("");
	const [raw, setRaw] = useState("");
	const [stats, setStats] = useState<Stats | null>(null);
	const [elapsed, setElapsed] = useState(0);
	const [error, setError] = useState("");
	const [copied, setCopied] = useState(false);
	const [dragging, setDragging] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);
	const timer = useRef<number | undefined>(undefined);

	const activeCode =
		activeTab === "typescript" ? typescript : activeTab === "zod" ? zod : raw;
	const lineCount = activeCode ? activeCode.trimEnd().split("\n").length : 0;
	const highlighted = useMemo(() => highlight(activeCode), [activeCode]);
	const run = useCallback(async () => {
		if (!input.trim()) {
			setTypescript("");
			setZod("");
			setRaw("");
			setStats(null);
			setError("");
			return;
		}
		try {
			await wasmReady;
			const start = performance.now();
			const payload = JSON.parse(
				generate(input, rootName || "Root", detectEnums),
			) as Payload;
			setElapsed(performance.now() - start);
			setTypescript(payload.typescript);
			setZod(payload.zod);
			setRaw(payload.raw);
			setStats(payload.stats);
			setError("");
		} catch (err) {
			setError(String(err));
			setTypescript("");
			setZod("");
			setRaw("");
			setStats(null);
		}
	}, [input, rootName, detectEnums]);

	useEffect(() => {
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => void run(), 200);
		return () => window.clearTimeout(timer.current);
	}, [run]);

	useEffect(() => {
		const preventBrowserDrop = (event: globalThis.DragEvent) =>
			event.preventDefault();
		window.addEventListener("dragover", preventBrowserDrop);
		window.addEventListener("drop", preventBrowserDrop);
		return () => {
			window.removeEventListener("dragover", preventBrowserDrop);
			window.removeEventListener("drop", preventBrowserDrop);
		};
	}, []);

	const loadExample = () => {
		setInput(EXAMPLE);
		setRootName("Order");
	};

	const clearAll = () => {
		setInput("");
		setStats(null);
		setError("");
		setTypescript("");
		setZod("");
		setRaw("");
	};

	const readFiles = (files: File[]) => {
		const usable = files.filter((file) =>
			/\.(json|jsonl|txt)$/i.test(file.name),
		);
		if (!usable.length) return;
		void Promise.all(usable.map((file) => file.text())).then((parts) => {
			setInput(
				parts
					.map((part) => part.trim())
					.filter(Boolean)
					.join("\n"),
			);
		});
	};

	const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
		readFiles(Array.from(event.target.files ?? []));
		event.target.value = "";
	};

	const onDrop = (event: ReactDragEvent<HTMLElement>) => {
		event.preventDefault();
		setDragging(false);
		readFiles(Array.from(event.dataTransfer.files));
	};

	const copy = async () => {
		if (!activeCode) return;
		await navigator.clipboard.writeText(activeCode);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1600);
	};

	const download = () => {
		if (!activeCode) return;
		const base = (rootName || "Root").replace(/[^\w.-]+/g, "-");
		const suffix =
			activeTab === "typescript"
				? ".ts"
				: activeTab === "zod"
					? ".schema.ts"
					: ".json";
		const blob = new Blob([activeCode], { type: "text/plain;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `${base}${suffix}`;
		link.click();
		URL.revokeObjectURL(url);
	};

	return (
		<div className="json-tool min-h-0 flex flex-col">
			<main className="workspace flex-1 min-h-0 grid grid-cols-2 gap-[13px]">
				<section
					className={`panel input-panel relative ${dragging ? "dragging" : ""}`}
					onDragEnter={(event) => {
						event.preventDefault();
						setDragging(true);
					}}
					onDragOver={(event) => {
						event.preventDefault();
						setDragging(true);
					}}
					onDragLeave={(event) => {
						event.preventDefault();
						setDragging(false);
					}}
					onDrop={onDrop}
				>
					<div className="panel-head flex-none flex items-center justify-between gap-2">
						<div className="panel-title flex items-center gap-2">
							<h2>JSON 样本</h2>
							{stats && <span className="count">{stats.samples} 个样本</span>}
						</div>
						<div className="tools flex gap-1.5">
							<button className="ghost" type="button" onClick={loadExample}>
								示例
							</button>
							<button
								className="ghost"
								type="button"
								onClick={() => fileInput.current?.click()}
							>
								上传
							</button>
							<button className="ghost" type="button" onClick={clearAll}>
								清空
							</button>
						</div>
					</div>
					<textarea
						value={input}
						onChange={(event) => setInput(event.target.value)}
						spellCheck={false}
						autoComplete="off"
						aria-label="JSON 输入"
						placeholder="粘贴 JSON，或把 .json / .jsonl 文件拖进来…"
					/>
					<div className="options flex-none flex items-center gap-[18px] flex-wrap">
						<label className="field">
							<span>根类型名</span>
							<input
								value={rootName}
								onChange={(event) => setRootName(event.target.value)}
								className="text-input"
								spellCheck={false}
							/>
						</label>
						<label className="switch">
							<input
								checked={detectEnums}
								onChange={(event) => setDetectEnums(event.target.checked)}
								type="checkbox"
							/>
							<span className="track">
								<span className="thumb" />
							</span>
							<span className="switch-label">识别枚举</span>
						</label>
					</div>
					<p className="hint">
						支持一次粘贴多个 JSON 文档（换行分隔）或
						JSONL。字段只出现于部分样本时，会自动标记为可选。
					</p>
					<div className="drop-hint">松开以导入 JSON 文件</div>
				</section>

				<section className="panel output-panel">
					<div className="panel-head flex-none flex items-center justify-between gap-2">
						<div className="tabs flex" role="tablist">
							<button
								type="button"
								role="tab"
								aria-selected={activeTab === "raw"}
								className={activeTab === "raw" ? "active" : ""}
								onClick={() => setActiveTab("raw")}
							>
								JSON
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={activeTab === "typescript"}
								className={activeTab === "typescript" ? "active" : ""}
								onClick={() => setActiveTab("typescript")}
							>
								TypeScript
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={activeTab === "zod"}
								className={activeTab === "zod" ? "active" : ""}
								onClick={() => setActiveTab("zod")}
							>
								Zod
							</button>
						</div>
						<div className="tools flex gap-1.5">
							<button
								className="ghost"
								type="button"
								disabled={!activeCode}
								onClick={download}
							>
								下载
							</button>
							<button
								className="primary"
								type="button"
								disabled={!activeCode}
								onClick={() => void copy()}
							>
								{copied ? "已复制" : "复制"}
							</button>
						</div>
					</div>
					{error && <div className="error">{error}</div>}
					{stats && !error && (
						<div className="stats">
							<span>
								<strong>{stats.samples}</strong> 样本
							</span>
							<span>
								<strong>{stats.objects}</strong> 对象
							</span>
							<span>
								<strong>{stats.fields}</strong> 字段
							</span>
							<span>
								<strong>{stats.optionalFields}</strong> 可选
							</span>
							<span>
								<strong>{stats.enums}</strong> 枚举
							</span>
							<span className="time">{elapsed.toFixed(2)} ms</span>
						</div>
					)}
					<div className="code-wrap">
						{activeCode ? (
							<pre>
								<code dangerouslySetInnerHTML={{ __html: highlighted }} />
							</pre>
						) : (
							<div className="placeholder">
								<p>在左侧粘贴 JSON，这里会实时生成类型。</p>
							</div>
						)}
					</div>
					<footer className="panel-foot">
						<span>{lineCount} 行</span>
						<span>Rust + WebAssembly</span>
					</footer>
				</section>
			</main>

			<input
				ref={fileInput}
				type="file"
				accept=".json,.jsonl,.txt"
				multiple
				hidden
				onChange={onFileChange}
			/>
		</div>
	);
}
