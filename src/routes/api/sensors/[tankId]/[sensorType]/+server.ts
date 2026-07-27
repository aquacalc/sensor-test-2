import type { RequestHandler } from './$types';

// ── Types ─────────────────────────────────────────────────────────────────────

type SensorType = 'temperature' | 'salinity' | 'ph' | 'co2';
type RouteSensorType = SensorType | 'all';

interface SensorReading {
	tankId: string;
	sensorType: SensorType;
	timestamp: string;
	value: number;
	unit: string;
}

// ── Mock data config ──────────────────────────────────────────────────────────
// Replace with DB lookups in production.
// Shape: { [tankId]: { [sensorType]: { base, jitter, unit } } }

interface SensorSpec {
	base: number;
	jitter: number;
	unit: string;
}

const MOCK_CONFIG: Record<string, Partial<Record<SensorType, SensorSpec>>> = {
	'tank-1': {
		temperature: { base: 20, jitter: 2, unit: '°C' },
		salinity: { base: 33, jitter: 1, unit: 'ppt' },
		ph: { base: 7.0, jitter: 0.3, unit: 'NBS' },
		co2: { base: 8.0, jitter: 1.5, unit: 'mg/L' }
	},
	'tank-2': {
		temperature: { base: 25, jitter: 3, unit: '°C' },
		salinity: { base: 28, jitter: 2, unit: 'ppt' },
		ph: { base: 7.4, jitter: 0.25, unit: 'NBS' },
		co2: { base: 10.0, jitter: 2.0, unit: 'mg/L' }
	},
	'tank-3': {
		temperature: { base: 18, jitter: 1.5, unit: '°C' },
		salinity: { base: 35, jitter: 0.5, unit: 'ppt' },
		ph: { base: 8.1, jitter: 0.2, unit: 'NBS' },
		co2: { base: 5.0, jitter: 1.0, unit: 'mg/L' }
	}
};

const VALID_SENSOR_TYPES: SensorType[] = ['temperature', 'salinity', 'ph', 'co2'];
const VALID_ROUTE_SENSOR_TYPES: RouteSensorType[] = [...VALID_SENSOR_TYPES, 'all'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomReading(spec: SensorSpec): number {
	return spec.base + (Math.random() - 0.5) * spec.jitter;
}

function formatValue(value: number, sensorType: SensorType): string {
	const decimals =
		sensorType === 'ph' ? 2 : sensorType === 'temperature' ? 1 : sensorType === 'co2' ? 2 : 1; // salinity
	return value.toFixed(decimals);
}

// ── SSE handler ───────────────────────────────────────────────────────────────

export const GET: RequestHandler = ({ params }) => {
	const { tankId, sensorType } = params;
	const requestedSensorType = sensorType as RouteSensorType;

	// ── Validate tankId ───────────────────────────────────────────────────────

	const tankConfig = MOCK_CONFIG[tankId];
	if (!tankConfig) {
		return new Response(JSON.stringify({ error: `Unknown tank: "${tankId}"` }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// ── Validate sensorType ───────────────────────────────────────────────────

	if (!VALID_ROUTE_SENSOR_TYPES.includes(requestedSensorType)) {
		return new Response(
			JSON.stringify({
				error: `Unknown sensor type: "${sensorType}"`,
				valid: [...VALID_SENSOR_TYPES, 'all']
			}),
			{ status: 400, headers: { 'Content-Type': 'application/json' } }
		);
	}

	if (requestedSensorType !== 'all') {
		const spec = tankConfig[requestedSensorType];
		if (!spec) {
			return new Response(
				JSON.stringify({
					error: `Tank "${tankId}" has no "${sensorType}" sensor`
				}),
				{ status: 404, headers: { 'Content-Type': 'application/json' } }
			);
		}
	}

	// ── Open SSE stream ───────────────────────────────────────────────────────

	const encoder = new TextEncoder();
	let interval: ReturnType<typeof setInterval>;

	const emitReading = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		sensorKey: SensorType,
		spec: SensorSpec
	) => {
		const reading: SensorReading = {
			tankId,
			sensorType: sensorKey,
			timestamp: new Date().toISOString(),
			value: parseFloat(formatValue(randomReading(spec), sensorKey)),
			unit: spec.unit
		};

		controller.enqueue(encoder.encode(`data: ${JSON.stringify(reading)}\n\n`));
	};

	const emitAllReadings = (controller: ReadableStreamDefaultController<Uint8Array>) => {
		for (const sensor of VALID_SENSOR_TYPES) {
			const sensorSpec = tankConfig[sensor];
			if (!sensorSpec) continue;

			const reading: SensorReading = {
				tankId,
				sensorType: sensor,
				timestamp: new Date().toISOString(),
				value: parseFloat(formatValue(randomReading(sensorSpec), sensor)),
				unit: sensorSpec.unit
			};

			controller.enqueue(encoder.encode(`data: ${JSON.stringify(reading)}\n\n`));
		}
	};

	const stream = new ReadableStream({
		start(controller) {
			// Send one reading immediately so the client doesn't wait
			// for the first interval to fire
			if (requestedSensorType === 'all') {
				emitAllReadings(controller);
			} else {
				const spec = tankConfig[requestedSensorType];
				if (spec) {
					emitReading(controller, requestedSensorType, spec);
				}
			}

			// Then stream on interval
			// In production: query DB here instead of randomReading()
			interval = setInterval(() => {
				if (requestedSensorType === 'all') {
					emitAllReadings(controller);
				} else {
					const spec = tankConfig[requestedSensorType];
					if (spec) {
						emitReading(controller, requestedSensorType, spec);
					}
				}
			}, 1250);
		},

		cancel() {
			// Client disconnected — stop generating readings
			clearInterval(interval);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
