<script lang="ts">
	import { onMount } from 'svelte';

	// ── Types ─────────────────────────────────────────────────────────────────

	type SensorType = 'temperature' | 'salinity' | 'ph' | 'co2' | 'flow';

	interface SensorReading {
		tankId: string;
		sensorType: SensorType;
		value: number;
		unit: string;
		timestamp: string;
	}

	// One entry per tank — holds the latest reading for each sensor type
	interface TankReadings {
		tankId: string;
		sensors: Partial<Record<SensorType, SensorReading>>;
	}

	// ── Sensor feeds to subscribe to ──────────────────────────────────────────
	// Add / remove entries here to add / remove sensors.
	// The UI groups them by tankId automatically.

	const SENSOR_FEEDS: { tankId: string; sensorType: SensorType }[] = [
		{ tankId: 'tank-1', sensorType: 'temperature' },
		{ tankId: 'tank-1', sensorType: 'salinity' },
		{ tankId: 'tank-1', sensorType: 'ph' },
		{ tankId: 'tank-1', sensorType: 'co2' },
		{ tankId: 'tank-2', sensorType: 'temperature' },
		{ tankId: 'tank-2', sensorType: 'salinity' },
		{ tankId: 'tank-2', sensorType: 'co2' },
		{ tankId: 'tank-3', sensorType: 'temperature' },
		{ tankId: 'tank-3', sensorType: 'ph' }
	];

	// ── State ──────────────────────────────────────────────────────────────────
	// Flat map of "tankId|sensorType" → latest reading
	let readings = $state<Record<string, SensorReading>>({});

	// ── Derived: group readings by tank ───────────────────────────────────────
	// One TankReadings object per unique tankId — drives the one-card-per-tank UI
	const tankCards = $derived((): TankReadings[] => {
		const map: Record<string, TankReadings> = {};

		for (const feed of SENSOR_FEEDS) {
			if (!map[feed.tankId]) {
				map[feed.tankId] = { tankId: feed.tankId, sensors: {} };
			}
		}

		for (const [key, reading] of Object.entries(readings)) {
			const [tankId] = key.split('|');
			if (map[tankId]) {
				map[tankId].sensors[reading.sensorType] = reading;
			}
		}

		return Object.values(map);
	});

	// ── Helpers ───────────────────────────────────────────────────────────────

	const SENSOR_LABELS: Record<SensorType, string> = {
		temperature: 'Temperature',
		salinity: 'Salinity',
		ph: 'pH',
		co2: 'CO₂',
		flow: 'Flow'
	};

	function fmtTime(iso: string): string {
		return new Date(iso).toLocaleTimeString();
	}

	// Which sensor types appear in a given tank card (preserves display order)
	const SENSOR_ORDER: SensorType[] = ['temperature', 'salinity', 'ph', 'co2', 'flow'];

	function sensorsForTank(tank: TankReadings): SensorType[] {
		return SENSOR_ORDER.filter((t) =>
			SENSOR_FEEDS.some((f) => f.tankId === tank.tankId && f.sensorType === t)
		);
	}

	// ── Connect to SSE streams ────────────────────────────────────────────────

	onMount(() => {
		const sources: EventSource[] = [];

		for (const feed of SENSOR_FEEDS) {
			const url = `/api/sensors/${feed.tankId}/${feed.sensorType}`;
			const key = `${feed.tankId}|${feed.sensorType}`;
			const source = new EventSource(url);

			source.onmessage = (event) => {
				try {
					const payload = JSON.parse(event.data) as SensorReading;
					readings = { ...readings, [key]: payload };
				} catch (err) {
					console.error(`Parse error on ${url}:`, err);
				}
			};

			source.onerror = (err) => {
				console.error(`Stream error on ${url}:`, err);
			};

			sources.push(source);
		}

		return () => sources.forEach((s) => s.close());
	});
</script>

<main>
	<h1>🐟 Live Tank Monitor</h1>
	<p class="subtitle">
		{tankCards().length} tank{tankCards().length !== 1 ? 's' : ''} · {SENSOR_FEEDS.length} sensor feeds
	</p>

	<div class="tank-grid">
		{#each tankCards() as tank (tank.tankId)}
			{@const latestReading = Object.values(tank.sensors).filter(Boolean).at(-1)}
			<div class="tank-card">
				<!-- Tank header -->
				<div class="tank-header">
					<span class="tank-name">{tank.tankId.replace('-', ' ').toUpperCase()}</span>
					<span class="live-dot" title="Live"></span>
				</div>

				<!-- One row per sensor type configured for this tank -->
				<dl class="sensor-rows">
					{#each sensorsForTank(tank) as sensorType (sensorType)}
						{@const reading = tank.sensors[sensorType]}
						<div class="sensor-row" class:waiting={!reading}>
							<dt class="sensor-label">
								{SENSOR_LABELS[sensorType]}
							</dt>
							<dd class="sensor-value">
								{#if reading}
									<span class="num">{reading.value}</span>
									<span class="unit">{reading.unit}</span>
								{:else}
									<span class="num dim">—</span>
								{/if}
							</dd>
						</div>
					{/each}
				</dl>

				<!-- Last update time — taken from the most recent reading -->
				{#if latestReading}
					<p class="updated">Updated {fmtTime(latestReading.timestamp)}</p>
				{:else}
					<p class="updated dim">Connecting…</p>
				{/if}
			</div>
		{/each}
	</div>
</main>

<style>
	main {
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
		max-width: 960px;
		margin: 2rem auto;
		padding: 0 1.25rem;
	}

	h1 {
		font-size: 1.5rem;
		margin-bottom: 0.2rem;
	}
	.subtitle {
		color: #6b7280;
		font-size: 0.85rem;
		margin-bottom: 1.75rem;
	}

	/* ── Tank grid ─────────────────────────────────────────────────────────── */
	.tank-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 1.25rem;
	}

	/* ── Tank card ─────────────────────────────────────────────────────────── */
	.tank-card {
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 1.25rem 1.25rem 1rem;
	}

	/* ── Card header ───────────────────────────────────────────────────────── */
	.tank-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
		padding-bottom: 0.65rem;
		border-bottom: 1px solid #e5e7eb;
	}

	.tank-name {
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: #111827;
	}

	/* Pulsing green dot */
	.live-dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: #10b981;
		animation: pulse 2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
		}
		50% {
			box-shadow: 0 0 0 6px rgba(16, 185, 129, 0.05);
		}
	}

	/* ── Sensor rows ───────────────────────────────────────────────────────── */
	.sensor-rows {
		display: flex;
		flex-direction: column;
		gap: 0;
		margin: 0 0 0.75rem;
	}

	.sensor-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		padding: 0.38rem 0;
		border-bottom: 1px solid #f3f4f6;
	}

	.sensor-row:last-child {
		border-bottom: none;
	}

	.sensor-label {
		font-size: 0.8rem;
		color: #6b7280;
		font-weight: 500;
	}

	.sensor-value {
		display: flex;
		align-items: baseline;
		gap: 0.2rem;
		margin: 0;
	}

	.num {
		font-family: 'Menlo', 'JetBrains Mono', monospace;
		font-size: 1.05rem;
		font-weight: 700;
		color: #111827;
	}

	.unit {
		font-size: 0.72rem;
		color: #9ca3af;
		font-weight: 400;
	}

	.dim {
		color: #d1d5db;
	}

	/* ── Updated timestamp ─────────────────────────────────────────────────── */
	.updated {
		font-size: 0.7rem;
		color: #9ca3af;
		margin: 0.5rem 0 0;
		text-align: right;
	}
</style>
