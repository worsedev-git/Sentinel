const { createCanvas } = require("canvas");
const GIFEncoder = require("gifencoder");
const axios = require("axios");
const FormData = require("form-data");

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

function getColor(score) {
	if (score >= 85) return { r: 220, g: 40,  b: 40  };
	if (score >= 60) return { r: 220, g: 120, b: 20  };
	if (score >= 30) return { r: 200, g: 180, b: 20  };
	return              { r: 40,  g: 180, b: 80  };
}

function getLikelihood(score) {
	if (score >= 85) return "HIGHLY LIKELY";
	if (score >= 60) return "LIKELY";
	if (score >= 30) return "SUSPICIOUS";
	return "UNLIKELY";
}

function hexColor({ r, g, b }) {
	return `rgb(${r},${g},${b})`;
}

function drawFrame(ctx, W, H, score, animScore, color) {
	ctx.clearRect(0, 0, W, H);
	ctx.fillStyle = "#16161a";
	ctx.fillRect(0, 0, W, H);

	const cx = W / 2;
	const cy = H / 2 - 10;
	const radius = 90;
	const lineW  = 12;

	ctx.strokeStyle = "#2a2a32";
	ctx.lineWidth   = lineW;
	ctx.beginPath();
	ctx.arc(cx, cy, radius, 0, Math.PI * 2);
	ctx.stroke();

	const startAngle = -Math.PI / 2;
	const endAngle   = startAngle + (Math.PI * 2 * (animScore / 100));

	const grad = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
	grad.addColorStop(0, hexColor(color));
	grad.addColorStop(1, `rgb(${Math.min(color.r + 60, 255)},${Math.min(color.g + 60, 255)},${Math.min(color.b + 60, 255)})`);

	ctx.strokeStyle = grad;
	ctx.lineWidth   = lineW;
	ctx.lineCap     = "round";
	ctx.beginPath();
	ctx.arc(cx, cy, radius, startAngle, endAngle);
	ctx.stroke();

	ctx.fillStyle    = hexColor(color);
	ctx.font         = "bold 48px sans-serif";
	ctx.textAlign    = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(Math.round(animScore) + "%", cx, cy);

	ctx.fillStyle    = "#aaaabb";
	ctx.font         = "14px sans-serif";
	ctx.textAlign    = "center";
	ctx.textBaseline = "middle";
	ctx.fillText("SUSPICION SCORE", cx, cy + 56);

	ctx.fillStyle = hexColor(color);
	ctx.font      = "bold 16px sans-serif";
	ctx.fillText(getLikelihood(score), cx, cy + 80);

	const divY = H / 2 + 100;
	ctx.strokeStyle = "#2a2a32";
	ctx.lineWidth   = 1;
	ctx.beginPath();
	ctx.moveTo(20, divY);
	ctx.lineTo(W - 20, divY);
	ctx.stroke();
}

function drawStats(ctx, W, H, data) {
	const divY   = H / 2 + 100;
	const startY = divY + 20;
	const col1   = 30;
	const col2   = W / 2 + 10;
	const lineH  = 28;

	const stats = [
		["Username",    data.username],
		["Account Age", data.accountAge],
		["Session",     data.sessionTime],
		["Reports",     String(data.reportCount)],
	];

	stats.forEach(([label, value], i) => {
		const x = i % 2 === 0 ? col1 : col2;
		const y = startY + Math.floor(i / 2) * lineH;

		ctx.fillStyle    = "#666677";
		ctx.font         = "11px sans-serif";
		ctx.textAlign    = "left";
		ctx.textBaseline = "top";
		ctx.fillText(label.toUpperCase(), x, y);

		ctx.fillStyle = "#ddddee";
		ctx.font      = "bold 13px sans-serif";
		ctx.fillText(value, x, y + 13);
	});

	const violY = startY + 2 * lineH + 10;
	ctx.fillStyle = "#666677";
	ctx.font      = "11px sans-serif";
	ctx.fillText("VIOLATIONS", col1, violY);

	ctx.fillStyle = "#ddddee";
	ctx.font      = "12px sans-serif";
	const lines   = (data.violations || "None this session").split("\n").slice(0, 3);
	lines.forEach((line, i) => {
		ctx.fillText(line, col1, violY + 14 + i * 16);
	});

	ctx.fillStyle    = "#444450";
	ctx.font         = "10px sans-serif";
	ctx.textAlign    = "center";
	ctx.fillText("Sentinel Security  •  Statistical Anti-Cheat", W / 2, H - 14);
}

function generateGIF(data) {
	return new Promise((resolve, reject) => {
		const W = 360;
		const H = 420;

		const encoder = new GIFEncoder(W, H);
		const chunks  = [];

		encoder.createReadStream().on("data",  chunk => chunks.push(chunk));
		encoder.createReadStream().on("end",   ()    => resolve(Buffer.concat(chunks)));
		encoder.createReadStream().on("error", reject);

		encoder.start();
		encoder.setRepeat(0);
		encoder.setDelay(16);
		encoder.setQuality(5);

		const canvas = createCanvas(W, H);
		const ctx    = canvas.getContext("2d");
		const color  = getColor(data.score);

		const totalFrames = 50;
		for (let f = 0; f <= totalFrames; f++) {
			const animScore = data.score * (f / totalFrames);
			drawFrame(ctx, W, H, data.score, animScore, color);
			if (f === totalFrames) drawStats(ctx, W, H, data);
			encoder.addFrame(ctx);
		}

		for (let f = 0; f < 30; f++) {
			drawFrame(ctx, W, H, data.score, data.score, color);
			drawStats(ctx, W, H, data);
			encoder.addFrame(ctx);
		}

		encoder.finish();
	});
}

async function sendToDiscord(gifBuffer, data) {
	const color      = getColor(data.score);
	const likelihood = getLikelihood(data.score);
	const colorHex   = (color.r << 16) | (color.g << 8) | color.b;

	const form    = new FormData();
	const payload = {
		embeds: [{
			title:       `[SUSPICION REPORT] ${data.username}`,
			description: `Cheater Likelihood: **${likelihood}**`,
			color:       colorHex,
			fields: [
				{ name: "Score Breakdown", value: data.breakdown || "No signals",   inline: false },
				{ name: "Profile",         value: `https://www.roblox.com/users/${data.userId}/profile`, inline: false },
			],
			image:     { url: "attachment://report.gif" },
			footer:    { text: "Sentinel Security  •  Statistical Anti-Cheat" },
			timestamp: new Date().toISOString(),
		}],
	};

	form.append("payload_json", JSON.stringify(payload));
	form.append("file", gifBuffer, { filename: "report.gif", contentType: "image/gif" });

	await axios.post(WEBHOOK_URL, form, { headers: form.getHeaders() });
}

module.exports = async function handler(req, res) {
	if (req.method !== "POST") {
		return res.status(405).json({ error: "Method not allowed" });
	}

	const data = req.body;

	if (!data || typeof data.score !== "number" || !data.username) {
		return res.status(400).json({ error: "Invalid payload" });
	}

	if (!WEBHOOK_URL) {
		return res.status(500).json({ error: "Webhook not configured" });
	}

	try {
		const gif = await generateGIF(data);
		await sendToDiscord(gif, data);
		return res.status(200).json({ success: true });
	} catch (err) {
		console.error("[Sentinel] GIF generation failed:", err);
		return res.status(500).json({ error: err.message });
	}
};
