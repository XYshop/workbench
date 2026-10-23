import { code128, drawingSVG, qrcode } from "@bwip-js/browser";
import { useContext, useMemo, useState } from "react";
import { ThemeContext } from "../../theme";
import "./barcode.css";

type BarcodeFormat = "qrcode" | "code128";

type BarcodeOptions = {
	bcid: BarcodeFormat;
	text: string;
	scale: number;
	padding: number;
	barcolor: string;
	backgroundcolor: string;
};

function renderSvg(format: BarcodeFormat, options: BarcodeOptions) {
	if (format === "qrcode") return qrcode(options, drawingSVG());
	return code128(
		{
			...options,
			height: 16,
			includetext: true,
			textxalign: "center",
			textcolor: options.barcolor,
		},
		drawingSVG(),
	);
}

function saveBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function createPng(svg: string, background: string) {
	const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
	const url = URL.createObjectURL(svgBlob);
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
		const width = Number(viewBox?.[1] ?? image.naturalWidth);
		const height = Number(viewBox?.[2] ?? image.naturalHeight);
		const scale = Math.max(1, Math.min(4, 1200 / Math.max(width, height)));
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(width * scale);
		canvas.height = Math.round(height * scale);
		const context = canvas.getContext("2d");
		if (!context) throw new Error("当前浏览器无法创建画布");
		context.fillStyle = background;
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((blob) => {
				if (blob) resolve(blob);
				else reject(new Error("PNG 导出失败"));
			}, "image/png");
		});
	} finally {
		URL.revokeObjectURL(url);
	}
}

export default function BarcodeTool() {
	const theme = useContext(ThemeContext);
	const [format, setFormat] = useState<BarcodeFormat>("qrcode");
	const [value, setValue] = useState("https://example.com");
	const [scale, setScale] = useState(3);
	const [padding, setPadding] = useState(8);
	const [foregroundOverride, setForegroundOverride] = useState<string | null>(null);
	const [backgroundOverride, setBackgroundOverride] = useState<string | null>(null);
	const foreground = foregroundOverride ?? (theme === "dark" ? "#E7EAF0" : "#111827");
	const background = backgroundOverride ?? (theme === "dark" ? "#151A23" : "#FFFFFF");
	const [exporting, setExporting] = useState(false);
	const [exportError, setExportError] = useState("");
	const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">("idle");

	const result = useMemo(() => {
		if (!value.trim()) return { svg: "", error: "请输入要编码的内容" };
		try {
			return {
				svg: renderSvg(format, {
					bcid: format,
					text: value,
					scale,
					padding,
					barcolor: foreground.slice(1),
					backgroundcolor: background.slice(1),
				}),
				error: "",
			};
		} catch (error) {
			return {
				svg: "",
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}, [format, value, scale, padding, foreground, background]);

	const downloadSvg = () => {
		if (!result.svg) return;
		saveBlob(
			new Blob([result.svg], { type: "image/svg+xml;charset=utf-8" }),
			`barcode-${format}.svg`,
		);
	};

	const downloadPng = async () => {
		if (!result.svg) return;
		setExporting(true);
		setExportError("");
		try {
			saveBlob(await createPng(result.svg, background), `barcode-${format}.png`);
		} catch (error) {
			setExportError(error instanceof Error ? error.message : String(error));
		} finally {
			setExporting(false);
		}
	};

	const copyValue = async () => {
		try {
			await navigator.clipboard.writeText(value);
			setCopyStatus("success");
		} catch {
			setCopyStatus("error");
		}
		window.setTimeout(() => setCopyStatus("idle"), 1600);
	};

	return (
		<div className="barcode-tool">
			<section className="barcode-editor panel">
				<div className="panel-head">
					<div className="panel-title"><h2>内容与样式</h2></div>
					<button className="ghost" type="button" onClick={() => setValue("https://example.com")}>
						加载示例
					</button>
				</div>

				<div className="barcode-form">
					<label className="barcode-field">
						<span className="barcode-field-heading">
							<span>编码内容</span>
							<button
								className={`text-action ${copyStatus}`}
								type="button"
								aria-live="polite"
								onClick={() => void copyValue()}
								disabled={!value}
							>
								{copyStatus === "success" ? "已复制" : copyStatus === "error" ? "复制失败" : "复制文本"}
							</button>
						</span>
						<textarea
							className="barcode-input"
							value={value}
							onChange={(event) => {
								setCopyStatus("idle");
								setValue(event.target.value);
							}}
							placeholder="输入网址、文本或编号…"
							spellCheck={false}
						/>
					</label>

					<fieldset className="barcode-format-field">
						<legend>码制</legend>
						<div className="barcode-format-options" role="radiogroup" aria-label="条码类型">
							<button
								className={`barcode-format-card ${format === "qrcode" ? "selected" : ""}`}
								type="button"
								role="radio"
								aria-checked={format === "qrcode"}
								onClick={() => setFormat("qrcode")}
							>
								<span className="format-symbol format-symbol-qr" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /></span>
								<span><strong>QR Code</strong><small>二维码 · 文本与链接</small></span>
							</button>
							<button
								className={`barcode-format-card ${format === "code128" ? "selected" : ""}`}
								type="button"
								role="radio"
								aria-checked={format === "code128"}
								onClick={() => setFormat("code128")}
							>
								<span className="format-symbol format-symbol-linear" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span>
								<span><strong>Code 128</strong><small>一维码 · 字母数字</small></span>
							</button>
						</div>
					</fieldset>

					<div className="barcode-settings">
						<label className="range-field">
							<span className="range-title"><span>清晰度</span><output>{scale}×</output></span>
							<input type="range" min="1" max="6" step="1" value={scale} onChange={(event) => setScale(Number(event.target.value))} />
							<small>控制条码模块的大小</small>
						</label>
						<label className="range-field">
							<span className="range-title"><span>留白</span><output>{padding}px</output></span>
							<input type="range" min="0" max="24" step="2" value={padding} onChange={(event) => setPadding(Number(event.target.value))} />
							<small>保留四周静区，便于扫描识别</small>
						</label>
					</div>

					<div className="barcode-colors">
						<label className="color-field">
							<span className="color-swatch" style={{ backgroundColor: foreground }}><input aria-label="条码颜色" type="color" value={foreground} onChange={(event) => setForegroundOverride(event.target.value)} /></span>
							<span><strong>前景色</strong><small>{foreground.toUpperCase()}</small></span>
						</label>
						<label className="color-field">
							<span className="color-swatch" style={{ backgroundColor: background }}><input aria-label="背景颜色" type="color" value={background} onChange={(event) => setBackgroundOverride(event.target.value)} /></span>
							<span><strong>背景色</strong><small>{background.toUpperCase()}</small></span>
						</label>
					</div>
				</div>
			</section>

			<section className="barcode-preview-panel panel">
				<div className="panel-head">
					<div className="panel-title"><h2>实时预览</h2></div>
					<span className="preview-live"><i /> 即时更新</span>
				</div>
				<div className="barcode-preview-content">
					<div className={`barcode-artboard ${format === "qrcode" ? "qr-artboard" : "linear-artboard"}`}>
						{result.svg ? (
							<img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`} alt={`${format === "qrcode" ? "二维码" : "Code 128 条形码"}：${value}`} />
						) : (
							<div className="barcode-empty"><span>▦</span><p>输入内容后显示预览</p></div>
						)}
					</div>
					{result.error && <p className="barcode-error" role="alert">{result.error}</p>}
					{exportError && <p className="barcode-error" role="alert">{exportError}</p>}
					<div className="barcode-preview-caption">
						<span className="format-badge">{format === "qrcode" ? "QR CODE" : "CODE 128"}</span>
						<span>{value.length} 个字符</span>
					</div>
				</div>
				<div className="barcode-export-bar">
					<div><strong>导出条码</strong><small>适用于网页、打印和设计稿</small></div>
					<div className="barcode-export-actions">
						<button className="ghost" type="button" onClick={downloadSvg} disabled={!result.svg}>下载 SVG</button>
						<button className="primary" type="button" onClick={() => void downloadPng()} disabled={!result.svg || exporting}>{exporting ? "生成中…" : "下载 PNG"}</button>
					</div>
				</div>
			</section>
		</div>
	);
}
