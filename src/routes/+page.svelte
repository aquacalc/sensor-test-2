<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	type SensorType = 'temperature' | 'salinity' | 'ph' | 'co2';

	interface SensorReading {
		tankId: string;
		sensorType: SensorType;
		value: number;
		unit: string;
		timestamp: string;
	}

	// Available tanks to switch between via radio buttons
	const TANKS = ['tank-1', 'tank-2', 'tank-3'];

	// All sensors we want to display for the active tank
	const SENSOR_ORDER: SensorType[] = ['temperature', 'salinity', 'ph', 'co2'];

	const SENSOR_LABELS: Record<SensorType, string> = {
		temperature: 'Temperature',
		salinity: 'Salinity',
		ph: 'pH',
		co2: 'CO₂'
	};

	// Active selected tank state controlled by the radio buttons
	let selectedTank = $state('tank-1');

	// Flat map of "tankId|sensorType" → latest reading
	let readings = $state<Record<string, SensorReading>>({});

	function getLatestReadingForTank(tankId: string): SensorReading | undefined {
		return Object.values(readings)
			.filter((reading): reading is SensorReading => Boolean(reading) && reading.tankId === tankId)
			.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
	}

	const viewTankIds = $derived(selectedTank === 'all' ? TANKS : [selectedTank]);

	let sources: EventSource[] = [];

	function fmtTime(iso: string): string {
		return new Date(iso).toLocaleTimeString();
	}

	// Close existing connections and open a single stream per selected tank
	function switchTankStreams(tankIds: string[]) {
		// Tear down any active SSE connections from the previous selection
		sources.forEach((s) => s.close());
		sources = [];
		readings = {}; // Clear previous readings view

		for (const tankId of tankIds) {
			const url = `/api/sensors/${tankId}/all`;
			const source = new EventSource(url);

			source.onmessage = (event) => {
				try {
					const payload = JSON.parse(event.data) as SensorReading;
					const key = `${payload.tankId}|${payload.sensorType}`;
					if (SENSOR_ORDER.includes(payload.sensorType)) {
						readings = { ...readings, [key]: payload };
					}
				} catch (err) {
					console.error(`Parse error on ${url}:`, err);
				}
			};

			source.onerror = (err) => {
				console.error(`Stream error on ${url}:`, err);
			};

			sources.push(source);
		}
	}

	// Automatically re-bind streams whenever `selectedTank` changes
	$effect(() => {
		const activeTankIds = selectedTank === 'all' ? TANKS : [selectedTank];
		switchTankStreams(activeTankIds);
	});

	onDestroy(() => {
		sources.forEach((s) => s.close());
	});
</script>

<main class="text-center">
	<h1>🐟 Live Tank Monitor Mock Up</h1>
	<p class="subtitle">Select a tank data stream below</p>

	<div class="radio-group flex flex-wrap justify-center gap-4">
		<label class="radio-label" class:active={selectedTank === 'all'}>
			<input type="radio" name="tankSelector" value="all" bind:group={selectedTank} />
			ALL
		</label>
		{#each TANKS as tankId (tankId)}
			<label class="radio-label" class:active={selectedTank === tankId}>
				<input type="radio" name="tankSelector" value={tankId} bind:group={selectedTank} />
				{tankId.replace('-', ' ').toUpperCase()}
			</label>
		{/each}
	</div>

	<div class="tank-grid flex flex-wrap justify-center gap-4">
		{#each viewTankIds as tankId (tankId)}
			{@const tankLatestReading = getLatestReadingForTank(tankId)}
			<div class="tank-card">
				<div class="tank-header">
					<span class="tank-name">{tankId.replace('-', ' ').toUpperCase()}</span>
					<span class="live-dot" title="Live"></span>
				</div>

				<dl class="sensor-rows">
					{#each SENSOR_ORDER as sensorType (sensorType)}
						{@const key = `${tankId}|${sensorType}`}
						{@const reading = readings[key]}
						<div class="sensor-row" class:waiting={!reading}>
							<dt class="sensor-label">
								{SENSOR_LABELS[sensorType]}
							</dt>
							<dd class="sensor-value">
								{#if reading}
									<span class="num">{reading.value.toFixed(2)}</span>
									<span class="unit">{reading.unit}</span>
								{:else}
									<span class="num dim">—</span>
								{/if}
							</dd>
						</div>
					{/each}
				</dl>

				{#if tankLatestReading}
					<p class="updated">Updated {fmtTime(tankLatestReading.timestamp)}</p>
				{:else}
					<p class="updated dim">Connecting…</p>
				{/if}
			</div>
		{/each}
	</div>
</main>

<style>
	:global(body) {
		margin: 0;
		min-height: 100vh;
		background: linear-gradient(180deg, #eef8ff 0%, #dceeff 55%, #cfe6ff 100%);
	}

	main {
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
		max-width: 960px;
		margin: 0 auto;
		min-height: 100vh;
		padding: 2rem 1.25rem 3rem;
		box-sizing: border-box;
	}

	h1 {
		font-size: 1.5rem;
		margin-bottom: 0.2rem;
	}
	.subtitle {
		color: #6b7280;
		font-size: 0.85rem;
		margin-bottom: 1.25rem;
	}

	/* ── Radio Group Styling ──────────────────────────────────────────────── */
	.radio-group {
		display: flex;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.radio-label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 1rem;
		background: #f3f4f6;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		cursor: pointer;
		font-weight: 600;
		font-size: 0.85rem;
		color: #374151;
		transition: all 0.2s;
	}

	.radio-label.active {
		background: #eef2ff;
		border-color: #6366f1;
		color: #4f46e5;
	}

	/* ── Tank card ─────────────────────────────────────────────────────────── */
	.tank-card {
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 1.25rem 1.25rem 1rem;
		width: 210px;
	}

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

	.updated {
		font-size: 0.7rem;
		color: #9ca3af;
		margin: 0.5rem 0 0;
		text-align: right;
	}
</style>
